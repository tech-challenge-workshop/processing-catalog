// The e2e suites' database name, kept apart from the setup file so a suite
// can test the rule without applying it.

export const E2E_DATABASE_NAME = 'fiapx_e2e';
const STACK_DATABASE_NAME = 'fiapx';

type DatabaseEnv = Partial<
  Record<'DATABASE_HOST' | 'DATABASE_NAME', string | undefined>
>;

/**
 * The database the e2e suites use: the explicit `DATABASE_NAME` when one is
 * set, `fiapx_e2e` when only a host is, and none without a database at all.
 * The stack's own database is refused outright.
 */
export function resolveE2eDatabaseName(env: DatabaseEnv): string | undefined {
  if (env.DATABASE_NAME === STACK_DATABASE_NAME) {
    throw new Error(
      `e2e suites must not run against the stack's database (DATABASE_NAME=${STACK_DATABASE_NAME})`,
    );
  }
  if (env.DATABASE_NAME) {
    return env.DATABASE_NAME;
  }
  return env.DATABASE_HOST ? E2E_DATABASE_NAME : undefined;
}

export function applyE2eDatabaseName(): string | undefined {
  const name = resolveE2eDatabaseName(process.env);
  if (name) {
    process.env.DATABASE_NAME = name;
  }
  return name;
}
