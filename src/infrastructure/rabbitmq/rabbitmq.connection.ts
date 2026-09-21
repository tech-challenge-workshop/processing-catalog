import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  connect,
  type AmqpConnectionManager,
  type ChannelWrapper,
} from 'amqp-connection-manager';

export const RABBITMQ_EXCHANGE = 'fiapx.events';

/**
 * Where a message goes once it has failed more times than it is worth
 * retrying. Without it, one poisonous message blocks its queue forever.
 */
export const RABBITMQ_DLX = 'fiapx.events.dlx';

export function deadLetterQueueFor(queue: string): string {
  return `${queue}.dlq`;
}

/**
 * Every queue the Catalog publishes to or consumes from.
 *
 * Asserted at channel setup, so a consumer never depends on a producer having
 * connected first: consuming a queue nobody declared fails the process with a
 * 404 at startup.
 */
export const RABBITMQ_QUEUES = [
  'video.validation.requested',
  'video.accepted',
  'video.rejected',
  'processing.queued',
  'processing.started',
  'processing.completed',
  'processing.failed',
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
        options?: {
          durable?: boolean;
          arguments?: Record<string, unknown>;
        },
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
      await channel.assertExchange(RABBITMQ_DLX, 'topic', { durable: true });

      for (const routingKey of RABBITMQ_QUEUES) {
        // The dead-letter queue is declared here, but dead-lettering itself
        // is NOT set as a queue argument. Five of these queues are also
        // declared by the Worker, and RabbitMQ rejects a second declaration
        // whose arguments differ - which took the Worker's channel down with
        // `PRECONDITION_FAILED - inequivalent arg 'x-dead-letter-exchange'`.
        //
        // The routing is applied as a broker policy by fiap-x-platform, which
        // owns the topology. A policy binds no declarer, so no service can
        // contradict another.
        const dlq = deadLetterQueueFor(routingKey);
        await channel.assertQueue(dlq, { durable: true });
        await channel.bindQueue(dlq, RABBITMQ_DLX, routingKey);

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

  async sendToQueue(
    queue: string,
    pattern: string,
    event: unknown,
  ): Promise<void> {
    const channel = this.getPublishChannel();
    await channel.sendToQueue(queue, { pattern, data: event });
  }

  async onModuleDestroy(): Promise<void> {
    await this.publishChannel?.close();
    await this.consumeChannel?.close();
    await this.connection?.close();
  }
}
