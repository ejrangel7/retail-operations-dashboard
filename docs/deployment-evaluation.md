# Production deployment and zero-cost evaluation

_Last reviewed: August 11, 2026._

## Current status

The public portfolio deployment is active at [retail-operations-dashboard.onrender.com](https://retail-operations-dashboard.onrender.com):

- one Render Free web service built from the repository root `Dockerfile`
- one Neon Free PostgreSQL database containing fictional demonstration data
- GitHub Actions validation for pull requests and pushes to `main`
- automatic Render deployment after the checks on `main` pass
- `/api/health` as the Render health check

The checked-in `render.yaml` is the reproducible Blueprint specification and the source of truth for intended settings. The existing Render service must remain manually aligned with it when settings change. Secrets and provider-owned identifiers are intentionally not stored in the repository.

## Why this architecture

The production image compiles React with `VITE_API_URL=/api`, serves the static application from Express, and exposes the API from the same origin. A single process avoids operating separate frontend and API services and keeps session cookies same-origin.

On startup, the container executes the idempotent `database/init.sql` file. This creates the schema and fictional demo records when the database is empty, safely rechecks them after a cold start, deletes any legacy known operator account, and seeds only the public viewer. The separate local operator credential seed is copied only into the Docker Compose development target. Test files that exercise the known local credentials are also excluded from the compiled production artifact.

The root `render.yaml` declares:

- `runtime: docker`
- `plan: free`
- deployment only after repository checks pass
- `/api/health` as the health check
- `DATABASE_URL` as an unversioned secret
- secure cookies for Render HTTPS
- no known operator credential in the production seed or image
- disabled operator login for the public demo as a second defensive layer
- one trusted proxy hop for Render

## Deployment flow

1. Open a pull request against `main`.
2. GitHub Actions runs `pnpm verify` and builds the production Docker image.
3. Review and merge only after the pull-request check passes.
4. GitHub Actions repeats the validation for the resulting `main` commit.
5. Render deploys after the `main` check passes and accepts the release only when `/api/health` succeeds.
6. Run the production verification checklist below.

This repeats the same repository-owned verification locally and in CI; it does not maintain separate validation logic.

## Current free-tier facts

### Render Free web service

Render documents 750 free instance hours per workspace each calendar month. A free web service spins down after 15 minutes without inbound traffic and can take about one minute to start again. Its filesystem is ephemeral, so PostgreSQL must remain external. Render also warns that included bandwidth and build minutes have limits; without a payment method, services or builds are suspended instead of generating supplementary charges.

Render Free is explicitly intended for hobby projects and previews, not production workloads with availability requirements.

Official sources:

- [Render free services and limits](https://render.com/docs/free)
- [Render Docker deployments](https://render.com/docs/docker)
- [Render Blueprint specification](https://render.com/docs/blueprint-spec)
- [Render health checks](https://render.com/docs/health-checks)

### Neon Free PostgreSQL

Neon lists its Free plan at $0 with no credit card required, 100 compute-unit hours per project each month, 0.5 GB storage per project, and scale-to-zero after inactivity. The connection string must use TLS; copy the pooled connection string supplied by Neon, including `sslmode=require` and its current channel-binding setting.

Official sources:

- [Neon pricing](https://neon.com/pricing)
- [Neon connection security](https://neon.com/docs/security/security-overview)
- [Neon connection guidance](https://neon.com/docs/connect/connection-errors)

## Alternatives considered

| Option | Result | Reason |
| --- | --- | --- |
| Render web + Render Postgres | Rejected | Render's free PostgreSQL expires after 30 days. |
| Separate Render static site + API | Rejected | More services and cross-origin configuration for no portfolio benefit. |
| Vercel Hobby + Neon | Not selected | Requires adapting Express to serverless functions, and Hobby is restricted to personal, non-commercial use. |
| Cloudflare Pages/Workers + Neon | Not selected | Requires a material Express/runtime rewrite; Workers Paid starts at a monthly minimum if Free limits are insufficient. |
| Local Docker only | Retained | Best development environment, but it does not provide a public portfolio URL. |

Official alternative references:

- [Vercel Hobby plan](https://vercel.com/docs/plans/hobby)
- [Vercel fair-use guidelines](https://vercel.com/docs/limits/fair-use-guidelines)
- [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)

## Cost guardrails

1. Select only the Render `Free` instance shown in the Blueprint.
2. Do not add a payment method to Render for this demo.
3. Create only a Neon `Free` project and do not enable a paid plan.
4. Use the generated `onrender.com` address; a custom domain is outside this evaluation.
5. Keep all data fictional and disposable.
6. Review provider limits again immediately before any real deployment because pricing can change.
7. Stop and request explicit authorization before enabling any paid feature.

## Production verification checklist

1. Confirm the GitHub Actions run for the merged `main` commit succeeded.
2. Confirm `GET https://retail-operations-dashboard.onrender.com/api/health` returns HTTP 200 and `{"status":"ok"}`.
3. Confirm the response includes production security headers such as CSP, HSTS, `X-Content-Type-Options`, and `X-Frame-Options`, without `X-Powered-By`.
4. Confirm the viewer can sign in, read dashboard data, filter and paginate collections, view charts, and export CSV.
5. Confirm the known local operator credentials receive HTTP 401 in production and order mutations remain blocked.
6. Confirm no real customer, order, credential, or financial data was introduced.

## Changes requiring explicit authorization

The existing deployment may receive application updates through the reviewed `main` workflow. Stop and request explicit user authorization before:

- creating, deleting, or replacing a Render or Neon resource
- changing either provider away from its Free plan
- adding a payment method, custom domain, paid add-on, or paid monitoring service
- rotating or replacing production secrets unless the user explicitly requests that maintenance
- importing non-fictional or sensitive data

No repository change is permission to incur charges.

## Local production-image validation

Build the same root image Render will build:

```bash
docker build -t retail-operations-dashboard:production .
```

Run it against an accessible PostgreSQL database:

```bash
docker run --rm -p 10000:10000 \
  -e DATABASE_URL="postgresql://user:password@host/database" \
  -e COOKIE_SECURE=false \
  retail-operations-dashboard:production
```

Then open `http://localhost:10000` and verify `http://localhost:10000/api/health`.
