import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { RabbitMQHealthIndicator } from '../infrastructure/rabbitmq/rabbitmq.health-indicator';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(RabbitMQHealthIndicator)
    private readonly rabbitmqHealthIndicator: RabbitMQHealthIndicator,
  ) {}

  @Get()
  check() {
    const isHealthy = this.rabbitmqHealthIndicator.isHealthy();

    if (!isHealthy) {
      throw new ServiceUnavailableException({
        status: 'error',
        rabbitmq: 'down',
      });
    }

    return {
      status: 'ok',
      rabbitmq: 'up',
    };
  }
}
