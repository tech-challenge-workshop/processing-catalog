import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import pinoHttp from 'pino-http';
import { CorrelationContext } from './correlation-context';
import { buildRootLoggerConfig } from './logger.config';

function createCapturingLogger(context: CorrelationContext) {
  const raw: string[] = [];
  const sink = new Writable({
    write(chunk: unknown, _encoding, callback) {
      raw.push(String(chunk));
      callback();
    },
  });
  const config = buildRootLoggerConfig(context);
  const instance = pinoHttp(config.pinoHttp, sink);
  return {
    instance,
    raw,
    parsed: (): Record<string, unknown>[] =>
      raw.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

async function withServer(
  logger: ReturnType<typeof createCapturingLogger>,
  handler: (server: Server) => Promise<void>,
): Promise<Record<string, unknown>[]> {
  const server = createServer((req, res) =>
    logger.instance(req, res, () => {
      res.end('ok');
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await handler(server);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  return logger.parsed();
}

describe('buildRootLoggerConfig', () => {
  let context: CorrelationContext;
  const originalLogLevel = process.env.LOG_LEVEL;

  beforeEach(() => {
    context = new CorrelationContext();
    delete process.env.LOG_LEVEL;
  });

  afterEach(() => {
    if (originalLogLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = originalLogLevel;
    }
  });

  it('emits one json line per log with service and the als correlationId', () => {
    const logger = createCapturingLogger(context);

    context.runWithCorrelation('cat-1', () => {
      logger.instance.logger.info('hello world');
    });

    expect(logger.raw).toHaveLength(1);
    const [line] = logger.parsed();
    expect(typeof line['timestamp']).toBe('number');
    expect(line['level']).toBe(30);
    expect(line['msg']).toBe('hello world');
    expect(line['service']).toBe('processing-catalog');
    expect(line['correlationId']).toBe('cat-1');
  });

  it('omits the correlationId key when no correlation scope is active', () => {
    const logger = createCapturingLogger(context);

    logger.instance.logger.info('no scope');

    const [line] = logger.parsed();
    expect(line['service']).toBe('processing-catalog');
    expect(line).not.toHaveProperty('correlationId');
  });

  it('redacts ownerEmail and email at the root and when nested', () => {
    const logger = createCapturingLogger(context);

    logger.instance.logger.info({
      ownerEmail: 'root@example.com',
      email: 'alice@example.com',
      request: { ownerEmail: 'one@example.com', id: 'r-1' },
      event: { data: { ownerEmail: 'two@example.com', eventId: 'e-1' } },
      visible: 'kept',
    });

    const [line] = logger.parsed();
    expect(line).not.toHaveProperty('ownerEmail');
    expect(line).not.toHaveProperty('email');
    expect(line['request']).toEqual({ id: 'r-1' });
    expect(line['event']).toEqual({ data: { eventId: 'e-1' } });
    expect(line['visible']).toBe('kept');
    const output = logger.raw.join('');
    for (const email of [
      'root@example.com',
      'alice@example.com',
      'one@example.com',
      'two@example.com',
    ]) {
      expect(output).not.toContain(email);
    }
  });

  it('redacts storage keys, sensitive headers and error config urls', () => {
    const logger = createCapturingLogger(context);

    logger.instance.logger.info({
      zipStorageKey: 'zip-secret',
      request: { sourceStorageKey: 'src-secret' },
      req: {
        headers: {
          authorization: 'Bearer token-123',
          cookie: 'session=abc',
          'user-agent': 'jest',
        },
      },
      err: { config: { url: 'amqp://user:pass@rabbitmq:5672', port: 5672 } },
    });

    const [line] = logger.parsed();
    expect(line).not.toHaveProperty('zipStorageKey');
    expect(line['request']).toEqual({});
    expect(line['req']).toEqual({ headers: { 'user-agent': 'jest' } });
    expect(line['err']).toEqual({ config: { port: 5672 } });
    const output = logger.raw.join('');
    for (const secret of [
      'zip-secret',
      'src-secret',
      'token-123',
      'session=abc',
      'user:pass',
    ]) {
      expect(output).not.toContain(secret);
    }
  });

  it('skips the access log for health, liveness and metrics only', async () => {
    const logger = createCapturingLogger(context);

    const lines = await withServer(logger, async (server) => {
      const { port } = server.address() as AddressInfo;
      for (const path of [
        '/health',
        '/health/live',
        '/metrics',
        '/processing-requests',
      ]) {
        const response = await fetch(`http://127.0.0.1:${port}${path}`);
        expect(response.status).toBe(200);
      }
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]['msg']).toBe('request completed');
    expect(lines[0]['service']).toBe('processing-catalog');
    expect((lines[0]['req'] as { url: string }).url).toBe(
      '/processing-requests',
    );
  });

  it('defaults to the info level when LOG_LEVEL is unset', () => {
    const logger = createCapturingLogger(context);

    logger.instance.logger.debug('hidden debug');
    logger.instance.logger.info('shown info');

    expect(logger.parsed().map((line) => line['msg'])).toEqual(['shown info']);
  });

  it('honors LOG_LEVEL from the environment', () => {
    process.env.LOG_LEVEL = 'error';
    const logger = createCapturingLogger(context);

    logger.instance.logger.info('hidden info');
    logger.instance.logger.error('shown error');

    expect(logger.parsed().map((line) => line['msg'])).toEqual(['shown error']);
  });
});
