import {
  ProcessingRequest,
  acceptProcessingRequest,
  createProcessingRequest,
} from '../domain/processing-request';
import { InMemoryProcessingRequestRepository } from './in-memory-processing-request.repository';

function ownedBy(
  ownerUserId: string,
  createdAt: Date,
  processingRequestId?: string,
): ProcessingRequest {
  const request = createProcessingRequest({
    ownerUserId,
    sourceStorageKey: 'videos/input.mp4',
  });
  return {
    ...request,
    processingRequestId: processingRequestId ?? request.processingRequestId,
    createdAt,
    updatedAt: createdAt,
  };
}

describe('InMemoryProcessingRequestRepository', () => {
  let repository: InMemoryProcessingRequestRepository;

  beforeEach(() => {
    repository = new InMemoryProcessingRequestRepository();
  });

  it('saves a request and finds it by processingRequestId', async () => {
    const request = createProcessingRequest({
      ownerUserId: 'user-123',
      sourceStorageKey: 'videos/input.mp4',
    });

    await repository.save(request);

    const found = await repository.findByProcessingRequestId(
      request.processingRequestId,
    );
    expect(found).toEqual(request);
  });

  it('updates a request in place', async () => {
    const request = createProcessingRequest({
      ownerUserId: 'user-123',
      sourceStorageKey: 'videos/input.mp4',
    });
    await repository.save(request);

    const updated = acceptProcessingRequest(request);
    await repository.update(updated);

    const found = await repository.findByProcessingRequestId(
      request.processingRequestId,
    );
    expect(found).toEqual(updated);
    expect(found?.status).toBe('QUEUED');
  });

  it('returns undefined when processingRequestId is not found', async () => {
    const found = await repository.findByProcessingRequestId('non-existent-id');
    expect(found).toBeUndefined();
  });

  it('tracks a processed eventId and detects duplicates', async () => {
    const eventId = 'event-123';

    expect(await repository.hasEventBeenProcessed(eventId)).toBe(false);

    await repository.markEventProcessed(eventId);

    expect(await repository.hasEventBeenProcessed(eventId)).toBe(true);
  });

  it('finds a request saved under a given eventId', async () => {
    const eventId = 'event-456';
    const request = createProcessingRequest({
      ownerUserId: 'user-456',
      sourceStorageKey: 'videos/another.mp4',
    });

    await repository.save(request);
    await repository.markEventProcessed(eventId, request.processingRequestId);

    const found = await repository.findByEventId(eventId);
    expect(found).toEqual(request);
  });

  it('returns undefined when eventId is not found', async () => {
    const found = await repository.findByEventId('non-existent-event');
    expect(found).toBeUndefined();
  });

  describe('owner-scoped reads', () => {
    const t = (minute: number) =>
      new Date(`2026-09-26T10:${String(minute).padStart(2, '0')}:00.000Z`);

    it('pages only the given owner, newest first', async () => {
      const aliceOld = ownedBy('alice', t(1));
      const bobMiddle = ownedBy('bob', t(2));
      const aliceNew = ownedBy('alice', t(3));
      for (const r of [aliceOld, bobMiddle, aliceNew]) {
        await repository.save(r);
      }

      const alicePage = await repository.findPageByOwner('alice', 0, 10);
      const bobPage = await repository.findPageByOwner('bob', 0, 10);

      expect(alicePage.map((r) => r.processingRequestId)).toEqual([
        aliceNew.processingRequestId,
        aliceOld.processingRequestId,
      ]);
      expect(bobPage.map((r) => r.processingRequestId)).toEqual([
        bobMiddle.processingRequestId,
      ]);
    });

    it('breaks a createdAt tie by processingRequestId ascending, whatever the insertion order', async () => {
      const lowId = '00000000-0000-4000-8000-000000000001';
      const highId = 'ffffffff-ffff-4fff-bfff-ffffffffffff';
      await repository.save(ownedBy('alice', t(5), highId));
      await repository.save(ownedBy('alice', t(5), lowId));

      const page = await repository.findPageByOwner('alice', 0, 10);

      expect(page.map((r) => r.processingRequestId)).toEqual([lowId, highId]);
    });

    it('applies offset and limit after ordering', async () => {
      const rows = [1, 2, 3, 4, 5].map((m) => ownedBy('alice', t(m)));
      // Insert out of order so the slice cannot be insertion order by luck.
      for (const r of [rows[2], rows[0], rows[4], rows[1], rows[3]]) {
        await repository.save(r);
      }

      const page = await repository.findPageByOwner('alice', 2, 2);

      // Newest first is minutes 5,4,3,2,1; offset 2, limit 2 -> 3,2.
      expect(page.map((r) => r.processingRequestId)).toEqual([
        rows[2].processingRequestId,
        rows[1].processingRequestId,
      ]);
    });

    it('returns an empty page and a zero count for an owner with no requests', async () => {
      await repository.save(ownedBy('alice', t(1)));

      expect(await repository.findPageByOwner('carol', 0, 10)).toEqual([]);
      expect(await repository.countByOwner('carol')).toBe(0);
    });

    it('returns an empty page beyond the last one', async () => {
      await repository.save(ownedBy('alice', t(1)));
      await repository.save(ownedBy('alice', t(2)));

      expect(await repository.findPageByOwner('alice', 20, 20)).toEqual([]);
      expect(await repository.countByOwner('alice')).toBe(2);
    });

    it("counts only the given owner's requests", async () => {
      await repository.save(ownedBy('alice', t(1)));
      await repository.save(ownedBy('alice', t(2)));
      await repository.save(ownedBy('bob', t(3)));

      expect(await repository.countByOwner('alice')).toBe(2);
      expect(await repository.countByOwner('bob')).toBe(1);
    });

    it('finds a request by id for its owner and not for another', async () => {
      const aliceRequest = ownedBy('alice', t(1));
      await repository.save(aliceRequest);

      expect(
        await repository.findByIdAndOwner(
          aliceRequest.processingRequestId,
          'alice',
        ),
      ).toEqual(aliceRequest);
      expect(
        await repository.findByIdAndOwner(
          aliceRequest.processingRequestId,
          'bob',
        ),
      ).toBeUndefined();
      expect(
        await repository.findByIdAndOwner(
          '11111111-1111-4111-8111-111111111111',
          'alice',
        ),
      ).toBeUndefined();
    });
  });
});
