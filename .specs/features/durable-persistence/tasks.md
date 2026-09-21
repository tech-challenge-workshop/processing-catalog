# Durable Persistence Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/durable-persistence/design.md`
**Status**: Complete

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: `.specs/features/full-lifecycle/tasks.md` (prior matrix for this repository), `test/jest-e2e.json`, `package.json` scripts. No coverage threshold is configured anywhere in the repository.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Domain aggregate | unit | Unchanged by this slice; existing coverage must not regress | `src/domain/*.spec.ts` | `npm test` |
| Application use cases | unit | Happy path, duplicate `eventId`, forbidden transition, unknown request, and that an outbox row is written instead of a direct publication | `src/application/*.spec.ts` | `npm test` |
| Persistence adapters | integration | Every port method against a real PostgreSQL, plus atomicity: a failure inside the transaction leaves no row in any of the three tables | `test/*.integration-spec.ts` | `npm run test:e2e` |
| Outbox relay | unit + integration | Unit: publishes pending, marks sent only after confirm, skips when empty. Integration: a broker outage leaves rows pending and drains them on return | `src/infrastructure/messaging/*.spec.ts`, `test/*.integration-spec.ts` | `npm test`, `npm run test:e2e` |
| Migrations | integration | Applied to an empty database, twice, with the second run a no-op | `test/*.integration-spec.ts` | `npm run test:e2e` |
| Entities and config | none | Build gate only - they declare shape and carry no behaviour | `src/infrastructure/persistence/*.entity.ts` | build gate only |

**Atomicity is asserted only at the integration layer.** `InMemoryUnitOfWork` cannot roll back, so a unit test claiming atomicity would pass without proving anything. Do not write one.

## Gate Check Commands

> Generated from codebase - confirm before Execute.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | After tasks with unit tests only | `npm test` |
| Full | After tasks touching persistence or the relay | `npm test && npm run test:e2e` |
| Build | After phase completion | `npm run lint && npm run typecheck && npm test && npm run test:e2e && npm run build` |

**Note**: integration tests need PostgreSQL and RabbitMQ. Start both first: `docker compose -f ../fiap-x-platform/compose.yaml up -d postgres rabbitmq`.

---

## Execution Plan

Phases are ordered and run sequentially - each phase completes before the next begins, and tasks within a phase execute in order.

**Phase 1 is mechanical and wide.** The port becomes asynchronous first so the compiler enumerates every call site, rather than discovering them while also introducing PostgreSQL.

### Phase 1: An asynchronous port

```
T1 → T2 → T3 → T4
```

### Phase 2: PostgreSQL behind the port

```
T5 → T6 → T7 → T8
```

### Phase 3: The transactional outbox

```
T9 → T10 → T11 → T12 → T13
```

### Phase 4: Resilience and the deliverable

```
T14 → T15 → T16
```

---

## Task Breakdown

### T1: Make the repository port asynchronous

**What**: Change all six methods of `ProcessingRequestRepository` to return promises.
**Where**: `src/domain/processing-request.repository.ts`
**Depends on**: None
**Reuses**: The existing method names and arguments, which do not change
**Requirement**: DP-01, DP-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Every method returns a promise; no name or argument changes
- [x] `npm run typecheck` lists every call site that now needs an `await`, and that list is recorded in the task notes
- [x] Quick gate passes after T2 and T3 land; this task alone is expected to leave the tree uncompilable

**Tests**: none
**Gate**: quick

**Evidence**: `957fc94`. Os seis metodos de `ProcessingRequestRepository` passaram a devolver `Promise`. A mudanca foi conduzida pelo compilador, nao por busca textual: 67 pontos de chamada acusados por `tsc`. Gate completo do catalog: lint=0, typecheck=0, `npm test` 107/107, build=0, `npm run test:e2e` 39/39 com banco (`DATABASE_HOST=localhost`) e 13 sem, com 26 que se declaram skip.

---

### T2: Make the in-memory adapter asynchronous

**What**: Return resolved promises from the in-memory repository, keeping its behaviour identical.
**Where**: `src/infrastructure/in-memory-processing-request.repository.ts`
**Depends on**: T1
**Reuses**: The existing Map-backed implementation
**Requirement**: DP-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Every method satisfies the new port
- [x] Its existing unit tests pass with `await`, none weakened
- [x] Quick gate passes: `npm test`

**Tests**: unit
**Gate**: quick

**Evidence**: `957fc94`. `InMemoryProcessingRequestRepository` satisfaz a porta assincrona sem mudar semantica - continua sendo a implementacao que os testes de composicao in-memory exercitam.

---

### T3: Await the port in the use cases

**What**: Add `await` at every repository call in the five use cases.
**Where**: `src/application/`
**Depends on**: T2
**Reuses**: The existing eight-step use-case bodies, otherwise unchanged
**Requirement**: DP-01, DP-02, DP-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `npm run typecheck` reports zero errors, which is what proves no call site was missed
- [x] No use case's behaviour changed: every existing assertion passes untouched
- [x] A test asserts a repository result is compared by value and not against a pending promise
- [x] Quick gate passes: `npm test`

**Tests**: unit
**Gate**: quick

**Evidence**: `957fc94`. Todo caso de uso aguarda a porta; nenhuma `Promise` flutuante sobrou, o que o lint do repo (`@typescript-eslint/no-floating-promises`) reprovaria.

---

### T4: Await the port in the observation controller

**What**: Make the local observation route await its lookup.
**Where**: `src/interface/processing-request-observation.controller.ts`
**Depends on**: T3
**Reuses**: The existing route and its `LOCAL_INTEGRATION` guard
**Requirement**: DP-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] The route returns the request, not a promise, asserted by reading a field from the response body
- [x] The route still returns 404 for an unknown id and is still absent without the flag
- [x] Build gate passes

**Tests**: e2e
**Gate**: build

**Evidence**: `957fc94`. O controller de observacao aguarda a porta e continua devolvendo a mesma forma de resposta - os e2e de leitura seguem verdes sem alteracao.

---

### T5: Add the data source and its configuration

**What**: Add TypeORM, a data source reading connection settings from the environment, and register it in the module.
**Where**: `src/infrastructure/persistence/data-source.ts`
**Depends on**: T4
**Reuses**: The environment-variable convention already used for `RABBITMQ_URL`
**Requirement**: DP-01, DP-06

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Connection settings come from the environment with no credential in the repository
- [x] `synchronize` is off, so migrations are the only way the schema changes
- [x] The application still boots with the in-memory adapter when no database is configured
- [x] Quick gate passes: `npm test`

**Tests**: none
**Gate**: quick

**Evidence**: `d391dd4`. `data-source.ts` le `DATABASE_HOST/PORT/NAME/SCHEMA/USER/PASSWORD`; `synchronize` nunca e ligado (AD-009), entao nenhuma mudanca de codigo pode reescrever uma tabela sem revisao.

---

### T6: Add the request entity and its migration

**What**: Map `ProcessingRequest` onto `processing_request`, and add the migration that creates it and `processed_event`.
**Where**: `src/infrastructure/persistence/processing-request.entity.ts`
**Depends on**: T5
**Reuses**: The aggregate shape settled in S2, including `failureCode`
**Requirement**: DP-02, DP-05, DP-14, DP-16

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `processed_event.event_id` is the primary key, so deduplication is a schema guarantee
- [x] `attempt_id`, `zip_storage_key` and `failure_code` are nullable and persist as absent rather than as empty strings
- [x] No column stores binary content
- [x] Applying the migration twice makes no change on the second run
- [x] Full gate passes

**Tests**: integration
**Gate**: full

**Evidence**: `d391dd4`, corrigido em `a648fe6`. `event_id` foi tipado `uuid` e rejeitava ids nao-UUID que o contrato declara como string; virou `text`. Era falha latente aqui, invisivel porque o e2e de ciclo de vida do catalog roda in-memory - so apareceu quando o notification bateu no mesmo tipo.

---

### T7: Implement the repository against PostgreSQL

**What**: Add the TypeORM adapter satisfying the port.
**Where**: `src/infrastructure/persistence/typeorm-processing-request.repository.ts`
**Depends on**: T6
**Reuses**: The in-memory adapter's behaviour as the specification of what this must do
**Requirement**: DP-01, DP-02, DP-03, DP-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Every port method is exercised against a real PostgreSQL
- [x] A request written, then read after the connection is re-established, returns every field by value
- [x] A duplicate `event_id` is rejected by the primary key rather than creating a second row
- [x] Full gate passes

**Tests**: integration
**Gate**: full

**Evidence**: `d391dd4`. `TypeOrmProcessingRequestRepository` implementa a porta contra PostgreSQL. Provado contra banco real em `test/durability.e2e-spec.ts`, nao em memoria.

---

### T8: Report the database in readiness

**What**: Add a database health indicator and include it in the health endpoint.
**Where**: `src/infrastructure/persistence/database.health-indicator.ts`
**Depends on**: T7
**Reuses**: `rabbitmq.health-indicator.ts` as the template
**Requirement**: DP-06

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Readiness is false when the database is unreachable and true when it is up
- [x] Liveness stays healthy while the database is down
- [x] Build gate passes

**Tests**: unit
**Gate**: build

**Evidence**: `d391dd4`. `GET /health` da stack em execucao responde `{"status":"ok","rabbitmq":"up","database":"up"}`. O indicador reporta saudavel quando nenhum banco esta configurado - essa e uma escolha deliberada, nao uma falha a bloquear - e falso quando a conexao nao inicializa ou `SELECT 1` lanca. Liveness nao depende dele.

---

### T9: Declare the unit of work and its in-memory implementation

**What**: Add the `UnitOfWork` port whose context carries a scoped repository and outbox writer, plus the in-memory implementation.
**Where**: `src/application/unit-of-work.ts`
**Depends on**: T8
**Reuses**: The repository port from T1
**Requirement**: DP-07, DP-09

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] The work receives its repository through the context, so no unscoped repository is reachable inside the callback
- [x] The in-memory implementation documents in a comment that it cannot roll back
- [x] No unit test asserts atomicity through it
- [x] Quick gate passes: `npm test`

**Tests**: unit
**Gate**: quick

**Evidence**: `3404e3c`. `UnitOfWork` entrega o repositorio **atraves** do contexto de transacao em vez de injeta-lo, de modo que nenhuma escrita consegue escapar da transacao. A implementacao in-memory existe para os testes que declaram usa-la.

---

### T10: Add the outbox table and its migration

**What**: Add the outbox entity and the migration creating it with a partial index on pending rows.
**Where**: `src/infrastructure/persistence/outbox.entity.ts`
**Depends on**: T9
**Reuses**: The migration convention from T6
**Requirement**: DP-07, DP-13, DP-14

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `published_at` null is the definition of pending, and is indexed
- [x] The payload column holds the event as JSON
- [x] Applying the migration twice makes no change on the second run
- [x] Full gate passes

**Tests**: integration
**Gate**: full

**Evidence**: `3404e3c`, com `event_id` corrigido para `text` em `a648fe6`. Indice parcial sobre `published_at IS NULL`, que e o que torna um poll que nao acha nada quase gratuito.

---

### T11: Implement the transactional unit of work

**What**: Add the TypeORM implementation committing on resolve and rolling back on throw.
**Where**: `src/infrastructure/persistence/typeorm-unit-of-work.ts`
**Depends on**: T10
**Reuses**: TypeORM's transaction manager
**Requirement**: DP-07, DP-08

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] A failure thrown inside the work leaves no row in `processing_request`, `processed_event` or `outbox`
- [x] A successful work commits all three together
- [x] The scoped repository writes through the transaction, proven by reading nothing from outside it before commit
- [x] Full gate passes

**Tests**: integration
**Gate**: full

**Evidence**: `3404e3c`. Transicao, registro de deduplicacao e linha de outbox commitam juntos. Atomicidade provada **contra PostgreSQL**: `durability.e2e-spec.ts` mostra que uma transicao rejeitada nao deixa nem estado, nem registro de evento processado, nem linha de outbox.

---

### T12: Write to the outbox instead of publishing

**What**: Change the use cases to record their event in the outbox inside the transaction, and stop calling the publisher.
**Where**: `src/application/`
**Depends on**: T11
**Reuses**: The use-case bodies from S2, with steps 2 to 6 moved inside the transaction callback
**Requirement**: DP-07, DP-08, DP-09

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] No use case calls the event publisher directly
- [x] Each use case that produced an event now produces a pending outbox row carrying the same queue, pattern and payload
- [x] Existing assertions about published events become assertions about the outbox row, with the payload still asserted field by field
- [x] A forbidden transition writes no outbox row
- [x] Full gate passes

**Tests**: unit
**Gate**: full

**Evidence**: `76a19e3`. Nenhum caso de uso publica mais no broker - registrado como AD-010. O que antes era publicacao virou `outbox.add(...)` dentro da transacao.

---

### T13: Publish pending rows from the relay

**What**: Add the relay that polls pending rows, publishes them, and marks them sent after the broker confirms.
**Where**: `src/infrastructure/messaging/outbox-relay.ts`
**Depends on**: T12
**Reuses**: `sendToQueue` on the existing `RabbitMQConnection`
**Requirement**: DP-10, DP-11, DP-12, DP-13

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] A pending row is published and then marked sent, in that order, asserted by sequence and not only by outcome
- [x] A broker failure leaves the row pending and publishes it on a later poll
- [x] A crash simulated between publishing and marking sent results in a second publication, and the consumer's deduplication absorbs it
- [x] An empty outbox produces no publication and no log line
- [x] The pending count and the age of the oldest row are exposed
- [x] Build gate passes

**Tests**: unit
**Gate**: build

**Evidence**: `76a19e3`, e o agendador que faltava em `90bac06`. O relay marca a linha como enviada **apos** o confirm do broker, nunca antes. `durability.e2e-spec.ts` prova os dois lados: com o broker fora, a transicao commita e nada se perde; quando ele volta, todas as pendencias saem e um segundo `drain()` nao republica nada. Na stack real: 3 publicadas, 0 pendentes.

---

### T14: Dead-letter what keeps failing

**What**: Declare each consumed queue with dead-letter arguments so a message that keeps failing leaves the main queue.
**Where**: `src/infrastructure/rabbitmq/rabbitmq.connection.ts`
**Depends on**: T13
**Reuses**: The existing `RABBITMQ_QUEUES` assertion, already guarded by `queue-declaration.spec.ts`
**Requirement**: DP-06

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Every consumed queue declares a dead-letter target
- [x] A message failing beyond the limit lands there and stops blocking its queue
- [x] `queue-declaration.spec.ts` still passes, and covers the dead-letter queues too
- [x] Full gate passes

**Tests**: integration
**Gate**: full

**Evidence**: `b010085`, com o mecanismo trocado em `90bac06`. **A implementacao original quebrou o sistema**: declarar as filas com `x-dead-letter-exchange` fez o RabbitMQ recusar a declaracao do Worker com `PRECONDITION_FAILED`, fechando o canal dele - `VideoAccepted` nunca era publicado e tudo travava em `RECEIVED`, com os 6 containers reportando healthy. Cinco dessas filas sao declaradas por dois servicos. O dead-lettering passou a ser **policy do broker**, aplicada pelo `fiap-x-platform` (AD-011); o catalog segue declarando e ligando as filas `.dlq`, mas nao define mais argumento nenhum. `rabbitmqctl list_policies` confirma a policy `dead-letter` ativa, e os logs do Worker tem zero ocorrencias de `PRECONDITION`. `queue-declaration.spec.ts` segue verde e cobre as `.dlq`.

---

### T15: Prove durability and atomicity end to end

**What**: Add the integration suite covering restart survival, replay, and a broker outage.
**Where**: `test/durable-persistence.integration-spec.ts`
**Depends on**: T14
**Reuses**: The lifecycle sequences from the S2 e2e suite
**Requirement**: DP-03, DP-04, DP-11, DP-12

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] A request driven to `PROCESSING`, then read through a new data source, still holds its status and attempt
- [x] Replaying every event after that applies no transition and writes no outbox row
- [x] With the broker stopped, transitions commit and rows stay pending; when it returns, every event arrives once as observed by the consumer
- [x] A failure mid-transaction leaves none of the three tables written
- [x] Build gate passes

**Tests**: integration
**Gate**: build

**Evidence**: `b010085`. Durabilidade e atomicidade provadas contra PostgreSQL real, incluindo sobrevivencia a uma nova conexao (o mais proximo de um restart que um teste encena) e replay de todo evento do ciclo de vida sem segunda transicao nem segunda publicacao.

---

### T16: Ship the schema

**What**: Document how migrations are applied and confirm they produce the schema the platform's generator reads.
**Where**: `README.md`
**Depends on**: T15
**Reuses**: The migrations from T6 and T10
**Requirement**: DP-14, DP-15, DP-16

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Applying the migrations to an empty database creates every table with no manual step
- [x] Applying them twice makes no change on the second run
- [x] The README states the command, and states that the creation deliverable is generated in `fiap-x-platform`, not maintained here
- [x] Build gate passes

**Tests**: integration
**Gate**: build

**Evidence**: `90bac06` e `8d3c66b`. Aqui apareceu a falha mais seria do slice: **nada disso estava ligado ao `app.module.ts`**. Os 36 e2e passavam contra as implementacoes in-memory enquanto a stack em execucao tinha zero tabelas do catalog - o slice estava inteiro e nao fazia nada. O composition root passou a resolver `DATA_SOURCE` (com `runMigrations` no boot) e a selecionar as implementacoes TypeORM; `OutboxRelayScheduler` foi adicionado porque o relay existia e ninguem o chamava. `test/composition.e2e-spec.ts` passou a afirmar o que o composition root de fato escolhe, e as duas suites in-memory passaram a **fixar** a composicao que pretendem exercitar em vez de herda-la do ambiente - sem isso, liam um dublê que o app nao usava e passavam por sorte. O README declara que o fluxo integrado exige banco. Gate completo do catalog: lint=0, typecheck=0, `npm test` 107/107, build=0, `npm run test:e2e` 39/39 com banco (`DATABASE_HOST=localhost`) e 13 sem, com 26 que se declaram skip.

**Commit**: `feat(persistence): make the catalog durable`

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3 → Phase 4

Phase 1:  T1 ------→ T2 ------→ T3 ------→ T4
Phase 2:  T5 ------→ T6 ------→ T7 ------→ T8
Phase 3:  T9 ------→ T10 ------→ T11 ------→ T12 ------→ T13
Phase 4:  T14 ------→ T15 ------→ T16

Phase boundaries (the last task of a phase gates the first task of the next):
          T4 ------→ T5
          T8 ------→ T9
          T13 ------→ T14
```

Total: 16 tasks. This packs into three batches at the ~7-task worker budget: Phases 1-2 (8 tasks), Phase 3 (5 tasks) and Phase 4 (3 tasks). Execute should offer batch sub-agents.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1: Port asynchronous | 1 interface | ✅ Granular |
| T2: In-memory adapter | 1 class | ✅ Granular |
| T3: Await in the use cases | 1 directory, one mechanical change | ⚠️ Wide but cohesive |
| T4: Await in the controller | 1 class | ✅ Granular |
| T5: Data source | 1 file | ✅ Granular |
| T6: Entity and migration | 1 entity + its migration | ✅ Granular |
| T7: PostgreSQL repository | 1 class | ✅ Granular |
| T8: Health indicator | 1 class | ✅ Granular |
| T9: Unit of work port | 1 port + its in-memory pair | ✅ Granular |
| T10: Outbox table | 1 entity + its migration | ✅ Granular |
| T11: Transactional unit of work | 1 class | ✅ Granular |
| T12: Use cases write to the outbox | 1 directory, one cohesive change | ⚠️ Wide but cohesive |
| T13: Relay | 1 class | ✅ Granular |
| T14: Dead-lettering | 1 file | ✅ Granular |
| T15: Integration suite | 1 suite | ✅ Granular |
| T16: Schema documentation | 1 file | ✅ Granular |

T3 and T12 each name a directory rather than a file. Both are single changes the compiler drives across the same five use cases, and splitting either into five tasks would produce five commits that do not compile alone. They are marked wide deliberately rather than passed off as granular.

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T1 | None | no inbound arrow | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T2 | T2 → T3 | ✅ Match |
| T4 | T3 | T3 → T4 | ✅ Match |
| T5 | T4 | T4 → T5 (phase boundary) | ✅ Match |
| T6 | T5 | T5 → T6 | ✅ Match |
| T7 | T6 | T6 → T7 | ✅ Match |
| T8 | T7 | T7 → T8 | ✅ Match |
| T9 | T8 | T8 → T9 (phase boundary) | ✅ Match |
| T10 | T9 | T9 → T10 | ✅ Match |
| T11 | T10 | T10 → T11 | ✅ Match |
| T12 | T11 | T11 → T12 | ✅ Match |
| T13 | T12 | T12 → T13 | ✅ Match |
| T14 | T13 | T13 → T14 (phase boundary) | ✅ Match |
| T15 | T14 | T14 → T15 | ✅ Match |
| T16 | T15 | T15 → T16 | ✅ Match |

No task depends on a task in a later phase.

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1 | Repository port declaration | none | none | ✅ OK |
| T2 | In-memory adapter | unit | unit | ✅ OK |
| T3 | Application use cases | unit | unit | ✅ OK |
| T4 | Interface controller | e2e | e2e | ✅ OK |
| T5 | Config | none | none | ✅ OK |
| T6 | Entity + migration | integration | integration | ✅ OK |
| T7 | Persistence adapter | integration | integration | ✅ OK |
| T8 | Health indicator | unit | unit | ✅ OK |
| T9 | Application port + in-memory pair | unit | unit | ✅ OK |
| T10 | Entity + migration | integration | integration | ✅ OK |
| T11 | Persistence adapter | integration | integration | ✅ OK |
| T12 | Application use cases | unit | unit | ✅ OK |
| T13 | Outbox relay | unit | unit | ✅ OK |
| T14 | Queue declaration | integration | integration | ✅ OK |
| T15 | Durability end to end | integration | integration | ✅ OK |
| T16 | Migrations | integration | integration | ✅ OK |

T1 and T5 are the only `Tests: none`, matching the matrix for a declaration and for configuration. T1 is proven by T2 and T3, which cannot compile unless the port is right; T5 by T7, which cannot reach a database without it.
