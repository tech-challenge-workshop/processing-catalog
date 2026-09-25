import { ProcessingRequestDomainError } from '../../domain/processing-request';
import {
  DEFAULT_RETRY_BACKOFF_MS,
  isPermanentFailure,
  retryBackoffMs,
  settleFailedMessage,
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
});
