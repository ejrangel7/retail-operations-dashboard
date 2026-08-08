# Retail Operations Dashboard

A portfolio-grade full-stack dashboard for monitoring retail orders, revenue, products, and inventory risk. It connects Edward Rangel's real-world background in software engineering, e-commerce, and retail operations with a modern TypeScript stack.

> All names, orders, products, and financial values in this repository are fictional demonstration data.

## Why this project

This project is designed to demonstrate more than isolated framework knowledge. It models a practical business workflow and shows how a frontend, API, database, container environment, and technical documentation fit together.

## Current MVP

- Executive summary for revenue, orders, products, and low-stock items
- Recent-order monitoring with fulfillment statuses
- Inventory watch list with reorder indicators
- REST API backed by PostgreSQL
- Responsive React interface
- Reproducible local environment with Docker Compose
- Seeded, fictional retail data

## Tech stack

- **Frontend:** React, TypeScript, Vite, responsive CSS
- **Backend:** Node.js, Express, TypeScript
- **Database:** PostgreSQL
- **Infrastructure:** Docker, Docker Compose, Nginx
- **Package management:** pnpm workspaces

## Architecture

```text
Browser
  │
  ▼
React + TypeScript frontend
  │  REST/JSON
  ▼
Express + TypeScript API
  │  SQL
  ▼
PostgreSQL
```

## Run with Docker

### Prerequisites

- Docker Desktop or Docker Engine with Docker Compose

### Start the complete application

```bash
docker compose up --build
```

Then open:

- Dashboard: `http://localhost:8080`
- API health check: `http://localhost:4000/api/health`

Stop the environment with:

```bash
docker compose down
```

## Run for development

### Prerequisites

- Node.js 22+
- pnpm
- PostgreSQL 16+

```bash
pnpm install
pnpm dev
```

The frontend runs on `http://localhost:5173` and the API on `http://localhost:4000`.

## Repository structure

```text
retail-operations-dashboard/
├── apps/
│   ├── api/          # Express REST API
│   └── web/          # React dashboard
├── database/         # PostgreSQL schema and demo seed data
├── docker-compose.yml
└── README.md
```

## API endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health` | API and database health |
| GET | `/api/dashboard` | Summary metrics |
| GET | `/api/products` | Filtered and paginated inventory data |
| GET | `/api/orders` | Filtered and paginated orders |

### Collection query parameters

- Both collection endpoints accept `page`, `pageSize` (maximum 100), and `search`.
- Orders accept `status=processing|shipped|delivered`.
- Products accept `stock=low|in-stock`.
- Collection responses include `items` plus page, page size, total results, and total pages.

## Roadmap

- [x] Full-stack project foundation
- [x] Dashboard, product, and order read models
- [x] PostgreSQL schema and fictional seed data
- [x] Docker Compose environment
- [x] Server-side filtering and pagination
- [ ] Create and update order workflows
- [ ] Authentication and role-based access
- [x] Unit and integration tests
- [x] GitHub Actions continuous integration
- [ ] Accessible charts and reporting
- [ ] Low-cost or zero-cost deployment evaluation

## Data and privacy

This repository does not contain customer information, store credentials, private business data, or production integrations. It is an independent portfolio project built with fictional data.

## Author

[Edward Rangel](https://github.com/ejrangel7) — Senior Full Stack Software Engineer

