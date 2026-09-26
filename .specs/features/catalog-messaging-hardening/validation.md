## Validation: catalog-messaging-hardening (catalog) — PASS with open items

**Spec-anchored check**: 9/9 requirements (MSG-01..09) matched the spec outcome. 2 spec-precision gaps flagged: the `OUTBOX_PUBLISH_TIMEOUT_MS=0` meaning, and the `RECEIVED` stale-attempt exemption.
**Gate**: this is the Build gate, run in a scratch worktree at `237d1ad` against a fresh PostgreSQL 17 (port 55444):
- lint: clean.
- typecheck: clean.
- unit: 229 passed.
- e2e: 171 passed, 0 skipped.
- build: OK.
**Sensor**: 44 mutants were injected into production code. 40 were killed and 4 survived. Of the 4 survivors, 2 are equivalent (M03b, M05a) and 2 are real test gaps (M01b, M05d). Excluding the equivalents, the score is 40/42.
**Diff/commit range**: `24079bc..237d1ad` (T1–T10), branch `fix/catalog-messaging-hardening`
**Verifier round**: this was the final round. The leftovers below are open items for "Validar depois".

---

### Per-requirement verdict

| ID | Spec outcome | Evidence (file:line / assertion) | Result |
|---|---|---|---|
| MSG-01 | Two relays: each row once; per-request order | `test/outbox-relay.e2e-spec.ts` "publishes each row exactly once, in per-request order…" (`ids` length 100, `Set` size 100, `seqs` equal `[0..9]` per request, no pending). The "returns 0 … while another replica holds the relay lock" test covers exclusion. Relay: `src/infrastructure/messaging/outbox-relay.ts:56-101` (`pg_try_advisory_xact_lock`, global `ORDER BY id`, break on first failure) | PASS |
| MSG-02 | Confirm timeout ends the drain; row stays pending; next tick retries; recovery | `rabbitmq.connection.ts:52-57,149-153` passes `{timeout}`. The "keeps the marks made before a failed publish…" test checks that rows 1–2 are marked, 3–5 are pending, and a second drain returns 3. The "returns within the publish timeout and leaves the row pending" test drives the real `RabbitMQConnection` against `amqp://127.0.0.1:1` with a 300 ms timeout and asserts 250 ≤ elapsed < 2000. `rabbitmq.connection.spec.ts` pins the option value | PASS, with open item F1 (`"0"` means no timeout) |
| MSG-03 | A stale attempt on Started, Completed or Failed: no change, no publish, recorded, acked. Completed without `attemptId` goes to the DLQ | `isStaleAttempt` is at `src/domain/processing-request.ts:105-110`. The check comes after the under-lock dedup and before the transition: start use case `:66`, complete use case `:69`, fail use case (processing origin). Unit specs cover each use case, including the redelivery and the stale Completed restating the stored key. The PostgreSQL test is `test/lifecycle-ordering.e2e-spec.ts` (QUEUED on A2: Failed for A1 is a no-op; Failed for A2 fails the request). `processing-completed.consumer.ts:76-79` requires a non-blank string | PASS, with open item F2 (Started and Failed still check presence only) |
| MSG-04 | `VideoRejected` is refused outside `RECEIVED`: DLQ, state kept | `rejectProcessingRequest` is at `processing-request.ts:224-245`. Evidence: domain spec (every status); use-case spec; `lifecycle-consumers.spec.ts` (nack without requeue through the real channel callback); lifecycle e2e | PASS |
| MSG-05 | `ProcessingFailed` for `RECEIVED` is refused: DLQ, state kept | `FAILABLE_STATUSES` no longer includes `RECEIVED`. Evidence: domain spec `'Cannot fail request in RECEIVED status'`; consumer nack; lifecycle e2e | PASS |
| MSG-06 | Unset, `""` or whitespace → 1000; `0` → 0; negative or NaN → 1000 | `settle-failed-message.ts:11-20`. The spec has a table-driven case for each input | PASS |
| MSG-07 | e2e uses `fiapx_e2e` (created and migrated); `fiapx` untouched; `DATABASE_NAME=fiapx` refused, naming the variable | `test/support/e2e-database-name.ts`, the setup and global-setup files, and `jest-e2e.json` wiring. Verified live: `DATABASE_NAME=fiapx npm run test:e2e` exits 1 from globalSetup with the message naming `DATABASE_NAME=fiapx`, and 0 suites run. `fiapx.catalog.outbox` held 11 rows before a full e2e run and 11 after; `fiapx_e2e` was created. Removing `DATABASE_NAME` from `ci.yml` is required, because otherwise CI would be refused. The CI service's credentials match the harness defaults, and `01-schemas.sql` creates the cluster-wide `catalog` role that `OWNER catalog` needs. CI has not been run | PASS (CI not run: open item) |
| MSG-08 | owner > 255 and source > 1024 → exact `400 <field> must be at most <n> characters`; nothing written; 255 and 1024 accepted | `create-processing-request.controller.ts:82-105`. The route e2e covers 256/255, 1025/3000/1024, and writes-nothing checks. Values are random-hex padded so a real btree overflow is reproducible | PASS |
| MSG-09 | Cross-field order; a re-read miss rethrows (key and source); `409` when the new source is already taken; `NULL`-key replay `200` | `create-processing-request.use-case.spec.ts` (2 tests) and route e2e (4 tests), all with exact messages or bodies | PASS |

Edge cases from the spec:
- Crash between publish and mark causes a republish: inherent, because the marks roll back with the transaction.
- A stale redelivery is a no-op: tested.
- An owner of exactly 255 characters is accepted: tested.

### Test integrity

The count went from 179 to 229 unit tests and from 148 to 171 e2e tests, with 0 skipped. No assertion was weakened, and each changed test was accounted for:
- **The one removed positive test.** `failProcessingRequest` on RECEIVED now asserts the refusal (message pinned). The positive case moved to `rejectProcessingRequest` with the same assertions, plus `attemptId` undefined.
- **Tests that gained `attemptId`.** The start, complete and fail callers, `durability`, the `lifecycle-ordering` helpers, `local-docker-integration` and the completed-consumer payloads now pass the current attempt. No assertion was changed.

### Discrimination sensor

Every mutant ran in the scratch `git worktree` against the full unit and e2e suites. The real tree's `git status --porcelain` was empty before and after.

| # | Mutant | Result |
|---|---|---|
| M01 | Lock ignored (`if (false)`) | killed (e2e 2) |
| M01b | `pg_try_advisory_lock` (session lock, never released) | **SURVIVED** |
| M02 | Publish `{timeout}` not passed | killed (unit 2, e2e 1) |
| M03 | Failure thrown inside the transaction (marks roll back) | killed (e2e 1) |
| M03b | UPDATE through `this.dataSource` (marks autocommit outside the tx) | SURVIVED: **equivalent** (see below) |
| M03c | Skip ahead after a failure (`continue`) | killed |
| M03d | `ORDER BY id DESC` | killed (e2e 3) |
| M04a/b/c | Stale check removed: Start / Complete / Fail | killed (1+1 / 3+1 / 3+1) |
| M04d/e | Stale branch does not mark processed: Start / Fail | killed |
| M05a | Start: stale check moved after the transition and no-op | SURVIVED: **equivalent** (see below) |
| M05b | Complete: stale check after the transition (AD-013 restatement first) | killed (unit 2) |
| M05c | Fail: stale check after the transition | killed (unit 1) |
| M05d | Fail: stale check before the under-lock dedup re-check | **SURVIVED** (low) |
| M06 | `RECEIVED` back in `FAILABLE_STATUSES` | killed (unit 3, e2e 1) |
| M07 / M07b | Reject allowed from `QUEUED` / from anywhere | killed (3+1 / 8+1) |
| M08 / b / c | Blank check removed / no trim / negative accepted | killed (4 / 2 / 2) |
| M09 / b / c | `fiapx` refusal removed / no `fiapx_e2e` default / both jest hooks removed | killed (e2e 2 / 2 / 1) |
| M10a–e | `>=` / `> max+1` / owner 256 / source 1025 / source 1023 | all killed |
| M11 / b | No `RECEIVED` exemption / stale predicate inverted | killed (3+2 / 24+11) |
| M12 / b | Completed `attemptId` presence-only / no trim | killed (3 / 1) |
| M13 / b / c | Failed passes `validation` / Rejected passes `processing` / Started drops `attemptId` | killed |
| M14 / b | Default timeout 0 / env ignored | killed (6 / 3+1) |
| M15a/b | Re-read miss returns `undefined`: source / key branch | killed (unit 1 each) |
| M16a/b/c | Owner checked last / source and key swapped / `NULL`-key rows ignored on re-read | killed (e2e 1 each) |

Three mutants need a judgement:
- **M03b** (the author's open item) is **accepted as equivalent**:
  - The advisory lock is held for the whole drain, so autocommitted marks are not visible to any competing drainer earlier than transactional ones would be.
  - The only difference is on a crash or a failed COMMIT. There the mutant republishes *fewer* rows, which does not break any spec outcome.
  - No behavioural test can distinguish the two.
- **M05a is equivalent.** For Start, the AD-013 no-op and the stale no-op have identical effects: both mark the event processed and change nothing. `startProcessingRequest` throws only for `RECEIVED`, which is exempt.
- **M01b** is the one survivor with teeth. See F3.

### Findings (ranked)

**F1 — Medium: `OUTBOX_PUBLISH_TIMEOUT_MS="0"` silently brings back V5's permanent stall.**
- **Code:**
  - `rabbitmq.connection.ts:52-57` passes 0 through, pinned by `rabbitmq.connection.spec.ts:64`.
  - `amqp-connection-manager@5.0.0` `ChannelWrapper.js:169` computes `timeout || this._publishTimeout`. `publishTimeout` is not set at `rabbitmq.connection.ts:114`, so 0 means no timer.
- **Failure scenario:**
  1. An operator sets `0` (reading it as "no wait" or "disabled"), and the broker goes away.
  2. A publish buffers forever and `drain` never returns.
  3. `OutboxRelayScheduler.tick` keeps `draining = true` (`outbox-relay.scheduler.ts:59-73`), so every later tick returns 0.
  4. The relay is frozen until a restart, even after the broker comes back.
- **Against the spec:** MSG-02 AC3 says the drain stops if the broker does not confirm within the configured value, and AC4 says every pending row is published when the broker comes back. For `0`, the code does the opposite of both. The design reused MSG-06's rule verbatim, but a backoff of 0 is a legitimate value; a confirm timeout of 0 is not.
- **Suggestion:** treat values ≤ 0 as the default (5000), or reject them at boot. Flip the `'0' → 0` case in the spec.

**F2 — Low-Medium: a malformed `attemptId` on `ProcessingFailed` or `ProcessingStarted` is now silently acked, not dead-lettered.**
- **Code:**
  - `processing-failed.consumer.ts:55,67` and `processing-started.consumer.ts` check only `'attemptId' in content`, then run `String(payload.attemptId)`.
  - Completed was hardened to require a non-blank string (`processing-completed.consumer.ts:76-79`); the other two were not.
- **Failure scenario:** a Worker regression sends `attemptId: null` or `""` on `ProcessingFailed`. The value becomes `"null"` or `""`, and `isStaleAttempt` returns true. The event is recorded as processed and acked, so the terminal failure is swallowed with no DLQ signal, and the request stays PROCESSING forever.
- **Before this feature**, the same message failed the request (the value was unused). The parse is not new, but the stale check made it consequential.
- **Suggestion:** reuse `hasAttemptId` in all three consumers, and add the null and empty cases to `lifecycle-consumers.spec.ts`.

**F3 — Low (test gap, code is correct): no test proves the relay lock is *released* after a drain.**
- **Mutant M01b** (session-level `pg_try_advisory_lock`) passes every test. In production that lock would stay on one pooled connection forever:
  - Other replicas would never drain.
  - A drain in the same replica would skip whenever the pool handed it a different connection.
- **Suggestion:** in `test/outbox-relay.e2e-spec.ts`, add a test where relay A drains, then relay B (the other DataSource) drains newly inserted rows and returns > 0.

**F4 — Low: stale check vs. dedup order in Fail is not pinned (M05d survived).**
- **Code:** `fail-processing-request.use-case.ts`, stale block after the under-lock `hasEventBeenProcessed`.
- **Why it matters:** the chosen order, dedup first, is correct and matches the author's interpretation. But swapping it goes unnoticed, and in a concurrent redelivery race the swapped version would insert a second processed-event record, a PK violation, and an extra requeue.
- **Cost:** a concurrency test is expensive, so this is acceptable as a known gap.

**F5 — Low (spec-precision): the `RECEIVED` stale-attempt exemption.**
- **Code:** `processing-request.ts:105-110`.
- **Verdict: accepted.** Read literally, MSG-03 AC1 ("different from the request's current one") would make any attempt event against a request with no attempt a no-op. That contradicts MSG-05 AC4, which requires `ProcessingFailed` on `RECEIVED` to be dead-lettered. The exemption is the only reading that satisfies both. M11 shows removing it breaks MSG-05 (3 unit + 2 e2e red).
- **Side effects:** a request rejected by validation (FAILED, no attempt) also bypasses the stale check.
  - A later `ProcessingFailed` for it is dead-lettered.
  - A late `ProcessingStarted` for it is an AD-013 no-op.
  - Both are reasonable.
- **Suggestion:** record the rule in `spec.md` ("a request with no attempt has no stale events; the transition decides").

**F6 — Low (quality): orphaned JSDoc.**
- **Code:** `src/domain/processing-request.ts:92-96`. `isUnchanged`'s doc comment now sits directly above `isStaleAttempt`'s doc, so `isUnchanged` has none and editors show the wrong docs.
- **Suggestion:** move `isStaleAttempt` above or below the `isUnchanged` block.

**F7 — Info: CI has not run.**
- **Evidence:** the `ci.yml` change removes `DATABASE_NAME: fiapx`. The harness now refuses that value, so the removal is required. Static review says CI will pass: postgres/postgres admin defaults, the `catalog` role from `01-schemas.sql`, and `OWNER catalog`.
- **Open item:** confirm with the first pushed run that the skip guard reports 171 passed and 0 skipped.

**Deviations reviewed:**
- **T3 open item (M03b):** accepted as equivalent.
- **T7 interpretations** (stale check after the under-lock dedup; `RECEIVED` exemption): both accepted.
- **T8 `ci.yml` change:** accepted as a necessary deviation from design ("CI: unchanged").
- **T9 random-hex padding:** a good catch that makes the test actually reproduce V38.

### Code quality check
- **Scope:** no features beyond the spec. Changes are minimal and follow existing patterns. The shared `parseNonNegativeMs` is justified by its two callers.
- **Tests:** they map to ACs and use exact messages and state assertions, not only call occurrence.
- **Nit:** `tasks.md` cites a lesson candidate "L-010" that is not recorded in `.specs/LESSONS.md`.

### Lessons signal
- **L-005 (confirmed)** was applied and held. V38's 3000-character `500` is now a `400`, and the boundaries are pinned (M10a–e killed).
- **L-006 (candidate)** was applied and effective: the two-field tests killed M16a and M16b. This is a second successful application, so it is evidence for promotion.
- **L-007 (candidate)** was applied and effective: M15a and M15b were killed in both branches. This is a second successful application, so it is evidence for promotion.
- **New candidate: "A 0 that means *disabled* downstream must be specified."** When a numeric config is passed to a library, specify what 0 means *in that library*. A parser rule copied from another setting (backoff 0 = valid) can silently disable a safety timeout (F1).
- **New candidate: "Test that a lock is released, not only that it excludes."** An exclusion test passes equally for a lock that is never released (M01b).
- **New candidate: "Revisit every parser when a field gains semantics."** When a new rule makes a previously ignored field meaningful (here, `attemptId` compared for staleness), re-check every parser of that field for presence-only validation (F2).
