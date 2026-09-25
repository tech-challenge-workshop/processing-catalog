import {
  ProcessingRequestStatus,
  acceptProcessingRequest,
  completeProcessingRequest,
  failProcessingRequest,
  isFailureCode,
  isUnchanged,
  startProcessingRequest,
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

  it('transitions PROCESSING to COMPLETED and stores the zipStorageKey', () => {
    const request = startProcessingRequest(
      acceptProcessingRequest(
        createProcessingRequest({
          ownerUserId: 'user-123',
          sourceStorageKey: 'videos/input.mp4',
        }),
      ),
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
    const request = startProcessingRequest(
      acceptProcessingRequest(
        createProcessingRequest({
          ownerUserId: 'user-123',
          sourceStorageKey: 'videos/input.mp4',
        }),
      ),
    );

    expect(() => completeProcessingRequest(request, '')).toThrow(
      'zipStorageKey is required',
    );

    expect(request.status).toBe(ProcessingRequestStatus.PROCESSING);
  });

  const queued = () =>
    acceptProcessingRequest(
      createProcessingRequest({
        ownerUserId: 'user-123',
        sourceStorageKey: 'videos/input.mp4',
      }),
    );

  const received = () =>
    createProcessingRequest({
      ownerUserId: 'user-123',
      sourceStorageKey: 'videos/input.mp4',
    });

  describe('startProcessingRequest', () => {
    it('transitions QUEUED to PROCESSING and refreshes updatedAt', () => {
      const request = queued();

      const started = startProcessingRequest(request);

      expect(started.status).toBe(ProcessingRequestStatus.PROCESSING);
      expect(started.attemptId).toBe(request.attemptId);
      expect(started.updatedAt.getTime()).toBeGreaterThanOrEqual(
        request.updatedAt.getTime(),
      );
    });

    it('rejects a RECEIVED request and leaves it unchanged', () => {
      const request = received();

      expect(() => startProcessingRequest(request)).toThrow(
        'Cannot start request in RECEIVED status',
      );
      expect(request.status).toBe(ProcessingRequestStatus.RECEIVED);
    });

    it('leaves a request that already started unchanged, so a replay creates no second start', () => {
      const request = startProcessingRequest(queued());

      const replayed = startProcessingRequest(request);

      expect(isUnchanged(request, replayed)).toBe(true);
      expect(replayed.status).toBe(ProcessingRequestStatus.PROCESSING);
    });

    it('leaves a completed request unchanged when its start arrives late', () => {
      const completed = completeProcessingRequest(queued(), 'zips/output.zip');

      const late = startProcessingRequest(completed);

      expect(isUnchanged(completed, late)).toBe(true);
      expect(late.status).toBe(ProcessingRequestStatus.COMPLETED);
    });

    it('leaves a failed request unchanged when its start arrives late', () => {
      const failed = failProcessingRequest(queued(), 'PROCESSAMENTO_FALHOU');

      const late = startProcessingRequest(failed);

      expect(isUnchanged(failed, late)).toBe(true);
      expect(late.status).toBe(ProcessingRequestStatus.FAILED);
    });
  });

  describe('completeProcessingRequest out of order', () => {
    it('completes a QUEUED request whose start has not been handled yet', () => {
      const request = queued();

      const completed = completeProcessingRequest(request, 'zips/out.zip');

      expect(completed.status).toBe(ProcessingRequestStatus.COMPLETED);
      expect(completed.zipStorageKey).toBe('zips/out.zip');
      expect(completed.attemptId).toBe(request.attemptId);
    });

    it('leaves a request completed with the same archive unchanged', () => {
      const completed = completeProcessingRequest(queued(), 'zips/out.zip');

      const again = completeProcessingRequest(completed, 'zips/out.zip');

      expect(isUnchanged(completed, again)).toBe(true);
    });

    it('rejects a second completion that names a different archive', () => {
      const completed = completeProcessingRequest(queued(), 'zips/out.zip');

      expect(() =>
        completeProcessingRequest(completed, 'zips/other.zip'),
      ).toThrow('Cannot complete request in COMPLETED status');
      expect(completed.zipStorageKey).toBe('zips/out.zip');
    });

    it('rejects completing a failed request', () => {
      const failed = failProcessingRequest(queued(), 'PROCESSAMENTO_FALHOU');

      expect(() => completeProcessingRequest(failed, 'zips/out.zip')).toThrow(
        'Cannot complete request in FAILED status',
      );
    });
  });

  describe('failProcessingRequest', () => {
    it('fails a RECEIVED request and records the code', () => {
      const request = received();

      const failed = failProcessingRequest(request, 'FORMATO_INVALIDO');

      expect(failed.status).toBe(ProcessingRequestStatus.FAILED);
      expect(failed.failureCode).toBe('FORMATO_INVALIDO');
      expect(request.status).toBe(ProcessingRequestStatus.RECEIVED);
    });

    it('fails a QUEUED request and records the code', () => {
      const failed = failProcessingRequest(queued(), 'DURACAO_EXCEDIDA');

      expect(failed.status).toBe(ProcessingRequestStatus.FAILED);
      expect(failed.failureCode).toBe('DURACAO_EXCEDIDA');
    });

    it('fails a PROCESSING request and keeps its attemptId', () => {
      const processing = startProcessingRequest(queued());

      const failed = failProcessingRequest(processing, 'PROCESSAMENTO_FALHOU');

      expect(failed.status).toBe(ProcessingRequestStatus.FAILED);
      expect(failed.failureCode).toBe('PROCESSAMENTO_FALHOU');
      expect(failed.attemptId).toBe(processing.attemptId);
    });

    it('rejects a request that already failed, leaving its code unchanged', () => {
      const failed = failProcessingRequest(queued(), 'DURACAO_EXCEDIDA');

      expect(() => failProcessingRequest(failed, 'FORMATO_INVALIDO')).toThrow(
        'Cannot fail request in FAILED status',
      );
      expect(failed.failureCode).toBe('DURACAO_EXCEDIDA');
    });

    it('rejects a completed request, leaving its stored state unchanged', () => {
      const completed = completeProcessingRequest(
        startProcessingRequest(queued()),
        'zips/output.zip',
      );

      expect(() =>
        failProcessingRequest(completed, 'PROCESSAMENTO_FALHOU'),
      ).toThrow('Cannot fail request in COMPLETED status');
      expect(completed.status).toBe(ProcessingRequestStatus.COMPLETED);
      expect(completed.failureCode).toBeUndefined();
    });

    it('rejects a code outside the vocabulary rather than storing it', () => {
      const request = queued();

      expect(() =>
        failProcessingRequest(
          request,
          'INVENTADO' as unknown as Parameters<typeof failProcessingRequest>[1],
        ),
      ).toThrow('Unknown failure code INVENTADO');
      expect(request.status).toBe(ProcessingRequestStatus.QUEUED);
    });
  });

  describe('isFailureCode', () => {
    it('accepts every code in the vocabulary', () => {
      for (const code of [
        'FORMATO_INVALIDO',
        'DURACAO_EXCEDIDA',
        'PROCESSAMENTO_FALHOU',
      ]) {
        expect(isFailureCode(code)).toBe(true);
      }
    });

    it('rejects anything else', () => {
      expect(isFailureCode('OUTRO')).toBe(false);
      expect(isFailureCode(undefined)).toBe(false);
    });
  });

  it('creates a request with no failure code', () => {
    expect(received().failureCode).toBeUndefined();
  });
});
