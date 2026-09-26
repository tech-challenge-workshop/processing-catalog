import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { GetOwnedProcessingRequestQuery } from '../application/get-owned-processing-request.query';
import { ListOwnedProcessingRequestsQuery } from '../application/list-owned-processing-requests.query';
import { OwnedItem, OwnedPage } from '../application/owned-item';

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Owner-scoped reads for the API, the only caller. The owner is in the path,
 * so an unscoped read is not even a route. Registered in every mode, unlike
 * the local-only observation controller.
 */
@Controller('owners/:ownerUserId/processing-requests')
export class OwnedProcessingRequestsController {
  constructor(
    private readonly listOwned: ListOwnedProcessingRequestsQuery,
    private readonly getOwned: GetOwnedProcessingRequestQuery,
  ) {}

  @Get()
  list(
    @Param('ownerUserId') ownerUserId: string,
    @Query('page') page: unknown,
    @Query('pageSize') pageSize: unknown,
  ): Promise<OwnedPage> {
    this.requireOwner(ownerUserId);
    return this.listOwned.execute({
      ownerUserId,
      page: parseBounded(
        page,
        DEFAULT_PAGE,
        1,
        Number.MAX_SAFE_INTEGER,
        () => 'page must be an integer greater than or equal to 1',
      ),
      pageSize: parseBounded(
        pageSize,
        DEFAULT_PAGE_SIZE,
        1,
        MAX_PAGE_SIZE,
        () => `pageSize must be an integer between 1 and ${MAX_PAGE_SIZE}`,
      ),
    });
  }

  @Get(':id')
  async findOne(
    @Param('ownerUserId') ownerUserId: string,
    @Param('id') id: string,
  ): Promise<OwnedItem> {
    this.requireOwner(ownerUserId);
    // The column is uuid: PostgreSQL would reject a malformed id with an
    // error, a 500 that tells malformed apart from missing. Answer it like
    // any other miss, before the query.
    if (!UUID.test(id)) {
      throw notFound();
    }
    const item = await this.getOwned.execute({
      ownerUserId,
      processingRequestId: id,
    });
    if (!item) {
      throw notFound();
    }
    return item;
  }

  private requireOwner(ownerUserId: string): void {
    if (!ownerUserId || ownerUserId.trim().length === 0) {
      throw new BadRequestException('ownerUserId is required');
    }
  }
}

/**
 * One body for every miss - another owner's id, an unknown id, a malformed
 * id - so the response is not an oracle for which requests exist.
 */
function notFound(): NotFoundException {
  return new NotFoundException('Processing request not found');
}

function parseBounded(
  raw: unknown,
  fallback: number,
  min: number,
  max: number,
  message: () => string,
): number {
  if (raw === undefined) {
    return fallback;
  }
  // A repeated parameter arrives as an array and fails the digit test.
  const value =
    typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new BadRequestException(message());
  }
  return value;
}
