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

  /**
   * The body is untyped JSON whatever the DTO says, so each field is checked
   * in order: present, a string, not blank. The key is also bounded, because
   * it is stored under a unique btree index that an oversized value would
   * overflow on every retry.
   */
  private validateDto(dto: CreateProcessingRequestDto): void {
    requireString(dto, 'ownerUserId');
    requireString(dto, 'sourceStorageKey');
    requireString(dto, 'idempotencyKey');
    if (dto.idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      throw new BadRequestException(
        `idempotencyKey must be at most ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`,
      );
    }
  }
}

/** Matches the API's limit on the Idempotency-Key header. */
const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

function requireString(
  dto: CreateProcessingRequestDto,
  field: keyof CreateProcessingRequestDto,
): void {
  const value: unknown = dto[field];
  if (value === undefined || value === null) {
    throw new BadRequestException(`${field} is required`);
  }
  if (typeof value !== 'string') {
    throw new BadRequestException(`${field} must be a string`);
  }
  if (value.trim().length === 0) {
    throw new BadRequestException(`${field} is required`);
  }
}
