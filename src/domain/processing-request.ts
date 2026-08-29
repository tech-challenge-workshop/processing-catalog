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
  attemptId: string | undefined;
  zipStorageKey: string | undefined;
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
    attemptId: undefined,
    zipStorageKey: undefined,
    createdAt: now,
    updatedAt: now,
  };
}

export function acceptProcessingRequest(
  request: ProcessingRequest,
): ProcessingRequest {
  if (request.status !== ProcessingRequestStatus.RECEIVED) {
    throw new ProcessingRequestDomainError(
      `Cannot accept request in ${request.status} status`,
    );
  }

  const now = new Date();
  return {
    ...request,
    status: ProcessingRequestStatus.QUEUED,
    attemptId: randomUUID(),
    updatedAt: now,
  };
}

export function completeProcessingRequest(
  request: ProcessingRequest,
  zipStorageKey: string,
): ProcessingRequest {
  if (request.status !== ProcessingRequestStatus.QUEUED) {
    throw new ProcessingRequestDomainError(
      `Cannot complete request in ${request.status} status`,
    );
  }
  if (!zipStorageKey || zipStorageKey.trim().length === 0) {
    throw new ProcessingRequestDomainError('zipStorageKey is required');
  }

  const now = new Date();
  return {
    ...request,
    status: ProcessingRequestStatus.COMPLETED,
    zipStorageKey,
    updatedAt: now,
  };
}
