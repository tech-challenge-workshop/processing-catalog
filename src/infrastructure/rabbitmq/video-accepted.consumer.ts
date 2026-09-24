import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { AcceptProcessingRequestUseCase } from '../../application/accept-processing-request.use-case';
import { ProcessingRequestDomainError } from '../../domain/processing-request';
import { VideoAcceptedDto } from '../../messaging/dto';
import { RabbitMQConnection } from './rabbitmq.connection';
import { settleFailedMessage } from './settle-failed-message';

@Injectable()
export class VideoAcceptedConsumer implements OnModuleInit {
  constructor(
    @Inject(RabbitMQConnection)
    private readonly connection: RabbitMQConnection,
    private readonly useCase: AcceptProcessingRequestUseCase,
  ) {}

  async onModuleInit(): Promise<void> {
    const channel = this.connection.getConsumeChannel();
    await channel.consume('video.accepted', (message) => {
      if (!message) {
        return;
      }

      void this.handleMessage(message.content.toString())
        .then(() => channel.ack(message))
        .catch((error) => settleFailedMessage(channel, message, error));
    });
  }

  async handleMessage(content: string): Promise<void> {
    const parsed = this.parseVideoAccepted(JSON.parse(content));
    await this.useCase.execute({
      eventId: parsed.eventId,
      processingRequestId: parsed.processingRequestId,
      occurredAt: parsed.occurredAt,
    });
  }

  private parseVideoAccepted(content: unknown): VideoAcceptedDto {
    if (content && typeof content === 'object' && 'data' in content) {
      content = content.data;
    }

    if (
      !content ||
      typeof content !== 'object' ||
      !('eventId' in content) ||
      !('processingRequestId' in content) ||
      !('occurredAt' in content)
    ) {
      throw new ProcessingRequestDomainError('Invalid VideoAccepted payload');
    }

    const payload = content as Record<string, unknown>;

    return {
      eventId: String(payload.eventId),
      processingRequestId: String(payload.processingRequestId),
      occurredAt: String(payload.occurredAt),
    };
  }
}
