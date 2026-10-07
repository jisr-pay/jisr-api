# October 9 submission verification

Executed October 7, 2026 in the shared Linux workspace. Baseline source revision:
`43592e5d0a519c4fdc3b7cb1d354c5d8b251c7ba`. Preparation changes affect documentation/governance and, where noted,
CI checks; no runtime implementation or public API was changed.

## Local results

Runtime: Node v24.15.0 for all runtime checks below.

- `npm ci --ignore-scripts --no-audit --no-fund`: dependencies installed from
  the lockfile (installation initially used Node 22 with an engine warning).
- `npm run check:sdk`: isolated offline installed-package check passed, including
  compiled imports, declarations, exact amounts and read-only settlement.
- `npm test`: 41 passed on Node 24.15.0.
- `npm run build`: JavaScript syntax and OpenAPI JSON checks passed.
- Earlier Node 22 attempts could not accept --test-isolation=none; supported
  Node 24 resolved the runtime limitation. No test-flag change was made.
- Network/payment responses in the suite are mocked. Real browser wallet and
  deployed API acceptance remain separate. Contract claims remain unverified.

## Review and publication

- `git diff --check`: passed after preparation edits.
- CI YAML parsed locally. A syntax parse does not replace GitHub execution.
- Six engineering issues were published with bounded acceptance criteria and
  proposed complexity; links are in WAVE_BACKLOG.md. No Wave labels/enrollment
  or contributor assignments were performed.
- Maintainers xteesamz and EthTobi were owner-confirmed; GitHub contact and
  anytime availability apply. GitHub App coverage/application slots still
  require dashboard confirmation.
- Changes will be proposed through a fork PR because the available account
  cannot push directly to the organization's protected branch. Merge decisions
  remain with maintainers. Recheck the final PR checks before applying.
