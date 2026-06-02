# Changelog

This file records project-level changes for `@alenfitz/spec-copilot`.

The framework-installed changelog is also kept at `framework/CHANGELOG.md` so users who install or update the framework can see the same evolution inside the generated framework files.

## [4.0.30] - 2026-06-01

### Gate Failure Circuit Breaker

Main dimension: Constraints + Feedback Loops.

test05 showed a costly pattern: after a gate failure, the model kept trying small edits and documentation rewrites for many commits instead of stopping to ask for direction. This release adds a local failure ledger so repeated identical gate failures become visible early.

Changes:

- Gate failures are recorded in `.spec-copilot/gate-failures.json`, keyed by `changeName + phase + failure signature`.
- The signature uses structured failure codes when available, and falls back to a hash of the first failure reason.
- On the second identical failure, gate warns that the next one will trigger the stop-loss prompt.
- From the third identical failure onward, gate prints a clear stop-loss message: pause, report to the user, and choose whether to guide repair, accept a documented degradation, or terminate the change.
- A passing gate clears the failure counters for that change/phase.

Boundary:

- This is a circuit breaker prompt, not an OS-level lock. It does not prevent another command from being run, but it makes continued blind retries explicit and auditable.
- It is intentionally local state, not committed project history. Long-term provenance still belongs in scaffold/amend/log flows.

Also in this release: review gate persistence-check credibility fix.

Real-project runs surfaced a false "0/22 write APIs have no persistence" failure that badly hurt gate credibility. Three root causes fixed:

- POST query endpoints (list/search/query, etc.) are no longer misclassified as write APIs requiring persistence.
- Interface-injected services now resolve to their `*Impl` class so persistence evidence inside the impl is found.
- Backend Java file lookup depth raised from 5 to 12 so deeply nested packages (`.../service/impl/`) are no longer missed.

Effect: a typical project goes from "0/22 false failure" to real verdicts (13/21 truly passing in the test project).

## [4.0.29] - 2026-06-01

### Signed Gate Sentinels

Main dimension: Tool Orchestration + Constraints.

v4.0.17 introduced `.gate-*-passed` sentinels so later phases could require evidence that earlier gates ran. test05-style adversarial behavior exposed a gap: those sentinel files were ordinary JSON. A model could create `{}` or copy an old sentinel and make archive/review believe a previous phase had passed.

Changes:

- Gate-written sentinels now include a local HMAC signature over `schema`, `phase`, `changeName`, `timestamp`, and framework `version`.
- The signing key is generated per project at `.spec-copilot/sentinel.key` and ignored by `.spec-copilot/.gitignore`.
- `review` verifies `.gate-smoke-passed`; `archive` verifies `.gate-review-passed` and, for complex changes, `.gate-test-passed`.
- Unsigned/old-format sentinels are rejected with a clear message instead of being treated as valid.
- Tests now generate normal sentinels via real gate commands, and include a forged unsigned sentinel regression test.

Boundary:

- This blocks low-cost forgery (`touch`, `{}`, copying a sentinel from another change/phase) and makes gate evidence a real CLI-issued artifact.
- It is not a claim of perfect cryptographic security against a model that can read local state and deliberately reimplement the signing algorithm. The next stronger layer is scaffold/amend provenance plus failure counters.

## [4.0.28] - 2026-06-01

### Guard first-run regression fix

v4.0.27 armed Guard by default but introduced a first-run regression: `install` creates empty `project-context.md` / `domain-rules.md` templates, then immediately `guard install` locks them (`lockAfter: always`) recording the empty-template hash. When `/spec:init` later fills the context, the next gate's hash check flags that legitimate fill as tampering and blocks it — a first-run UX regression, not a security gain.

Changes:

- `cmdGuardInstall` gains a `deferAlwaysLock` option; install-time auto-arm defers locking the always-protected files.
- `onGatePassed` locks the `always` files at the first passing gate (apply/smoke), when content is already filled — locking real content instead of an empty template.
- `onGatePassed` now returns `{ locked, failures }`; the gate call site emits an explicit warning when guard is installed but auto-lock fails, instead of swallowing it silently (P2).
- Added first-run regression tests: install does not lock empty templates; filling project-context.md does not trip the gate.
- Template-aware auto-lock follow-up: auto-lock skips unfilled `project-context.md` and example-only `domain-rules.md`, so the first gate cannot accidentally freeze placeholder context as trusted truth.
- `apply` gate now fails if Guard cannot freeze the current `spec.md`; permanent context/rule auto-lock failures remain visible warnings.

Effect:

- New projects: after `guard install`, `locks.json` is empty, so `/spec:init` filling context is not blocked.
- After the first apply/smoke gate passes, spec.md + domain-rules.md + project-context.md get locked (protection preserved, just deferred to the right moment).
- If project context/domain rules are still templates, they are reported and left unlocked until real content exists.

## [4.0.27] - 2026-06-01

### Guard armed by default

Main dimension: Tool Orchestration (make an existing mechanism actually take effect).

The test05 review exposed a structural problem: the Guard / Contract Freeze code existed but was off by default. `install` never ran `guard install`, and at gate time a missing guard made the hash check fall into a silent `catch{}` — effectively letting the model rewrite `spec.md` to lower the bar with no detection.

This release adds no new checks. It only wires the existing tamper-protection so it is on by default.

Changes:

- `install` now runs `guard install` at the end, so spec tamper-protection is armed by default for new projects.
- `gate` now distinguishes two states instead of silently passing:
  - Not installed → loud warning ("protection not in effect") plus a one-line enable hint (non-blocking, for upgrade compatibility).
  - Installed and hash mismatch → blocked (non-zero exit).
- Replaced `catch { /* skip when guard not installed */ }` so it only swallows genuine guard-module errors (visible with `SPEC_COPILOT_DEBUG`).
- `doctor` now counts "guard not installed" as an issue and exits non-zero when issues exist.
- `guard.js` exports a new `isInstalled()` helper.
- Added `test/guard-arming.test.js` (4 cases): armed-by-default / tamper-blocked / uninstalled-warning / doctor-issue.

Boundary:

- This makes the problem harder to happen rather than just easier to surface: by default, tampering with `spec.md` is blocked at gate time.
- It still does not prevent the AI from writing files — Guard's mechanism is "modified files fail the gate", not write denial.
- Whether sentinel files (`.gate-*-passed`) are forgeable is deferred to a later release (fixed in v4.0.29).

## [4.0.26] - 2026-05-29

### OpenCode Agent Invocation Probe

Main dimension: Tool Orchestration + Feedback Loops.

This release fixes a real host-adapter problem found during test05 review: opencode installations wrote sub-agent profiles into `.opencode/agent/`, while current opencode expects project agents under `.opencode/agents/`. That made review silently degrade into a `General Task`, so independent reviewer assumptions were not actually true.

Changes:

- Changed opencode agent install directory to `.opencode/agents/`.
- Updated opencode agent frontmatter to use `mode: subagent` plus `permission:` instead of legacy `tools:`.
- Added `/spec:agent-check` as a fast runtime probe command.
- Added `npx @alenfitz/spec-copilot agents verify` to validate agent directory and frontmatter without waiting for `/spec:review`.
- `doctor` now runs host agent profile verification and points users to `/spec:agent-check`.
- `/spec:review` now explicitly stops if opencode falls back to `General Task`.
- README command counts updated from 13 to 14.

Verification:

- Added install tests for `.opencode/agents/`, permission frontmatter, legacy directory detection, and `agents verify`.

Boundary:

- `agents verify` proves installation shape, not runtime dispatch. `/spec:agent-check` is the quick runtime probe that must be run inside opencode.
- If opencode still shows `General Task`, the framework now surfaces the issue immediately instead of letting review proceed in degraded mode.

## [4.0.25] - 2026-05-28

### Write Field Consumption

Main dimension: Entropy Control + Feedback Loops.

This release does not claim that request fields are semantically correct. It adds a narrower check for a real fake-closure pattern: the spec declares write API fields, but backend implementation only passes a whole `request` object around and never consumes declared fields such as `title` or `description`.

Changes:

- Added `checkWriteFieldConsumption` in `bin/review-checks.js`.
- Integrated the new check into `gate review` output as `WRITE_FIELD_CONSUMPTION`.
- Reads §6.2 API field checklist rows for write APIs.
- Checks the backend entry and directly called service method bodies for declared required/optional field evidence.
- Skips when the spec has no field checklist, avoiding false failures for projects without structured field declarations.

Tests:

- Added a failing case where `title` / `description` are declared but never consumed by backend code.
- Added a passing case where service code reads `request.get("title")` and `request.get("description")` before saving.
- Added boundary tests for empty write-field rows and snake_case fields consumed through camelCase evidence.

Verification:

- `node --test test/review-checks.test.js`: 19 / 19 passed.
- `npm test`: 110 / 110 passed.
- `npm run build`: passed.

Boundary:

- This is field evidence detection, not full semantic validation.
- It does not prove field values are validated, transformed correctly, persisted to the right columns, or echoed in the response.
- Current scope traces Java/Spring controller plus one direct service call.
- DTO getter/setter and Map key usage are supported as textual evidence; deeper dataflow remains future work.
- This is the last planned Entropy Control increment for the current milestone; next development should move to Tool Orchestration.

## [4.0.24] - 2026-05-28

### Write Persistence Closure

Main dimension: Entropy Control + Feedback Loops.

This release adds a focused review gate check for a recurring experimental failure: a model creates `POST` / `PUT` / `PATCH` / `DELETE` APIs and returns success, but the backend implementation does not show any persistence evidence.

Changes:

- Added `checkWritePersistenceClosure` in `bin/review-checks.js`.
- Integrated the new check into `gate review` output as `WRITE_PERSISTENCE`.
- Reads write APIs from the API coverage matrix.
- Resolves backend entries such as `TicketController#save`.
- Checks controller method bodies and direct service/repository calls for persistence evidence.
- Fails review when no obvious `save` / `insert` / `update` / `delete` / `persist` evidence exists.

Tests:

- Added focused tests for a fake success response with no persistence.
- Added focused tests for controller-to-service-to-repository persistence.
- Added a guard test so `service.save(...)` does not pass unless the service method itself has persistence evidence.
- Added a guard test so unrelated calls such as `userRepository.updateLastLoginTime()` do not satisfy a ticket save API.
- Added a plural-normalization regression test so paths such as `/api/addresses/save` can match `addressRepository.save(...)`.

Verification:

- `node --test test/review-checks.test.js`: 15 / 15 passed.
- `npm test`: 106 / 106 passed.
- `npm run build`: passed.

Boundary:

- This is a heuristic evidence check, not a database transaction proof.
- Current scope mainly covers Java/Spring controller to one-hop service/repository calls.
- Concrete repository/mapper calls must overlap with the current API business tokens; generic calls such as `repository.save(...)` are still accepted as evidence.
- Business-token plural normalization handles common `s` / `es` / `ies` cases, but it is not a full linguistic stemmer.
- It does not yet prove request-field usage, transaction commit, or response echo correctness.
- Non-standard ORM, async event persistence, or dynamic SQL may need future adapters or allowlist support.

## [4.0.23] - 2026-05-28

### Non-Degradable Task Rules

Main dimension: Entropy Control.

This release connects `不可降级项` to the review gate. If a task declares hard non-degradable acceptance points and later records non-empty `简化或降级处理`, review fails with a clear `NON_DEGRADABLE` signal.

Effect:

- Turns `不可降级项` from a template field into an enforceable review input.
- Exposes the case where a model knows a hard requirement but still explains it away as a downgrade.

Verification:

- `npm test`: 101 / 101 passed.
- `node --test test/entropy-control.test.js`: 8 / 8 passed.
- `npm run build`: passed.

Boundary:

- This version does not prove the non-degradable item is implemented.
- It only prevents declaring a hard acceptance point and then bypassing it through degradation notes.

## [4.0.22] - 2026-05-28

### Task Vertical Slice

Main dimension: Entropy Control.

This release introduces V-Slice task structure to reduce overly broad or layer-only task decomposition.

Changes:

- Added required V-Slice fields to `tasks.md`.
- Required each task to describe user action, API contract, state/data change, UI/output result, and verification path.
- Added `不可降级项`.
- Added apply/lint checks for missing V-Slice fields.
- Fails when one task covers more than 3 feature points.

Effect:

- Moves task-size and task-closure issues earlier, before implementation.
- Pushes tasks toward independently verifiable business slices instead of frontend/backend/test layer buckets.

Verification:

- `npm test`: 99 / 99 passed.
- `npm run build`: passed.

## Earlier Versions

Earlier project history is still available in `framework/CHANGELOG.md`. Going forward, root `CHANGELOG.md` should be updated for every project release, and `framework/CHANGELOG.md` should remain aligned when framework behavior or installed files change.
