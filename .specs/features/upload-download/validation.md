# Upload and Download Validation — catalog

**Verdict**: PASS. UPL-11, UPL-12, UPL-13 and UPL-14 are met against real PostgreSQL. All 14 injected mutants were killed. Three low-severity spec-precision gaps are open, and none of them breaks an acceptance criterion.

**Date**: 2026-09-26
**Spec**: `.specs/features/upload-download/spec.md`
**Diff range**: `0d61cea..9006b14` (branch `feat/upload-download`, commits T1–T6)
**Verifier**: independent sub-agent (author ≠ verifier), read-only over the real tree

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1 Migration, entity and domain field | ✅ Done | 03aa37e |
| T2 Port lookup and in-memory uniqueness | ✅ Done | 1b38cdd |
| T3 TypeORM lookup and 23505 mapping | ✅ Done | 3183bdf |
| T4 Idempotent use case | ✅ Done | ed63f3b |
| T5 Create answers 201, 200 or 409 | ✅ Done | 6609fcc |
| T6 Archive route | ✅ Done | 9006b14 |

---

## Spec-Anchored Acceptance Criteria

### P1: Idempotent creation (UPL-11, UPL-12)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| 1. Unused key → create the request and its `VideoValidationRequested` in one transaction, answer 201 | 201, one row, one outbox entry | `test/create-processing-request-route.e2e-spec.ts:96` `expect(first.status).toBe(201)`; `:114-115` `rows(alice)).toBe(1)`, `outboxEntries(alice)).toBe(1)`; `src/application/create-processing-request.use-case.spec.ts:114` asserts `outcome 'created'`, the key stored and one outbox entry carrying the request id | ✅ PASS |
| 2. Same owner, key and source → 200 with the existing request, no row and no outbox entry written | 200, identical body, still 1 row and 1 outbox entry | `test/create-processing-request-route.e2e-spec.ts:112-115` `second.status).toBe(200)`, `second.body).toStrictEqual(created)`, rows 1, outbox 1; unit `:129` also asserts no processed-event record | ✅ PASS |
| 3. Same owner and key, different source → 409, nothing written | 409 | `test/create-processing-request-route.e2e-spec.ts:132-140` 409 with exact body, rows 1, outbox 1; `test/idempotent-creation.e2e-spec.ts:155-159` | ✅ PASS |
| 4. Two concurrent creates, same owner and key → one request, one outbox entry, both responses carry its id | 1 row, 1 outbox entry, identical ids | `test/idempotent-creation.e2e-spec.ts:78-88` (both ids equal the stored id), `:104-117` (burst of 8), `:120-146` (forced loser: the insert rejects with `DuplicateIdempotencyKeyError`, then the loser gets the winner's id); HTTP `test/create-processing-request-route.e2e-spec.ts:179-185` statuses `[200,201]`, `a).toBe(b)`, rows 1, outbox 1 | ✅ PASS |
| 5. Two owners, same key string → a request each | two 201s, distinct ids, one row and one outbox entry each | `test/idempotent-creation.e2e-spec.ts:162-178` (concurrent); `test/create-processing-request-route.e2e-spec.ts:188-210` | ✅ PASS |
| 6. Missing or blank key → 400, nothing written | 400 `idempotencyKey is required` | `test/create-processing-request-route.e2e-spec.ts:143-166` missing, empty and blank: exact body, rows 0, outbox 0 | ✅ PASS |

### P2: The archive key, for its owner only (UPL-13)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| 1. `COMPLETED` request of that owner → `200 { zipStorageKey }` | exactly `{zipStorageKey}` | `test/owned-processing-requests.e2e-spec.ts:456-459` `toStrictEqual({ zipStorageKey: 'zips/<alice>/out.zip' })` | ✅ PASS |
| 2. Owned but not `COMPLETED` → 409 | 409 | `test/owned-processing-requests.e2e-spec.ts:473-491` for RECEIVED, QUEUED and FAILED, exact body; unit `src/application/get-owned-archive.query.spec.ts:45-70` adds PROCESSING | ✅ PASS |
| 3. Another owner, missing id, or non-UUID id → the constant 404 of the owner-scoped reads | byte-identical to the item route's 404 | `test/owned-processing-requests.e2e-spec.ts:493-516` `expect(res.text).toBe(itemMiss.text)` for all three, plus a check that the other owner's response does not leak the key; `:518-531` a malformed id is refused before any query | ✅ PASS |
| 4. The owner-scoped list and read still carry no `zipStorageKey` | key-free | `test/owned-processing-requests.e2e-spec.ts:548-572` exact key sets, `not.toContain(zip)` and `not.toContain('zipStorageKey')` on a COMPLETED request | ✅ PASS |

### UPL-14: schema and migration

| Criterion | Outcome | Evidence | Result |
| --- | --- | --- | --- |
| Nullable column with a unique index on `(owner_user_id, idempotency_key)` | indexdef matches | `test/idempotency-key-migration.e2e-spec.ts:65-70` | ✅ PASS |
| Reversible: `down` removes both | column and index gone | `test/idempotency-key-migration.e2e-spec.ts:78-80` | ✅ PASS |
| Pre-S6 rows keep `NULL` and survive | row keeps a NULL key after reapply | `test/idempotency-key-migration.e2e-spec.ts:82-95` | ✅ PASS |
| Idempotent re-run | nothing pending | `test/idempotency-key-migration.e2e-spec.ts:124-128`; `test/persistence.e2e-spec.ts` (existing twice-run test) | ✅ PASS |

**Status**: ✅ All ACs covered with spec-matched assertions. ⚠️ Three spec-precision gaps are flagged below; none contradicts an AC.

---

## Edge Cases

- [x] A pre-S6 row with a NULL key does not affect creates: `test/idempotency-key-migration.e2e-spec.ts:98-111` covers this at the index. My HTTP probe with a pre-S6 NULL row for the same owner returned 201, then 200 on replay, for the new key.
- [x] A unique-constraint rejection returns the winner, not an error: `test/idempotent-creation.e2e-spec.ts:120-148`.
- [x] Only `uq_processing_request_owner_idempotency` is mapped. Any other 23505 passes through: `test/persistence.e2e-spec.ts:209-226` asserts a `processing_request_pkey` 23505 stays a raw `QueryFailedError`. The mapping lives at `src/infrastructure/persistence/typeorm-processing-request.repository.ts:21-31`.
- [x] Replay and conflict write nothing: every case asserts both the rows and the outbox table, and the unit tests also assert no processed-event record.

---

## Discrimination Sensor

All mutations ran in a scratch `git worktree` (`scratchpad/s6wt`, detached at 9006b14) against a dedicated PostgreSQL 17 on port 55436, then the worktree was removed. After cleanup, `git status --porcelain` on the real tree was empty, the same as the baseline, and HEAD was still 9006b14. M10 and M11 corrupt the shared schema, so M10–M14 were rerun, each on a freshly recreated database. The results below are from those clean runs.

| # | File:line | Mutation | Killed? |
| --- | --- | --- | --- |
| M1 | `src/application/create-processing-request.use-case.ts:71-73` | The fast-path replay also writes an outbox entry | ✅ Killed (unit 2, e2e 6 red) |
| M2 | `src/application/create-processing-request.use-case.ts:99-101` | Remove the catch-and-re-read, so every error is rethrown | ✅ Killed (unit 2, e2e 2 red) |
| M3 | `src/application/get-owned-archive.query.ts:42-45` | Skip the COMPLETED check, so a non-completed request is `ready` | ✅ Killed (unit 5, e2e 3 red) |
| M4 | `src/application/get-owned-archive.query.ts:34-40` | Look up by id only, so another owner's request gets 409 | ✅ Killed (unit 1, e2e 1 red) |
| M5 | `src/infrastructure/persistence/typeorm-processing-request.repository.ts:27-30` | Map any 23505, dropping the constraint check | ✅ Killed (e2e 1 red) |
| M6 | same | Never map the idempotency 23505 | ✅ Killed (e2e 3 red) |
| M7 | `src/infrastructure/in-memory-processing-request.repository.ts:24` | The in-memory save does not enforce uniqueness | ✅ Killed (unit 3 red) |
| M8 | `src/interface/create-processing-request.controller.ts:46` | A replay answers 201 | ✅ Killed (e2e 2 red) |
| M9 | `src/application/create-processing-request.use-case.ts:122` | A different source is replayed instead of raising a conflict | ✅ Killed (unit 2, e2e 2 red) |
| M10 | `migrations/1789956000000-AddIdempotencyKey.ts:16` | The index is not unique | ✅ Killed (e2e 4 red) |
| M11 | `migrations/1789956000000-AddIdempotencyKey.ts:25` | `down()` keeps the column | ✅ Killed (e2e 3 red) |
| M12 | `src/interface/owned-processing-requests.controller.ts:93-95` | Remove the archive route's UUID guard | ✅ Killed (e2e 2 red) |
| M13 | `src/interface/owned-processing-requests.controller.ts:100-102` | The archive route's 404 body differs from the item route's | ✅ Killed (e2e 1 red) |
| M14 | `src/infrastructure/persistence/typeorm-processing-request.repository.ts:184` | The key lookup ignores the owner | ✅ Killed (e2e 4 red) |

**Sensor depth**: expanded (≥5; data integrity under concurrency, and an authorization boundary)
**Result**: 14/14 killed. ✅ PASS

---

## Code Quality

| Principle | Status |
| --- | --- |
| Minimum code | ✅ |
| Surgical changes | ✅ Only the files the tasks name, plus the fixture updates they require |
| No scope creep | ✅ |
| Matches patterns | ✅ Reuses notification-service's 23505 pattern, the owned controller's guard and constant 404, and the `IF [NOT] EXISTS` migration style |
| Spec-anchored outcome check | ✅ |
| Per-layer coverage (domain 1:1, routes happy + edge + error) | ✅ |
| Every test maps to a requirement | ✅ The one test outside the spec, `get-owned-archive.query.spec.ts:75` (COMPLETED with a NULL key), is the documented L-002 gap |
| Guidelines | none; strong defaults applied |

**Changed existing tests, none weakened.** Each change to a pre-existing test only adds `idempotencyKey` to the input or body, or unwraps `.request` from the new result. These are `accept`, `complete`, `fail` and `start` use-case specs, `lifecycle-consumers`, `processing-completed.consumer`, `video-accepted.consumer`, `create-processing-request.controller.spec` (3 posts), `test/app.e2e-spec.ts` (3 posts; the missing-fields case still omits `sourceStorageKey` and still asserts 400 with 0 outbox entries), `test/local-docker-integration.e2e-spec.ts` (6 posts), and `owned-item.spec.ts` (fixture field). `test/owner-index-migration.e2e-spec.ts` gains a step-back past later migrations, and its "last executed is S5's" assertion is unchanged. No assertion was removed or loosened, and none was skipped.

---

## Gate Check

- **Gate command**: `npm run lint && npm run typecheck && npm test && DATABASE_HOST=localhost DATABASE_PORT=55436 npm run test:e2e && npm run build`
- **Result**: exit 0. lint and typecheck clean, unit 168/168, e2e 109/109, build OK.
- **Test count before feature**: unit 144, e2e 79. I measured both at `0d61cea` in the scratch worktree against a fresh database.
- **Test count after feature**: unit 168, e2e 109.
- **Delta**: +24 unit, +30 e2e.
- **Skipped tests**: 0.
- **Failures**: none.

---

## Findings (ranked)

None is a blocker or breaks an AC. Each is a spec-precision gap for the orchestrator to accept or route.

1. **Low: an oversized key gives 500, and a retry can never succeed.** Neither this spec nor `fiap-x-api`'s bounds the key's length. `src/interface/create-processing-request.controller.ts:75` accepts any non-blank string, and the btree index rejects large incompressible values. Probe: a 10,000-character random key answered `500` with `index row requires 10056 bytes, maximum size is 8191`. Scenario: a client sends a long `Idempotency-Key` header, the API completes the multipart upload and calls the Catalog, and the Catalog 500s on every retry, so the upload never becomes a request. Suggested fix: specify a maximum length (for example 255) and answer 400 above it, here and in the API.
2. **Low: a non-string key gives 500 instead of 400.** At `src/interface/create-processing-request.controller.ts:75`, `dto.idempotencyKey.trim()` throws a TypeError on a number or an array. Probes: `idempotencyKey: 123` and `["arr"]` both answered 500. `ownerUserId` and `sourceStorageKey` already share this pattern (a numeric `ownerUserId` also answers 500), and the API always sends a string, so reaching it takes a caller bug. AC 1.6 ("missing or blank → 400") is still met.
3. **Info, L-003 recurrence: the key's whitespace is checked but not normalized.** The blank check trims, but the raw value is stored and matched (`controller.ts:75`, `use-case.ts:51`). Probe: `"k"` then `" k "` gave two 201s and two requests. That matches the design's "must be matched exactly", but the spec does not say whether the trimmed or the raw value is the key. Whether a whitespace variant counts as the same key is the API's call.
4. **Info, L-002: a COMPLETED request with a NULL key answers 409.** At `src/application/get-owned-archive.query.ts:42-45`, the domain cannot produce this row. It is documented in tasks.md and unit-tested (`get-owned-archive.query.spec.ts:75`), and it is not in the spec.

Observation, no action: TypeORM `findByOwnerAndIdempotencyKey` (`typeorm-processing-request.repository.ts:183-186`) would match any of the owner's rows if called with `undefined`, because TypeORM drops `undefined` from `where`. It is unreachable today: both the controller and the use case reject a blank key before the lookup.

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| --- | --- | --- |
| UPL-11 | Implementing | ✅ Verified |
| UPL-12 | Implementing | ✅ Verified |
| UPL-13 | Implementing | ✅ Verified |
| UPL-14 | Implementing | ✅ Verified |

---

## Lessons signal (for the orchestrator to record via `lessons.py`)

- Spec-precision gap, L-003 recurrence: a client-chosen identifier was validated after trimming, but the spec does not say whether the raw or the trimmed value is used. Evidence: `src/interface/create-processing-request.controller.ts:75`.
- Spec-precision gap, new: when a client-chosen token is stored under a btree unique index, specify a maximum length so an oversized value is a 400, not a 500. Evidence: `src/infrastructure/persistence/migrations/1789956000000-AddIdempotencyKey.ts:16`.

---

## Summary

**Overall**: ✅ Ready

**Spec-anchored check**: 10/10 ACs and all four UPL-14 criteria matched. 3 spec-precision gaps flagged (Low, Low, Info), plus the documented L-002 case.
**Sensor**: 14/14 mutations killed.
**Gate**: unit 168, e2e 109, 0 failed, 0 skipped.

**What works**: idempotent creation, safe under real concurrency (2-way, 8-way burst, and a forced unique-index loser); replay and conflict write nothing to rows, the outbox or processed events; the 23505 mapping is limited to the idempotency index; the archive route returns exactly `{zipStorageKey}`, 409 when not completed, and a 404 byte-identical to the item route's; the list and read stay key-free; the migration reverts cleanly and keeps NULL keys on pre-S6 rows.

**Issues found**: findings 1 to 3 above, each optional to fix.

**Next steps**: place this report at `.specs/features/upload-download/validation.md`, run `validate_state.py upload-download`, record the two lessons, and either accept findings 1 and 2 or open a fix task for them.
