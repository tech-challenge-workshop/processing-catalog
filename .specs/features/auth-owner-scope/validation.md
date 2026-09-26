# Auth and Owner Scope Validation — catalog

**Date**: 2026-09-26
**Spec**: `.specs/features/auth-owner-scope/spec.md` (AUTH-10..AUTH-13)
**Diff range**: `b99fe9a..76ef3cd` (implementation, 5 commits `721b41d`..`76ef3cd` on `feat/auth-owner-scope`; `9055436`..`b99fe9a` are spec docs)
**Verifier**: independent sub-agent (author ≠ verifier)
**Environment**: host Node with the repo's `node_modules`; PostgreSQL `postgres:17-alpine` container `s5v-pg` on host port 55434, bootstrapped from `fiap-x-platform/db/init/01-schemas.sql`; `DATABASE_HOST=localhost DATABASE_PORT=55434`. The container was removed afterwards.

**Result**: PASS. All 13 acceptance criteria and all 3 edge cases have `file:line` evidence, 20 of 20 mutants were killed and the build gate is green with 0 skipped. There are four non-blocking follow-ups, listed under Fix Plans.

---

## Task Completion

| Task | Status | Notes |
| --- | --- | --- |
| T1 port + in-memory reads | ✅ Done | `721b41d`; every `Done when` checked |
| T2 TypeORM reads | ✅ Done | `bea2166`; SQL captured in `test/owner-scoped-reads.e2e-spec.ts:161-183` |
| T3 composite index migration | ✅ Done | `35282e2`; up/down/re-run in `test/owner-index-migration.e2e-spec.ts` |
| T4 projection + queries | ✅ Done | `f1554ee` |
| T5 controller + registration | ✅ Done | `76ef3cd`; registered unconditionally at `src/app.module.ts:52` |

No `SPEC_DEVIATION` markers were found in the diff. `tasks.md` records one deviation, which is transient: `tsc` was red between T1 and T2 and is green again at HEAD.

---

## Source checks (read directly, not inferred from tests)

- **The owner is in every query.** `src/infrastructure/persistence/typeorm-processing-request.repository.ts:119` has `where: { ownerUserId }` (page), `:120` has `order: { createdAt: 'DESC', processingRequestId: 'ASC' }`, `:121-122` apply `skip`/`take` in SQL, `:129` has `where: { ownerUserId }` (count), and `:138` has `where: { processingRequestId, ownerUserId }` (by id, one statement). No owner-scoped method loads and then filters. The port (`src/domain/processing-request.repository.ts:38-47`) has no owner-less listing method.
- **A non-UUID id returns the constant 404 before any query.** `src/interface/owned-processing-requests.controller.ts:66-67` has `if (!UUID.test(id)) throw notFound();`, which runs before `getOwned.execute` at `:69`. Every miss uses the single `notFound()` factory at `:90-92`, which builds `new NotFoundException('Processing request not found')` (also used at `:74`).
- **Blank owner.** `:80` has `if (!ownerUserId || ownerUserId.trim().length === 0)`, which throws 400 before any query in both routes (`:37`, `:62`).

---

## Spec-Anchored Acceptance Criteria

### P1: One owner's requests, one page at a time (AUTH-10, AUTH-11, AUTH-13)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| AC1 only `<owner>`'s requests | items ⊆ owner; the other owner's absent | `test/owned-processing-requests.e2e-spec.ts:135` `toEqual([low, high, aliceOld.id])`, `:141-148` bob has 2 and none of alice's; repo `test/owner-scoped-reads.e2e-spec.ts:85-87`; unit `src/application/list-owned-processing-requests.query.spec.ts:88-94` | ✅ PASS |
| AC2 filter in the repository query | `WHERE owner_user_id = $1` in the SQL | `test/owner-scoped-reads.e2e-spec.ts:174` `toMatch(/WHERE .*"owner_user_id" = \$1/)` (page), `:180` (count) | ✅ PASS |
| AC3 order + offset + at most `pageSize` | `createdAt` desc, id asc; offset `(p-1)*n` | `test/owned-processing-requests.e2e-spec.ts:205-208` page 2/size 2 → minutes 3,2; `:187` 20 of 21; `:135` tie → `[low, high]`; SQL `test/owner-scoped-reads.e2e-spec.ts:175-178`; unit `src/application/list-owned-processing-requests.query.spec.ts:77` `toHaveBeenCalledWith('alice', 4, 2)` | ✅ PASS |
| AC4 body `{items,page,pageSize,total}`, total = the owner's count | exact keys; total counts all the owner's requests | `test/owned-processing-requests.e2e-spec.ts:160-172` `toStrictEqual({ items:[…], page:1, pageSize:5, total:1 })`; `:189` `total` 21 with 20 items; `:140`, `:142` | ✅ PASS |
| AC5 item fields; `failureReason` iff FAILED = `failureReasonFor(code)` | exact sentence per code; absent otherwise | `src/application/owned-item.spec.ts:54-60` (it.each over the 3 codes, exact sentences); `:80-85` keys only for QUEUED/PROCESSING/COMPLETED; `:28-33` RECEIVED; e2e `test/owned-processing-requests.e2e-spec.ts:260-274` | ✅ PASS |
| AC6 no `sourceStorageKey`, `zipStorageKey`, `attemptId` | absent from both routes | `src/application/owned-item.spec.ts:106` `expect(item).not.toHaveProperty(key)`, `:108-111` values absent; e2e `test/owned-processing-requests.e2e-spec.ts:287` `expect(res.text).not.toContain(secret)` (list); `:375` `toStrictEqual` exact shape (by id) | ✅ PASS |
| AC7 blank owner → 400, no repository call | 400, reads not called | `test/owned-processing-requests.e2e-spec.ts:296` `toBe(400)`, `:297-299` message, `:301` `expect(read).not.toHaveBeenCalled()`; by-id route `:428-434` | ✅ PASS |
| AC8 bad `page`/`pageSize` → 400 naming the parameter | 400 + message naming it | `test/owned-processing-requests.e2e-spec.ts:314-317` `'page must be an integer greater than or equal to 1'` for `0,-1,1.5,abc,''`; `:333-336` `'pageSize must be an integer between 1 and 100'` for `0,101,2.5,abc,''`; bounds accepted `:354-357` | ✅ PASS |
| AC9 available whether or not `LOCAL_INTEGRATION` is set | routes answer in both modes | flag unset: `test/composition.e2e-spec.ts:98-112` (list 200 with an empty page, controller's own 404 body), and the whole `test/owned-processing-requests.e2e-spec.ts` runs with `delete process.env.LOCAL_INTEGRATION` (`:3`); flag set: `test/local-docker-integration.e2e-spec.ts:373-374` | ✅ PASS |

### P2: One request, for its owner only (AUTH-12, AUTH-13)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| AC1 own request → 200 with the P1 AC5 shape | 200, exact item | `test/owned-processing-requests.e2e-spec.ts:374-382` `toBe(200)` + `toStrictEqual({… failureReason: 'Nao foi possivel processar o video. Tente enviar novamente.' })`; unit `src/application/get-owned-processing-request.query.spec.ts:36-42` | ✅ PASS |
| AC2 another owner → 404, same body as missing | byte-identical 404 | `test/owned-processing-requests.e2e-spec.ts:399` `toBe(404)`, `:403` `expect(others.text).toBe(random.text)`; unit `src/application/get-owned-processing-request.query.spec.ts:57` `resolves.toBeUndefined()` | ✅ PASS |
| AC3 unknown id or non-UUID → 404 | 404 with the constant body | `test/owned-processing-requests.e2e-spec.ts:400-404` (random UUID and `not-a-uuid`, `toStrictEqual(NOT_FOUND)`); `:414-418` `abc` → 404 with no read called | ✅ PASS |
| AC4 id and owner in the same query | one statement with both predicates | `test/owner-scoped-reads.e2e-spec.ts:181` `toMatch(/WHERE .*"processing_request_id" = \$1/)` and `:182` `toMatch(/"owner_user_id" = \$2/)` on the same captured statement | ✅ PASS |

**Status**: ✅ All 13 ACs covered; the asserted values match the spec outcomes.

---

## Edge Cases

- [x] An owner with no requests gets `items: []`, `total: 0`: `test/owned-processing-requests.e2e-spec.ts:236-241` `toStrictEqual({ items: [], page: 1, pageSize: 20, total: 0 })`; repo `test/owner-scoped-reads.e2e-spec.ts:133-134`; in-memory `src/infrastructure/in-memory-processing-request.repository.spec.ts:151-152`
- [x] A page beyond the last returns empty `items` and the owner's total: `test/owned-processing-requests.e2e-spec.ts:222-227` `toStrictEqual({ items: [], page: 5, pageSize: 2, total: 2 })`; unit `src/application/list-owned-processing-requests.query.spec.ts:106`
- [x] Equal `createdAt` gives a stable order: `test/owner-scoped-reads.e2e-spec.ts:101-102` (the same `[low, high]` on two calls) plus the SQL tiebreak `:175-177`; in-memory `src/infrastructure/in-memory-processing-request.repository.spec.ts:129`. See follow-up 1: in PostgreSQL only the SQL-text assertion discriminates.

---

## Discrimination Sensor

Each mutant ran in a fresh `rsync` copy of the HEAD tree under the scratchpad, without `.git` or `dist`, with `node_modules` symlinked. The Python applier exits non-zero unless its anchor matches exactly once, so no mutant could run unapplied. Every mutant also passed `tsc --noEmit`, so every kill is behavioural, not a compile error. Suites run for each mutant: `jest` (unit) and `jest --config test/jest-e2e.json` with `DATABASE_HOST` set.

| # | File:line | Mutation | Unit failed | E2E failed | Killed? |
| --- | --- | --- | --- | --- | --- |
| M01 | `src/infrastructure/persistence/typeorm-processing-request.repository.ts:119` | owner dropped from `findPageByOwner` `where` | 0 | 12 | ✅ |
| M02 | `src/infrastructure/persistence/typeorm-processing-request.repository.ts:128` | owner dropped from `countByOwner` (counts all rows) | 0 | 10 | ✅ |
| M03 | `src/infrastructure/persistence/typeorm-processing-request.repository.ts:138` | owner dropped from `findByIdAndOwner` `where` | 0 | 3 | ✅ |
| M04 | `src/infrastructure/persistence/typeorm-processing-request.repository.ts:120` | sort inverted, `createdAt` DESC → ASC | 0 | 7 | ✅ |
| M05 | `src/infrastructure/persistence/typeorm-processing-request.repository.ts:120` | `processingRequestId` tiebreak dropped | 0 | 1 (SQL-text test only) | ✅ |
| M06 | `src/application/list-owned-processing-requests.query.ts:27` | offset `page * pageSize` | 3 | 6 | ✅ |
| M07 | `src/infrastructure/in-memory-processing-request.repository.ts:75` | in-memory count of all rows | 7 | 0 | ✅ |
| M08 | `src/interface/owned-processing-requests.controller.ts:66` | UUID guard removed | 0 | 2 (+1 unrelated, see note) | ✅ |
| M09 | `src/application/get-owned-processing-request.query.ts:25` | another owner's id gets a distinct 404 (existence oracle) | 1 | 1 | ✅ |
| M10 | `src/application/owned-item.ts:44` | `failureCode` leaked in FAILED items | 5 | 2 | ✅ |
| M11 | `src/application/owned-item.ts:38` | `sourceStorageKey` leaked in every item | 10 | 3 | ✅ |
| M12 | `src/application/owned-item.ts:41` | `failureReason` emitted for non-FAILED statuses | 5 | 2 | ✅ |
| M13 | `src/app.module.ts:52` | owned controller registered only when `LOCAL_INTEGRATION` is set | 0 | 24 | ✅ |
| M14 | `src/interface/owned-processing-requests.controller.ts:50` | `pageSize` 101 accepted (message unchanged) | 0 | 1 | ✅ |
| M15 | `src/interface/owned-processing-requests.controller.ts:80` | blank-owner check without `trim()` | 0 | 2 | ✅ |
| M16 | `src/interface/owned-processing-requests.controller.ts:42` | `page` 0 accepted | 0 | 1 | ✅ |
| M17 | `src/infrastructure/in-memory-processing-request.repository.ts:84` | in-memory `findByIdAndOwner` ignores owner | 2 | 0 | ✅ |
| M18 | `src/infrastructure/in-memory-processing-request.repository.ts:67` | in-memory tiebreak dropped | 1 | 0 | ✅ |
| M19 | `src/application/list-owned-processing-requests.query.ts:32` | `total` = rows on the page | 3 | 4 | ✅ |
| M20 | `src/infrastructure/persistence/migrations/1789955000000-IndexProcessingRequestOwnerCreatedAt.ts:14` | `up()` keeps the old owner-only index | 0 | 1 | ✅ |

**Note on M08.** The first run also failed `Local Docker Integration › runs RECEIVED → QUEUED → COMPLETED` (POST returned 404). That suite is in-memory and does not reach the mutated line. It did not reproduce on a rerun of M08 or in 4 unmutated e2e runs, so it is recorded as a harness flake, not a kill. The rerun killed M08 on the same two owned-route tests, and the log shows the `QueryFailedError: invalid input syntax for type uuid` 500 that the guard exists to prevent. The rerun's third failure (`owner index migration › replaces…`) came from M20 having left the old index in the shared scratch database. That is a harness-only interaction, cleared by the next migration-suite run.

**Sensor depth**: P0 (authorization/data isolation), 20 behaviour-level mutants covering all three owner predicates, order, tiebreak, offset, count, UUID guard, 404 oracle, projection leaks, registration, bounds and migration.
**Isolation**: real-tree `git status --porcelain` was empty before and after (identical). No `git stash`; the real tree was never edited.
**Result**: 20/20 killed. Survivors: 0 (real 0, equivalent 0, harness-only 0).

---

## Code Quality

| Principle | Status |
| --- | --- |
| Minimum code / surgical / no scope creep | ✅ Five source files plus one migration and one module edit; the observation controller is untouched, as the spec requires |
| Matches patterns | ✅ Token-injected port, explicit `BadRequestException` validation in the style of `create-processing-request.controller.ts`, idempotent migration SQL |
| Spec-anchored outcome check | ✅ Exact status codes, exact 404 body, exact 400 messages, exact failure sentences, `toStrictEqual` shapes |
| Per-layer coverage expectation | ✅ In-memory unit + PostgreSQL integration for the repository; unit for the projection and queries; e2e for both routes (happy, edge and every 400/404), both flag modes |
| Every test maps to a requirement | ✅ Spot-checked all new suites; each test maps to an AC, edge case or `Done when` item |
| Documented guidelines followed | none found; strong defaults applied (as `tasks.md` states) |

---

## Gate Check

- **Gate command**: `npm run lint && npm run typecheck && npm test && DATABASE_HOST=localhost DATABASE_PORT=55434 npm run test:e2e -- --json --outputFile=<scratch>/e2e.json && npm run build`
- **Outcome**: exit 0. Lint 0, typecheck 0, unit 144/144 (0 pending), e2e 79/79 (0 pending, 0 todo per the JSON report), build 0
- **Before** (`b99fe9a`, run in a `git archive` scratch copy): 121 unit + 43 e2e = 164. **After**: 144 + 79 = 223. **Delta**: +59; no existing test removed (the diff only adds to `test/composition.e2e-spec.ts` and `test/local-docker-integration.e2e-spec.ts`)
- **Skipped**: none (every `describeIfDatabase` suite ran against PostgreSQL)

---

## Spec-precision gaps

1. **P1 AC5 "iff FAILED" vs a FAILED row without a code.** `failure_code` is nullable with no CHECK constraint (`src/infrastructure/persistence/migrations/1789953000000-CreateProcessingRequest.ts:15`). `toOwnedItem` emits `failureReason` only when `status === FAILED && failureCode` (`src/application/owned-item.ts:40-44`), so a FAILED row with a NULL code would have no `failureReason`, which contradicts the literal "iff". The domain cannot produce such a row: `failProcessingRequest` rejects an unknown code (`src/domain/processing-request.ts:181`). The spec does not say what to do, and no test pins it.
2. **P1 AC7 defines only "blank after trimming".** A non-blank owner with surrounding whitespace (for example `%20alice`) passes validation and is queried untrimmed (`src/interface/owned-processing-requests.controller.ts:37-39`). That returns an empty page, which fails closed and is safe, but the spec is silent.

---

## Fix Plans (non-blocking)

1. **The PostgreSQL tiebreak tests do not discriminate on behaviour alone.** M05 (drop `processingRequestId: 'ASC'`) was killed only by the SQL-text regex at `test/owner-scoped-reads.e2e-spec.ts:175-177`. The behavioural tiebreak tests (`test/owner-scoped-reads.e2e-spec.ts:92-103`, `test/owned-processing-requests.e2e-spec.ts:119-149`) still pass, most likely because the composite index returns ties in id order. Optional: seed ties whose heap order differs from index order, or accept the SQL assertion as the guard. Minor.
2. **Pin the FAILED-without-code case** in `spec.md` (spec-precision gap 1), or add a CHECK constraint `status <> 'FAILED' OR failure_code IS NOT NULL`. Minor.
3. **State in `spec.md`** whether the owner segment is used verbatim or trimmed (spec-precision gap 2). Minor.
4. **Cross-repo, already tracked:** regenerate `fiap-x-platform/db/create-database.sql` from migration `1789955000000` (from the T3 status note in `tasks.md`). Not a gap in this slice.

---

## Requirement Traceability Update

AUTH-10, AUTH-11, AUTH-12 and AUTH-13 move from Implementing to ✅ Verified. The Verifier does not edit `spec.md`.

---

## Summary

**Overall**: ✅ Ready, with minor follow-ups
**Spec-anchored check**: 13/13 ACs + 3/3 edge cases evidenced; 2 spec-precision gaps flagged (non-blocking)
**Sensor**: 20/20 killed
**Gate**: 223 passed (144 unit + 79 e2e), 0 skipped; lint, typecheck and build clean

**What works**: every owner-scoped query carries the owner in SQL; malformed, unknown and foreign ids produce byte-identical 404s with no query for malformed ids; the projection is an allow-list; the routes answer in both flag modes; the composite index migrates up and down idempotently.

**Next steps**: optional follow-ups 1–3; the platform regenerates the DB script (follow-up 4).
