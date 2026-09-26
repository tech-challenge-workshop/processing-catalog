import { failureReasonFor } from '../domain/failure-reason';
import {
  ProcessingRequest,
  ProcessingRequestStatus,
} from '../domain/processing-request';

/**
 * What the Catalog tells its caller about a request on its owner's behalf.
 * Declared here, not shared (AD-003): the API keeps its own copy.
 */
export interface OwnedItem {
  processingRequestId: string;
  status: ProcessingRequestStatus;
  createdAt: string;
  updatedAt: string;
  /** Present if and only if the status is FAILED. */
  failureReason?: string;
}

export interface OwnedPage {
  items: OwnedItem[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * Built from an allow-list, never by copying the aggregate and deleting
 * fields: a field added to the aggregate later stays private until someone
 * decides to expose it. Storage keys, the attempt, the raw failure code and
 * the owner never leave through here.
 */
export function toOwnedItem(request: ProcessingRequest): OwnedItem {
  const item: OwnedItem = {
    processingRequestId: request.processingRequestId,
    status: request.status,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
  };
  if (
    request.status === ProcessingRequestStatus.FAILED &&
    request.failureCode
  ) {
    item.failureReason = failureReasonFor(request.failureCode);
  }
  return item;
}
