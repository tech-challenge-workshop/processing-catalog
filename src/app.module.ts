import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CreateProcessingRequestController } from './interface/create-processing-request.controller';
import { CreateProcessingRequestUseCase } from './application/create-processing-request.use-case';
import { AcceptProcessingRequestUseCase } from './application/accept-processing-request.use-case';
import { CompleteProcessingRequestUseCase } from './application/complete-processing-request.use-case';
import { InMemoryProcessingRequestRepository } from './infrastructure/in-memory-processing-request.repository';
import { InMemoryEventPublisher } from './infrastructure/in-memory-event-publisher';
import { RabbitMQModule } from './infrastructure/rabbitmq/rabbitmq.module';
import { RabbitMQEventPublisher } from './infrastructure/rabbitmq/rabbitmq.event-publisher';
import { RabbitMQHealthIndicator } from './infrastructure/rabbitmq/rabbitmq.health-indicator';
import { VideoAcceptedConsumer } from './infrastructure/rabbitmq/video-accepted.consumer';
import { ProcessingCompletedConsumer } from './infrastructure/rabbitmq/processing-completed.consumer';
import { HealthController } from './interface/health.controller';
import { ProcessingRequestObservationController } from './interface/processing-request-observation.controller';

const isLocalIntegration = () => process.env.LOCAL_INTEGRATION === 'true';

@Module({
  imports: [RabbitMQModule],
  controllers: [
    AppController,
    CreateProcessingRequestController,
    HealthController,
    ...(isLocalIntegration() ? [ProcessingRequestObservationController] : []),
  ],
  providers: [
    AppService,
    CreateProcessingRequestUseCase,
    AcceptProcessingRequestUseCase,
    CompleteProcessingRequestUseCase,
    InMemoryProcessingRequestRepository,
    {
      provide: 'ProcessingRequestRepository',
      useExisting: InMemoryProcessingRequestRepository,
    },
    InMemoryEventPublisher,
    {
      provide: 'EventPublisher',
      useExisting: isLocalIntegration()
        ? RabbitMQEventPublisher
        : InMemoryEventPublisher,
    },
    RabbitMQHealthIndicator,
    VideoAcceptedConsumer,
    ProcessingCompletedConsumer,
  ],
})
export class AppModule {}
