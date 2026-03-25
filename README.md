# BUMN Master System Backend

Express + Better Auth + Drizzle ORM (SQLite) backend.

## Quick Start
1. Copy env file:
   - `cp .env.example .env`
   - Fill `OPENAI_API_KEY` and `OPENAI_MODEL` for AI generation.
2. Install dependencies:
   - `npm install`
3. Run dev server:
   - `npm run dev`

Server runs at `http://localhost:8080` by default.

## Endpoints
- `GET /api/health` basic health check.
- `POST/GET /api/auth/*` handled by Better Auth.

## Notes
- We will add schema and endpoints step-by-step.
- Better Auth tables are handled by the adapter.
