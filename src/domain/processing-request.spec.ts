import {
  ProcessingRequestStatus,
  createProcessingRequest,
} from './processing-request';

describe('ProcessingRequest', () => {
  it('creates a request in RECEIVED state with required fields', () => {
    const ownerUserId = 'user-123';
    const sourceStorageKey = 'videos/input.mp4';

    const request = createProcessingRequest({ ownerUserId, sourceStorageKey });

    expect(request.status).toBe(ProcessingRequestStatus.RECEIVED);
    expect(request.ownerUserId).toBe(ownerUserId);
    expect(request.sourceStorageKey).toBe(sourceStorageKey);
    expect(request.processingRequestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(request.createdAt).toBeInstanceOf(Date);
    expect(request.updatedAt).toBeInstanceOf(Date);
  });

  it('rejects creation when ownerUserId is missing', () => {
    expect(() =>
      createProcessingRequest({
        ownerUserId: '',
        sourceStorageKey: 'videos/input.mp4',
      }),
    ).toThrow('ownerUserId is required');
  });

  it('rejects creation when sourceStorageKey is missing', () => {
    expect(() =>
      createProcessingRequest({
        ownerUserId: 'user-123',
        sourceStorageKey: '',
      }),
    ).toThrow('sourceStorageKey is required');
  });
});
