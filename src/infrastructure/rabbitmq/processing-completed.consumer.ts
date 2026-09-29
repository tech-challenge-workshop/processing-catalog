import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { CompleteProcessingRequestUseCase } from '../../application/complete-processing-request.use-case';
import { ProcessingRequestDomainError } from '../../domain/processing-request';
import { ProcessingCompletedDto } from '../../messaging/dto';
import { isValidAttemptId } from './attempt-id';
import { RabbitMQConnection } from './rabbitmq.connection';
import { withMessageCorrelation } from '../messaging/with-correlation';
import { settleMessage } from './settle-failed-message';

@Injectable()
export class ProcessingCompletedConsumer implements OnModuleInit {
  constructor(
    @Inject(RabbitMQConnection)
    private readonly connection: RabbitMQConnection,
    private readonly useCase: CompleteProcessingRequestUseCase,
  ) {}

  async onModuleInit(): Promise<void> {
    const channel = this.connection.getConsumeChannel();
    await channel.consume('processing.completed', (message) => {
      if (!message) {
        return;
      }

      const content = message.content.toString();
      void withMessageCorrelation(content, () =>
        settleMessage(channel, message, 'ProcessingCompleted', () =>
          this.handleMessage(content),
        ),
      );
    });
  }

  async handleMessage(content: string): Promise<void> {
    const parsed = this.parseProcessingCompleted(JSON.parse(content));
    await this.useCase.execute({
      eventId: parsed.eventId,
      processingRequestId: parsed.processingRequestId,
      attemptId: parsed.attemptId,
      zipStorageKey: parsed.zipStorageKey,
      occurredAt: parsed.occurredAt,
    });
  }

  private parseProcessingCompleted(content: unknown): ProcessingCompletedDto {
    if (content && typeof content === 'object' && 'data' in content) {
      content = content.data;
    }

    if (
      !content ||
      typeof content !== 'object' ||
      !('eventId' in content) ||
      !('processingRequestId' in content) ||
      !('zipStorageKey' in content) ||
      !('occurredAt' in content)
    ) {
      throw new ProcessingRequestDomainError(
        'Invalid ProcessingCompleted payload',
      );
    }

    const payload = content as Record<string, unknown>;
    if (!isValidAttemptId(payload.attemptId)) {
      throw new ProcessingRequestDomainError('attemptId is required');
    }

    return {
      eventId: String(payload.eventId),
      processingRequestId: String(payload.processingRequestId),
      attemptId: payload.attemptId,
      zipStorageKey: String(payload.zipStorageKey),
      occurredAt: String(payload.occurredAt),
    };
  }
}
