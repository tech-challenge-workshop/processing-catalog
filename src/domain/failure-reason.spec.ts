import { FAILURE_CODES, FailureCode } from './processing-request';
import { failureReasonFor } from './failure-reason';

describe('failureReasonFor', () => {
  it.each(FAILURE_CODES)('maps %s to a sentence', (code: FailureCode) => {
    expect(failureReasonFor(code).length).toBeGreaterThan(0);
  });

  it('gives every code a distinct sentence', () => {
    const sentences = FAILURE_CODES.map(failureReasonFor);

    expect(new Set(sentences).size).toBe(FAILURE_CODES.length);
  });

  it('never exposes an internal detail', () => {
    for (const code of FAILURE_CODES) {
      const reason = failureReasonFor(code);

      // No storage keys, stack frames, exception text or raw codes.
      expect(reason).not.toMatch(/s3:|local\/|\.zip|at\s+\w+\.|Error:/i);
      expect(reason).not.toContain(code);
    }
  });
});
