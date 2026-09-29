import { ProcessingRequestDomainError } from '../../domain/processing-request';
import { catalogMetrics } from '../../observability/metrics';
import {
  DEFAULT_RETRY_BACKOFF_MS,
  isPermanentFailure,
  retryBackoffMs,
  settleFailedMessage,
  settleMessage,
} from './settle-failed-message';

describe('settleFailedMessage', () => {
  const message = { content: Buffer.from('{}') };

  const channel = () => ({ nack: jest.fn() });

  it('dead-letters a domain error without requeue', async () => {
    const ch = channel();

    await settleFailedMessage(
      ch,
      message,
      new ProcessingRequestDomainError(
        'Cannot start request in RECEIVED status',
      ),
      0,
    );

    expect(ch.nack).toHaveBeenCalledWith(message, false, false);
  });

  it('dead-letters a body that is not JSON, instead of requeueing it forever', async () => {
    const ch = channel();
    let parseError: unknown;
    try {
      JSON.parse('{not json');
    } catch (error) {
      parseError = error;
    }

    await settleFailedMessage(ch, message, parseError, 0);

    expect(ch.nack).toHaveBeenCalledWith(message, false, false);
  });

  it('requeues an infrastructure error', async () => {
    const ch = channel();

    await settleFailedMessage(ch, message, new Error('connection refused'), 0);

    expect(ch.nack).toHaveBeenCalledWith(message, false, true);
  });

  it('waits the backoff before requeueing, so a dead dependency does not spin the queue', async () => {
    jest.useFakeTimers();
    try {
      const ch = channel();

      const settled = settleFailedMessage(
        ch,
        message,
        new Error('connection refused'),
        1000,
      );
      await jest.advanceTimersByTimeAsync(999);
      expect(ch.nack).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(1);
      await settled;
      expect(ch.nack).toHaveBeenCalledWith(message, false, true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not wait before dead-lettering', async () => {
    jest.useFakeTimers();
    try {
      const ch = channel();

      await settleFailedMessage(
        ch,
        message,
        new ProcessingRequestDomainError('bad'),
        1000,
      );

      expect(ch.nack).toHaveBeenCalledWith(message, false, false);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('isPermanentFailure', () => {
  it('treats a TypeError as transient, so a bug is retried and logged rather than silently dead-lettered', () => {
    expect(isPermanentFailure(new TypeError('x is undefined'))).toBe(false);
  });
});

describe('retryBackoffMs', () => {
  const previous = process.env.RABBITMQ_RETRY_BACKOFF_MS;
  afterEach(() => {
    if (previous === undefined) {
      delete process.env.RABBITMQ_RETRY_BACKOFF_MS;
    } else {
      process.env.RABBITMQ_RETRY_BACKOFF_MS = previous;
    }
  });

  it('defaults when unset or invalid', () => {
    delete process.env.RABBITMQ_RETRY_BACKOFF_MS;
    expect(retryBackoffMs()).toBe(DEFAULT_RETRY_BACKOFF_MS);
    process.env.RABBITMQ_RETRY_BACKOFF_MS = 'soon';
    expect(retryBackoffMs()).toBe(DEFAULT_RETRY_BACKOFF_MS);
  });

  it('reads a configured value', () => {
    process.env.RABBITMQ_RETRY_BACKOFF_MS = '250';
    expect(retryBackoffMs()).toBe(250);
  });

  it.each([
    ['empty', '', 1000],
    ['whitespace only', '  ', 1000],
    ['zero', '0', 0],
    ['a valid value', '250', 250],
    ['negative', '-1', 1000],
    ['not a number', 'abc', 1000],
  ])('maps %s (%j) to %d ms', (_label, raw, expected) => {
    process.env.RABBITMQ_RETRY_BACKOFF_MS = raw;
    expect(retryBackoffMs()).toBe(expected);
  });

  it('maps unset to 1000 ms', () => {
    delete process.env.RABBITMQ_RETRY_BACKOFF_MS;
    expect(retryBackoffMs()).toBe(1000);
  });
});

describe('settleMessage (OBS-25)', () => {
  const message = { content: Buffer.from('{}') };

  const channel = () => ({ ack: jest.fn(), nack: jest.fn() });

  const consumed = async () =>
    (await catalogMetrics.metrics())
      .split('\n')
      .filter((line) => line.startsWith('fiapx_events_consumed_total{'));

  beforeEach(() => {
    catalogMetrics.resetMetrics();
  });

  it('acks a handled message and counts it once as acked under the caller event', async () => {
    const ch = channel();

    await settleMessage(
      ch,
      message,
      'VideoAccepted',
      () => Promise.resolve(),
      0,
    );

    expect(ch.ack).toHaveBeenCalledWith(message);
    expect(ch.nack).not.toHaveBeenCalled();
    expect(await consumed()).toEqual([
      'fiapx_events_consumed_total{event="VideoAccepted",outcome="acked"} 1',
    ]);
  });

  it('dead-letters a permanent failure and counts it once as dead_lettered', async () => {
    const ch = channel();

    await settleMessage(
      ch,
      message,
      'ProcessingFailed',
      () => Promise.reject(new ProcessingRequestDomainError('bad payload')),
      0,
    );

    expect(ch.ack).not.toHaveBeenCalled();
    expect(ch.nack).toHaveBeenCalledWith(message, false, false);
    expect(await consumed()).toEqual([
      'fiapx_events_consumed_total{event="ProcessingFailed",outcome="dead_lettered"} 1',
    ]);
  });

  it('dead-letters a body that is not JSON and counts it as dead_lettered', async () => {
    const ch = channel();

    await settleMessage(
      ch,
      message,
      'VideoRejected',
      () =>
        Promise.resolve().then(() => {
          JSON.parse('{not json');
        }),
      0,
    );

    expect(ch.nack).toHaveBeenCalledWith(message, false, false);
    expect(await consumed()).toEqual([
      'fiapx_events_consumed_total{event="VideoRejected",outcome="dead_lettered"} 1',
    ]);
  });

  it('requeues a transient failure without counting it, since the message is not settled yet', async () => {
    const ch = channel();

    await settleMessage(
      ch,
      message,
      'ProcessingStarted',
      () => Promise.reject(new Error('connection refused')),
      0,
    );

    expect(ch.ack).not.toHaveBeenCalled();
    expect(ch.nack).toHaveBeenCalledWith(message, false, true);
    expect(await consumed()).toEqual([]);
  });

  it('counts a requeued message exactly once when its redelivery is acked', async () => {
    const ch = channel();

    await settleMessage(
      ch,
      message,
      'ProcessingCompleted',
      () => Promise.reject(new Error('connection refused')),
      0,
    );
    await settleMessage(
      ch,
      message,
      'ProcessingCompleted',
      () => Promise.resolve(),
      0,
    );

    expect(await consumed()).toEqual([
      'fiapx_events_consumed_total{event="ProcessingCompleted",outcome="acked"} 1',
    ]);
  });
});
