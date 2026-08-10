# Zero-cost deployment evaluation

_Last reviewed: August 10, 2026._

## Decision

Use one Render Free web service built from the repository root `Dockerfile`, connected to one Neon Free PostgreSQL project.

This is a deployment-ready recommendation only. No external account, database, web service, domain, payment method, or billable resource is created by this repository.

## Why this architecture

The production image compiles React with `VITE_API_URL=/api`, serves the static application from Express, and exposes the API from the same origin. A single process avoids operating separate frontend and API services and keeps session cookies same-origin.

On startup, the container executes the idempotent `database/init.sql` file. This creates the schema and fictional demo records when the database is empty and safely rechecks them after a cold start.

The root `render.yaml` explicitly declares:

- `runtime: docker`
- `plan: free`
- deployment only after repository checks pass
- `/api/health` as the health check
- `DATABASE_URL` as an unversioned secret
- secure cookies for Render HTTPS

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

## Deployment steps requiring user authorization

1. Create a Neon Free project and copy its pooled TLS connection string.
2. In Render, create a Blueprint from this repository.
3. Confirm that the proposed service shows `Free`, not `Starter` or another paid plan.
4. Enter the Neon connection string when Render prompts for `DATABASE_URL`.
5. Deploy and verify `/api/health`, operator login, viewer read-only access, and CSV export.

These steps mutate external services and are intentionally not automated or executed without explicit approval.

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
