import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import * as ts from 'typescript';

/**
 * Guards AD-011: topology that more than one service declares is a broker
 * policy, never a queue argument.
 *
 * Five of this service's queues are also declared by `processing-worker`.
 * RabbitMQ compares a redeclaration against the existing queue and rejects
 * any difference, then **closes the channel of whoever declared second**:
 *
 *   PRECONDITION_FAILED - inequivalent arg 'x-dead-letter-exchange'
 *   for queue 'video.accepted': received none but current is 'fiapx.events.dlx'
 *
 * That is not hypothetical. Adding `x-dead-letter-exchange` here once closed
 * the Worker's channel, so `VideoAccepted` was never published and every
 * request stalled at RECEIVED - while all six containers reported healthy and
 * every gate in this repository stayed green. Which service loses depends on
 * boot order, so the same code can work on one boot and fail on the next.
 *
 * The dead-letter routing now lives in `fiap-x-platform/rabbitmq/definitions.json`
 * as a policy. A policy binds no declarer, so no service can contradict another.
 *
 * This reads the sources rather than a running broker: nothing else in the
 * gate talks to a broker that already holds a differing declaration.
 */

/** Where the routing this guard protects is actually configured. */
const POLICY_LOCATION = 'fiap-x-platform/rabbitmq/definitions.json';

interface Declaration {
  file: string;
  line: number;
  queue: string;
  argumentKeys: string[];
}

const sourceFiles = (dir: string): string[] => {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    // AppleDouble sidecars on exFAT are not source.
    if (entry.startsWith('._')) {
      continue;
    }
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
      found.push(path);
    }
  }
  return found;
};

const keysOfArgumentsProperty = (
  options: ts.ObjectLiteralExpression,
): string[] | undefined => {
  for (const property of options.properties) {
    if (
      !ts.isPropertyAssignment(property) ||
      property.name.getText() !== 'arguments'
    ) {
      continue;
    }
    if (!ts.isObjectLiteralExpression(property.initializer)) {
      // An arguments table this guard cannot read is worse than one it can:
      // report it rather than let it through unseen.
      return ['<not a literal this guard can read>'];
    }
    return property.initializer.properties
      .map((entry) => entry.name?.getText() ?? '<computed>')
      .map((name) => name.replace(/^['"]|['"]$/g, ''));
  }
  return undefined;
};

/**
 * A queue whose name says it is a dead-letter target is declared by this
 * service alone, so the policy never reaches it and arguments on it are safe.
 * The name is the whole signal - a declaration that wants this exemption has
 * to say so where the next reader will see it.
 */
const isDeadLetterTarget = (queue: string): boolean =>
  /dlq|deadletter/i.test(queue);

const declarationsWithArguments = (files: string[]): Declaration[] => {
  const found: Declaration[] = [];

  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
    );

    const record = (
      node: ts.Node,
      queue: string,
      options: ts.ObjectLiteralExpression,
    ): void => {
      const argumentKeys = keysOfArgumentsProperty(options);
      if (!argumentKeys || argumentKeys.length === 0) {
        return;
      }
      if (isDeadLetterTarget(queue)) {
        return;
      }
      found.push({
        file,
        line:
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        queue,
        argumentKeys,
      });
    };

    const visit = (node: ts.Node): void => {
      // channel.assertQueue(name, { ... })
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.getText() === 'assertQueue' &&
        node.arguments.length >= 2
      ) {
        const options = node.arguments[1];
        if (ts.isObjectLiteralExpression(options)) {
          record(
            node,
            node.arguments[0].getText().replace(/^['"]|['"]$/g, ''),
            options,
          );
        }
      }

      // { queue: '...', queueOptions: { ... } } - the ClientsModule and
      // microservice transport shape.
      if (
        ts.isPropertyAssignment(node) &&
        node.name.getText() === 'queueOptions' &&
        ts.isObjectLiteralExpression(node.initializer) &&
        ts.isObjectLiteralExpression(node.parent)
      ) {
        // A spread has no name at all, so narrow to the two forms that do
        // before asking for one.
        const named = node.parent.properties.filter(
          (
            property,
          ): property is
            ts.PropertyAssignment | ts.ShorthandPropertyAssignment =>
            ts.isPropertyAssignment(property) ||
            ts.isShorthandPropertyAssignment(property),
        );
        const sibling = named.find(
          (property) => property.name.getText() === 'queue',
        );
        // `queue` is often a variable or a shorthand, so the literal name is
        // frequently unknowable here. That is deliberately not treated as a
        // pass: a name this guard cannot read is a name it cannot exempt, and
        // defaulting to "allowed" is how the original defect shipped.
        const queue = sibling
          ? ts.isPropertyAssignment(sibling)
            ? sibling.initializer.getText().replace(/^['"]|['"]$/g, '')
            : sibling.name.getText()
          : '<a queue this guard cannot name>';
        record(node, queue, node.initializer);
      }

      ts.forEachChild(node, visit);
    };

    visit(source);
  }

  return found;
};

const SRC = join(__dirname, '..', '..');

describe('broker topology (AD-011)', () => {
  const files = sourceFiles(SRC);

  it('reads the sources where queues are declared', () => {
    // A guard that silently stops finding its subject passes forever.
    const declaring = files.filter((file) =>
      /assertQueue|queueOptions/.test(readFileSync(file, 'utf8')),
    );

    expect(declaring.length).toBeGreaterThan(0);
  });

  it('declares no queue with arguments that a policy must own', () => {
    const violations = declarationsWithArguments(files);

    // RabbitMQ compares the **entire** arguments table, so any key makes a
    // redeclaration inequivalent - not only the dead-letter ones that caused
    // the outage. The rule is therefore all arguments, not a deny-list that
    // the next feature would step around.
    const explained = violations.map(
      (violation) =>
        `${relative(process.cwd(), violation.file)}:${violation.line} ` +
        `declares '${violation.queue}' ` +
        `with arguments [${violation.argumentKeys.join(', ')}]. ` +
        `AD-011: another service declares this queue too, and RabbitMQ will ` +
        `close whichever channel declares second. Configure it as a policy ` +
        `in ${POLICY_LOCATION} instead.`,
    );

    expect(explained).toEqual([]);
  });
});
