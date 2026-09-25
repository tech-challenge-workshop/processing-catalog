import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { StartProcessingRequestUseCase } from '../../application/start-processing-request.use-case';
import { ProcessingRequestDomainError } from '../../domain/processing-request';
import { ProcessingStartedDto } from '../../messaging/dto';
import { RabbitMQConnection } from './rabbitmq.connection';
import { settleFailedMessage } from './settle-failed-message';

@Injectable()
export class ProcessingStartedConsumer implements OnModuleInit {
  constructor(
    @Inject(RabbitMQConnection)
    private readonly connection: RabbitMQConnection,
    private readonly useCase: StartProcessingRequestUseCase,
  ) {}

  async onModuleInit(): Promise<void> {
    const channel = this.connection.getConsumeChannel();
    await channel.consume('processing.started', (message) => {
      if (!message) {
        return;
      }

      void this.handleMessage(message.content.toString())
        .then(() => channel.ack(message))
        .catch((error) => settleFailedMessage(channel, message, error));
    });
  }

  async handleMessage(content: string): Promise<void> {
    const parsed = this.parse(JSON.parse(content));
    await this.useCase.execute({
      eventId: parsed.eventId,
      processingRequestId: parsed.processingRequestId,
      occurredAt: parsed.occurredAt,
    });
  }

  private parse(content: unknown): ProcessingStartedDto {
    if (content && typeof content === 'object' && 'data' in content) {
      content = content.data;
    }

    if (
      !content ||
      typeof content !== 'object' ||
      !('eventId' in content) ||
      !('processingRequestId' in content) ||
      !('attemptId' in content) ||
      !('occurredAt' in content)
    ) {
      throw new ProcessingRequestDomainError(
        'Invalid ProcessingStarted payload',
      );
    }

    const payload = content as Record<string, unknown>;

    return {
      eventId: String(payload.eventId),
      processingRequestId: String(payload.processingRequestId),
      attemptId: String(payload.attemptId),
      occurredAt: String(payload.occurredAt),
    };
  }
}
