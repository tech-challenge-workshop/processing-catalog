import {
  InMemoryOutboxWriter,
  InMemoryUnitOfWork,
} from '../in-memory-unit-of-work';
import { randomUUID } from 'crypto';
import {
  ProcessingRequestDomainError,
  ProcessingRequestStatus,
  startProcessingRequest,
} from '../../domain/processing-request';
import { AcceptProcessingRequestUseCase } from '../../application/accept-processing-request.use-case';
import { CreateProcessingRequestUseCase } from '../../application/create-processing-request.use-case';
import { FailProcessingRequestUseCase } from '../../application/fail-processing-request.use-case';
import { StartProcessingRequestUseCase } from '../../application/start-processing-request.use-case';
import { InMemoryProcessingRequestRepository } from '../in-memory-processing-request.repository';
import { ProcessingFailedConsumer } from './processing-failed.consumer';
import { ProcessingStartedConsumer } from './processing-started.consumer';
import { RabbitMQConnection } from './rabbitmq.connection';
import { VideoRejectedConsumer } from './video-rejected.consumer';

describe('lifecycle consumers', () => {
  let repository: InMemoryProcessingRequestRepository;
  let outbox: InMemoryOutboxWriter;
  let unitOfWork: InMemoryUnitOfWork;
  const connection = {} as RabbitMQConnection;

  beforeEach(() => {
    repository = new InMemoryProcessingRequestRepository();
    outbox = new InMemoryOutboxWriter();
    unitOfWork = new InMemoryUnitOfWork(repository, outbox);
  });

  const received = async () =>
    (
      await new CreateProcessingRequestUseCase(repository, unitOfWork).execute({
        eventId: randomUUID(),
        ownerUserId: 'user-123',
        sourceStorageKey: 'videos/input.mp4',
        idempotencyKey: randomUUID(),
      })
    ).request;

  const queued = async () => {
    const created = await received();
    return new AcceptProcessingRequestUseCase(repository, unitOfWork).execute({
      eventId: randomUUID(),
      processingRequestId: created.processingRequestId,
      occurredAt: new Date().toISOString(),
    });
  };

  /**
   * Delivers one message through the consumer's real channel callback and
   * waits until it is settled, so a test sees the ack or nack the broker
   * would receive.
   */
  const deliver = async (
    make: (connection: RabbitMQConnection) => {
      onModuleInit(): Promise<void>;
    },
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
    await make({
      getConsumeChannel: () => channel,
    } as unknown as RabbitMQConnection).onModuleInit();
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

  const processing = async () => {
    const request = await queued();
    await repository.update(startProcessingRequest(request));
    return request;
  };

  const statusOf = async (id: string) =>
    (await repository.findByProcessingRequestId(id))?.status;

  /** Every `attemptId` that is not a non-blank string (ROB-02). */
  const malformedAttemptIds: [string, Record<string, unknown>][] = [
    ['no attemptId', {}],
    ['a null attemptId', { attemptId: null }],
    ['a numeric attemptId', { attemptId: 1 }],
    ['an empty attemptId', { attemptId: '' }],
    ['a whitespace attemptId', { attemptId: '  ' }],
  ];

  describe('VideoRejectedConsumer', () => {
    const consumer = () =>
      new VideoRejectedConsumer(
        connection,
        new FailProcessingRequestUseCase(repository, unitOfWork),
      );

    it('moves the request to FAILED and publishes one terminal event', async () => {
      const request = await received();
      const before = outbox.recordedTerminalEvents.length;

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
      expect(outbox.recordedTerminalEvents).toHaveLength(before + 1);
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

    it('asks for the validation rejection', async () => {
      const useCase = new FailProcessingRequestUseCase(repository, unitOfWork);
      const execute = jest.spyOn(useCase, 'execute');
      const request = await received();

      await new VideoRejectedConsumer(connection, useCase).handleMessage(
        JSON.stringify({
          eventId: 'rejected-1',
          processingRequestId: request.processingRequestId,
          failureCode: 'FORMATO_INVALIDO',
          occurredAt: '2026-09-20T00:00:00Z',
        }),
      );

      expect(execute).toHaveBeenCalledWith({
        eventId: 'rejected-1',
        origin: 'validation',
        processingRequestId: request.processingRequestId,
        failureCode: 'FORMATO_INVALIDO',
        occurredAt: '2026-09-20T00:00:00Z',
      });
    });

    it.each<[string, () => Promise<{ processingRequestId: string }>]>([
      ['QUEUED', () => queued()],
      ['PROCESSING', () => processing()],
    ])(
      'dead-letters a rejection for a %s request and keeps its state',
      async (status, make) => {
        const request = await make();
        const before = outbox.recordedTerminalEvents.length;

        const { channel, message } = await deliver(
          (conn) =>
            new VideoRejectedConsumer(
              conn,
              new FailProcessingRequestUseCase(repository, unitOfWork),
            ),
          {
            eventId: 'rejected-late',
            processingRequestId: request.processingRequestId,
            failureCode: 'FORMATO_INVALIDO',
            occurredAt: new Date().toISOString(),
          },
        );

        expect(channel.nack).toHaveBeenCalledWith(message, false, false);
        expect(channel.ack).not.toHaveBeenCalled();
        expect(await statusOf(request.processingRequestId)).toBe(status);
        expect(outbox.recordedTerminalEvents).toHaveLength(before);
      },
    );

    it('acks a rejection for a RECEIVED request', async () => {
      const request = await received();

      const { channel, message } = await deliver(
        (conn) =>
          new VideoRejectedConsumer(
            conn,
            new FailProcessingRequestUseCase(repository, unitOfWork),
          ),
        {
          eventId: 'rejected-1',
          processingRequestId: request.processingRequestId,
          failureCode: 'FORMATO_INVALIDO',
          occurredAt: new Date().toISOString(),
        },
      );

      expect(channel.ack).toHaveBeenCalledWith(message);
      expect(channel.nack).not.toHaveBeenCalled();
      expect(await statusOf(request.processingRequestId)).toBe(
        ProcessingRequestStatus.FAILED,
      );
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
        new StartProcessingRequestUseCase(repository, unitOfWork),
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

    it('hands the attemptId to the use case', async () => {
      const useCase = new StartProcessingRequestUseCase(repository, unitOfWork);
      const execute = jest.spyOn(useCase, 'execute');
      const request = await queued();

      await new ProcessingStartedConsumer(connection, useCase).handleMessage(
        JSON.stringify({
          eventId: 'started-1',
          processingRequestId: request.processingRequestId,
          attemptId: request.attemptId,
          occurredAt: '2026-09-20T00:00:00Z',
        }),
      );

      expect(execute).toHaveBeenCalledWith({
        eventId: 'started-1',
        processingRequestId: request.processingRequestId,
        attemptId: request.attemptId,
        occurredAt: '2026-09-20T00:00:00Z',
      });
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

    it.each(malformedAttemptIds)(
      'dead-letters a start with %s without calling the use case',
      async (_case, attempt) => {
        const useCase = new StartProcessingRequestUseCase(
          repository,
          unitOfWork,
        );
        const execute = jest.spyOn(useCase, 'execute');
        const request = await queued();
        const body = {
          eventId: 'started-malformed',
          processingRequestId: request.processingRequestId,
          occurredAt: new Date().toISOString(),
          ...attempt,
        };

        await expect(
          new ProcessingStartedConsumer(connection, useCase).handleMessage(
            JSON.stringify(body),
          ),
        ).rejects.toThrow(
          new ProcessingRequestDomainError('attemptId is required'),
        );
        const { channel, message } = await deliver(
          (conn) => new ProcessingStartedConsumer(conn, useCase),
          body,
        );

        expect(channel.nack).toHaveBeenCalledWith(message, false, false);
        expect(channel.ack).not.toHaveBeenCalled();
        expect(execute).not.toHaveBeenCalled();
        expect(await statusOf(request.processingRequestId)).toBe(
          ProcessingRequestStatus.QUEUED,
        );
        expect(
          await repository.hasEventBeenProcessed('started-malformed'),
        ).toBe(false);
      },
    );

    it('acks a start from another attempt and keeps the request QUEUED', async () => {
      const request = await queued();

      const { channel, message } = await deliver(
        (conn) =>
          new ProcessingStartedConsumer(
            conn,
            new StartProcessingRequestUseCase(repository, unitOfWork),
          ),
        {
          eventId: 'started-stale',
          processingRequestId: request.processingRequestId,
          attemptId: randomUUID(),
          occurredAt: new Date().toISOString(),
        },
      );

      expect(channel.ack).toHaveBeenCalledWith(message);
      expect(channel.nack).not.toHaveBeenCalled();
      expect(await statusOf(request.processingRequestId)).toBe(
        ProcessingRequestStatus.QUEUED,
      );
      expect(await repository.hasEventBeenProcessed('started-stale')).toBe(
        true,
      );
    });
  });

  describe('ProcessingFailedConsumer', () => {
    const consumer = () =>
      new ProcessingFailedConsumer(
        connection,
        new FailProcessingRequestUseCase(repository, unitOfWork),
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

    it('does not mark the event processed when the outbox write fails', async () => {
      const request = await queued();
      await repository.update(startProcessingRequest(request));
      jest.spyOn(outbox, 'add').mockImplementationOnce(() => {
        throw new Error('outbox write failed');
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
      ).rejects.toThrow('outbox write failed');

      expect(await repository.hasEventBeenProcessed('failed-1')).toBe(false);
    });

    it('asks for the processing failure of the reported attempt', async () => {
      const useCase = new FailProcessingRequestUseCase(repository, unitOfWork);
      const execute = jest.spyOn(useCase, 'execute');
      const request = await processing();

      await new ProcessingFailedConsumer(connection, useCase).handleMessage(
        JSON.stringify({
          eventId: 'failed-1',
          processingRequestId: request.processingRequestId,
          attemptId: request.attemptId,
          failureCode: 'PROCESSAMENTO_FALHOU',
          occurredAt: '2026-09-20T00:00:00Z',
        }),
      );

      expect(execute).toHaveBeenCalledWith({
        eventId: 'failed-1',
        origin: 'processing',
        attemptId: request.attemptId,
        processingRequestId: request.processingRequestId,
        failureCode: 'PROCESSAMENTO_FALHOU',
        occurredAt: '2026-09-20T00:00:00Z',
      });
    });

    it('moves a queued request to FAILED', async () => {
      const request = await queued();

      await consumer().handleMessage(
        JSON.stringify({
          eventId: 'failed-1',
          processingRequestId: request.processingRequestId,
          attemptId: request.attemptId,
          failureCode: 'DURACAO_EXCEDIDA',
          occurredAt: new Date().toISOString(),
        }),
      );

      const stored = await repository.findByProcessingRequestId(
        request.processingRequestId,
      );
      expect(stored?.status).toBe(ProcessingRequestStatus.FAILED);
      expect(stored?.failureCode).toBe('DURACAO_EXCEDIDA');
    });

    it('dead-letters a failure for a RECEIVED request and keeps its state', async () => {
      const request = await received();
      const before = outbox.recordedTerminalEvents.length;

      const { channel, message } = await deliver(
        (conn) =>
          new ProcessingFailedConsumer(
            conn,
            new FailProcessingRequestUseCase(repository, unitOfWork),
          ),
        {
          eventId: 'failed-early',
          processingRequestId: request.processingRequestId,
          attemptId: randomUUID(),
          failureCode: 'PROCESSAMENTO_FALHOU',
          occurredAt: new Date().toISOString(),
        },
      );

      expect(channel.nack).toHaveBeenCalledWith(message, false, false);
      expect(channel.ack).not.toHaveBeenCalled();
      expect(await statusOf(request.processingRequestId)).toBe(
        ProcessingRequestStatus.RECEIVED,
      );
      expect(outbox.recordedTerminalEvents).toHaveLength(before);
    });

    it('rejects a malformed payload', async () => {
      await expect(
        consumer().handleMessage(JSON.stringify({ eventId: 'failed-1' })),
      ).rejects.toThrow('Invalid ProcessingFailed payload');
    });

    it.each(malformedAttemptIds)(
      'dead-letters a failure with %s without calling the use case',
      async (_case, attempt) => {
        const useCase = new FailProcessingRequestUseCase(
          repository,
          unitOfWork,
        );
        const execute = jest.spyOn(useCase, 'execute');
        const request = await processing();
        const before = outbox.recordedTerminalEvents.length;
        const body = {
          eventId: 'failed-malformed',
          processingRequestId: request.processingRequestId,
          failureCode: 'PROCESSAMENTO_FALHOU',
          occurredAt: new Date().toISOString(),
          ...attempt,
        };

        await expect(
          new ProcessingFailedConsumer(connection, useCase).handleMessage(
            JSON.stringify(body),
          ),
        ).rejects.toThrow(
          new ProcessingRequestDomainError('attemptId is required'),
        );
        const { channel, message } = await deliver(
          (conn) => new ProcessingFailedConsumer(conn, useCase),
          body,
        );

        expect(channel.nack).toHaveBeenCalledWith(message, false, false);
        expect(channel.ack).not.toHaveBeenCalled();
        expect(execute).not.toHaveBeenCalled();
        expect(await statusOf(request.processingRequestId)).toBe(
          ProcessingRequestStatus.PROCESSING,
        );
        expect(outbox.recordedTerminalEvents).toHaveLength(before);
      },
    );

    it('acks a failure from another attempt and keeps the request PROCESSING', async () => {
      const request = await processing();
      const before = outbox.recordedTerminalEvents.length;

      const { channel, message } = await deliver(
        (conn) =>
          new ProcessingFailedConsumer(
            conn,
            new FailProcessingRequestUseCase(repository, unitOfWork),
          ),
        {
          eventId: 'failed-stale',
          processingRequestId: request.processingRequestId,
          attemptId: randomUUID(),
          failureCode: 'PROCESSAMENTO_FALHOU',
          occurredAt: new Date().toISOString(),
        },
      );

      expect(channel.ack).toHaveBeenCalledWith(message);
      expect(channel.nack).not.toHaveBeenCalled();
      expect(await statusOf(request.processingRequestId)).toBe(
        ProcessingRequestStatus.PROCESSING,
      );
      expect(outbox.recordedTerminalEvents).toHaveLength(before);
    });
  });
});
