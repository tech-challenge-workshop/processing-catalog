import { Body, Controller, Post, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CreateProcessingRequestUseCase } from '../application/create-processing-request.use-case';
import { ProcessingRequestDomainError } from '../domain/processing-request';
import { CreateProcessingRequestDto } from './create-processing-request.dto';

@Controller('processing-requests')
export class CreateProcessingRequestController {
  constructor(
    private readonly createProcessingRequestUseCase: CreateProcessingRequestUseCase,
  ) {}

  @Post()
  async create(@Body() dto: CreateProcessingRequestDto) {
    this.validateDto(dto);

    try {
      const { request } = await this.createProcessingRequestUseCase.execute({
        eventId: randomUUID(),
        ownerUserId: dto.ownerUserId,
        sourceStorageKey: dto.sourceStorageKey,
        // Transitional until T5 requires the key on this route: a fresh key
        // per call keeps today's behaviour, one request per POST.
        idempotencyKey: randomUUID(),
      });

      return {
        processingRequestId: request.processingRequestId,
        status: request.status,
        ownerUserId: request.ownerUserId,
        sourceStorageKey: request.sourceStorageKey,
        createdAt: request.createdAt.toISOString(),
      };
    } catch (error) {
      if (error instanceof ProcessingRequestDomainError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  private validateDto(dto: CreateProcessingRequestDto): void {
    if (!dto.ownerUserId || dto.ownerUserId.trim().length === 0) {
      throw new BadRequestException('ownerUserId is required');
    }
    if (!dto.sourceStorageKey || dto.sourceStorageKey.trim().length === 0) {
      throw new BadRequestException('sourceStorageKey is required');
    }
  }
}
