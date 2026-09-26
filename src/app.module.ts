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
import { DataSource } from 'typeorm';
import { RabbitMQConnection } from './infrastructure/rabbitmq/rabbitmq.connection';
import { UNIT_OF_WORK } from './application/unit-of-work';
import {
  DATA_SOURCE,
  createDataSource,
  isDatabaseConfigured,
} from './infrastructure/persistence/data-source';
import { TypeOrmProcessingRequestRepository } from './infrastructure/persistence/typeorm-processing-request.repository';
import { TypeOrmUnitOfWork } from './infrastructure/persistence/typeorm-unit-of-work';
import { OutboxRelay } from './infrastructure/messaging/outbox-relay';
import { OutboxRelayScheduler } from './infrastructure/messaging/outbox-relay.scheduler';
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
import { OwnedProcessingRequestsController } from './interface/owned-processing-requests.controller';
import { ListOwnedProcessingRequestsQuery } from './application/list-owned-processing-requests.query';
import { GetOwnedProcessingRequestQuery } from './application/get-owned-processing-request.query';

const isLocalIntegration = () => process.env.LOCAL_INTEGRATION === 'true';

@Module({
  imports: [RabbitMQModule],
  controllers: [
    AppController,
    CreateProcessingRequestController,
    HealthController,
    // Owner-scoped reads serve production, so they are never behind the flag.
    OwnedProcessingRequestsController,
    ...(isLocalIntegration() ? [ProcessingRequestObservationController] : []),
  ],
  providers: [
    AppService,
    CreateProcessingRequestUseCase,
    AcceptProcessingRequestUseCase,
    CompleteProcessingRequestUseCase,
    StartProcessingRequestUseCase,
    FailProcessingRequestUseCase,
    ListOwnedProcessingRequestsQuery,
    GetOwnedProcessingRequestQuery,
    InMemoryProcessingRequestRepository,
    DatabaseHealthIndicator,
    InMemoryOutboxWriter,
    {
      // With no database configured the service runs entirely in memory, so
      // the unit suite and a bare `npm start` need no container. When one is
      // configured, migrations are applied before any event is accepted.
      provide: DATA_SOURCE,
      useFactory: async (): Promise<DataSource | undefined> => {
        if (!isDatabaseConfigured()) {
          return undefined;
        }
        const dataSource = createDataSource();
        await dataSource.initialize();
        await dataSource.runMigrations();
        return dataSource;
      },
    },
    {
      provide: OutboxRelay,
      useFactory: (
        dataSource: DataSource | undefined,
        connection: RabbitMQConnection,
      ) => (dataSource ? new OutboxRelay(dataSource, connection) : undefined),
      inject: [DATA_SOURCE, RabbitMQConnection],
    },
    OutboxRelayScheduler,
    {
      // The in-memory unit of work until the data source is wired in; it
      // cannot roll back, which is why atomicity is asserted only against
      // PostgreSQL in the integration suite.
      provide: UNIT_OF_WORK,
      useFactory: (
        repository: InMemoryProcessingRequestRepository,
        outbox: InMemoryOutboxWriter,
        dataSource?: DataSource,
      ) =>
        dataSource
          ? new TypeOrmUnitOfWork(dataSource)
          : new InMemoryUnitOfWork(repository, outbox),
      inject: [
        InMemoryProcessingRequestRepository,
        InMemoryOutboxWriter,
        DATA_SOURCE,
      ],
    },
    {
      provide: 'ProcessingRequestRepository',
      useFactory: (
        inMemory: InMemoryProcessingRequestRepository,
        dataSource?: DataSource,
      ) =>
        dataSource
          ? TypeOrmProcessingRequestRepository.fromDataSource(dataSource)
          : inMemory,
      inject: [InMemoryProcessingRequestRepository, DATA_SOURCE],
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
