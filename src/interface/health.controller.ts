import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { RabbitMQHealthIndicator } from '../infrastructure/rabbitmq/rabbitmq.health-indicator';
import { DatabaseHealthIndicator } from '../infrastructure/persistence/database.health-indicator';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(RabbitMQHealthIndicator)
    private readonly rabbitmqHealthIndicator: RabbitMQHealthIndicator,
    @Inject(DatabaseHealthIndicator)
    private readonly databaseHealthIndicator: DatabaseHealthIndicator,
  ) {}

  @Get()
  async check() {
    const rabbitmq = this.rabbitmqHealthIndicator.isHealthy();
    const database = await this.databaseHealthIndicator.isHealthy();

    if (!rabbitmq || !database) {
      throw new ServiceUnavailableException({
        status: 'error',
        rabbitmq: rabbitmq ? 'up' : 'down',
        database: database ? 'up' : 'down',
      });
    }

    return {
      status: 'ok',
      rabbitmq: 'up',
      database: 'up',
    };
  }
}
