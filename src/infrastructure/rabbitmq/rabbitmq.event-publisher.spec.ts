import { RabbitMQEventPublisher } from './rabbitmq.event-publisher';
import { type RabbitMQConnection } from './rabbitmq.connection';

describe('RabbitMQEventPublisher', () => {
  let sendToQueueMock: jest.Mock;
  let connectionMock: RabbitMQConnection;
  let publisher: RabbitMQEventPublisher;

  beforeEach(() => {
    sendToQueueMock = jest.fn().mockResolvedValue(undefined);
    connectionMock = {
      sendToQueue: sendToQueueMock,
    } as unknown as RabbitMQConnection;
    publisher = new RabbitMQEventPublisher(connectionMock);
  });

  it('publishes VideoValidationRequested to the worker validation queue', async () => {
    const event = {
      eventId: 'event-1',
      processingRequestId: 'req-1',
      ownerUserId: 'user-1',
      sourceStorageKey: 'videos/input.mp4',
      occurredAt: new Date().toISOString(),
    };

    await publisher.publishVideoValidationRequested(event);

    expect(sendToQueueMock).toHaveBeenCalledTimes(1);
    expect(sendToQueueMock).toHaveBeenCalledWith(
      'video-validation',
      'VideoValidationRequested',
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

    expect(sendToQueueMock).toHaveBeenCalledWith(
      'processing',
      'ProcessingQueued',
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

    expect(sendToQueueMock).toHaveBeenCalledWith(
      'notification.terminal',
      'terminal.event',
      event,
    );
  });
});
