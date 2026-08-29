import { Inject, Injectable } from '@nestjs/common';
import { EventPublisher } from '../../application/event-publisher';
import {
  ProcessingQueuedDto,
  TerminalEventDto,
  VideoValidationRequestedDto,
} from '../../messaging/dto';
import { RabbitMQConnection, RABBITMQ_EXCHANGE } from './rabbitmq.connection';

@Injectable()
export class RabbitMQEventPublisher implements EventPublisher {
  constructor(
    @Inject(RabbitMQConnection)
    private readonly connection: RabbitMQConnection,
  ) {}

  async publishVideoValidationRequested(
    event: VideoValidationRequestedDto,
  ): Promise<void> {
    await this.publish('video.validation.requested', event);
  }

  async publishProcessingQueued(event: ProcessingQueuedDto): Promise<void> {
    await this.publish('processing.queued', event);
  }

  async publishTerminalEvent(event: TerminalEventDto): Promise<void> {
    await this.publish('processing.terminal', event);
  }

  private async publish(routingKey: string, event: unknown): Promise<void> {
    const channel = this.connection.getPublishChannel();
    await channel.publish(RABBITMQ_EXCHANGE, routingKey, event);
  }
}
