import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CreateProcessingRequestController } from './interface/create-processing-request.controller';
import { CreateProcessingRequestUseCase } from './application/create-processing-request.use-case';
import { AcceptProcessingRequestUseCase } from './application/accept-processing-request.use-case';
import { CompleteProcessingRequestUseCase } from './application/complete-processing-request.use-case';
import { StartProcessingRequestUseCase } from './application/start-processing-request.use-case';
import { FailProcessingRequestUseCase } from './application/fail-processing-request.use-case';
import { InMemoryProcessingRequestRepository } from './infrastructure/in-memory-processing-request.repository';
import { DatabaseHealthIndicator } from './infrastructure/persistence/database.health-indicator';
import { UNIT_OF_WORK } from './application/unit-of-work';
import {
  InMemoryOutboxWriter,
  InMemoryUnitOfWork,
} from './infrastructure/in-memory-unit-of-work';
import { InMemoryEventPublisher } from './infrastructure/in-memory-event-publisher';
import { RabbitMQModule } from './infrastructure/rabbitmq/rabbitmq.module';
import { RabbitMQEventPublisher } from './infrastructure/rabbitmq/rabbitmq.event-publisher';
import { RabbitMQHealthIndicator } from './infrastructure/rabbitmq/rabbitmq.health-indicator';
import { VideoAcceptedConsumer } from './infrastructure/rabbitmq/video-accepted.consumer';
import { ProcessingCompletedConsumer } from './infrastructure/rabbitmq/processing-completed.consumer';
import { VideoRejectedConsumer } from './infrastructure/rabbitmq/video-rejected.consumer';
import { ProcessingStartedConsumer } from './infrastructure/rabbitmq/processing-started.consumer';
import { ProcessingFailedConsumer } from './infrastructure/rabbitmq/processing-failed.consumer';
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
    StartProcessingRequestUseCase,
    FailProcessingRequestUseCase,
    InMemoryProcessingRequestRepository,
    DatabaseHealthIndicator,
    InMemoryOutboxWriter,
    {
      // The in-memory unit of work until the data source is wired in; it
      // cannot roll back, which is why atomicity is asserted only against
      // PostgreSQL in the integration suite.
      provide: UNIT_OF_WORK,
      useFactory: (
        repository: InMemoryProcessingRequestRepository,
        outbox: InMemoryOutboxWriter,
      ) => new InMemoryUnitOfWork(repository, outbox),
      inject: [InMemoryProcessingRequestRepository, InMemoryOutboxWriter],
    },
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
    VideoRejectedConsumer,
    ProcessingStartedConsumer,
    ProcessingFailedConsumer,
  ],
})
export class AppModule {}
