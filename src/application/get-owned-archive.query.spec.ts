import {
  ProcessingRequest,
  acceptProcessingRequest,
  completeProcessingRequest,
  createProcessingRequest,
  failProcessingRequest,
  startProcessingRequest,
} from '../domain/processing-request';
import { InMemoryProcessingRequestRepository } from '../infrastructure/in-memory-processing-request.repository';
import { GetOwnedArchiveQuery } from './get-owned-archive.query';

describe('GetOwnedArchiveQuery', () => {
  let repository: InMemoryProcessingRequestRepository;
  let query: GetOwnedArchiveQuery;

  const received = () =>
    createProcessingRequest({
      ownerUserId: 'alice',
      sourceStorageKey: 'sources/alice/a.mp4',
    });

  beforeEach(() => {
    repository = new InMemoryProcessingRequestRepository();
    query = new GetOwnedArchiveQuery(repository);
  });

  it("returns a completed request's archive key to its owner", async () => {
    const completed = completeProcessingRequest(
      acceptProcessingRequest(received()),
      'zips/alice/out.zip',
    );
    await repository.save(completed);

    await expect(
      query.execute({
        ownerUserId: 'alice',
        processingRequestId: completed.processingRequestId,
      }),
    ).resolves.toStrictEqual({
      kind: 'ready',
      zipStorageKey: 'zips/alice/out.zip',
    });
  });

  it.each<[string, () => ProcessingRequest]>([
    ['RECEIVED', () => received()],
    ['QUEUED', () => acceptProcessingRequest(received())],
    [
      'PROCESSING',
      () => startProcessingRequest(acceptProcessingRequest(received())),
    ],
    [
      'FAILED',
      () =>
        failProcessingRequest(
          acceptProcessingRequest(received()),
          'PROCESSAMENTO_FALHOU',
        ),
    ],
  ])('reports an owned %s request as not completed', async (_status, make) => {
    const request = make();
    await repository.save(request);

    await expect(
      query.execute({
        ownerUserId: 'alice',
        processingRequestId: request.processingRequestId,
      }),
    ).resolves.toStrictEqual({ kind: 'not-completed' });
  });

  // The domain cannot produce this row (completion requires the key); if the
  // column is ever NULL, there is no archive to hand out, so it answers like
  // any request that has none yet rather than as a 200 without a key.
  it('reports a COMPLETED request without an archive key as not completed', async () => {
    const broken = {
      ...completeProcessingRequest(
        acceptProcessingRequest(received()),
        'zips/alice/out.zip',
      ),
      zipStorageKey: undefined,
    };
    await repository.save(broken);

    await expect(
      query.execute({
        ownerUserId: 'alice',
        processingRequestId: broken.processingRequestId,
      }),
    ).resolves.toStrictEqual({ kind: 'not-completed' });
  });

  it("finds nothing for another owner's completed request", async () => {
    const completed = completeProcessingRequest(
      acceptProcessingRequest(received()),
      'zips/alice/out.zip',
    );
    await repository.save(completed);

    await expect(
      query.execute({
        ownerUserId: 'bob',
        processingRequestId: completed.processingRequestId,
      }),
    ).resolves.toStrictEqual({ kind: 'not-found' });
  });

  it('finds nothing for an unknown id', async () => {
    await expect(
      query.execute({
        ownerUserId: 'alice',
        processingRequestId: '11111111-1111-4111-8111-111111111111',
      }),
    ).resolves.toStrictEqual({ kind: 'not-found' });
  });
});
