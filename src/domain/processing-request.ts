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
    failureCode: undefined,
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
  if (request.status !== ProcessingRequestStatus.PROCESSING) {
    // A completion that never started means a lost ProcessingStarted, not a
    // valid path: PROCESSING would otherwise be a decorative state.
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

export function startProcessingRequest(
  request: ProcessingRequest,
): ProcessingRequest {
  if (request.status !== ProcessingRequestStatus.QUEUED) {
    throw new ProcessingRequestDomainError(
      `Cannot start request in ${request.status} status`,
    );
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
