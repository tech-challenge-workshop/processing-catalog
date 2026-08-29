import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  connect,
  type AmqpConnectionManager,
  type ChannelWrapper,
} from 'amqp-connection-manager';

export const RABBITMQ_EXCHANGE = 'fiapx.events';

export const RABBITMQ_QUEUES = [
  'video.validation.requested',
  'video.accepted',
  'processing.queued',
  'processing.completed',
  'processing.terminal',
] as const;

export type RabbitMQQueue = (typeof RABBITMQ_QUEUES)[number];

export const DEFAULT_RABBITMQ_URL = 'amqp://rabbitmq:5672';

@Injectable()
export class RabbitMQConnection implements OnModuleInit, OnModuleDestroy {
  private connection: AmqpConnectionManager | undefined;
  private publishChannel: ChannelWrapper | undefined;
  private consumeChannel: ChannelWrapper | undefined;

  onModuleInit(): void {
    const url = process.env.RABBITMQ_URL ?? DEFAULT_RABBITMQ_URL;
    this.connection = connect(url);

    const setup = async (channel: {
      assertExchange: (
        exchange: string,
        type: string,
        options?: { durable?: boolean },
      ) => Promise<unknown>;
      assertQueue: (
        queue: string,
        options?: { durable?: boolean },
      ) => Promise<{ queue: string }>;
      bindQueue: (
        queue: string,
        exchange: string,
        routingKey: string,
      ) => Promise<unknown>;
    }): Promise<void> => {
      await channel.assertExchange(RABBITMQ_EXCHANGE, 'topic', {
        durable: true,
      });
      for (const routingKey of RABBITMQ_QUEUES) {
        const queue = await channel.assertQueue(routingKey, {
          durable: true,
        });
        await channel.bindQueue(queue.queue, RABBITMQ_EXCHANGE, routingKey);
      }
    };

    this.publishChannel = this.connection.createChannel({
      json: true,
      setup,
    });

    this.consumeChannel = this.connection.createChannel({
      json: true,
      setup,
    });
  }

  isConnected(): boolean {
    return this.connection?.isConnected() ?? false;
  }

  getPublishChannel(): ChannelWrapper {
    if (!this.publishChannel) {
      throw new Error('RabbitMQ publish channel is not initialized');
    }
    return this.publishChannel;
  }

  getConsumeChannel(): ChannelWrapper {
    if (!this.consumeChannel) {
      throw new Error('RabbitMQ consume channel is not initialized');
    }
    return this.consumeChannel;
  }

  async onModuleDestroy(): Promise<void> {
    await this.connection?.close();
  }
}
