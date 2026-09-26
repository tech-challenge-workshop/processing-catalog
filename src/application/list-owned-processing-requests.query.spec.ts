import {
  ProcessingRequest,
  createProcessingRequest,
} from '../domain/processing-request';
import { InMemoryProcessingRequestRepository } from '../infrastructure/in-memory-processing-request.repository';
import { ListOwnedProcessingRequestsQuery } from './list-owned-processing-requests.query';

const t = (minute: number) =>
  new Date(`2026-09-26T10:${String(minute).padStart(2, '0')}:00.000Z`);

function ownedBy(ownerUserId: string, createdAt: Date): ProcessingRequest {
  return {
    ...createProcessingRequest({
      ownerUserId,
      // One source per request: an owner holds one request per source.
      sourceStorageKey: `videos/${createdAt.toISOString()}.mp4`,
    }),
    createdAt,
    updatedAt: createdAt,
  };
}

describe('ListOwnedProcessingRequestsQuery', () => {
  let repository: InMemoryProcessingRequestRepository;
  let query: ListOwnedProcessingRequestsQuery;
  let alice: ProcessingRequest[];

  beforeEach(async () => {
    repository = new InMemoryProcessingRequestRepository();
    query = new ListOwnedProcessingRequestsQuery(repository);
    alice = [1, 2, 3, 4, 5].map((m) => ownedBy('alice', t(m)));
    for (const r of [...alice, ownedBy('bob', t(6))]) {
      await repository.save(r);
    }
  });

  it("returns the first page of the owner's items, newest first, with the page, size and total", async () => {
    const page = await query.execute({
      ownerUserId: 'alice',
      page: 1,
      pageSize: 2,
    });

    expect(page).toStrictEqual({
      items: [
        {
          processingRequestId: alice[4].processingRequestId,
          status: 'RECEIVED',
          createdAt: '2026-09-26T10:05:00.000Z',
          updatedAt: '2026-09-26T10:05:00.000Z',
        },
        {
          processingRequestId: alice[3].processingRequestId,
          status: 'RECEIVED',
          createdAt: '2026-09-26T10:04:00.000Z',
          updatedAt: '2026-09-26T10:04:00.000Z',
        },
      ],
      page: 1,
      pageSize: 2,
      total: 5,
    });
  });

  it('starts page p at offset (p - 1) * pageSize', async () => {
    const findPage = jest.spyOn(repository, 'findPageByOwner');

    const page = await query.execute({
      ownerUserId: 'alice',
      page: 3,
      pageSize: 2,
    });

    // Newest first is minutes 5,4 | 3,2 | 1: page 3 holds only the oldest.
    expect(page.items.map((i) => i.processingRequestId)).toEqual([
      alice[0].processingRequestId,
    ]);
    expect(findPage).toHaveBeenCalledWith('alice', 4, 2);
    expect(page.total).toBe(5);
  });

  it("never includes another owner's request, in the items or the total", async () => {
    const page = await query.execute({
      ownerUserId: 'bob',
      page: 1,
      pageSize: 20,
    });

    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(1);
    expect(
      page.items.some((i) =>
        alice.some((a) => a.processingRequestId === i.processingRequestId),
      ),
    ).toBe(false);
  });

  it('returns no items and a zero total for an owner with no requests', async () => {
    await expect(
      query.execute({ ownerUserId: 'carol', page: 1, pageSize: 20 }),
    ).resolves.toStrictEqual({ items: [], page: 1, pageSize: 20, total: 0 });
  });

  it("returns no items but the owner's total beyond the last page", async () => {
    await expect(
      query.execute({ ownerUserId: 'alice', page: 9, pageSize: 20 }),
    ).resolves.toStrictEqual({ items: [], page: 9, pageSize: 20, total: 5 });
  });
});
