/**
 * The one rule every attempt event's `attemptId` follows: a non-blank string.
 * Anything else - missing, `null`, a number, empty or blank - cannot name an
 * attempt, so the message is malformed and goes to the DLQ instead of being
 * mistaken for a stale attempt and acked.
 */
export function isValidAttemptId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
