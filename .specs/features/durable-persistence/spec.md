# Catalog Durable Persistence Specification

## Problem Statement

Everything the Catalog knows lives in memory. A restart erases every `ProcessingRequest`, every status, and every record of which events were already processed — so a redelivery after a restart re-applies a transition that already happened, and a user's history simply disappears.

The publication path has the same shape of problem in reverse: `publishTerminalEvent` is called after the state is written, but outside any transaction. If the broker is unreachable at that instant the state has already changed and the event is lost forever, with nothing to retry from. That is precisely the "do not lose a request during a spike" requirement, and it is the one the foundation answers with a transactional outbox.

## Goals

- [ ] Survive a restart with every request, status and deduplication record intact.
- [ ] Make a state transition and its outgoing event one atomic fact.
- [ ] Retry publication until the broker confirms, without ever duplicating an effect.
- [ ] Ship the database creation script the challenge lists as a deliverable.

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
| --- | --- |
| A cache tier | AD-008 fixes this: deduplication must commit with the transition it guards, which an external cache cannot join. |
| Owner-scoped status queries | Owned by S5. This slice makes the data durable; S5 exposes it. |
| FFprobe, FFmpeg, ZIP creation and object storage | Owned by S4. |
| Durable deduplication in the Worker | AD-008 again: the Worker's idempotency comes from its deterministic object key, not from bookkeeping. Its in-memory checker stays as defence in depth. |
| Sending email | Owned by S7. |
| Managed database hosting | AD-005 fixes PostgreSQL in a container. |

---

## Assumptions & Open Questions

Every ambiguity is resolved or recorded here - nothing is left silently unclear.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Repository port shape | Becomes asynchronous | PostgreSQL access is I/O. The current port is synchronous (`save(): void`, `find(): T \| undefined`), so every use case and consumer changes signature. Hiding that behind a blocking facade would be a lie about what the call does. | y |
| Where the outbox row is written | In the same transaction as the transition | It is the whole point: a committed transition with an uncommitted event, or the reverse, is exactly the loss this slice removes. | y |
| Who publishes outbox rows | A relay that polls pending rows and marks them sent after the broker confirms | Publishing inline would put a network call inside the transaction, holding a lock for the broker's latency. | y |
| Delivery guarantee | At-least-once | The relay can crash between publishing and marking sent. Consumers already deduplicate by `eventId`, so a repeat is harmless; losing an event is not. | y |
| Deduplication storage | A `processed_event` table written in the transition's transaction | AD-008. A cache cannot join the transaction, which opens the window where an event is marked processed but its transition rolls back. | y |
| Schema evolution | Versioned migrations, applied explicitly | The creation script the challenge asks for is generated from them, so the two cannot drift. | y |
| Test strategy | The existing in-memory adapter stays and keeps serving unit tests; PostgreSQL is exercised by integration tests | Keeping the fast suite fast, while the adapter that talks to a real database is proven against a real database. | y |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: Survive a restart ⭐ MVP

**User Story**: As a user, I want my request and its status to still exist after the service restarts, so that a deploy does not erase what I submitted.

**Why P1**: Without it nothing else in this slice matters, and RT-1 is unmet.

**Acceptance Criteria** (each line is one EARS pattern):

1. WHEN a `ProcessingRequest` is created THEN the Catalog SHALL persist it in PostgreSQL before responding. <!-- event-driven -->
2. WHEN a transition is applied THEN the Catalog SHALL persist the new status, `attemptId`, `zipStorageKey` and `failureCode` as applicable. <!-- event-driven -->
3. WHEN the service restarts THEN every previously persisted request SHALL still be readable with the status it last held. <!-- event-driven -->
4. WHEN an event is applied THEN its `eventId` SHALL be recorded so that a redelivery after a restart applies no second transition. <!-- event-driven -->
5. The Catalog SHALL store no binary content, only keys and metadata. <!-- ubiquitous -->
6. IF the database is unreachable THEN the Catalog SHALL report itself not ready while remaining live. <!-- unwanted-behavior -->

**Independent Test**: Drive a request to `PROCESSING`, restart the process, read it back, and replay the events that produced it.

---

### P2: Make the transition and its event one atomic fact

**User Story**: As the system, I want a state change and the event announcing it to commit together, so that a broker outage cannot leave the two disagreeing.

**Why P2**: This is the mechanism the foundation names for RF-2, and the reason the slice exists.

**Acceptance Criteria**:

1. WHEN a transition produces an outgoing event THEN the Catalog SHALL write the new state and an outbox row in a single database transaction. <!-- event-driven -->
2. IF writing either the state or the outbox row fails THEN neither SHALL be committed. <!-- unwanted-behavior -->
3. The Catalog SHALL NOT publish to the broker inside that transaction. <!-- ubiquitous -->
4. WHEN a pending outbox row exists THEN the relay SHALL publish it and mark it sent only after the broker confirms. <!-- event-driven -->
5. IF the broker is unreachable THEN pending rows SHALL remain pending and SHALL be retried, and no row SHALL be discarded. <!-- unwanted-behavior -->
6. IF the relay crashes after publishing but before marking a row sent THEN the row SHALL be published again, and the consumer's `eventId` deduplication SHALL absorb it. <!-- unwanted-behavior -->
7. WHILE rows remain pending, the Catalog SHALL expose their count and the age of the oldest one. <!-- state-driven -->

**Independent Test**: Stop the broker, drive several transitions, confirm the states committed and the rows are pending, then start the broker and confirm every event is published exactly once as observed by the consumer.

---

### P3: Ship the schema as a deliverable

**User Story**: As an evaluator, I want a runnable script that creates the database, because the challenge asks for one.

**Why P3**: It is a deliverable, not a runtime requirement.

**Acceptance Criteria**:

1. WHEN the migrations are applied to an empty database THEN they SHALL create every table this service needs, with no manual step. <!-- event-driven -->
2. WHEN the creation script is produced THEN it SHALL be generated from the migrations rather than maintained separately. <!-- event-driven -->
3. WHEN migrations are applied twice THEN the second run SHALL make no change. <!-- event-driven -->

---

## Edge Cases

- IF two replicas process different events for the same request concurrently THEN exactly one transition SHALL commit and the other SHALL be rejected, rather than both writing.
- IF a message fails processing beyond the configured limit THEN it SHALL be routed to a dead-letter queue and SHALL NOT block its main queue.
- IF the same `eventId` is written to `processed_event` concurrently THEN the second write SHALL be rejected by a uniqueness constraint rather than creating a duplicate row.
- WHEN the outbox is empty THEN the relay SHALL do no work and SHALL log nothing.
- IF a request carries no `attemptId` because it failed before any attempt started THEN that SHALL persist as absent, not as an empty string.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| DP-01 | P1: Survive a restart | Design | Pending |
| DP-02 | P1: Survive a restart | Design | Pending |
| DP-03 | P1: Survive a restart | Design | Pending |
| DP-04 | P1: Survive a restart | Design | Pending |
| DP-05 | P1: Survive a restart | Design | Pending |
| DP-06 | P1: Survive a restart | Design | Pending |
| DP-07 | P2: Atomic transition and event | Design | Pending |
| DP-08 | P2: Atomic transition and event | Design | Pending |
| DP-09 | P2: Atomic transition and event | Design | Pending |
| DP-10 | P2: Atomic transition and event | Design | Pending |
| DP-11 | P2: Atomic transition and event | Design | Pending |
| DP-12 | P2: Atomic transition and event | Design | Pending |
| DP-13 | P2: Atomic transition and event | Design | Pending |
| DP-14 | P3: Schema deliverable | - | Pending |
| DP-15 | P3: Schema deliverable | - | Pending |
| DP-16 | P3: Schema deliverable | - | Pending |

**ID format:** `DP-[NUMBER]`

**Coverage:** 16 total, 0 mapped to tasks, 16 unmapped (mapping happens in Tasks).

---

## Success Criteria

- [ ] A request driven to `PROCESSING` survives a restart with its status and attempt intact.
- [ ] Stopping the broker mid-flow loses no event: every one arrives once the broker returns.
- [ ] Replaying every event after a restart changes no state and publishes nothing further.
- [ ] Applying the migrations to an empty database produces a working schema, twice in a row.
