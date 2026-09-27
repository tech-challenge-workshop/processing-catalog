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
          ownerEmail: dto.ownerEmail,
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
   * in order, each through its own sequence: present, a string, not blank,
   * not too long. Every field is bounded because each is stored under a btree
   * index that an oversized value would overflow on every retry.
   */
  private validateDto(dto: CreateProcessingRequestDto): void {
    requireString(dto, 'ownerUserId', MAX_OWNER_USER_ID_LENGTH);
    requireString(dto, 'ownerEmail', MAX_OWNER_EMAIL_LENGTH);
    requireString(dto, 'sourceStorageKey', MAX_SOURCE_STORAGE_KEY_LENGTH);
    requireString(dto, 'idempotencyKey', MAX_IDEMPOTENCY_KEY_LENGTH);
  }
}

const MAX_OWNER_USER_ID_LENGTH = 255;
const MAX_OWNER_EMAIL_LENGTH = 255;
const MAX_SOURCE_STORAGE_KEY_LENGTH = 1024;
/** Matches the API's limit on the Idempotency-Key header. */
const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

function requireString(
  dto: CreateProcessingRequestDto,
  field: keyof CreateProcessingRequestDto,
  maxLength: number,
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
  if (value.length > maxLength) {
    throw new BadRequestException(
      `${field} must be at most ${maxLength} characters`,
    );
  }
}
