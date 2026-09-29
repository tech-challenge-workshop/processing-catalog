import { correlationContext } from '../../observability/correlation-context';
import {
  catalogMetrics,
  type ConsumedEventName,
} from '../../observability/metrics';
import { ProcessingCompletedConsumer } from './processing-completed.consumer';
import { ProcessingFailedConsumer } from './processing-failed.consumer';
import { ProcessingStartedConsumer } from './processing-started.consumer';
import { RabbitMQConnection } from './rabbitmq.connection';
import { VideoAcceptedConsumer } from './video-accepted.consumer';
import { VideoRejectedConsumer } from './video-rejected.consumer';

interface StubUseCase {
  execute: jest.Mock<Promise<void>, []>;
  seen: (string | undefined)[];
}

type Consumer = { onModuleInit(): Promise<void> };

/**
 * Each of the five consumers, driven through its real channel callback: the
 * wrapped path the broker exercises, not `handleMessage` directly.
 */
const consumers: [
  ConsumedEventName,
  (connection: RabbitMQConnection, useCase: never) => Consumer,
  Record<string, unknown>,
][] = [
  [
    'VideoAccepted',
    (c, u) => new VideoAcceptedConsumer(c, u),
    { eventId: 'e-1', processingRequestId: 'pr-1', occurredAt: 'now' },
  ],
  [
    'VideoRejected',
    (c, u) => new VideoRejectedConsumer(c, u),
    {
      eventId: 'e-1',
      processingRequestId: 'pr-1',
      failureCode: 'FORMATO_INVALIDO',
      occurredAt: 'now',
    },
  ],
  [
    'ProcessingStarted',
    (c, u) => new ProcessingStartedConsumer(c, u),
    {
      eventId: 'e-1',
      processingRequestId: 'pr-1',
      attemptId: 'a-1',
      occurredAt: 'now',
    },
  ],
  [
    'ProcessingCompleted',
    (c, u) => new ProcessingCompletedConsumer(c, u),
    {
      eventId: 'e-1',
      processingRequestId: 'pr-1',
      attemptId: 'a-1',
      zipStorageKey: 'zips/out.zip',
      occurredAt: 'now',
    },
  ],
  [
    'ProcessingFailed',
    (c, u) => new ProcessingFailedConsumer(c, u),
    {
      eventId: 'e-1',
      processingRequestId: 'pr-1',
      attemptId: 'a-1',
      failureCode: 'PROCESSAMENTO_FALHOU',
      occurredAt: 'now',
    },
  ],
];

describe('consumers: correlation context and consumed counter', () => {
  beforeEach(() => {
    catalogMetrics.resetMetrics();
  });

  const stubUseCase = (): StubUseCase => {
    const stub: StubUseCase = {
      seen: [],
      execute: jest.fn(() => {
        stub.seen.push(correlationContext.getCorrelationId());
        return Promise.resolve();
      }),
    };
    return stub;
  };

  const deliver = async (
    make: (connection: RabbitMQConnection, useCase: never) => Consumer,
    useCase: StubUseCase,
    body: unknown,
  ) => {
    let handler: ((message: unknown) => void) | undefined;
    const channel = {
      consume: jest.fn((_queue: string, h: (message: unknown) => void) => {
        handler = h;
        return Promise.resolve();
      }),
      ack: jest.fn(),
      nack: jest.fn(),
    };
    await make(
      { getConsumeChannel: () => channel } as unknown as RabbitMQConnection,
      useCase as never,
    ).onModuleInit();
    const message = { content: Buffer.from(JSON.stringify(body)) };
    handler!(message);
    for (
      let i = 0;
      i < 100 &&
      channel.ack.mock.calls.length + channel.nack.mock.calls.length === 0;
      i++
    ) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    return { channel, message };
  };

  const consumedLines = async () =>
    (await catalogMetrics.metrics())
      .split('\n')
      .filter((line) => line.startsWith('fiapx_events_consumed_total{'));

  it.each(consumers)(
    '%s: handles under the message id and counts the ack under its own event',
    async (event, make, payload) => {
      const useCase = stubUseCase();

      const { channel, message } = await deliver(make, useCase, {
        pattern: event,
        data: { ...payload, correlationId: 'cat-1' },
      });

      expect(useCase.seen).toEqual(['cat-1']);
      expect(channel.ack).toHaveBeenCalledWith(message);
      expect(await consumedLines()).toEqual([
        `fiapx_events_consumed_total{event="${event}",outcome="acked"} 1`,
      ]);
    },
  );

  it.each(consumers)(
    '%s: counts a malformed message under its own event as dead_lettered',
    async (event, make) => {
      const useCase = stubUseCase();

      const { channel, message } = await deliver(make, useCase, {
        correlationId: 'cat-1',
      });

      expect(useCase.execute).not.toHaveBeenCalled();
      expect(channel.nack).toHaveBeenCalledWith(message, false, false);
      expect(await consumedLines()).toEqual([
        `fiapx_events_consumed_total{event="${event}",outcome="dead_lettered"} 1`,
      ]);
    },
  );

  it('handles a message without a correlationId under a generated id and acks it (OBS-20)', async () => {
    const [event, make, payload] = consumers[0];
    const useCase = stubUseCase();

    const { channel } = await deliver(make, useCase, payload);

    expect(useCase.seen).toHaveLength(1);
    expect(useCase.seen[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(channel.ack).toHaveBeenCalledTimes(1);
    expect(await consumedLines()).toEqual([
      `fiapx_events_consumed_total{event="${event}",outcome="acked"} 1`,
    ]);
  });
});
