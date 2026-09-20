# CI Pipeline Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/ci-pipeline/design.md`
**Status**: Done

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: `test/jest-e2e.json`, `package.json` scripts, prior `tasks.md` gate tables in `.specs/features/local-docker-integration/`. No coverage threshold is configured anywhere in the repository.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| GitHub Actions workflow | none | Build gate only. A workflow has no unit-testable surface; its behaviour is verified by observing a real check run, which T6 does explicitly. | `.github/workflows/*.yml` | build gate only |
| Service source | none (unchanged) | This feature changes no source file, so existing coverage stands. | `src/**/*.ts` | `npm test` |

## Gate Check Commands

> Generated from codebase - confirm before Execute.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | After editing the workflow file | `python3 -c "import sys,yaml;yaml.safe_load(open('.github/workflows/ci.yml'))"` |
| Full | After a job is added or reordered | `npm run lint && npm test && npm run test:e2e` |
| Build | After phase completion | `npm run lint && npm test && npm run test:e2e && npm run build` |

---

## Execution Plan

Phases are ordered and run sequentially - each phase completes before the next begins, and tasks within a phase execute in order.

### Phase 1: Quality gate

```
T1 → T2 → T3
```

### Phase 2: Extended jobs

```
T4 → T5
```

### Phase 3: Verification on the platform

```
T6
```

---

## Task Breakdown

### T1: Create the workflow with the quality job

**What**: Add `ci.yml` with a `quality` job that checks out, sets up Node 22, installs with `npm ci`, and runs lint, unit tests, e2e tests and build in that order.
**Where**: `.github/workflows/ci.yml`
**Depends on**: None
**Reuses**: `package.json` scripts `lint`, `test`, `test:e2e`, `build`
**Requirement**: CI-01, CI-02, CI-03, CI-04, CI-05, CI-06, CI-07, CI-08

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Triggers are `pull_request` targeting `main` and `push` to `main`
- [ ] `runs-on: ubuntu-latest` and `actions/setup-node` pins Node 22
- [ ] Install step is `npm ci`, never `npm install`
- [ ] Steps run in order: lint, test, test:e2e, build
- [ ] The job is named `quality`, matching the required status check contract in the design
- [ ] No step references a secret
- [ ] Quick gate passes: the workflow file parses as YAML

**Tests**: none
**Gate**: quick

---

### T2: Enable dependency caching

**What**: Add `cache: npm` to the `actions/setup-node` step so installs restore from cache keyed on the lockfile.
**Where**: `.github/workflows/ci.yml` (modify)
**Depends on**: T1
**Reuses**: `package-lock.json` as the cache key source
**Requirement**: CI-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `actions/setup-node` declares `cache: npm`
- [ ] No manual `actions/cache` step is added, since setup-node covers it
- [ ] Quick gate passes: the workflow file parses as YAML

**Tests**: none
**Gate**: quick

---

### T3: Add concurrency control and job timeout

**What**: Add a per-ref concurrency group that cancels superseded runs, and a 15-minute timeout on the `quality` job.
**Where**: `.github/workflows/ci.yml` (modify)
**Depends on**: T2
**Reuses**: None
**Requirement**: CI-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `concurrency` groups by workflow and ref with `cancel-in-progress: true`
- [ ] The `quality` job declares `timeout-minutes: 15`
- [ ] Quick gate passes: the workflow file parses as YAML

**Tests**: none
**Gate**: quick

---

### T4: Add the container image build job

**What**: Add an `image` job that runs only after `quality` succeeds and builds the Dockerfile to a local tag without pushing.
**Where**: `.github/workflows/ci.yml` (modify)
**Depends on**: T3
**Reuses**: `Dockerfile`, `.dockerignore`
**Requirement**: CI-9, CI-10, CI-11

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] The job declares `needs: quality`
- [ ] The build targets a local tag and no registry login or push step exists
- [ ] A failing image build fails the check run
- [ ] Quick gate passes: the workflow file parses as YAML

**Tests**: none
**Gate**: quick

---

### T5: Publish the coverage summary as an artifact

**What**: Run the unit step with coverage and upload the generated summary with `actions/upload-artifact`, without gating on any threshold.
**Where**: `.github/workflows/ci.yml` (modify)
**Depends on**: T4
**Reuses**: the existing `test:cov` script if its output path suits, otherwise `npm test -- --coverage`
**Requirement**: CI-12, CI-13

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Coverage is produced by the existing unit test step, not a second full run
- [ ] The summary is uploaded as a run artifact
- [ ] No coverage threshold can fail the job
- [ ] Build gate passes: `npm run lint && npm test && npm run test:e2e && npm run build`

**Tests**: none
**Gate**: build

---

### T6: Verify the workflow on a real pull request

**What**: Open a pull request, confirm the check behaves correctly by injecting and reverting a deliberate failure, then record the exact check name for branch protection.
**Where**: `.specs/features/ci-pipeline/design.md` (record the observed check name)
**Depends on**: T5
**Reuses**: The branch protection rule already configured on `main`
**Requirement**: CI-02, CI-06, CI-07

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] A pull request to `main` shows the `quality` check running
- [x] A deliberately introduced lint error turns the check red at the lint step
- [x] Reverting that error turns the check green
- [x] The exact check name is recorded in the design so it can be selected as a required status check
- [x] No unrelated change remains in the branch

**Completed**: 2026-09-20

| Evidence | Run |
| --- | --- |
| Required check `quality` turned **red** on a deliberate lint error, failing at `Run npm run lint` | [35538772101](https://github.com/tech-challenge-workshop/processing-catalog/actions/runs/35538772101) |
| Reverting the probe turned `quality` **green** | [35538836830](https://github.com/tech-challenge-workshop/processing-catalog/actions/runs/35538836830) |

Dependent jobs behaved as designed: they reported `SKIPPED` while the gate was red.
The temporary pull request was closed without merging and its branch deleted, so no
probe reached `main`. `quality` is now a required status check in the `protect main`
ruleset.

**Tests**: none
**Gate**: build

**Commit**: `ci: add pull request quality gate`

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3

Phase 1:  T1 ------→ T2 ------→ T3
Phase 2:  T4 ------→ T5
Phase 3:  T6

Phase boundaries (the last task of a phase gates the first task of the next):
          T3 ------→ T4
          T5 ------→ T6
```

Total: 6 tasks. This packs into a single batch (at or below the ~7-task worker budget), so Execute runs inline with no sub-agents dispatched.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1: Create workflow with quality job | 1 file, 1 job | ✅ Granular |
| T2: Enable dependency caching | 1 step option | ✅ Granular |
| T3: Concurrency and timeout | 2 cohesive settings, 1 file | ✅ Granular |
| T4: Image build job | 1 job | ✅ Granular |
| T5: Coverage artifact | 1 step pair, 1 file | ✅ Granular |
| T6: Verify on a pull request | 1 observable outcome | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T1 | None | no inbound arrow | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T2 | T2 → T3 | ✅ Match |
| T4 | T3 | T3 → T4 (phase boundary) | ✅ Match |
| T5 | T4 | T4 → T5 | ✅ Match |
| T6 | T5 | T5 → T6 (phase boundary) | ✅ Match |

No task depends on a task in a later phase.

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1 | GitHub Actions workflow | none | none | ✅ OK |
| T2 | GitHub Actions workflow | none | none | ✅ OK |
| T3 | GitHub Actions workflow | none | none | ✅ OK |
| T4 | GitHub Actions workflow | none | none | ✅ OK |
| T5 | GitHub Actions workflow | none | none | ✅ OK |
| T6 | GitHub Actions workflow | none | none | ✅ OK |

`Tests: none` is valid for every task here because the coverage matrix assigns `none` to the workflow layer - a workflow has no unit-testable surface. This is not test deferral: T6 carries the actual verification, performed against a real check run, and its `Done when` entries are binary and observable.
