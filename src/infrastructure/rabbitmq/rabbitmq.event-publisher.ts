import { Inject, Injectable } from '@nestjs/common';
import { EventPublisher } from '../../application/event-publisher';
import {
  ProcessingQueuedDto,
  TerminalEventDto,
  VideoValidationRequestedDto,
} from '../../messaging/dto';
import { RabbitMQConnection } from './rabbitmq.connection';

@Injectable()
export class RabbitMQEventPublisher implements EventPublisher {
  constructor(
    @Inject(RabbitMQConnection)
    private readonly connection: RabbitMQConnection,
  ) {}

  async publishVideoValidationRequested(
    event: VideoValidationRequestedDto,
  ): Promise<void> {
    await this.connection.sendToQueue(
      'video-validation',
      'VideoValidationRequested',
      event,
    );
  }

  async publishProcessingQueued(event: ProcessingQueuedDto): Promise<void> {
    await this.connection.sendToQueue('processing', 'ProcessingQueued', event);
  }

  async publishTerminalEvent(event: TerminalEventDto): Promise<void> {
    await this.connection.sendToQueue(
      'notification.terminal',
      'terminal.event',
      event,
    );
  }
}
