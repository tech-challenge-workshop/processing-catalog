import { Inject, Injectable } from '@nestjs/common';
import { RabbitMQConnection } from './rabbitmq.connection';

@Injectable()
export class RabbitMQHealthIndicator {
  constructor(
    @Inject(RabbitMQConnection)
    private readonly connection: RabbitMQConnection,
  ) {}

  isHealthy(): boolean {
    return this.connection.isConnected();
  }
}
