# Production workers

ResearchAI requires two persistent Node processes. They poll Supabase for fenced jobs;
they do not expose HTTP endpoints. Configure process-level health/restart checks on the
hosting platform.

## PDF processing and embeddings

Start command:

```bash
npm run worker
```

Required environment:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `EMBEDDING_API_KEY`
- `EMBEDDING_STAGE_ENABLED=true`

The continuous process handles PDF jobs and interleaves Voyage embedding work. It
fails at startup if embedding is disabled or required configuration is missing.

## Evidence Matrix

Start command:

```bash
npm run worker:evidence
```

Required environment:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENROUTER_API_KEY`
- `LLM_MODEL=openrouter/free`
- `LLM_STRUCTURED_MODE=json_schema` (optional; this is the default)

## Deployment

`Dockerfile.worker` builds one production image for either process. Its default command
starts PDF processing and embeddings; override the command with
`npm run worker:evidence` for the second service. A platform may also deploy directly
from the repository with the same two start commands.

For local development, `npm run worker:local` and
`npm run worker:evidence:local` load the gitignored `.env.worker` file. Production
commands read only the hosting platform's injected process environment.

Both workers remain alive while polling, handle `SIGTERM`/`SIGINT`, and rely on database
claim fencing and stale-job recovery if a host terminates during work. No HTTP health
server is required; use process liveness and automatic restart behavior.

The Supabase service-role key bypasses RLS. Store it only in the worker host's secret
manager. Never expose it to the browser, prefix it with `VITE_`, place it in Vercel's web
application environment, bake it into an image, or commit `.env.worker`.
