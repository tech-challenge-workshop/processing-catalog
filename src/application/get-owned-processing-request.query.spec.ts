import {
  ProcessingRequestStatus,
  createProcessingRequest,
  failProcessingRequest,
  acceptProcessingRequest,
} from '../domain/processing-request';
import { InMemoryProcessingRequestRepository } from '../infrastructure/in-memory-processing-request.repository';
import { GetOwnedProcessingRequestQuery } from './get-owned-processing-request.query';

describe('GetOwnedProcessingRequestQuery', () => {
  let repository: InMemoryProcessingRequestRepository;
  let query: GetOwnedProcessingRequestQuery;

  beforeEach(() => {
    repository = new InMemoryProcessingRequestRepository();
    query = new GetOwnedProcessingRequestQuery(repository);
  });

  it('returns the owned item to its owner', async () => {
    const failed = failProcessingRequest(
      acceptProcessingRequest(
        createProcessingRequest({
          ownerUserId: 'alice',
          sourceStorageKey: 'videos/input.mp4',
        }),
      ),
      'DURACAO_EXCEDIDA',
    );
    await repository.save(failed);

    const item = await query.execute({
      ownerUserId: 'alice',
      processingRequestId: failed.processingRequestId,
    });

    expect(item).toStrictEqual({
      processingRequestId: failed.processingRequestId,
      status: ProcessingRequestStatus.FAILED,
      createdAt: failed.createdAt.toISOString(),
      updatedAt: failed.updatedAt.toISOString(),
      failureReason: 'O video excede a duracao maxima de 10 minutos.',
    });
  });

  it('returns nothing for another owner', async () => {
    const request = createProcessingRequest({
      ownerUserId: 'alice',
      sourceStorageKey: 'videos/input.mp4',
    });
    await repository.save(request);

    await expect(
      query.execute({
        ownerUserId: 'bob',
        processingRequestId: request.processingRequestId,
      }),
    ).resolves.toBeUndefined();
  });

  it('returns nothing for an unknown id', async () => {
    await expect(
      query.execute({
        ownerUserId: 'alice',
        processingRequestId: '11111111-1111-4111-8111-111111111111',
      }),
    ).resolves.toBeUndefined();
  });
});
