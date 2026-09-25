# ResearchAI

ResearchAI is a provenance-first academic research workspace. It turns a private project corpus into searchable evidence, structured cross-paper intelligence, grounded drafts, inspectable citations, and deterministic quality observations.

The core design constraint is simple: claims produced or derived by the application must remain traceable to authorized evidence. ResearchAI abstains when that evidence is unavailable or insufficient; it is not an unrestricted essay generator or a universal fact checker.

## Core workflow

1. Create a project and upload PDFs or link papers from the private library.
2. Persistent workers extract text, detect sections, build chunks, and generate Voyage embeddings.
3. Search and ask corpus-grounded questions with citations to paper sections and pages.
4. Extract structured paper evidence into the Evidence Matrix.
5. Explore deterministic Research Map relationships and potential corpus-relative research gaps.
6. Generate short citation-grounded academic drafts and inspect their source provenance.
7. Check whether each cited evidence item supports a generated statement.
8. Review deterministic workspace and draft observations in the Research Quality Inspector.

## Major features

### Projects, papers, and semantic retrieval

- Supabase authentication with email/password, password reset, and Google OAuth.
- User-owned projects, a reusable PDF library, and project-paper linking.
- Private storage, background PDF processing, section detection, bounded chunks, page metadata, and retryable job handling.
- Current-generation Voyage embeddings and project-scoped pgvector semantic retrieval.

### Research Chat

Research Chat performs project-aware retrieval-augmented question answering. The server selects current chunks, assigns deterministic evidence IDs, requests strict structured output from OpenRouter, and validates every returned citation before display. Invalid or unsupported output fails closed, while citations open the underlying paper provenance.

Chat is currently single-turn and stateless. It answers only from retrieved project evidence.

### Academic intelligence

- **Evidence Matrix:** source-backed extraction of objectives, methodologies, datasets, findings, limitations, future work, and concepts. It tracks current, partial, failed, and stale states and preserves claim-level provenance.
- **Research Map:** deterministic shared-concept, methodology, dataset, finding, and direct paper-relationship derivation from validated Matrix data.
- **Research Gap Explorer:** conservative, deterministic claim-signature matching for recurring limitations and future-research opportunities. Results are potential gaps in the current corpus, never claims about all literature.

### Academic writing and verification

- **Citation-Grounded Academic Writer:** five bounded modes for literature synthesis, study comparison, methodology summary, findings synthesis, and limitations/future-work synthesis. Evidence is authorized and selected server-side; generated units must cite valid evidence or the entire draft is rejected.
- **Claim Checker:** evaluates one Writer statement against exactly its cited evidence as supported, partially supported, unsupported, or insufficiently supported. This measures evidence support, not universal truth.
- **Citation and reference handling:** paper-level numeric citations, deterministic reference formatting, editable bibliographic metadata, and evidence-level provenance beneath each visible reference.
- **Research Quality Inspector:** deterministic workspace and draft findings for processing/search coverage, Evidence Matrix state, citation completeness, unchecked or weakly supported draft units, and evidence concentration. It does not assign a quality score.

## Grounding architecture

```text
Browser workspace
  -> authenticated TanStack server functions
  -> Supabase Auth / Postgres RLS / private Storage
  -> semantic retrieval or current Evidence Matrix claims
  -> bounded, sanitized evidence packet
  -> one strict structured OpenRouter call where required
  -> runtime schema and provenance/citation validation
  -> inspectable source UI

Railway workers
  -> fenced PDF-processing and embedding jobs
  -> fenced Evidence Matrix extraction jobs
  -> Supabase using a worker-only service-role credential
```

Research Map, Research Gap Explorer, citation formatting, and Research Quality Inspector rules are deterministic. Research Chat, Evidence Matrix extraction, Academic Writer generation, and Claim Checker assessment are LLM-backed but validated and provenance-constrained.

## Technology stack

- **Web:** React 19, TypeScript, TanStack Start, TanStack Router, TanStack Query
- **UI:** Tailwind CSS, shadcn/Radix primitives, Lucide, XYFlow
- **Data:** Supabase Auth, PostgreSQL, Row Level Security, private Storage, pgvector
- **Documents:** PDF.js plus custom section and chunk processing
- **Embeddings:** Voyage `voyage-4`, 1,024 dimensions
- **LLM:** OpenRouter structured output; current configuration uses `openrouter/free`
- **Hosting:** Vercel web application, Railway persistent workers, Supabase managed services
- **Quality:** Zod, Vitest, ESLint, Prettier, TypeScript

## Production deployment

- **Vercel** hosts the SSR web application and authenticated server functions.
- **Supabase** provides authentication, PostgreSQL/RLS, private PDF storage, pgvector, and fenced job state.
- **Railway** runs two persistent Node processes: PDF processing plus embeddings, and Evidence Matrix extraction.
- **Voyage** generates document and search-query embeddings.
- **OpenRouter** serves the grounded LLM features without exposing provider credentials to the browser.

## Local development

### Prerequisites

- Node.js and npm
- A Supabase project
- Voyage and OpenRouter credentials

### Install and configure

```bash
npm install
cp .env.example .env.local
cp .env.worker.example .env.worker
```

Application variables (`.env.local`):

```dotenv
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-publishable-key
OPENROUTER_API_KEY=your-openrouter-key
LLM_MODEL=openrouter/free
LLM_STRUCTURED_MODE=json_schema
EMBEDDING_API_KEY=your-voyage-key
```

`EMBEDDING_API_KEY` is required by the Vercel server runtime for semantic query embeddings. `OPENROUTER_API_KEY`, `LLM_MODEL`, and `LLM_STRUCTURED_MODE` are server-only despite being stored alongside the public `VITE_` settings.

Worker variables (`.env.worker`):

```dotenv
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
EMBEDDING_API_KEY=your-voyage-key
EMBEDDING_STAGE_ENABLED=true
OPENROUTER_API_KEY=your-openrouter-key
LLM_MODEL=openrouter/free
LLM_STRUCTURED_MODE=json_schema
```

Never expose the service-role or provider keys through a `VITE_` variable. Real environment files are gitignored.

### Database

Apply `supabase/migrations/` in numeric order. The current latest migration is:

```text
0012_citation_metadata.sql
```

It adds user-maintained citation metadata without invalidating processing, embeddings, Matrix evidence, or provenance.

### Start the application and workers

```bash
npm run dev

# Persistent PDF processing + Voyage embedding process
npm run worker:local

# Persistent Evidence Matrix extraction process
npm run worker:evidence:local
```

Production worker processes use `npm run worker` and `npm run worker:evidence`, with environment variables injected by the host. See `WORKER_DEPLOYMENT.md` and `Dockerfile.worker`.

## Security and privacy highlights

- Application access is scoped through authenticated, request-scoped Supabase clients and RLS.
- The service-role key is worker-only and is never required by the browser or Vercel web application.
- Browser requests cannot supply user identity, evidence contents, prompts, retrieval limits, or provider options as authority.
- PDFs, metadata, claims, and user instructions are treated as untrusted content and sanitized at prompt boundaries.
- Structured output, citation IDs, evidence locators, project membership, currentness, and provenance are revalidated server-side.
- Provider errors and diagnostics omit prompts, paper text, raw responses, credentials, and user/project identifiers.
- Citation metadata is formatted deterministically; the LLM cannot invent bibliographic identity.

## AI usage allowances

Monthly AI allowances are configured in `ai_allowance_profiles`; users inherit the
`default` profile unless a future administrative workflow assigns another profile.
Enforcement uses the authenticated actor's append-only `usage_events`, never project
ownership or browser state. Successful provider responses consume one request. Failed
provider calls do not consume a request, while any real token counts reported for a
failed call are retained and count toward the token allowance. Missing token metadata
stays unknown and is never estimated.

The allowance is checked immediately before each LLM provider call. Since final output
tokens are unknowable before generation, a call that starts below the token limit can
finish slightly above it; the recorded actual usage then blocks subsequent calls until
the next UTC monthly boundary. No scheduled reset job is required.

## Known limitations

- Research Chat is single-turn and stateless.
- Writer drafts and Claim Checker assessments are ephemeral and are not autosaved.
- Claim Checker assesses only the supplied cited evidence; it is not a web-enabled fact checker.
- Research Gap Explorer is deliberately conservative and corpus-relative.
- Bibliographic metadata may require manual completion; ResearchAI does not fabricate missing fields or perform external metadata lookup.
- `openrouter/free` routing can be intermittently unavailable; failures are surfaced safely without automatic model fallback.
- Background processing depends on the two persistent worker services being healthy.
- The Comparisons workspace remains a placeholder; comparison writing is available through Academic Writer.

## Validation

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
git diff --check
```

## Repository layout

```text
src/features/          Product domains and UI
src/lib/               Supabase, embedding, and structured-LLM infrastructure
src/routes/            TanStack file-based routes and document shell
worker/                PDF, embedding, and Evidence Matrix workers
supabase/migrations/   Ordered schema, RLS, job, vector, and citation migrations
supabase/verification/ SQL verification scripts
```

ResearchAI supports research judgment with transparent, corpus-grounded evidence. It does not replace reading the source papers.
