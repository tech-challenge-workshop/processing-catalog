# Service Robustness — Context

Decisions captured on 2026-09-26, before Specify.

This is **spec F**, the second of three specs that resolve the leftovers from specs A–D. The plan runs E → F → G, and E (`gate-guards`) is already merged. F spans three repositories on the branch `fix/service-robustness`, one spec file each:

- `processing-catalog` (this file lives here);
- `notification-service`;
- `processing-worker`.

## Scope decided

| Item | Where | Decision |
| --- | --- | --- |
| V45 (Medium): `OUTBOX_PUBLISH_TIMEOUT_MS="0"` disables the library's timeout, so a silent broker freezes the relay | Catalog | In |
| V46 (Low/Medium): Started and Failed only check that `attemptId` is present, so `null` becomes `"null"`, is treated as stale and is acked without going to the DLQ | Catalog | In |
| V47 (Low): the advisory lock's release is untested; the dedup/stale order in Fail is not pinned; the `RECEIVED` exemption is not written in the spec; an orphaned doc comment | Catalog | In |
| V48 (Medium): a message with `data: null` or no `data` is never settled; every `SyntaxError` counts as permanent | Notification | In |
| V49 (Low/Medium): the shutdown hook's order is not pinned; a window after the flag check; the broker suite's CI guard is untested; the `SyntaxError` branch is dead for non-JSON input | Worker | In, with the decisions below |

## Decisions (user, 2026-09-26)

| Question | Answer |
| --- | --- |
| V49, the window after the shutdown flag check | **Accepted and documented.** If shutdown starts while `ProcessingCompleted` is being published, the event may go out twice. The Catalog already deduplicates it by `eventId`. No change to the consumer |
| V49, the Worker's `SyntaxError` branch | **Removed.** Nest nacks non-JSON before any Worker code runs. The broker suite already proves that non-JSON goes to the DLQ |

## Agent's discretion

- Where the Catalog's `attemptId` validation lives, as long as all three attempt consumers share it.
- How the Worker's hook-order test reaches the moment between `onModuleDestroy` and `onApplicationShutdown`. One option is a test-only provider whose `beforeApplicationShutdown` releases the held packager.
