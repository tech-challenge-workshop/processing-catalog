import { Inject } from '@nestjs/common';
import { ProcessingRequestStatus } from '../domain/processing-request';
import type { ProcessingRequestRepository } from '../domain/processing-request.repository';

export interface GetOwnedArchiveInput {
  ownerUserId: string;
  processingRequestId: string;
}

/**
 * `not-found` covers both a missing request and another owner's, so the
 * caller cannot tell them apart. The key leaves only through `ready`.
 */
export type OwnedArchive =
  | { kind: 'ready'; zipStorageKey: string }
  | { kind: 'not-completed' }
  | { kind: 'not-found' };

/**
 * The one owner-scoped read that returns a storage key. It is its own
 * route and its own shape, so the key never reaches an item payload
 * (AUTH-13).
 */
export class GetOwnedArchiveQuery {
  constructor(
    @Inject('ProcessingRequestRepository')
    private readonly repository: ProcessingRequestRepository,
  ) {}

  async execute({
    ownerUserId,
    processingRequestId,
  }: GetOwnedArchiveInput): Promise<OwnedArchive> {
    const request = await this.repository.findByIdAndOwner(
      processingRequestId,
      ownerUserId,
    );
    if (!request) {
      return { kind: 'not-found' };
    }
    if (
      request.status !== ProcessingRequestStatus.COMPLETED ||
      !request.zipStorageKey
    ) {
      return { kind: 'not-completed' };
    }
    return { kind: 'ready', zipStorageKey: request.zipStorageKey };
  }
}
