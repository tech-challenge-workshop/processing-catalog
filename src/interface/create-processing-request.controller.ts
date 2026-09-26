import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'crypto';
import {
  CreateProcessingRequestUseCase,
  IdempotencyConflictError,
} from '../application/create-processing-request.use-case';
import { ProcessingRequestDomainError } from '../domain/processing-request';
import { CreateProcessingRequestDto } from './create-processing-request.dto';

@Controller('processing-requests')
export class CreateProcessingRequestController {
  constructor(
    private readonly createProcessingRequestUseCase: CreateProcessingRequestUseCase,
  ) {}

  /**
   * 201 when this call created the request, 200 when the owner's key
   * replayed an existing one (same body), 409 when the key is bound to
   * another source. The API maps these one-to-one.
   */
  @Post()
  async create(
    @Body() dto: CreateProcessingRequestDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.validateDto(dto);

    try {
      const { request, outcome } =
        await this.createProcessingRequestUseCase.execute({
          eventId: randomUUID(),
          ownerUserId: dto.ownerUserId,
          sourceStorageKey: dto.sourceStorageKey,
          idempotencyKey: dto.idempotencyKey,
        });

      if (outcome === 'replayed') {
        res.status(HttpStatus.OK);
      }

      return {
        processingRequestId: request.processingRequestId,
        status: request.status,
        ownerUserId: request.ownerUserId,
        sourceStorageKey: request.sourceStorageKey,
        createdAt: request.createdAt.toISOString(),
      };
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        throw new ConflictException(error.message);
      }
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
    if (!dto.idempotencyKey || dto.idempotencyKey.trim().length === 0) {
      throw new BadRequestException('idempotencyKey is required');
    }
  }
}
