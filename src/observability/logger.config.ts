import { randomUUID } from 'node:crypto';
import type { Options as PinoHttpOptions } from 'pino-http';
import { CorrelationContext, parseCorrelationId } from './correlation-context';

const ACCESS_LOG_EXCLUDED_PATHS = ['/health', '/health/live', '/metrics'];

// SPEC_DEVIATION: design.md lists only `*.`-prefixed paths. The redactor's
// wildcards need a parent key, so a root-level `{ ownerEmail }` would survive,
// and a logged event envelope (`{ event: { data: { ownerEmail } } }`) nests
// the field two levels deep. The bare keys and the two-level wildcard are
// added so OBS-22's outcome (the owner's email never appears in a log line)
// holds for every shape the Catalog logs.
// Reason: the spec-defined outcome outranks the design's literal path list.
const REDACTED_KEYS = [
  'email',
  'ownerEmail',
  'zipStorageKey',
  'sourceStorageKey',
];
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  // Defensive, per design.md: a client error echoing its connection config
  // must not leak the AMQP URL's credentials.
  'err.config.url',
  ...REDACTED_KEYS,
  ...REDACTED_KEYS.map((key) => `*.${key}`),
  ...REDACTED_KEYS.map((key) => `*.*.${key}`),
];

// `service` lives in the root mixin, not pino-http `customProps`: customProps
// reaches only request-scoped loggers, and OBS-22 requires it on every line
// (bootstrap, the relay scheduler, consumers).
const SERVICE_NAME = 'processing-catalog';

export interface RootLoggerConfig {
  pinoHttp: PinoHttpOptions;
}

export function buildRootLoggerConfig(
  context: CorrelationContext,
): RootLoggerConfig {
  return {
    pinoHttp: {
      level: process.env.LOG_LEVEL ?? 'info',
      timestamp: () => `,"timestamp":${Date.now()}`,
      mixin: () => {
        const correlationId = context.getCorrelationId();
        return correlationId === undefined
          ? { service: SERVICE_NAME }
          : { service: SERVICE_NAME, correlationId };
      },
      redact: { paths: REDACT_PATHS, remove: true },
      genReqId: (req) =>
        parseCorrelationId(req.headers['x-correlation-id']) ?? randomUUID(),
      autoLogging: {
        ignore: (req) => {
          const url = req.url;
          return url !== undefined && ACCESS_LOG_EXCLUDED_PATHS.includes(url);
        },
      },
    },
  };
}
