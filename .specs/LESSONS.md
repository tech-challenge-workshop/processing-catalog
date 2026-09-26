# LESSONS - auto-maintained by scripts/lessons.py

> Machine-owned. Do NOT hand-edit. Changes are overwritten on the next `lessons.py` write.
> Canonical state lives in `.specs/lessons.json`. Edit lessons only via the script.
> promote_threshold=2 distinct features · window_days=45 · quarantine_threshold=2

## Confirmed (load these at Specify/Design)

Corroborated across multiple features. Safe to apply as guidance.

### L-005 - A client-chosen token stored under a btree unique index needs a specified maximum length so an oversized value is a 400, not a 500.
- signal: `spec_precision_gap` · recurrence: 2 feature(s) · scope: `persistence` · harmful: 0
- features: upload-download, api-hardening
- evidence: src/infrastructure/persistence/migrations/1789956000000-AddIdempotencyKey.ts:16 (persistence) (+1 more)
- last seen: 2026-09-26T13:56:10Z

## Candidates (under observation - do NOT load as guidance yet)

Seen once or not yet corroborated. Tracked, not trusted.

### L-001 - Add a characterization test for spec edge cases even when the behavior is documented as unreachable, so a future code addition cannot silently bypass the required rejection
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `domain` · harmful: 0
- features: initial-vertical-slice
- evidence: spec.md:48 - edge case unsupported status transition has no test (domain)
- last seen: 2026-08-27T23:35:46Z

### L-002 - When a field is present iff a status, specify the outcome for rows whose supporting column is null or add a database constraint that forbids them
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · harmful: 0
- features: auth-owner-scope
- evidence: src/application/owned-item.ts:40
- last seen: 2026-09-26T03:43:02Z

### L-003 - When a spec validates an identifier after trimming, also state whether the trimmed or raw value is used in the query
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · harmful: 0
- features: auth-owner-scope
- evidence: src/interface/owned-processing-requests.controller.ts:80
- last seen: 2026-09-26T03:43:02Z

### L-004 - When a client-chosen identifier is trimmed for validation, the spec must say whether the raw or trimmed value is stored and matched.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `interface` · harmful: 0
- features: upload-download
- evidence: src/interface/create-processing-request.controller.ts:75 (interface)
- last seen: 2026-09-26T05:29:40Z

### L-006 - When a spec fixes a validation order across fields, add at least one test with two malformed fields.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `interface` · harmful: 0
- features: api-hardening
- evidence: src/interface/create-processing-request.controller.ts:75 (interface)
- last seen: 2026-09-26T13:56:10Z

### L-007 - Test the lost-race branch where the re-read finds nothing, not only the branch where it finds the winner.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `application` · harmful: 0
- features: api-hardening
- evidence: src/application/create-processing-request.use-case.ts:118 (application)
- last seen: 2026-09-26T13:56:10Z

### L-008 - When a numeric config is passed to a library, specify what 0 means in that library; a parser rule copied from another setting can silently disable a safety timeout.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `config` · harmful: 0
- features: catalog-messaging-hardening
- evidence: src/infrastructure/rabbitmq/rabbitmq.connection.ts:52 (config)
- last seen: 2026-09-26T19:03:04Z

### L-009 - Test that a lock is released, not only that it excludes; an exclusion test passes equally for a lock never released.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `persistence` · harmful: 0
- features: catalog-messaging-hardening
- evidence: src/infrastructure/messaging/outbox-relay.ts (persistence)
- last seen: 2026-09-26T19:03:04Z

### L-010 - When a rule makes a previously ignored field meaningful, re-check every parser of that field for presence-only validation.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `messaging` · harmful: 0
- features: catalog-messaging-hardening
- evidence: src/infrastructure/rabbitmq/processing-failed.consumer.ts:55 (messaging)
- last seen: 2026-09-26T19:03:04Z

## Quarantined (failed when applied - ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
