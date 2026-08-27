import { randomUUID } from 'crypto';

export enum ProcessingRequestStatus {
  RECEIVED = 'RECEIVED',
  QUEUED = 'QUEUED',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export interface ProcessingRequest {
  processingRequestId: string;
  ownerUserId: string;
  sourceStorageKey: string;
  status: ProcessingRequestStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProcessingRequestInput {
  ownerUserId: string;
  sourceStorageKey: string;
}

export class ProcessingRequestDomainError extends Error {}

export function createProcessingRequest(
  input: CreateProcessingRequestInput,
): ProcessingRequest {
  if (!input.ownerUserId || input.ownerUserId.trim().length === 0) {
    throw new ProcessingRequestDomainError('ownerUserId is required');
  }
  if (!input.sourceStorageKey || input.sourceStorageKey.trim().length === 0) {
    throw new ProcessingRequestDomainError('sourceStorageKey is required');
  }

  const now = new Date();
  return {
    processingRequestId: randomUUID(),
    ownerUserId: input.ownerUserId,
    sourceStorageKey: input.sourceStorageKey,
    status: ProcessingRequestStatus.RECEIVED,
    createdAt: now,
    updatedAt: now,
  };
}
