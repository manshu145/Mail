# NexiMail

Production-ready, self-hosted email marketing and campaign management control plane.

> Your contacts. Your infrastructure. Your sending rules. Your data.

## Phase 1 status

This repository currently contains the Phase 1 foundation:

- Next.js 16 + React + TypeScript
- PostgreSQL with Drizzle ORM
- Redis
- Secure cookie-based admin auth foundation
- Owner/Admin/Operator roles
- Docker Compose for app + Postgres + Redis
- App/API health checks
- Initial login and dashboard shell

## Local development

1. Copy `.env.example` to `.env`.
2. Set `AUTH_SECRET` to a long random value.
3. Start PostgreSQL and Redis:

```bash
docker compose up -d postgres redis
```

4. Install dependencies and run migrations:

```bash
npm install
npm run db:generate
npm run db:migrate
npm run dev
```

Open `http://localhost:3000`.

## Full stack in Docker

```bash
docker compose up --build
```

## Important architecture rule

Web requests will never send large campaigns directly. Campaign delivery will be implemented in later phases through persistent background workers and Postfix.

## Roadmap

Development follows the NexiMail MVP specification phase-by-phase. Phase 2 is Contacts + Lists + Import + Suppression.
