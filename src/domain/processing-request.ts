import { randomUUID } from 'crypto';

export enum ProcessingRequestStatus {
  RECEIVED = 'RECEIVED',
  QUEUED = 'QUEUED',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

/**
 * The closed vocabulary of safe failure codes, fixed by `docs/foudation.md`.
 * Anything outside it is rejected rather than stored.
 */
export type FailureCode =
  'FORMATO_INVALIDO' | 'DURACAO_EXCEDIDA' | 'PROCESSAMENTO_FALHOU';

export const FAILURE_CODES: readonly FailureCode[] = [
  'FORMATO_INVALIDO',
  'DURACAO_EXCEDIDA',
  'PROCESSAMENTO_FALHOU',
];

export function isFailureCode(value: unknown): value is FailureCode {
  return FAILURE_CODES.includes(value as FailureCode);
}

export interface ProcessingRequest {
  processingRequestId: string;
  ownerUserId: string;
  sourceStorageKey: string;
  status: ProcessingRequestStatus;
  attemptId: string | undefined;
  zipStorageKey: string | undefined;
  failureCode: FailureCode | undefined;
  /** The owner's confirmation key. Absent on requests created before S6. */
  idempotencyKey: string | undefined;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProcessingRequestInput {
  ownerUserId: string;
  sourceStorageKey: string;
  idempotencyKey?: string;
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
    failureCode: undefined,
    idempotencyKey: input.idempotencyKey,
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

/**
 * Whether a transition changed anything. The lifecycle functions return the
 * **same object** when an event restates what is already true, so callers
 * can record the event as seen without writing a state change or publishing.
 */
export function isUnchanged(
  before: ProcessingRequest,
  after: ProcessingRequest,
): boolean {
  return before === after;
}

const COMPLETABLE_STATUSES: readonly ProcessingRequestStatus[] = [
  ProcessingRequestStatus.QUEUED,
  ProcessingRequestStatus.PROCESSING,
];

export function completeProcessingRequest(
  request: ProcessingRequest,
  zipStorageKey: string,
): ProcessingRequest {
  if (!zipStorageKey || zipStorageKey.trim().length === 0) {
    throw new ProcessingRequestDomainError('zipStorageKey is required');
  }
  if (
    request.status === ProcessingRequestStatus.COMPLETED &&
    request.zipStorageKey === zipStorageKey
  ) {
    // The same completion reported again - a redelivery the eventId did not
    // catch. It states what is already true, so it changes nothing.
    return request;
  }
  if (!COMPLETABLE_STATUSES.includes(request.status)) {
    throw new ProcessingRequestDomainError(
      `Cannot complete request in ${request.status} status`,
    );
  }
  // QUEUED is accepted because ProcessingStarted and ProcessingCompleted
  // travel on different queues: the completion can be handled before the
  // start. The Worker publishes the start first, so a completion is proof
  // that processing began - refusing it would dead-letter the only event that
  // carries the archive key and leave the request in PROCESSING forever.

  const now = new Date();
  return {
    ...request,
    status: ProcessingRequestStatus.COMPLETED,
    zipStorageKey,
    updatedAt: now,
  };
}

export function startProcessingRequest(
  request: ProcessingRequest,
): ProcessingRequest {
  if (request.status === ProcessingRequestStatus.RECEIVED) {
    // Nothing can start before the video was accepted: the Worker only sees
    // the job once the acceptance has committed and been published.
    throw new ProcessingRequestDomainError(
      `Cannot start request in ${request.status} status`,
    );
  }
  if (request.status !== ProcessingRequestStatus.QUEUED) {
    // A start that arrives after the request already moved on - overtaken by
    // its own completion or failure, or repeated. It is stale, not wrong:
    // applying it would move a finished request backwards.
    return request;
  }

  const now = new Date();
  return {
    ...request,
    status: ProcessingRequestStatus.PROCESSING,
    updatedAt: now,
  };
}

const FAILABLE_STATUSES: readonly ProcessingRequestStatus[] = [
  ProcessingRequestStatus.RECEIVED,
  ProcessingRequestStatus.QUEUED,
  ProcessingRequestStatus.PROCESSING,
];

export function failProcessingRequest(
  request: ProcessingRequest,
  failureCode: FailureCode,
): ProcessingRequest {
  if (!FAILABLE_STATUSES.includes(request.status)) {
    throw new ProcessingRequestDomainError(
      `Cannot fail request in ${request.status} status`,
    );
  }
  if (!isFailureCode(failureCode)) {
    throw new ProcessingRequestDomainError(
      `Unknown failure code ${String(failureCode)}`,
    );
  }

  const now = new Date();
  return {
    ...request,
    status: ProcessingRequestStatus.FAILED,
    failureCode,
    updatedAt: now,
  };
}
