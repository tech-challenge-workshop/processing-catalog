import type { ChannelWrapper } from 'amqp-connection-manager';
import {
  RabbitMQConnection,
  outboxPublishTimeoutMs,
} from './rabbitmq.connection';

const restoreTimeoutEnv = (previous: string | undefined) => () => {
  if (previous === undefined) {
    delete process.env.OUTBOX_PUBLISH_TIMEOUT_MS;
  } else {
    process.env.OUTBOX_PUBLISH_TIMEOUT_MS = previous;
  }
};

describe('RabbitMQConnection.sendToQueue', () => {
  afterEach(restoreTimeoutEnv(process.env.OUTBOX_PUBLISH_TIMEOUT_MS));

  const connectionWithFakeWrapper = () => {
    const wrapper = { sendToQueue: jest.fn().mockResolvedValue(true) };
    const connection = new RabbitMQConnection();
    jest
      .spyOn(connection, 'getPublishChannel')
      .mockReturnValue(wrapper as unknown as ChannelWrapper);
    return { connection, wrapper };
  };

  it('publishes with a 5000 ms timeout by default', async () => {
    delete process.env.OUTBOX_PUBLISH_TIMEOUT_MS;
    const { connection, wrapper } = connectionWithFakeWrapper();

    await connection.sendToQueue('processing.queued', 'ProcessingQueued', {
      id: 'r1',
    });

    expect(wrapper.sendToQueue).toHaveBeenCalledWith(
      'processing.queued',
      { pattern: 'ProcessingQueued', data: { id: 'r1' } },
      { timeout: 5000 },
    );
  });

  it('publishes with the configured timeout', async () => {
    process.env.OUTBOX_PUBLISH_TIMEOUT_MS = '750';
    const { connection, wrapper } = connectionWithFakeWrapper();

    await connection.sendToQueue('processing.queued', 'ProcessingQueued', {
      id: 'r1',
    });

    expect(wrapper.sendToQueue).toHaveBeenCalledWith(
      'processing.queued',
      { pattern: 'ProcessingQueued', data: { id: 'r1' } },
      { timeout: 750 },
    );
  });
});

describe('outboxPublishTimeoutMs', () => {
  afterEach(restoreTimeoutEnv(process.env.OUTBOX_PUBLISH_TIMEOUT_MS));

  it.each([
    ['empty', '', 5000],
    ['whitespace only', '  ', 5000],
    ['zero', '0', 0],
    ['a valid value', '250', 250],
    ['negative', '-1', 5000],
    ['not a number', 'abc', 5000],
  ])('maps %s (%j) to %d ms', (_label, raw, expected) => {
    process.env.OUTBOX_PUBLISH_TIMEOUT_MS = raw;
    expect(outboxPublishTimeoutMs()).toBe(expected);
  });

  it('maps unset to 5000 ms', () => {
    delete process.env.OUTBOX_PUBLISH_TIMEOUT_MS;
    expect(outboxPublishTimeoutMs()).toBe(5000);
  });
});
