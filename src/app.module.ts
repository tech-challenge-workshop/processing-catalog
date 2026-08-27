import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CreateProcessingRequestController } from './interface/create-processing-request.controller';
import { CreateProcessingRequestUseCase } from './application/create-processing-request.use-case';
import { InMemoryProcessingRequestRepository } from './infrastructure/in-memory-processing-request.repository';
import { InMemoryEventPublisher } from './infrastructure/in-memory-event-publisher';

@Module({
  imports: [],
  controllers: [AppController, CreateProcessingRequestController],
  providers: [
    AppService,
    CreateProcessingRequestUseCase,
    {
      provide: 'ProcessingRequestRepository',
      useClass: InMemoryProcessingRequestRepository,
    },
    {
      provide: 'EventPublisher',
      useClass: InMemoryEventPublisher,
    },
    InMemoryProcessingRequestRepository,
    InMemoryEventPublisher,
  ],
})
export class AppModule {}
