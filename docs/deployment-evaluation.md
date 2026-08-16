# Production deployment and zero-cost evaluation

_Last reviewed: August 16, 2026._

## Current status

The public portfolio deployment is active at [retail-operations-dashboard.onrender.com](https://retail-operations-dashboard.onrender.com):

- one Render Free web service built from the repository root `Dockerfile`
- one Neon Free PostgreSQL database containing fictional demonstration data
- GitHub Actions validation for pull requests and pushes to `main`
- immutable SHA-pinned Actions and scheduled Dependabot checks for npm, Docker, and workflows
- structured security events in the existing Render log stream, with process-scoped identifier fingerprints
- automatic Render deployment after the checks on `main` pass
- `/api/health` as the Render health check

The checked-in `render.yaml` is the reproducible Blueprint specification and the source of truth for intended settings. The existing Render service must remain manually aligned with it when settings change. Secrets and provider-owned identifiers are intentionally not stored in the repository.

## Why this architecture

The production image compiles React with `VITE_API_URL=/api`, serves the static application from Express, and exposes the API from the same origin. A single process avoids operating separate frontend and API services and keeps session cookies same-origin.

The web container starts only the Express process and never executes schema or seed SQL. Versioned migrations run through an explicit owner-only command and are tracked by filename and checksum in PostgreSQL. Docker Compose models this separation with a one-shot `database-setup` service before the API starts. The local operator credential remains exclusive to the development image, and test files that exercise it remain excluded from the compiled production artifact.

Production uses two security boundaries: an owner connection for explicit migrations and a restricted runtime connection for the web process. The runtime role can read dashboard data and maintain login sessions but receives neither DDL privileges nor order mutation privileges. Render stores only the restricted `DATABASE_URL`; the owner-only `MIGRATION_DATABASE_URL` must remain outside the web service.

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
3. Review the PR after its checks pass, but do not merge a database-changing release yet.
4. If the PR contains a new migration, apply that reviewed backward-compatible migration from a trusted terminal with the owner connection.
5. Merge the PR after the migration succeeds.
6. GitHub Actions repeats the validation for the resulting `main` commit.
7. Render deploys after the `main` check passes and accepts the release only when `/api/health` succeeds.
8. Run the production verification checklist below.

This repeats the same repository-owned verification locally and in CI; it does not maintain separate validation logic.

## Current free-tier facts

### Render Free web service

Render documents 750 free instance hours per workspace each calendar month. A free web service spins down after 15 minutes without inbound traffic and can take about one minute to start again. Its filesystem is ephemeral, so PostgreSQL must remain external. Render also warns that included bandwidth and build minutes have limits; without a payment method, services or builds are suspended instead of generating supplementary charges.

Render Free is explicitly intended for hobby projects and previews, not production workloads with availability requirements.

Render documents pre-deploy commands as a paid-web-service feature. This Free deployment therefore keeps migrations as an explicit release command instead of coupling them to web-process startup. No additional Render service or paid feature is required.

Official sources:

- [Render free services and limits](https://render.com/docs/free)
- [Render deploy lifecycle and pre-deploy availability](https://render.com/docs/deploys)
- [Render Docker deployments](https://render.com/docs/docker)
- [Render Blueprint specification](https://render.com/docs/blueprint-spec)
- [Render health checks](https://render.com/docs/health-checks)

### Neon Free PostgreSQL

Neon lists its Free plan at $0 with no credit card required, 100 compute-unit hours per project each month, 0.5 GB storage per project, and scale-to-zero after inactivity. The connection string must use TLS; copy the pooled connection string supplied by Neon, including `sslmode=require` and its current channel-binding setting.

Official sources:

- [Neon pricing](https://neon.com/pricing)
- [Neon PostgreSQL role compatibility](https://neon.com/docs/reference/compatibility)
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
2. For a database-changing release, confirm the reviewed migration completed before the merge and appears in `schema_migrations`.
3. Confirm `GET https://retail-operations-dashboard.onrender.com/api/health` returns HTTP 200 and `{"status":"ok"}`.
4. Confirm the response includes production security headers such as CSP, HSTS, `X-Content-Type-Options`, and `X-Frame-Options`, without `X-Powered-By`.
5. Confirm the viewer can sign in, read dashboard data, filter and paginate collections, view charts, and export CSV.
6. Confirm the known local operator credentials receive HTTP 401 in production and order mutations remain blocked.
7. Confirm blocked authentication or rate-limit activity appears as JSON with `"category":"security"` and does not expose raw credentials, tokens, email addresses, or client addresses.
8. Confirm no real customer, order, credential, or financial data was introduced.

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
  -e DATABASE_URL="postgresql://restricted-user:password@host/database" \
  -e COOKIE_SECURE=false \
  retail-operations-dashboard:production
```

Then open `http://localhost:10000` and verify `http://localhost:10000/api/health`.
