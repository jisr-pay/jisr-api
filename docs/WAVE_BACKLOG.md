# Wave engineering backlog

Drafted October 7, 2026 for the October 9 submission. These are local issue drafts,
not published GitHub issues or Wave enrollments. Complexity and points are proposed
planning values (trivial 100, medium 150, high 200); maintainers must confirm scope
and actual enrollment in the Drips app. An issue is not evidence its feature exists.

## 1. [jisr-api] Contract payment verification

### Complexity & Points

- Tier: High (200 pts proposed)
- Proposed label: `complexity: high`

### Description & Context

Close the contract evidence gap when the chosen web flow uses Soroban routing.

### Requirements & Acceptance Criteria

- [ ] Verify invocation/event semantics against recovered source.
- [ ] Match network, sender, recipient, asset and exact amount.
- [ ] Keep incomplete evidence pending.
- [ ] Test forged events and stale responses.
- [ ] Relevant automated checks pass; include positive/negative tests for implemented behavior.

### Relevant Files & Architecture

src/evidence.js; src/reconcile.js; docs/EVIDENCE.md

### Contribution Guidelines

Use a focused `feat:`/`fix:`/`docs:` PR, include `Closes #<issue_id>`, and record
actual local and CI results before requesting review.

## 2. [jisr-api] Deployment acceptance

### Complexity & Points

- Tier: Medium (150 pts proposed)
- Proposed label: `complexity: medium`

### Description & Context

Establish live wallet-session API behavior.

### Requirements & Acceptance Criteria

- [ ] Record deployed revision and health.
- [ ] Test origin isolation, logout, history and reconciliation through the web proxy.
- [ ] Confirm secrets remain server-side.
- [ ] Relevant automated checks pass; include positive/negative tests for implemented behavior.

### Relevant Files & Architecture

DEPLOY.md; Dockerfile; docs/OWNERSHIP.md

### Contribution Guidelines

Use a focused `feat:`/`fix:`/`docs:` PR, include `Closes #<issue_id>`, and record
actual local and CI results before requesting review.

## 3. [jisr-api] SQLite backup and restore drill

### Complexity & Points

- Tier: Medium (150 pts proposed)
- Proposed label: `complexity: medium`

### Description & Context

Prove recoverability before schema or deployment changes.

### Requirements & Acceptance Criteria

- [ ] Document consistent database/WAL backup.
- [ ] Restore a synthetic database.
- [ ] Verify history and schema version.
- [ ] Test older-binary rejection.
- [ ] Relevant automated checks pass; include positive/negative tests for implemented behavior.

### Relevant Files & Architecture

DEPLOY.md; migrations/; test/

### Contribution Guidelines

Use a focused `feat:`/`fix:`/`docs:` PR, include `Closes #<issue_id>`, and record
actual local and CI results before requesting review.

## 4. [jisr-api] SDK artifact provenance refresh

### Complexity & Points

- Tier: Medium (150 pts proposed)
- Proposed label: `complexity: medium`

### Description & Context

Keep API consumption tied to reviewed compiled SDK artifacts.

### Requirements & Acceptance Criteria

- [ ] Record source revision and artifact digest.
- [ ] Verify installed export surface and declarations.
- [ ] Exercise exact amount boundaries.
- [ ] Avoid unreviewed artifact replacement.
- [ ] Relevant automated checks pass; include positive/negative tests for implemented behavior.

### Relevant Files & Architecture

SDK_REVIEW.md; vendor/; scripts/check-sdk.js

### Contribution Guidelines

Use a focused `feat:`/`fix:`/`docs:` PR, include `Closes #<issue_id>`, and record
actual local and CI results before requesting review.

## 5. [jisr-api] Branch protection verification

### Complexity & Points

- Tier: Trivial (100 pts proposed)
- Proposed label: `complexity: trivial`

### Description & Context

Confirm review and CI enforcement for the API repository.

### Requirements & Acceptance Criteria

- [ ] Inspect repository/organization rules and branch protection.
- [ ] Record required checks and reviewer policy.
- [ ] Verify enforcement through an authorized PR workflow.
- [ ] Relevant automated checks pass; include positive/negative tests for implemented behavior.

### Relevant Files & Architecture

.github/workflows/ci.yml; CONTRIBUTING.md

### Contribution Guidelines

Use a focused `feat:`/`fix:`/`docs:` PR, include `Closes #<issue_id>`, and record
actual local and CI results before requesting review.

## 6. [jisr-api] Request boundary regression tests

### Complexity & Points

- Tier: Medium (150 pts proposed)
- Proposed label: `complexity: medium`

### Description & Context

Strengthen evidence against malformed or abusive wallet requests.

### Requirements & Acceptance Criteria

- [ ] Exercise oversized bodies, invalid cursors, expired/replayed sessions and concurrent mutations.
- [ ] Assert stable errors and no credential exposure.
- [ ] Align OpenAPI with observed behavior.
- [ ] Relevant automated checks pass; include positive/negative tests for implemented behavior.

### Relevant Files & Architecture

src/; test/; openapi.json

### Contribution Guidelines

Use a focused `feat:`/`fix:`/`docs:` PR, include `Closes #<issue_id>`, and record
actual local and CI results before requesting review.

## Published issue links

- [Contract payment verification](https://github.com/jisr-pay/jisr-api/issues/5)
- [Deployment acceptance](https://github.com/jisr-pay/jisr-api/issues/6)
- [SQLite backup and restore drill](https://github.com/jisr-pay/jisr-api/issues/7)
- [SDK artifact provenance refresh](https://github.com/jisr-pay/jisr-api/issues/8)
- [Branch protection verification](https://github.com/jisr-pay/jisr-api/issues/9)
- [Request boundary regression tests](https://github.com/jisr-pay/jisr-api/issues/10)

These issues are published but have not been enrolled into Drips Wave or assigned.
