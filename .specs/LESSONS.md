# LESSONS - auto-maintained by scripts/lessons.py

> Machine-owned. Do NOT hand-edit. Changes are overwritten on the next `lessons.py` write.
> Canonical state lives in `.specs/lessons.json`. Edit lessons only via the script.
> promote_threshold=2 distinct features · window_days=45 · quarantine_threshold=2

## Confirmed (load these at Specify/Design)

Corroborated across multiple features. Safe to apply as guidance.

_none_

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

## Quarantined (failed when applied - ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
