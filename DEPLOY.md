# Deploying jisr-api (Railway)

Node 24 HTTP server backed by SQLite. The transfer journal in SQLite is the source
of truth (the downtime drill proved it survives restarts), so the database lives on
a Railway **volume** mounted at `/data`, which persists across deploys and restarts.

## What lives where

- `Dockerfile` — node:24-slim, prod deps, runs the same checks as CI. Binds
  `HOST=0.0.0.0:8080`, database at `DATABASE_PATH=/data/transfers.sqlite`.
- `railway.json` — Dockerfile builder, `/healthz` health check, restart policy.

## One-time setup (CLI)

```bash
railway login --browserless      # opens a verification link
railway init                     # create project "jisr-api"
railway volume add --mount-path /data
railway variables set SERVICE_TOKEN=$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")
railway variables set WALLET_AUTH_ORIGIN=https://jisr-pay.vercel.app
railway variables set HORIZON_URL=https://horizon-testnet.stellar.org
railway up                       # build + deploy from this directory
railway domain                   # generates https://<app>.up.railway.app
```

`SERVICE_TOKEN` generation command is the one from `.env.example`. `WALLET_AUTH_ORIGIN`
must be the exact browser origin (scheme + host, no path) the wallet UI runs on;
sessions from any other origin are rejected.

## Continuous deployment

In the Railway dashboard: Service → Settings → Source → connect the
`jisr-pay/jisr-api` GitHub repo, branch `main`. Every merge to `main` then
builds and deploys automatically; `railway.json` governs the deploy.

## Verify

```bash
railway status
curl https://<app>.up.railway.app/healthz   # {"status":"ok","network":"TESTNET"}
```

## Notes

- `HORIZON_URL` points at Stellar Testnet; mainnet is a separate, explicit decision.
- The image runs as root so the first boot can initialize the fresh volume; a
  non-root user with a volume init step is a listed hardening follow-up.
- Once the Vercel frontend calls this API, add the API origin to the CSP
  `connect-src` in jisr-web's `vercel.json`.
