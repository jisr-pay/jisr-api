# Deploying jisr-api (Fly.io)

Node 24 HTTP server backed by SQLite. The transfer journal in SQLite is the source
of truth (the downtime drill proved it survives restarts), so the database lives on
a Fly volume that persists across deploys and restarts.

## One-time setup

```bash
fly apps create jisr-api        # or another name; keep fly.toml `app` in sync
fly volumes create jisr_data --region iad --size 1   # same region as fly.toml
fly secrets set SERVICE_TOKEN=$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")
fly secrets set WALLET_AUTH_ORIGIN=https://<your-vercel-app>.vercel.app
fly deploy
```

`SERVICE_TOKEN` generation command is the one from `.env.example`. `WALLET_AUTH_ORIGIN`
must be the exact browser origin (scheme + host + port) the wallet UI runs on; sessions
from any other origin are rejected.

## Continuous deployment

`.github/workflows/deploy.yml` deploys every push to `main` once a `FLY_API_TOKEN`
repository secret exists. Mint a scoped token with `fly tokens deploy` and add it
under Settings → Secrets and variables → Actions. Until then the workflow logs a
skip notice instead of failing.

## Verify

```bash
fly status
curl https://jisr-api.fly.dev/healthz    # {"status":"ok"}
```

## Notes

- `HORIZON_URL` points at Stellar Testnet; mainnet is a separate, explicit decision.
- Machines scale to zero (`auto_stop_machines = "suspend"`); wake-up adds a short
  delay. Set `min_machines_running = 1` in `fly.toml` for always-on.
- The image runs as root so the first boot can initialize the fresh volume; a
  non-root user with a volume init step is a listed hardening follow-up.
- Once the Vercel frontend calls this API, add the `https://jisr-api.fly.dev` origin
  to the CSP `connect-src` in jisr-web's `vercel.json`.
