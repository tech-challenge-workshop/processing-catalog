import { Inject } from '@nestjs/common';
import type { ProcessingRequestRepository } from '../domain/processing-request.repository';
import { OwnedItem, toOwnedItem } from './owned-item';

export interface GetOwnedProcessingRequestInput {
  ownerUserId: string;
  processingRequestId: string;
}

export class GetOwnedProcessingRequestQuery {
  constructor(
    @Inject('ProcessingRequestRepository')
    private readonly repository: ProcessingRequestRepository,
  ) {}

  /** Undefined both for a missing request and for another owner's. */
  async execute({
    ownerUserId,
    processingRequestId,
  }: GetOwnedProcessingRequestInput): Promise<OwnedItem | undefined> {
    const request = await this.repository.findByIdAndOwner(
      processingRequestId,
      ownerUserId,
    );
    return request ? toOwnedItem(request) : undefined;
  }
}
