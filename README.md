# ResearchAI

ResearchAI is a provenance-first workspace for organizing research papers and turning a project corpus into inspectable research intelligence. It helps researchers move from uploaded PDFs to semantic search, grounded question answering, structured evidence, cross-paper relationships, and conservative potential-gap discovery without losing the connection to the underlying sources.

The project is designed around a simple constraint: generated or derived research claims should be traceable to evidence in papers the user owns. ResearchAI is not an unrestricted essay generator, and its gap explorer does not claim to prove universal gaps in the literature.

## Why it exists

Literature review work often involves several disconnected steps: storing papers, finding relevant passages, comparing methods and findings, tracing claims back to pages, and identifying patterns across a corpus. General-purpose chat tools can accelerate parts of that process, but they can also obscure provenance or answer beyond the available evidence.

ResearchAI brings those steps into one project-scoped workflow and favors explicit abstention when the corpus cannot support a result.

## Current workflow

1. Create a research project and add PDF papers from the library or by upload.
2. Process PDFs into normalized sections and bounded chunks with page metadata.
3. Generate current-generation chunk embeddings for project-scoped semantic retrieval.
4. Ask questions in **Research Chat** and inspect the cited supporting passages.
5. Request **Evidence Matrix** extraction for structured objectives, methodologies, datasets, findings, limitations, future work, and concepts.
6. Explore shared concepts, methodologies, datasets, and paper findings in the **Research Map**.
7. Review conservatively derived **Research Gap Explorer** candidates and open their supporting claims and provenance.
8. Use the in-progress Citation-Grounded Writer foundation to prepare authorized, bounded evidence packets for future grounded drafting.

## Implemented features

### Projects, library, and paper processing

- Email/password and Google authentication flows.
- User-owned projects and a reusable paper library with many-to-many project assignment.
- Private PDF storage with ownership-constrained paths.
- Background PDF parsing, section detection, chunking, page tracking, retry handling, and processing status.
- Current-generation embedding jobs and project-aware semantic search over non-reference content.

### Research Chat

Research Chat is a project-aware retrieval-augmented question-answering experience. It:

- retrieves relevant current-generation chunks within the authorized scope;
- packages bounded evidence with deterministic citation identifiers;
- requests structured output from OpenRouter through a server-only provider;
- validates the response and citation identifiers before display;
- links citations back to paper, section, and page context; and
- returns a grounded no-evidence state instead of generating an unsupported answer.

Chat is currently single-turn and stateless. It is intentionally constrained to the retrieved project evidence.

### Evidence Matrix

The Evidence Matrix extracts and compares seven fixed fields across processed papers:

- objective
- methodology
- dataset
- findings
- limitations
- future work
- concepts

Extraction uses bounded, section-aware evidence packets and strict structured output. Persisted claims retain source records so users can inspect supporting excerpts and live chunk provenance. The UI distinguishes pending, running, partial, failed, current, and stale extraction states; extraction is explicitly requested rather than triggered by downstream views.

### Research Map

The Research Map is derived deterministically from persisted Evidence Matrix data. It surfaces:

- shared concepts;
- shared methodologies;
- shared datasets;
- paper-level findings; and
- direct, typed relationships between papers and shared terms.

It provides a responsive visual graph and structured index, filters, stale-state visibility, and lazy evidence sheets. Map relationships are explainable data structures, not LLM-generated interpretations.

### Research Gap Explorer

The Research Gap Explorer identifies **potential gaps in the current corpus**, not definitive gaps in all published research. Its deterministic claim-signature engine currently supports conservative recurring-limitation and future-research-opportunity matching using:

- direct Research Map relatedness;
- explicit, versioned action and target vocabularies;
- evidence from at least two distinct papers;
- deterministic identifiers and ordering; and
- preserved Evidence Matrix provenance.

Methodology gaps, dataset-coverage gaps, and finding tensions remain deliberately conservative and abstain unless existing rules provide sufficient support. Candidate details show participating papers, related map terms, current/stale state, matching signals, and lazily loaded source evidence.

### Citation-Grounded Writer — in progress

The Writer architecture and deterministic evidence/retrieval foundation are implemented. The server-side foundation currently provides:

- strict requests for literature synthesis, study comparison, methodology summary, findings synthesis, and limitations/future-work synthesis;
- authenticated, RLS-scoped project and paper loading;
- semantic-chunk or Evidence Matrix evidence selection according to mode;
- source-backed claim filtering and stale-evidence exclusion;
- deterministic deduplication, paper diversity, ordering, and `W1...Wn` evidence IDs;
- bounded evidence packets with sanitization against control characters, prompt delimiters, and citation-ID spoofing; and
- typed `ready`, `no_evidence`, `insufficient_evidence`, and `stale_only` outcomes.

**Not yet implemented:** Writer LLM generation, post-generation citation validation, draft persistence/editing, and the Writer UI. The workspace currently shows a Writing placeholder; ResearchAI does not yet present generated drafts as a completed feature.

## Architecture overview

```text
Authenticated React workspace
        │
        ├── Supabase Auth, Postgres/RLS, private Storage
        │       ├── projects and paper links
        │       ├── processing sections/chunks
        │       ├── embedding/search state
        │       └── Evidence Matrix claims and provenance
        │
        ├── Local/server-side workers
        │       ├── PDF processing
        │       ├── Voyage embedding/indexing
        │       └── Evidence Matrix extraction
        │
        ├── Authenticated server functions
        │       ├── semantic search
        │       ├── grounded Research Chat
        │       └── Writer evidence preparation
        │
        └── Deterministic client-side intelligence
                ├── Research Map
                └── Research Gap Explorer
```

PDF processing and extraction are asynchronous. Research Map and Research Gap candidates reuse already-loaded Evidence Matrix data and derive their views without creating a second persistence layer. Detailed source records are loaded lazily when evidence is opened.

## Technology stack

- **Application:** React 19, TypeScript, TanStack Start, TanStack Router, TanStack Query
- **UI:** Tailwind CSS, shadcn/Radix UI primitives, Lucide icons, XYFlow
- **Backend:** Supabase Auth, PostgreSQL, Row Level Security, private Storage, database functions
- **Document processing:** PDF.js, custom section detection and chunking workers
- **Semantic retrieval:** Voyage AI `voyage-4`, 1,024-dimensional vectors, pgvector-backed search
- **Structured LLM work:** OpenRouter with a server-configured model and strict JSON Schema support
- **Validation and testing:** Zod, Vitest, ESLint, Prettier

## Grounding and security principles

- Browser requests never supply ownership identity, evidence contents, retrieval limits, provider configuration, or prompts.
- Authenticated application reads are scoped through Supabase RLS.
- The Supabase service-role key is restricted to local/server-side workers and must never use a `VITE_` prefix.
- OpenRouter and Voyage credentials remain server-side and are not returned in errors or logs.
- Paper text, extracted claims, metadata, and user focus are treated as untrusted content.
- Structured model outputs and citation IDs are validated before grounded Chat results are displayed.
- Evidence Matrix, Research Map, Research Gaps, and Writer evidence retain explicit paper/field/item or chunk provenance.
- Stale processing generations are identified rather than silently treated as current.
- ResearchAI abstains when evidence is missing, malformed, stale-only, or insufficiently diverse.

## Local setup

### Prerequisites

- Node.js and npm
- A Supabase project
- OpenRouter credentials and a configured model for Research Chat and Evidence Matrix extraction
- Voyage AI credentials for embeddings

### 1. Install dependencies

```bash
npm install
```

### 2. Configure Supabase

Apply the SQL migrations in `supabase/migrations/` in numeric order. They create the application tables, private `papers` storage bucket, RLS policies, worker claim functions, vector/search infrastructure, and Evidence Matrix persistence.

Copy the browser/server application template:

```bash
cp .env.example .env.local
```

Set the public Supabase URL and anon key, plus the server-only OpenRouter settings described in the template. Never place a service-role or provider secret in a `VITE_` variable.

### 3. Configure workers

```bash
cp .env.worker.example .env.worker
```

Set the server-only Supabase service-role key, Voyage key, and—when running evidence extraction—the OpenRouter settings documented in the template. These files are gitignored; do not commit real credentials.

### 4. Start the application

```bash
npm run dev
```

The development server runs on `http://localhost:3000`.

### 5. Run background stages as needed

```bash
# Process uploaded PDFs continuously
npm run worker

# Preview or index one ready paper
npm run embedding:index:dry -- <paper-id>
npm run embedding:index -- <paper-id>

# Process explicitly requested Evidence Matrix extractions
npm run worker:evidence
```

The worker scripts also provide `:once` and `:drain` variants where listed in `package.json`. Continuous embedding scheduling is opt-in through the worker configuration documented in `.env.worker.example`.

## Quality checks

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
npm run check
```

## Project status and roadmap

| Area                                                    | Status                            |
| ------------------------------------------------------- | --------------------------------- |
| Authentication, projects, library, PDF ingestion        | Implemented                       |
| PDF processing, sections, chunks, and retryable workers | Implemented                       |
| Embeddings and semantic retrieval                       | Implemented                       |
| Citation-grounded Research Chat                         | Implemented                       |
| Evidence Matrix extraction and provenance UI            | Implemented                       |
| Deterministic Research Map                              | Implemented                       |
| Deterministic Research Gap Explorer                     | Implemented                       |
| Writer architecture and evidence/retrieval foundation   | Implemented                       |
| Writer structured generation and citation validation    | Planned / not yet implemented     |
| Writer UI and draft workflow                            | Planned / not yet implemented     |
| Comparisons workspace                                   | Placeholder / not yet implemented |

Near-term work centers on completing the Citation-Grounded Writer without weakening the existing grounding boundary: structured sentence- or claim-level generation, fail-closed citation validation, inspectable provenance, and a responsive Writer workspace.

## Repository layout

```text
src/features/          Feature modules for papers, chat, evidence, maps, gaps, and Writer foundations
src/lib/               Shared Supabase, embedding, and structured-LLM infrastructure
src/routes/            TanStack file-based routes
worker/                PDF, embedding, and Evidence Matrix workers
supabase/migrations/   Ordered database and RLS migrations
supabase/verification/ SQL verification scripts for data/security invariants
```

---

ResearchAI is under active development. Current intelligence features are corpus-relative and evidence-backed; they should support—not replace—a researcher's judgment and source review.
