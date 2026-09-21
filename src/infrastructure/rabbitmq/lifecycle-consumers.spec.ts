import { randomUUID } from 'crypto';
import {
  ProcessingRequestStatus,
  startProcessingRequest,
} from '../../domain/processing-request';
import { AcceptProcessingRequestUseCase } from '../../application/accept-processing-request.use-case';
import { CreateProcessingRequestUseCase } from '../../application/create-processing-request.use-case';
import { FailProcessingRequestUseCase } from '../../application/fail-processing-request.use-case';
import { StartProcessingRequestUseCase } from '../../application/start-processing-request.use-case';
import { InMemoryEventPublisher } from '../in-memory-event-publisher';
import { InMemoryProcessingRequestRepository } from '../in-memory-processing-request.repository';
import { ProcessingFailedConsumer } from './processing-failed.consumer';
import { ProcessingStartedConsumer } from './processing-started.consumer';
import { RabbitMQConnection } from './rabbitmq.connection';
import { VideoRejectedConsumer } from './video-rejected.consumer';

describe('lifecycle consumers', () => {
  let repository: InMemoryProcessingRequestRepository;
  let publisher: InMemoryEventPublisher;
  const connection = {} as RabbitMQConnection;

  beforeEach(() => {
    repository = new InMemoryProcessingRequestRepository();
    publisher = new InMemoryEventPublisher();
  });

  const received = () =>
    new CreateProcessingRequestUseCase(repository, publisher).execute({
      eventId: randomUUID(),
      ownerUserId: 'user-123',
      sourceStorageKey: 'videos/input.mp4',
    });

  const queued = async () => {
    const created = await received();
    return new AcceptProcessingRequestUseCase(repository, publisher).execute({
      eventId: randomUUID(),
      processingRequestId: created.processingRequestId,
      occurredAt: new Date().toISOString(),
    });
  };

  describe('VideoRejectedConsumer', () => {
    const consumer = () =>
      new VideoRejectedConsumer(
        connection,
        new FailProcessingRequestUseCase(repository, publisher),
      );

    it('moves the request to FAILED and publishes one terminal event', async () => {
      const request = await received();
      const before = publisher.publishedTerminalEvents.length;

      await consumer().handleMessage(
        JSON.stringify({
          eventId: 'rejected-1',
          processingRequestId: request.processingRequestId,
          failureCode: 'FORMATO_INVALIDO',
          occurredAt: new Date().toISOString(),
        }),
      );

      expect(
        (
          await repository.findByProcessingRequestId(
            request.processingRequestId,
          )
        )?.status,
      ).toBe(ProcessingRequestStatus.FAILED);
      expect(publisher.publishedTerminalEvents).toHaveLength(before + 1);
    });

    it('unwraps a Nest data envelope', async () => {
      const request = await received();

      await consumer().handleMessage(
        JSON.stringify({
          pattern: 'VideoRejected',
          data: {
            eventId: 'rejected-1',
            processingRequestId: request.processingRequestId,
            failureCode: 'DURACAO_EXCEDIDA',
            occurredAt: new Date().toISOString(),
          },
        }),
      );

      expect(
        (
          await repository.findByProcessingRequestId(
            request.processingRequestId,
          )
        )?.failureCode,
      ).toBe('DURACAO_EXCEDIDA');
    });

    it('rejects a payload with no failureCode', async () => {
      await expect(
        consumer().handleMessage(
          JSON.stringify({
            eventId: 'rejected-1',
            processingRequestId: 'req-1',
            occurredAt: new Date().toISOString(),
          }),
        ),
      ).rejects.toThrow('Invalid VideoRejected payload');
    });

    it('rejects a payload with no processingRequestId', async () => {
      await expect(
        consumer().handleMessage(
          JSON.stringify({
            eventId: 'rejected-1',
            failureCode: 'FORMATO_INVALIDO',
            occurredAt: new Date().toISOString(),
          }),
        ),
      ).rejects.toThrow('Invalid VideoRejected payload');
    });
  });

  describe('ProcessingStartedConsumer', () => {
    const consumer = () =>
      new ProcessingStartedConsumer(
        connection,
        new StartProcessingRequestUseCase(repository),
      );

    it('moves a queued request to PROCESSING', async () => {
      const request = await queued();

      await consumer().handleMessage(
        JSON.stringify({
          eventId: 'started-1',
          processingRequestId: request.processingRequestId,
          attemptId: request.attemptId,
          occurredAt: new Date().toISOString(),
        }),
      );

      expect(
        (
          await repository.findByProcessingRequestId(
            request.processingRequestId,
          )
        )?.status,
      ).toBe(ProcessingRequestStatus.PROCESSING);
    });

    it('applies no second transition for a duplicate delivery', async () => {
      const request = await queued();
      const content = JSON.stringify({
        eventId: 'started-1',
        processingRequestId: request.processingRequestId,
        attemptId: request.attemptId,
        occurredAt: new Date().toISOString(),
      });

      await consumer().handleMessage(content);
      await consumer().handleMessage(content);

      expect(
        (
          await repository.findByProcessingRequestId(
            request.processingRequestId,
          )
        )?.status,
      ).toBe(ProcessingRequestStatus.PROCESSING);
    });

    it('rejects a malformed payload', async () => {
      await expect(
        consumer().handleMessage(JSON.stringify({ eventId: 'started-1' })),
      ).rejects.toThrow('Invalid ProcessingStarted payload');
    });
  });

  describe('ProcessingFailedConsumer', () => {
    const consumer = () =>
      new ProcessingFailedConsumer(
        connection,
        new FailProcessingRequestUseCase(repository, publisher),
      );

    it('moves a processing request to FAILED with the reported code', async () => {
      const request = await queued();
      await repository.update(startProcessingRequest(request));

      await consumer().handleMessage(
        JSON.stringify({
          eventId: 'failed-1',
          processingRequestId: request.processingRequestId,
          attemptId: request.attemptId,
          failureCode: 'PROCESSAMENTO_FALHOU',
          occurredAt: new Date().toISOString(),
        }),
      );

      const stored = await repository.findByProcessingRequestId(
        request.processingRequestId,
      );
      expect(stored?.status).toBe(ProcessingRequestStatus.FAILED);
      expect(stored?.failureCode).toBe('PROCESSAMENTO_FALHOU');
    });

    it('does not mark the event processed when publication fails', async () => {
      const request = await queued();
      await repository.update(startProcessingRequest(request));
      jest
        .spyOn(publisher, 'publishTerminalEvent')
        .mockImplementationOnce(() => {
          throw new Error('broker down');
        });

      await expect(
        consumer().handleMessage(
          JSON.stringify({
            eventId: 'failed-1',
            processingRequestId: request.processingRequestId,
            attemptId: request.attemptId,
            failureCode: 'PROCESSAMENTO_FALHOU',
            occurredAt: new Date().toISOString(),
          }),
        ),
      ).rejects.toThrow('broker down');

      expect(await repository.hasEventBeenProcessed('failed-1')).toBe(false);
    });

    it('rejects a malformed payload', async () => {
      await expect(
        consumer().handleMessage(JSON.stringify({ eventId: 'failed-1' })),
      ).rejects.toThrow('Invalid ProcessingFailed payload');
    });
  });
});
