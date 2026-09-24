import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { FailProcessingRequestUseCase } from '../../application/fail-processing-request.use-case';
import {
  FailureCode,
  ProcessingRequestDomainError,
} from '../../domain/processing-request';
import { VideoRejectedDto } from '../../messaging/dto';
import { RabbitMQConnection } from './rabbitmq.connection';
import { settleFailedMessage } from './settle-failed-message';

@Injectable()
export class VideoRejectedConsumer implements OnModuleInit {
  constructor(
    @Inject(RabbitMQConnection)
    private readonly connection: RabbitMQConnection,
    private readonly useCase: FailProcessingRequestUseCase,
  ) {}

  async onModuleInit(): Promise<void> {
    const channel = this.connection.getConsumeChannel();
    await channel.consume('video.rejected', (message) => {
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
      failureCode: parsed.failureCode,
      occurredAt: parsed.occurredAt,
    });
  }

  private parse(content: unknown): VideoRejectedDto {
    if (content && typeof content === 'object' && 'data' in content) {
      content = content.data;
    }

    if (
      !content ||
      typeof content !== 'object' ||
      !('eventId' in content) ||
      !('processingRequestId' in content) ||
      !('failureCode' in content) ||
      !('occurredAt' in content)
    ) {
      throw new ProcessingRequestDomainError('Invalid VideoRejected payload');
    }

    const payload = content as Record<string, unknown>;

    return {
      eventId: String(payload.eventId),
      processingRequestId: String(payload.processingRequestId),
      failureCode: payload.failureCode as FailureCode,
      occurredAt: String(payload.occurredAt),
    };
  }
}
