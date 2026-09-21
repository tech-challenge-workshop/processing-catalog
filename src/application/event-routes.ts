/**
 * Where each outgoing event goes.
 *
 * Previously this lived inside the publisher, one method per event. With the
 * outbox owning publication, the use case records a destination rather than
 * calling a named method, so the mapping has to be a value it can reference.
 */
export const EVENT_ROUTES = {
  VideoValidationRequested: {
    queue: 'video-validation',
    pattern: 'VideoValidationRequested',
  },
  ProcessingQueued: {
    queue: 'processing',
    pattern: 'ProcessingQueued',
  },
  TerminalEvent: {
    queue: 'notification.terminal',
    pattern: 'terminal.event',
  },
} as const;

export type CatalogEventName = keyof typeof EVENT_ROUTES;
