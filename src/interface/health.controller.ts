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

  /**
   * Liveness: 200 while the process serves requests. It never consults a
   * dependency, so an outage makes the pod not-ready rather than restarted.
   */
  @Get('live')
  live() {
    return { status: 'ok' };
  }
}
