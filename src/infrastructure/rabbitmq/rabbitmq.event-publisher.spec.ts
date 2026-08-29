import { RabbitMQEventPublisher } from './rabbitmq.event-publisher';
import {
  RABBITMQ_EXCHANGE,
  type RabbitMQConnection,
} from './rabbitmq.connection';

describe('RabbitMQEventPublisher', () => {
  let publishMock: jest.Mock;
  let connectionMock: RabbitMQConnection;
  let publisher: RabbitMQEventPublisher;

  beforeEach(() => {
    publishMock = jest.fn().mockResolvedValue(true);
    connectionMock = {
      getPublishChannel: () =>
        ({
          publish: publishMock,
        }) as unknown as {
          publish: (
            exchange: string,
            routingKey: string,
            content: unknown,
          ) => Promise<boolean>;
        },
    } as unknown as RabbitMQConnection;
    publisher = new RabbitMQEventPublisher(connectionMock);
  });

  it('publishes VideoValidationRequested with the correct routing key', async () => {
    const event = {
      eventId: 'event-1',
      processingRequestId: 'req-1',
      ownerUserId: 'user-1',
      sourceStorageKey: 'videos/input.mp4',
      occurredAt: new Date().toISOString(),
    };

    await publisher.publishVideoValidationRequested(event);

    expect(publishMock).toHaveBeenCalledTimes(1);
    expect(publishMock).toHaveBeenCalledWith(
      RABBITMQ_EXCHANGE,
      'video.validation.requested',
      event,
    );
  });

  it('publishes ProcessingQueued with attemptId', async () => {
    const event = {
      eventId: 'event-2',
      processingRequestId: 'req-2',
      ownerUserId: 'user-2',
      sourceStorageKey: 'videos/input.mp4',
      attemptId: 'attempt-2',
      occurredAt: new Date().toISOString(),
    };

    await publisher.publishProcessingQueued(event);

    expect(publishMock).toHaveBeenCalledWith(
      RABBITMQ_EXCHANGE,
      'processing.queued',
      event,
    );
  });

  it('publishes TerminalEvent with status and zip key', async () => {
    const event = {
      eventId: 'event-3',
      processingRequestId: 'req-3',
      ownerUserId: 'user-3',
      status: 'COMPLETED' as const,
      zipStorageKey: 'zips/output.zip',
      occurredAt: new Date().toISOString(),
    };

    await publisher.publishTerminalEvent(event);

    expect(publishMock).toHaveBeenCalledWith(
      RABBITMQ_EXCHANGE,
      'processing.terminal',
      event,
    );
  });
});
