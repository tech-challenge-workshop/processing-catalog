import { Inject } from '@nestjs/common';
import type { ProcessingRequestRepository } from '../domain/processing-request.repository';
import { OwnedPage, toOwnedItem } from './owned-item';

export interface ListOwnedProcessingRequestsInput {
  ownerUserId: string;
  /** 1-based; validated by the caller. */
  page: number;
  pageSize: number;
}

/**
 * A plain read through the repository: nothing is written, so there is no
 * unit of work and no lock to hold.
 */
export class ListOwnedProcessingRequestsQuery {
  constructor(
    @Inject('ProcessingRequestRepository')
    private readonly repository: ProcessingRequestRepository,
  ) {}

  async execute({
    ownerUserId,
    page,
    pageSize,
  }: ListOwnedProcessingRequestsInput): Promise<OwnedPage> {
    const offset = (page - 1) * pageSize;
    const [rows, total] = await Promise.all([
      this.repository.findPageByOwner(ownerUserId, offset, pageSize),
      this.repository.countByOwner(ownerUserId),
    ]);
    return { items: rows.map(toOwnedItem), page, pageSize, total };
  }
}
