import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { RABBITMQ_QUEUES } from './rabbitmq.connection';

/**
 * A consumer that subscribes to a queue nobody declared dies at startup with
 * `404 NOT-FOUND`, and no fake connection can reveal it: the fake answers
 * `consume` for any name. This reads the consumers themselves, so adding one
 * without declaring its queue fails here instead of in a container.
 */
describe('queue declaration', () => {
  const dir = __dirname;

  const consumedQueues = (): { file: string; queue: string }[] => {
    const found: { file: string; queue: string }[] = [];
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.consumer.ts') || file.endsWith('.spec.ts')) {
        continue;
      }
      const source = readFileSync(join(dir, file), 'utf8');
      for (const match of source.matchAll(/channel\.consume\(\s*'([^']+)'/g)) {
        found.push({ file, queue: match[1] });
      }
    }
    return found;
  };

  it('finds a consumed queue for every consumer in this folder', () => {
    const consumed = consumedQueues();

    expect(consumed.length).toBeGreaterThanOrEqual(5);
  });

  it('declares every queue a consumer subscribes to', () => {
    const declared = new Set<string>(RABBITMQ_QUEUES);
    const undeclared = consumedQueues().filter(
      ({ queue }) => !declared.has(queue),
    );

    expect(undeclared).toEqual([]);
  });
});
