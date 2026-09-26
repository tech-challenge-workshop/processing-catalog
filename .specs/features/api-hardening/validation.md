## Validation: api-hardening (catalog) — PASS with open items

**Date**: 2026-09-26
**Spec**: `.specs/features/api-hardening/spec.md` (HARD-09..11)
**Diff range**: `ae009cc..4ade5f3` on `fix/api-hardening` (T1-T5, 5 commits)
**Verifier**: independent sub-agent (author ≠ verifier), final round. Leftovers are open items.

Every AC of HARD-09, HARD-10 and HARD-11 is covered with an exact, spec-matched assertion, and the gate is green with 0 skipped. The sensor killed 14 of 16 non-equivalent mutants. One new 500 exists outside the ACs: an oversized `sourceStorageKey` now overflows the new unique index (open item 1).

**Spec-anchored check**: 9/9 ACs + 2/2 edge cases matched spec outcome; 1 spec-precision gap (source length unbounded)
**Gate**: lint ✔, typecheck ✔, unit 179/179, e2e 148/148 (0 skipped, fresh PostgreSQL 17 on :55438), build ✔
**Sensor**: 17 mutations, 14 killed, 1 equivalent, 2 survived

---

## Task Completion

| Task | Status | Notes |
| --- | --- | --- |
| T1 | ✅ Done | Migration + 6-test suite; fixtures moved to distinct sources |
| T2 | ✅ Done | Port method, `DuplicateSourceError`, in-memory adapter |
| T3 | ✅ Done | TypeORM lookup + per-index 23505 mapping |
| T4 | ✅ Done | Use-case source lookup + source re-read |
| T5 | ✅ Done | `requireString` + key length cap |

---

## Spec-Anchored Acceptance Criteria

### HARD-09 — P1: One request per source — ✅ PASS

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| P1.1 new key, known source → 200 with that request | `200`, same request | `test/create-processing-request-route.e2e-spec.ts:118-137` - `expect(second.status).toBe(200)`; `expect(second.body).toStrictEqual(first.body)` (`:135`) | ✅ |
| P1.2 nothing written | no row, no outbox entry (and no processed-event record) | route `:136-137` - `rows(alice)` 1, `outboxEntries(alice)` 1; `src/application/create-processing-request.use-case.spec.ts:224` - `expect(insert).not.toHaveBeenCalled()`, `:229-231` - `hasEventBeenProcessed(secondKey.eventId)` false, key-2 unbound | ✅ |
| P1.3 concurrent different keys, one source | 1 row, 1 outbox, both carry its id | `test/idempotent-creation.e2e-spec.ts:170-193` - rows 1, outbox 1, `toEqual([stored.id, stored.id])` (`:185`), outcomes `['created','replayed']`; burst of 8 `:195-208` - `Set(ids).size` 1, one `created`; forced loser `:210-245` - `rejects.toBeInstanceOf(DuplicateSourceError)` (`:229`), same id, rows/outbox/processed_event 1 | ✅ (use-case level against PostgreSQL; no HTTP-level concurrent case, not required by the spec) |
| P1.4 key bound to another source → 409, even when the new source already has a request | `IdempotencyConflictError` → `409` | `use-case.spec.ts:237-255` - `rejects.toBeInstanceOf(IdempotencyConflictError)`, rows 2, outbox 2, no processed-event record; S6 route 409 test still green | ✅ (in-memory only for the "new source already has a request" variant) |
| Edge: pre-S6 NULL-key row, same source → 200 with that row | `replayed`, that row | `use-case.spec.ts:257-270` - `expect(result.request).toBe(preS6)`, outcome `replayed`, count 1, outbox 0. PostgreSQL side: NULL-key rows collide on the index, `test/owner-source-migration.e2e-spec.ts:90-97`; the lookup ignores the key (`typeorm-...repository.ts:198-205`) | ✅ (in-memory for the use case) |
| Edge: source index rejects an insert → existing request | winner returned, not an error | `idempotent-creation.e2e-spec.ts:210-245`; `use-case.spec.ts:272-288` | ✅ |
| 23505 mapping per index; others pass through | source → `DuplicateSourceError`, key → `DuplicateIdempotencyKeyError`, pkey unchanged | `test/persistence.e2e-spec.ts:275` source; `:303-304` key-only (taken under another source, so a single index is violated); `:226-229` pkey `not.toBeInstanceOf` both + `constraint: 'processing_request_pkey'` | ✅ |
| Migration reversible; two owners share a source | index present/gone/reapplied; 2 rows | `owner-source-migration.e2e-spec.ts:61` exact `indexdef`; `:74` `toBeUndefined()` after revert; `:77` reapplied; `:113` `toBe(2)`; `:119` nothing pending | ✅ |

### HARD-10 — P2: Key length bounded — ✅ PASS

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| P2.1 key > 255 → 400, nothing written | `400 idempotencyKey must be at most 255 characters` | `create-processing-request-route.e2e-spec.ts:236-246` - `toStrictEqual(badRequest(...))`, `written(body)` `{rows:0,outbox:0}` counted by owner OR source | ✅ |
| P2.2 exactly 255 accepted | `201` | `:248-255` - status 201, `{rows:1,outbox:1}` | ✅ |

### HARD-11 — P2: Non-string fields rejected — ✅ PASS

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| P2.3 non-string field → 400 naming it, nothing written | `400 <field> must be a string` | `:257-281` - 12 cases (number, array, object, `true` × 3 fields), `toStrictEqual(badRequest(\`${field} must be a string\`))`, `{rows:0,outbox:0}` | ✅ |
| Near misses (design order required → string → blank) | numeric string accepted; `null`/missing/empty/blank → `is required` | `:283-293` 201; `:295-319` 9 cases with exact `is required` body | ✅ |
| S6 messages unchanged | `<field> is required` | `:295-319` + unchanged S6 key cases | ✅ |

**Status**: ✅ All ACs covered with spec-exact outcomes. 1 spec-precision gap (see open item 1).

---

## The flagged race (same key K, sources S1 and S2, S2 already has a request R2)

**Verdict: not a spec violation. It can happen, and the outcome is linearizable.**

- **How it happens.** B = (K, S2) runs its key lookup before A = (K, S1) commits, so K is unbound for B. B's source lookup then finds R2 and returns `200 R2`. B writes nothing, so K stays unbound. A then commits and binds K to S1.
- **Why it is allowed.** P1.4 is conditional: "IF the key is already bound to a different source". At B's read, K is not bound. The result equals the serial order B → A, which the spec permits: a new key on a known source replays, and the second key stays unused (Out of Scope).
- **The triple race.** Add C = (K2, S2), also in flight. B misses both lookups and its insert violates both indexes. PostgreSQL reports one of them: a key violation gives 409, a source violation gives `200 R2`. Both outcomes match a valid serial order (A→B or C→B→A).
- **Side effect to note.** A retry of B after A commits gets `409`, not `200`. The same happens with no concurrency at all (B, then A, then B again). It needs the caller to reuse one key for two uploads, which is already a caller error. No action needed.

---

## Discrimination Sensor

Run in a scratch `git worktree` with 5 e2e suites plus all unit tests per mutant. The real tree was never modified: porcelain matched the baseline before and after. M9 onward were re-run on a fresh container, because M8's non-unique index let duplicates in and poisoned the database.

| # | File:line | Mutation | Result |
| --- | --- | --- | --- |
| M1 | `use-case.ts:82-84` | Ignore the source lookup | ✅ Killed (unit) |
| M2 | `use-case.ts:110` | Source re-read removed (rethrow) | ✅ Killed (unit + 3 e2e) |
| M3 | `use-case.ts:68` | Source check before key check | ✅ Killed (unit + 2 e2e) |
| M4 | `typeorm-...repository.ts:86` | Every 23505 → `DuplicateSourceError` | ✅ Killed (5 e2e) |
| M5a | `in-memory-...repository.ts:31` | `save` ignores NULL-key rows on source | ✅ Killed (unit) |
| M5b | `in-memory-...repository.ts:127` | Lookup ignores NULL-key rows | ✅ Killed (unit) |
| M6 | `controller.ts:97-99` | Drop string type check | ✅ Killed (12 e2e) |
| M7 | `controller.ts:87` | Cap 256 | ✅ Killed (1 e2e) |
| M8 | migration `:13` | Index not unique | ✅ Killed (3 e2e) |
| M9 | `typeorm-...repository.ts:203` | Source lookup not owner-scoped | ✅ Killed (1 e2e) |
| M10 | `in-memory-...repository.ts:27` | Source collision checked before key | ✅ Killed (2 unit) |
| M11 | `controller.ts:94` | `null` reported as "must be a string" | ✅ Killed (3 e2e) |
| M12 | `controller.ts:100-102` | Blank check dropped | ⚪ Equivalent: the domain (`processing-request.ts:54,57`) and the use case (`use-case.ts:52`) reject blank with the same message, and nothing is written |
| M13 | `controller.ts:75` | Key-length check before the other fields' type checks | ❌ Survived (cross-field order unpinned) |
| M14 | `use-case.ts:118-120` | Source re-read miss returns `undefined` instead of rethrowing | ❌ Survived (untested; the S6 key branch has the same gap) |
| M15 | `use-case.ts:121` | Source lost race reports `created` | ✅ Killed |
| M16 | `use-case.ts:83` | Known source reports `created` | ✅ Killed |

**Sensor depth**: P0 (data integrity), 17 manual mutants.
**Result**: 14/16 non-equivalent killed (87.5%). Both survivors are low risk (see open items 2 and 3).

---

## Changed existing tests: none weakened

- **Distinct sources per fixture.** `idempotency-key-migration` (`insertWithKey`), `owner-scoped-reads` (`ownedBy`), `owned-processing-requests` (`seed`), and the unit fixtures in the in-memory and list-query specs now give each request its own source.
  - This is forced by the new index.
  - No assertion was removed.
  - The leak check in `owned-processing-requests` now names both real sources, which is at least as strict.
- **S6 forced-loser tests** (`use-case.spec.ts:194-214`, `idempotent-creation.e2e-spec.ts:124-165`) now also make `findByOwnerAndSource` miss once. That is correct: a real early reader misses both lookups, and without the extra miss the source lookup would answer before the key index is reached. The assertions are unchanged, and M2 and M3 prove the paths are still exercised.
- **`idempotency-key-migration`** steps back past later migrations before its unchanged "last executed is S6's" assertion.
- **`persistence` pkey test** gained one assertion, `not.toBeInstanceOf(DuplicateSourceError)`.
- **Test counts:** unit 168 → 179, e2e 109 → 148. No test was deleted or skipped.

---

## Code Quality

| Principle | Status |
| --- | --- |
| Minimum code / surgical | ✅ One lookup, one catch branch, one helper, one migration |
| Matches patterns | ✅ Mirrors the S6 key path and migration |
| Spec-anchored outcomes | ✅ Exact bodies (`toStrictEqual`), exact constraint names |
| Per-layer coverage | ✅ Matrix met. P1.4 and the NULL-key edge case are proven in-memory only, but mutants M3 and M5 are killed |
| Guidelines | none - strong defaults applied |

---

## Open items (Validar depois), ranked

1. **[Major] An oversized `sourceStorageKey` is now a 500 on every retry.**
   - **Where:** `src/infrastructure/persistence/migrations/1789957000000-UniqueOwnerSource.ts:13-14`, with no bound in `src/interface/create-processing-request.controller.ts:74-83`.
   - **Failure scenario:** `POST {ownerUserId, sourceStorageKey: <3000 incompressible chars>, idempotencyKey:'k'}` returns `500`. The log shows `index row size 3064 exceeds btree version 4 maximum 2704 for index "uq_processing_request_owner_source"`. Reproduced over HTTP against PostgreSQL 17.
   - **Cause:** T1's index introduced this. Before T1, `source_storage_key` was in no btree index.
   - **Spec impact:** it is V26 again, on a new index. It breaks the spec Goal "Every malformed create input is a 400, never a 500" and the Success criterion "No malformed create reaches a 500", but no AC. It is a spec-precision gap, and L-005 recurring.
   - **Reachability:** today the API builds `sources/<owner>/<uploadId>.<ext>` (`fiap-x-api/src/uploads/start-upload.service.ts:32`), so the risk is low. But the spec's problem statement says the Catalog's contract must not depend on its caller.
   - **Related, pre-existing:** `ownerUserId` is also unbounded under `idx_processing_request_owner_created` and both unique indexes.
   - **Fix:** bound `sourceStorageKey` (and `ownerUserId`) in `validateDto` with a named `400`, plus a spec AC for each.
2. **[Minor] Survivor M13: cross-field validation order is not pinned.**
   - **Where:** `controller.ts:75-83`.
   - **Failure scenario:** for `{ownerUserId: 42, idempotencyKey: 'k'.repeat(256)}`, the design order (per field, owner first) gives `ownerUserId must be a string`. A regression that checks the length first would answer the length message, and no test would notice.
   - **Fix:** add one combined-malformed case.
3. **[Minor] Survivor M14: a source re-read that finds nothing is untested.**
   - **Where:** `use-case.ts:118-120`.
   - **Failure scenario:** if the winner row vanishes between the rollback and the re-read, a regression would return `{request: undefined}` and the controller would throw a TypeError, where the design specifies a rethrow. The design accepts this risk ("nothing deletes requests today"), and the S6 key branch has the same gap.
   - **Fix:** add a unit test with `findByOwnerAndSource` mocked to miss twice.
4. **[Minor] Two HARD-09 behaviours are proven only against the in-memory adapter.**
   - **Where:** P1.4's "new source already has a request" variant (`use-case.spec.ts:237`) and the pre-S6 NULL-key replay (`use-case.spec.ts:257`).
   - **Gap:** there is no PostgreSQL or route case for either. The code path is adapter-independent, and the index and lookup semantics are proven on PostgreSQL separately, so the risk is low.
   - **Fix:** add one route test for each.

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| --- | --- | --- |
| HARD-09 | Implementing | ✅ Verified (open items 3, 4) |
| HARD-10 | Implementing | ✅ Verified (open item 1 is a sibling gap on the source field) |
| HARD-11 | Implementing | ✅ Verified (open item 2) |

---

## Lessons signal

- **spec_precision_gap (persistence/interface): L-005 recurs.** Adding a btree index over an existing client-supplied text column (`source_storage_key`) created a new 500 path, `src/infrastructure/persistence/migrations/1789957000000-UniqueOwnerSource.ts:13`. Lesson: when a migration puts a client-supplied column under a btree index, the same feature must bound that field at the edge. This is the second feature with this signal (upload-download, api-hardening), so L-005 is eligible for promotion.
- **surviving_mutant (interface):** cross-field validation order unpinned, `src/interface/create-processing-request.controller.ts:75`. Lesson: when a spec fixes a validation order, add at least one test with two malformed fields.
- **surviving_mutant (application):** the lost-race re-read-miss branch is untested, `src/application/create-processing-request.use-case.ts:118`. This recurs from S6's key branch.
- The Verifier did not run `lessons.py`: it would write to `.specs/` in the real tree. The orchestrator should record these.

---

## Summary

**Overall**: ✅ Ready, with 4 open items (1 Major, 3 Minor). None blocks HARD-09..11.
**Environment**: the scratch worktree and the `hard-catver-pg` container were removed. The real tree is clean at `4ade5f3`.
