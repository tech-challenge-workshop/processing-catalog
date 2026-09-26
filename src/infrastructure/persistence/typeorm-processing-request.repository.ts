import { DataSource, EntityManager } from 'typeorm';
import {
  FailureCode,
  ProcessingRequest,
  ProcessingRequestStatus,
} from '../../domain/processing-request';
import { ProcessingRequestRepository } from '../../domain/processing-request.repository';
import { ProcessedEventEntity } from './processed-event.entity';
import { ProcessingRequestEntity } from './processing-request.entity';

function toDomain(row: ProcessingRequestEntity): ProcessingRequest {
  return {
    processingRequestId: row.processingRequestId,
    ownerUserId: row.ownerUserId,
    sourceStorageKey: row.sourceStorageKey,
    status: row.status as ProcessingRequestStatus,
    // Absent stays absent: a null column must not become an empty string.
    attemptId: row.attemptId ?? undefined,
    zipStorageKey: row.zipStorageKey ?? undefined,
    failureCode: (row.failureCode as FailureCode | null) ?? undefined,
    idempotencyKey: row.idempotencyKey ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRow(request: ProcessingRequest): ProcessingRequestEntity {
  const row = new ProcessingRequestEntity();
  row.processingRequestId = request.processingRequestId;
  row.ownerUserId = request.ownerUserId;
  row.sourceStorageKey = request.sourceStorageKey;
  row.status = request.status;
  row.attemptId = request.attemptId ?? null;
  row.zipStorageKey = request.zipStorageKey ?? null;
  row.failureCode = request.failureCode ?? null;
  row.idempotencyKey = request.idempotencyKey ?? null;
  row.createdAt = request.createdAt;
  row.updatedAt = request.updatedAt;
  return row;
}

export class TypeOrmProcessingRequestRepository implements ProcessingRequestRepository {
  /**
   * Takes an EntityManager rather than a DataSource so the same class serves
   * both a plain connection and a transaction: the unit of work hands it the
   * transactional manager, and nothing else can write outside it.
   */
  constructor(private readonly manager: EntityManager) {}

  static fromDataSource(
    dataSource: DataSource,
  ): TypeOrmProcessingRequestRepository {
    return new TypeOrmProcessingRequestRepository(dataSource.manager);
  }

  async save(request: ProcessingRequest): Promise<void> {
    await this.manager.insert(ProcessingRequestEntity, toRow(request));
  }

  async update(request: ProcessingRequest): Promise<void> {
    await this.manager.save(ProcessingRequestEntity, toRow(request));
  }

  async findByProcessingRequestId(
    processingRequestId: string,
  ): Promise<ProcessingRequest | undefined> {
    const row = await this.manager.findOne(ProcessingRequestEntity, {
      where: { processingRequestId },
    });
    return row ? toDomain(row) : undefined;
  }

  async findForUpdate(
    processingRequestId: string,
  ): Promise<ProcessingRequest | undefined> {
    // SELECT ... FOR UPDATE: a second transaction for the same request waits
    // here until the first commits, then reads the status it left behind.
    const row = await this.manager.findOne(ProcessingRequestEntity, {
      where: { processingRequestId },
      lock: { mode: 'pessimistic_write' },
    });
    return row ? toDomain(row) : undefined;
  }

  async findByEventId(eventId: string): Promise<ProcessingRequest | undefined> {
    const event = await this.manager.findOne(ProcessedEventEntity, {
      where: { eventId },
    });
    if (!event?.processingRequestId) {
      return undefined;
    }
    return this.findByProcessingRequestId(event.processingRequestId);
  }

  async markEventProcessed(
    eventId: string,
    processingRequestId?: string,
  ): Promise<void> {
    const row = new ProcessedEventEntity();
    row.eventId = eventId;
    row.processingRequestId = processingRequestId ?? null;
    row.processedAt = new Date();
    await this.manager.insert(ProcessedEventEntity, row);
  }

  async hasEventBeenProcessed(eventId: string): Promise<boolean> {
    const count = await this.manager.count(ProcessedEventEntity, {
      where: { eventId },
    });
    return count > 0;
  }

  // The owner is part of every WHERE below: PostgreSQL filters, orders and
  // bounds the page, so no row of another owner is ever loaded.
  async findPageByOwner(
    ownerUserId: string,
    offset: number,
    limit: number,
  ): Promise<ProcessingRequest[]> {
    const rows = await this.manager.find(ProcessingRequestEntity, {
      where: { ownerUserId },
      order: { createdAt: 'DESC', processingRequestId: 'ASC' },
      skip: offset,
      take: limit,
    });
    return rows.map(toDomain);
  }

  countByOwner(ownerUserId: string): Promise<number> {
    return this.manager.count(ProcessingRequestEntity, {
      where: { ownerUserId },
    });
  }

  async findByIdAndOwner(
    processingRequestId: string,
    ownerUserId: string,
  ): Promise<ProcessingRequest | undefined> {
    const row = await this.manager.findOne(ProcessingRequestEntity, {
      where: { processingRequestId, ownerUserId },
    });
    return row ? toDomain(row) : undefined;
  }
}
