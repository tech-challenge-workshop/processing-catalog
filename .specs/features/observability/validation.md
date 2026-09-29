# Observability Validation

**Date**: 2026-09-28
**Spec**: `.specs/features/observability/spec.md`
**Diff range**: `origin/main..HEAD` = `4b063cd..0624f3e` (3 docs commits + 18 task commits + 2 post-verification fix commits; 60 files, +3667/-32)
**Verifier**: independent sub-agent (author ≠ verifier), re-verification round 2 of 3 (final round)

---

## Round 1 → Round 2

| Round 1 item | Round 2 status |
| ------------ | -------------- |
| **Fix 1 (Major)**: OBS-16's `varchar(128)` column bound undiscriminated (sensor M8 survived) | ✅ **Closed** by `7c14d0e`. `test/create-processing-request-route.e2e-spec.ts:577-600` POSTs a 128-char id and asserts `res.status` 201, `stored()` → `[{ column: 'c'.repeat(128), payload: 'c'.repeat(128) }]`, and `information_schema.columns` → `[{ character_maximum_length: 128, is_nullable: 'YES' }]`. M8 re-run with the migration really applied (column dropped + `catalog.migrations` row deleted first; width read back as `64` during the run): **killed**, e2e `Expected: 201, Received: 500` at `:583`. |
| Observation 1: `fiapx_http_requests_total` / `fiapx_http_request_duration_seconds` registered but never recorded | ✅ **Closed** by `0624f3e`. `src/observability/http-metrics.middleware.ts` (port of fiap-x-api's) wired at `src/app.module.ts:143` for `'*'`; +4 unit, +1 e2e; 4 new mutants (M11–M14), all killed. |
| Observations 2–5 (header not persisted, `migration:run` broken, OBS-24 e2e `>= 1`, mid-tick scrape untested) | Unchanged; still observations (see Summary). |

The rest of the feature was re-checked cold, not only the fixes: every AC re-anchored to HEAD line numbers, full gate re-run, and 7 fresh mutations.

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1–T18 | ✅ Done | 18 task commits in range, one Conventional Commit each (re-listed with `git log origin/main..HEAD`). |
| Post-verification Fix 1 | ✅ Done | `7c14d0e test(catalog): prove the correlation id column holds 128 chars`, +1 e2e (recorded in tasks.md "Post-verification fixes"). |
| Post-verification Fix 2 | ✅ Done | `0624f3e feat(catalog): record http request metrics`, +4 unit, +1 e2e (recorded in tasks.md). Not required by any spec AC; it implements design.md's `CatalogMetrics` "same middleware pattern as the API" and removes round 1's dead-instrumentation observation. |
| T5 | ⚠️ Done with caveat | `npm run migration:run` is broken, and was broken before this feature (the data-source exports a factory, not a `DataSource` instance). Out of scope. The migration is now bound-checked at the DB (`create-processing-request-route.e2e-spec.ts:597-599`). |

---

## Spec-Anchored Acceptance Criteria

> 13 requirements: OBS-16..28 (7 P1 + 6 P2). OBS-29/30 are unused. Line numbers re-derived against HEAD `0624f3e`. Only `test/create-processing-request-route.e2e-spec.ts` and `test/health-and-metrics.e2e-spec.ts` changed after round 1. Every other cited file is unchanged since `918307b`.

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| ------------------------- | -------------------- | ----------------------- | ------ |
| OBS-16 WHEN create receives a `correlationId` THEN validate (non-blank, ≤128 printable ASCII) and persist it in the same transaction as the request row | Valid id stored on the row **and** on its outbox event; 128 accepted end to end; column `varchar(128) NULL` (spec "Column shape") | `test/create-processing-request-route.e2e-spec.ts:566-575` - `expect(await stored(body.ownerUserId)).toEqual([{ column: 'cat-1', payload: 'cat-1' }])` (row joined to its outbox row, real Postgres); `:577-600` - 128 chars: `expect(res.status).toBe(201)`, `expect(await stored(...)).toEqual([{ column: correlationId, payload: correlationId }])`, `expect(columns).toEqual([{ character_maximum_length: 128, is_nullable: 'YES' }])`; unit `src/application/create-processing-request.use-case.spec.ts:371-388` (127/128 in-memory) | ✅ PASS (M8 killed) |
| OBS-17 WHEN any event is published from the outbox THEN it carries the stored request's `correlationId` when one exists | All 4 outbox writers carry the stored value; field omitted (not null) when absent | `test/observability.e2e-spec.ts:249-259` - `expect(published.map((s) => s.pattern)).toEqual(['VideoValidationRequested','ProcessingQueued','terminal.event'])` + `expect(published.map((s) => s.payload.correlationId)).toEqual(['cat-1','cat-1','cat-1'])`; `:303` - `expect(event.payload).not.toHaveProperty('correlationId')`; unit `src/application/accept-processing-request.use-case.spec.ts:165,174,186` | ✅ PASS |
| OBS-18 WHEN the terminal event is published THEN it carries the stored `correlationId` | Terminal `correlationId === stored`, for COMPLETED and FAILED, never the consumer's ambient id | `test/observability.e2e-spec.ts:255-259` (COMPLETED `'cat-1'`); `:279` - `expect(terminal?.payload.correlationId).toBe('cat-2')` while the consumed message carried another id; unit `src/application/complete-processing-request.use-case.spec.ts:304,313,325`; `src/application/fail-processing-request.use-case.spec.ts:449,464,473,485` | ✅ PASS (M16 killed) |
| OBS-19 WHEN any consumer handles a message THEN set the log context from the message's `correlationId` before handling and restore/clear it afterwards | Handler sees the message id; context `undefined` after success and after throw; all 5 consumers | `src/infrastructure/rabbitmq/consumer-observability.spec.ts:130-146` - `expect(useCase.seen).toEqual(['cat-1'])` for all 5 consumers via the real channel callback; `src/infrastructure/messaging/with-correlation.spec.ts:33-50` - `expect(correlationContext.getCorrelationId()).toBeUndefined()` after resolve and after reject; e2e `test/observability.e2e-spec.ts:358-359` - `expect(handling?.correlationId).toBe('cat-9')` | ✅ PASS |
| OBS-20 IF an inbound message lacks / carries an invalid `correlationId` THEN generate a fresh id and do NOT fail the message | Generated UUID in context; message acked | `src/infrastructure/messaging/with-correlation.spec.ts:52-78` - absent, number, object, null, blank, 129 chars, non-printable: `expect(seen).toMatch(UUID)`, `expect(handler).toHaveBeenCalledTimes(1)`; e2e `test/observability.e2e-spec.ts:334-336` - `expect(handling?.correlationId).toEqual(expect.stringMatching(UUID)); expect(broker.channel.ack).toHaveBeenCalledTimes(1)`, nack not called | ✅ PASS (M15 killed) |
| OBS-21 IF the create request carries an invalid `correlationId` THEN 400 with the same field-error shape as the other bounded fields | 400 `{message, error:'Bad Request', statusCode:400}`; nothing written | `test/create-processing-request-route.e2e-spec.ts:602-618` - for `''`, `'   '`, 129 chars, `42`, `null`: `expect(res.status).toBe(400)`, `expect(res.body).toStrictEqual({ message: 'correlationId must be 1 to 128 printable ASCII characters', error: 'Bad Request', statusCode: 400 })`, `expect(await rows(...)).toBe(0)`, `expect(await outboxEntries(...)).toBe(0)` | ✅ PASS |
| OBS-22 WHEN the Catalog emits any log line THEN JSON with `timestamp`, `level`, `msg`, `service`, current `correlationId`, never the owner's email | Every captured line parses with those keys; `service:'processing-catalog'`; no owner email | `test/observability.e2e-spec.ts:449-474` - every line of a create: `expect(line).toEqual(expect.objectContaining({ service: 'processing-catalog', correlationId: 'cat-log', level: …, timestamp: …, msg: … }))` + `expect(JSON.stringify(line)).not.toContain(body.ownerEmail)`; unit `src/observability/logger.config.spec.ts:69-75`, `:88-113` | ✅ PASS (⚠️ spec-precision flag 1) |
| OBS-23 WHEN Prometheus scrapes `/metrics` THEN it includes `fiapx_outbox_pending_rows`, `fiapx_outbox_oldest_pending_seconds`, `fiapx_outbox_publish_failures_total`, `fiapx_events_consumed_total{event,outcome="acked\|dead_lettered"}` | 200; all four families; gauges equal seeded rows | `test/health-and-metrics.e2e-spec.ts:82-96` - `expect(response.status).toBe(200)`, content type `'text/plain; version=0.0.4'`, `` toContain(`# TYPE ${family} `) `` for all four; `test/observability.e2e-spec.ts:387` - `toContain('fiapx_outbox_pending_rows 3')`; `:361-366` - exact `...{event="VideoAccepted",outcome="acked"} 1` and `...outcome="dead_lettered"} 1` | ✅ PASS |
| OBS-24 WHEN a publish exceeds the confirm timeout or the broker rejects it THEN increment `fiapx_outbox_publish_failures_total` and leave the row pending | +1 per failed attempt; row still pending | `src/infrastructure/messaging/outbox-relay.spec.ts:75-84` - `expect(await failures()).toBe('fiapx_outbox_publish_failures_total 1'); expect(outbox.pending.map((row) => row.id)).toEqual(['row-1']); expect(outbox.marked).toEqual([])`; `:86-109` (timeout ×2 → 1 then 2; success → 0); e2e `test/observability.e2e-spec.ts:392-400` | ✅ PASS |
| OBS-25 WHEN a consumer settles a message THEN increment `fiapx_events_consumed_total` with matching `event` and `outcome` | Exactly one series per final settlement | `src/infrastructure/rabbitmq/settle-failed-message.spec.ts:140-248` - exact lines for acked, dead_lettered, requeue → `toEqual([])`, requeue-then-ack → one `acked 1`; `src/infrastructure/rabbitmq/consumer-observability.spec.ts:130-163` - all 5 consumers | ✅ PASS (⚠️ spec-precision flag 2) |
| OBS-26 WHILE RabbitMQ or PostgreSQL is unreachable THEN `/health` 503 naming the failed dependency and `/health/live` 200 | 503 `{status:'error', rabbitmq, database}` naming the down one; live 200 | `test/health-and-metrics.e2e-spec.ts:67-80` - `expect(ready.status).toBe(503); expect(ready.body).toStrictEqual({ status: 'error', rabbitmq: 'down', database: 'up' }); expect(live.status).toBe(200)`; `test/observability.e2e-spec.ts:428-445` - `toStrictEqual({ status: 'error', rabbitmq: 'up', database: 'down' })`, live 200, `/metrics` 200 | ✅ PASS |
| OBS-27 WHEN both dependencies are healthy THEN `/health` 200 | 200 `{status:'ok', rabbitmq:'up', database:'up'}` | `test/health-and-metrics.e2e-spec.ts:54-65` - `expect(ready.status).toBe(200); expect(ready.body).toStrictEqual({ status: 'ok', rabbitmq: 'up', database: 'up' })` | ✅ PASS |
| OBS-28 metric exposition and health endpoints SHALL NOT require auth and SHALL NOT produce access-log lines | 200 without credentials; zero access-log lines for `/health`, `/health/live`, `/metrics` | `test/health-and-metrics.e2e-spec.ts:82-85` (no auth header, 200); `test/observability.e2e-spec.ts:477-491` - `expect(urls).toEqual(['/'])`; unit `src/observability/logger.config.spec.ts:149-171` | ✅ PASS (still green with the new HTTP metrics middleware in the chain) |

**Status**: ✅ All 13 ACs covered with spec-matching assertions. 2 ⚠️ spec-precision flags (judged outcome-met, below).

**Payload/conjunction rule**: payload fields are asserted by value: `payload.correlationId` per event (`observability.e2e-spec.ts:255-259`). The omitted case uses `not.toHaveProperty` (`:303`). The 400 body uses `toStrictEqual` (`create-processing-request-route.e2e-spec.ts:609-613`). OBS-16's conjunction (row **and** outbox payload **and** column shape) is asserted in one test (`:584-599`). OBS-24's conjunction (count **and** row pending) is asserted together (`outbox-relay.spec.ts:81-83`). The new HTTP metrics e2e asserts the full `{method, route, status}` label set plus value `1` (`health-and-metrics.e2e-spec.ts:111-119`), and asserts that raw ids never appear (`:120-121`).

**Spec-precision flags (imprecise spec, judged outcome-met; unchanged from round 1, lessons L-013/L-014 already recorded):**

1. ⚠️ **OBS-22 "the current `correlationId`" outside any scope.** Lines emitted outside a request or consumer scope (bootstrap, relay scheduler) omit the key (`src/observability/logger.config.ts:47-52`, asserted `logger.config.spec.ts:78-85`). The spec is silent on this case. Also, consumers author no log line of their own: the e2e reads a line the test injects inside the use case, so the scope is proven but a consumer-authored line is not.
2. ⚠️ **OBS-25 "settles" vs requeue.** A transient `nack(requeue=true)` is not counted (`src/infrastructure/rabbitmq/settle-failed-message.ts:99-107`). The final settlement of the redelivery is counted. This is consistent with the bounded `acked|dead_lettered` label set.

---

## Discrimination Sensor

Scratch isolation: each mutation ran in a fresh `git worktree add --detach /tmp/catalog-v2-<id> HEAD` with the real `node_modules` symlinked. A script applied the mutation and asserted exactly one match. The full unit suite and the full e2e suite (real Postgres `catalog-obs-e2e-pg:55432`, db `fiapx_e2e`, `maxWorkers: 1`) ran in the worktree, which was then removed with `--force` + `git worktree prune`. Real-tree baseline (`git status --porcelain` = the 3 uncommitted round-1 report/lesson files) was captured before the sensor and matched after **every** mutation. No `/tmp/catalog-v2-*` left behind; `git worktree list` shows only the real tree.

M8 DB handling: before the mutant, `ALTER TABLE catalog.processing_request DROP COLUMN correlation_id` + `DELETE FROM catalog.migrations WHERE name='AddCorrelationId1789959000000'`, so the mutated migration actually ran (width read back as `64` during the run). Afterwards the same drop/delete ran, then the real tree's full e2e (exit 0, 202/202). The column read back as `128 | YES`.

| Mutation | File:line | Description | Killed? |
| -------- | --------- | ----------- | ------- |
| M8 (re-run) | `src/infrastructure/persistence/migrations/1789959000000-AddCorrelationId.ts:12` | Column `varchar(128) NULL` → `varchar(64) NULL` | ✅ Killed - e2e `stores a 128 characters id whole, in a nullable varchar(128) column` (`Expected: 201, Received: 500`). Unit 332/332 (DB-only concern, as expected) |
| M11 | `src/observability/http-metrics.middleware.ts:18` | Matched route label = raw `req.originalUrl` instead of the route template | ✅ Killed - unit `records the route template for a matched request`, `counts each request exactly once`. e2e `counts served requests by route template on /metrics, never by raw path` (run twice, both killed) |
| M12 | `src/observability/http-metrics.middleware.ts:18` | Unmatched fallback `'unmatched'` → raw `req.path` | ✅ Killed - unit `records 'unmatched' when no route template matched`. The e2e survives it: its 404 goes through a matched template, so the unit spec owns the fallback |
| M13 | `src/observability/http-metrics.middleware.ts:24` | Status label hard-coded `'200'` instead of `String(res.statusCode)` | ✅ Killed - unit `records 'unmatched'…` (404). e2e route-template case (400/404) |
| M14 | `src/app.module.ts:143` | `HttpMetricsMiddleware` removed from `consumer.apply(...)` (wiring removed) | ✅ Killed - e2e route-template case. Unit 332/332, as expected: the wiring is owned by the e2e |
| M15 | `src/observability/correlation-context.ts:8` | Printable range `[\x20-\x7E]` → `[\x00-\x7E]` (accepts control chars) | ✅ Killed - unit 3 failed (`parseCorrelationId › … control characters`, use case `rejects a non-printable correlation id…`, `withMessageCorrelation › replaces a non-printable character…`). The e2e survives it (the route 400 matrix has no control-char case); the unit specs own it |
| M16 | `src/application/complete-processing-request.use-case.ts:106` | COMPLETED terminal event drops the stored id (`updated.correlationId !== undefined` → `false`) | ✅ Killed - unit 2 failed (`carries the id stored at creation…`, `takes the id from the stored request, not the ambient log context`). e2e `stores cat-1 … through COMPLETED` |

**Sensor depth**: expanded (7 behavior-level mutations in round 2, ≥5 required; spans a DB migration, event contract, validation, and HTTP metrics). The 9 mutations killed in round 1 (M1–M7, M9, M10) target files unchanged since round 1 and were not repeated.
**Result**: 7/7 killed - PASS ✅

---

## Interactive UAT Results

Not performed. This is a backend/observability feature, so automated checks (unit + e2e + sensor) are sufficient per validate.md §3/§7.

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code / no scope creep | ✅ Round 1's dead `recordHttpRequest` instrumentation is now wired (`http-metrics.middleware.ts`, 33 lines, a port of fiap-x-api's). It goes beyond the spec's ACs but is required by design.md. |
| No abstractions for single-use code | ✅ |
| Surgical changes | ✅ The fixes touch 5 files (1 test, 1 middleware + spec, 1 wiring line, 1 e2e, tasks.md). |
| Matches existing patterns/style | ✅ The middleware mirrors the API's: route template, `'unmatched'`, errors swallowed on `finish`. |
| Spec-anchored outcome check | ✅ 13/13 |
| Per-layer coverage (domain 1:1 ACs; routes happy+edge+error) | ✅ The "Persistence - column round-trips" row now covers the bound too. `/health`, `/health/live`, `/metrics`, `POST /processing-requests` each have happy + edge + error cases. |
| Every test maps to an AC/edge/Done-when | ✅ The new HTTP-metrics tests (4 unit, 1 e2e) map to design.md `CatalogMetrics` and the tasks.md Fix 2 Done-when, not to a spec AC. They are claimed there, so none is unclaimed. |
| Documented guidelines followed | ✅ `.github/workflows/ci.yml` gates re-run green |

SPEC_DEVIATION markers (unchanged, judged acceptable in round 1; lessons L-015/L-016 recorded): `src/observability/logger.config.ts:7-13` and `src/observability/observability.module.ts:9-11`.

Changed-test integrity: the fix commits only add cases. No assertion was removed or weakened (`git diff 918307b..HEAD -- test src` shows additions only in test files).

---

## Edge Cases

- [x] Stored `NULL correlation_id` → published events omit the field (`observability.e2e-spec.ts:282-305`). Consumers of those events generate a fresh id (`with-correlation.spec.ts:52-60`).
- [ ] ⚠️ Scrape mid-relay-tick → gauges reflect the last completed read. No test covers this; the guarantee is structural (gauges read outside the relay transaction). Not discriminated. Observation.
- [x] Database down → `/metrics` 200 while `/health` 503 (`observability.e2e-spec.ts:428-445`; unit `metrics.spec.ts:68-79`).
- [x] `correlationId` over the bound → 400 before storage (`create-processing-request-route.e2e-spec.ts:602-618`). The storage bound itself is now proven at 128 (`:577-600`).

---

## Gate Check

- **Gate command**: `npm run lint && npm run typecheck && npm test && DATABASE_HOST=localhost DATABASE_PORT=55432 DATABASE_SCHEMA=catalog DATABASE_USER=catalog DATABASE_PASSWORD=catalog npm run test:e2e && npm run build`
- **Exit codes (captured directly by this Verifier on HEAD `0624f3e`)**:
  - `npm run lint` → exit 0
  - `npm run typecheck` → exit 0
  - `npm test` → exit 0 - Test Suites 34/34, Tests 332 passed, 0 failed, 0 skipped
  - `npm run test:e2e` → exit 0 - Test Suites 18/18, Tests 202 passed, 0 failed, 0 skipped. A second full run (DB restore after M8) was also 202/202.
  - `npm run build` → exit 0
- **Test count before feature** (`origin/main`, from round 1): 248 unit + 185 e2e = 433
- **Test count after feature**: 332 unit + 202 e2e = 534
- **Delta**: +84 unit, +17 e2e (+101), 0 deletions. That is round 1's +80/+15, plus Fix 1 (+1 e2e) and Fix 2 (+4 unit, +1 e2e), matching tasks.md.
- **Skipped tests**: none (`DATABASE_HOST` set, so every `describeIfDatabase` suite ran)
- **Failures**: none on the real tree.

---

## Fix Plans

None blocking. See the flake observation in Summary (test-harness robustness, non-blocking).

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| ----------- | --------------- | ---------- |
| OBS-16 | ❌ Needs Fix (round 1) | ✅ Verified |
| OBS-17..28 | ✅ Verified (round 1) | ✅ Verified (re-checked round 2) |

---

## Summary

**Overall**: ✅ Ready - PASS

**Spec-anchored check**: 13/13 ACs matched spec outcome; 2 ⚠️ spec-precision flags (outcome-met)
**Sensor**: 7/7 killed in round 2, including M8 (round 1's survivor) and 4 mutants on the new HTTP metrics middleware
**Gate**: lint/typecheck/build exit 0; unit 332/332; e2e 202/202; 0 skipped

**What works**: correlationId validated, persisted through a proven `varchar(128) NULL` column, and carried from the stored row on all four outbox-written events (omitted, not null, when absent). All five consumers run under the message's id with a generated fallback, and the scope is cleared after. The settle-point counter splits acked/dead_lettered exactly. The publish-failure counter increments once per failed attempt and leaves the row pending. Outbox gauges survive a DB outage. `/health` 503 names either dependency; `/health/live` 200; `/metrics` 200 unauthenticated and absent from the access log. JSON pino logs carry service + correlationId, with email redaction. HTTP request metrics are now recorded by route template with bounded labels.

**Observations (non-blocking)**:
1. **One non-reproducing e2e failure seen during the sensor.** In mutant M11's first run (a mutation that cannot affect the relay), `observability.e2e-spec.ts:250` `stores cat-1 … through COMPLETED` got `published = []`. It did not recur in M11's second run, in 3 isolated runs of that suite on the real tree, or in the other 9 full e2e runs. The likely mechanism is in the test helper `publishedFor` (`observability.e2e-spec.ts:196-199`), which calls `OutboxRelay.drain()` once. `drain()` takes a single 50-row batch and silently returns 0 when `pg_try_advisory_xact_lock` is not acquired (`src/infrastructure/messaging/outbox-relay.ts:67-73`). Either a concurrent scheduled tick or a >50-row pending backlog in the shared DB can therefore yield an empty list. Suggested hardening (follow-up, not a gate): loop `drain()` until the request's rows appear or a short deadline passes.
2. HTTP metrics count `/health`, `/health/live`, `/metrics` (mirrors fiap-x-api; they are excluded only from the access log, which is what OBS-28 requires). Decided choice.
3. Only the body `correlationId` is persisted; the `X-Correlation-Id` header only scopes request logs. Decided choice (tasks.md T8).
4. `npm run migration:run` was broken before this feature; out of scope.
5. OBS-24's e2e asserts `>= 1`, so exact counter placement rests on the unit spec. Likewise M12 (unmatched fallback) and M15 (control chars) are owned by unit specs only. They were killed, but no e2e case exercises them.
6. The mid-tick scrape consistency edge case has no discriminating test (structural guarantee).

**Next steps**: none blocking. Feature may be marked done. Observation 1 is worth a small follow-up hardening of the e2e helper.
