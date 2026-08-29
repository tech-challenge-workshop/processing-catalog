import { Module } from '@nestjs/common';
import { RabbitMQConnection } from './rabbitmq.connection';
import { RabbitMQEventPublisher } from './rabbitmq.event-publisher';

@Module({
  providers: [RabbitMQConnection, RabbitMQEventPublisher],
  exports: [RabbitMQConnection, RabbitMQEventPublisher],
})
export class RabbitMQModule {}
