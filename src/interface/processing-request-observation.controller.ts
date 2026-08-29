import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
} from '@nestjs/common';
import type { ProcessingRequestRepository } from '../domain/processing-request.repository';

@Controller('processing-requests')
export class ProcessingRequestObservationController {
  constructor(
    @Inject('ProcessingRequestRepository')
    private readonly repository: ProcessingRequestRepository,
  ) {}

  @Get(':id')
  findById(@Param('id') id: string) {
    const request = this.repository.findByProcessingRequestId(id);

    if (!request) {
      throw new NotFoundException(`Processing request ${id} not found`);
    }

    return {
      processingRequestId: request.processingRequestId,
      ownerUserId: request.ownerUserId,
      sourceStorageKey: request.sourceStorageKey,
      status: request.status,
      attemptId: request.attemptId,
      zipStorageKey: request.zipStorageKey,
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
    };
  }
}
