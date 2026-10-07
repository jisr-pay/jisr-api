# Contributing to Jisr API

Use Node 24.15+ within Node 24 and run `npm ci`. Configure local settings from
`.env.example`; keep SERVICE_TOKEN server-side. Do not commit environment files,
databases, wallet credentials, signed transactions, or customer records.

Create focused `feat/<topic>`, `fix/<topic>`, `docs/<topic>`, or `test/<topic>`
branches. Run `npm run check:sdk`, `npm test`, and `npm run build` before review.
Tests use Node's built-in runner with in-process isolation. Add positive and
negative tests for changed routes, evidence validation, or persistence behavior.

PRs must explain the concrete problem, behavior change, actual check results,
and limitations, and include `Closes #<issue_id>` for the implemented issue.
Open a tracking issue first if needed. Required CI checks must pass before merge.

Keep signing and broadcasting in the wallet flow. Network timeouts and missing
results remain pending; confirmation requires matching payment evidence.
Preserve exact decimal amounts, immutable transfer identity, wallet ownership
checks, and migration compatibility. Update OpenAPI and related documentation
when changing transport behavior.

See the organization [maintainer record](https://github.com/jisr-pay/.github/blob/main/MAINTAINERS.md),
[security policy](https://github.com/jisr-pay/.github/blob/main/SECURITY.md), and
[code of conduct](https://github.com/jisr-pay/.github/blob/main/CODE_OF_CONDUCT.md).
