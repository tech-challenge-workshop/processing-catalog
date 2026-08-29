import {
  ProcessingRequestStatus,
  acceptProcessingRequest,
  completeProcessingRequest,
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
    expect(request.attemptId).toBeUndefined();
    expect(request.zipStorageKey).toBeUndefined();
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

  it('transitions RECEIVED to QUEUED and generates an attemptId', () => {
    const request = createProcessingRequest({
      ownerUserId: 'user-123',
      sourceStorageKey: 'videos/input.mp4',
    });

    const accepted = acceptProcessingRequest(request);

    expect(accepted.status).toBe(ProcessingRequestStatus.QUEUED);
    expect(accepted.attemptId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(accepted.zipStorageKey).toBeUndefined();
    expect(accepted.updatedAt.getTime()).toBeGreaterThanOrEqual(
      request.updatedAt.getTime(),
    );
  });

  it('transitions QUEUED to COMPLETED and stores the zipStorageKey', () => {
    const request = acceptProcessingRequest(
      createProcessingRequest({
        ownerUserId: 'user-123',
        sourceStorageKey: 'videos/input.mp4',
      }),
    );

    const completed = completeProcessingRequest(request, 'zips/output.zip');

    expect(completed.status).toBe(ProcessingRequestStatus.COMPLETED);
    expect(completed.zipStorageKey).toBe('zips/output.zip');
    expect(completed.attemptId).toBe(request.attemptId);
    expect(completed.updatedAt.getTime()).toBeGreaterThanOrEqual(
      request.updatedAt.getTime(),
    );
  });

  it('rejects direct transition from RECEIVED to COMPLETED', () => {
    const request = createProcessingRequest({
      ownerUserId: 'user-123',
      sourceStorageKey: 'videos/input.mp4',
    });

    expect(() => completeProcessingRequest(request, 'zips/output.zip')).toThrow(
      'Cannot complete request in RECEIVED status',
    );

    expect(request.status).toBe(ProcessingRequestStatus.RECEIVED);
    expect(request.zipStorageKey).toBeUndefined();
  });

  it('rejects transition from QUEUED to QUEUED', () => {
    const request = acceptProcessingRequest(
      createProcessingRequest({
        ownerUserId: 'user-123',
        sourceStorageKey: 'videos/input.mp4',
      }),
    );
    const originalAttemptId = request.attemptId;

    expect(() => acceptProcessingRequest(request)).toThrow(
      'Cannot accept request in QUEUED status',
    );

    expect(request.status).toBe(ProcessingRequestStatus.QUEUED);
    expect(request.attemptId).toBe(originalAttemptId);
  });

  it('rejects completion without a zipStorageKey', () => {
    const request = acceptProcessingRequest(
      createProcessingRequest({
        ownerUserId: 'user-123',
        sourceStorageKey: 'videos/input.mp4',
      }),
    );

    expect(() => completeProcessingRequest(request, '')).toThrow(
      'zipStorageKey is required',
    );

    expect(request.status).toBe(ProcessingRequestStatus.QUEUED);
  });
});
