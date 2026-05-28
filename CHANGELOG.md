# Changelog

This file records project-level changes for `@alenfitz/spec-copilot`.

The framework-installed changelog is also kept at `framework/CHANGELOG.md` so users who install or update the framework can see the same evolution inside the generated framework files.

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
