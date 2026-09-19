import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Design-level checks on migration 0006 (pgvector foundation). They cannot prove
 * runtime behavior (that needs Postgres; see supabase/verification/), but they pin
 * the invariants later phases rely on so an accidental edit cannot silently remove
 * them.
 */
const read = (name: string) =>
  readFileSync(
    new URL(`../supabase/migrations/${name}`, import.meta.url),
    'utf8',
  ).replace(/\r\n/g, '\n')

const raw = read('0006_vector_foundation.sql')
/** SQL with -- comments removed, so prose about HNSW etc. can't trip the checks. */
const sql = raw.replace(/--.*$/gm, '')

/** The text of one `create table public.<name> (...)` statement. */
const table = (name: string) => {
  const start = sql.indexOf(`create table public.${name} (`)
  expect(start).toBeGreaterThan(-1)
  const end = sql.indexOf('\n);', start)
  return sql.slice(start, end + 3)
}

describe('migration 0006: pgvector', () => {
  it('enables the vector extension idempotently in the extensions schema', () => {
    expect(sql).toMatch(
      /create extension if not exists vector with schema extensions;/,
    )
  })

  it('fails loudly if the extension is unavailable', () => {
    expect(sql).toMatch(/from pg_extension where extname = 'vector'/)
    expect(sql).toMatch(/raise exception 'pgvector/)
  })

  it('uses vector(1024), not halfvec', () => {
    expect(table('chunk_embeddings')).toMatch(
      /embedding vector\(1024\) not null/,
    )
    expect(sql).not.toMatch(/halfvec/i)
    expect(sql.match(/vector\(\d+\)/g)).toEqual(['vector(1024)'])
  })

  it('creates NO approximate vector index (HNSW / IVFFlat) yet', () => {
    expect(sql).not.toMatch(/using\s+hnsw/i)
    expect(sql).not.toMatch(/using\s+ivfflat/i)
    expect(sql).not.toMatch(/vector_(cosine|l2|ip)_ops/i)
    // Every index on chunk_embeddings is an ordinary btree over relational columns.
    const indexes =
      sql.match(/create index \w+\s+on public\.chunk_embeddings \([^)]*\)/g) ??
      []
    expect(indexes).toHaveLength(3)
    for (const index of indexes) expect(index).not.toMatch(/embedding\b/)
  })
})

describe('migration 0006: embedding model registry', () => {
  const registry = table('embedding_models')

  it('records provider, model, dimension, input profile and lifecycle status', () => {
    for (const column of [
      'provider text not null',
      'provider_model text not null',
      'dimensions int not null',
      'input_profile text not null',
      'status text not null',
      'min_similarity real',
    ]) {
      expect(registry).toContain(column)
    }
    expect(registry).toMatch(/status in \('building', 'active', 'retired'\)/)
  })

  it('ties dimensions to the vector(1024) column and keeps min_similarity nullable', () => {
    expect(registry).toMatch(/check \(dimensions = 1024\)/)
    expect(registry).toMatch(
      /min_similarity is null or min_similarity between -1 and 1/,
    )
    expect(registry).not.toMatch(/min_similarity real not null/)
  })

  it('allows each provider/model/dimension/profile combination only once', () => {
    expect(registry).toMatch(
      /unique \(provider, provider_model, dimensions, input_profile\)/,
    )
  })

  it('allows at most one active profile, so there is one search space', () => {
    expect(sql).toMatch(
      /create unique index embedding_models_single_active_idx\s+on public\.embedding_models \(\(true\)\) where status = 'active'/,
    )
  })

  it('makes identity columns immutable once vectors may exist', () => {
    expect(sql).toMatch(
      /create or replace function public\.embedding_models_protect_identity\(\)/,
    )
    for (const column of [
      'id',
      'provider',
      'provider_model',
      'dimensions',
      'input_profile',
    ]) {
      expect(sql).toContain(`new.${column} is distinct from old.${column}`)
    }
    expect(sql).toMatch(
      /before update on public\.embedding_models\s+for each row execute function public\.embedding_models_protect_identity\(\)/,
    )
  })

  it('seeds the Voyage voyage-4 / 1024 profile idempotently', () => {
    expect(sql).toMatch(
      /insert into public\.embedding_models[\s\S]*'voyage-4:1024:ctx-v1', 'voyage', 'voyage-4', 1024, 'ctx-v1', 'active'/,
    )
    expect(sql).toMatch(/on conflict \(id\) do nothing/)
  })

  it('stores no credentials', () => {
    expect(sql).not.toMatch(/api[_-]?key|secret|token|password|bearer/i)
  })
})

describe('migration 0006: chunk_embeddings ownership and cascade', () => {
  const embeddings = table('chunk_embeddings')

  it('adds the composite unique key that same-owner foreign keys need', () => {
    expect(sql).toMatch(
      /alter table public\.paper_chunks\s+add constraint paper_chunks_id_paper_user_key unique \(id, paper_id, user_id\)/,
    )
  })

  it('does not otherwise alter existing tables', () => {
    // Only the composite unique key on paper_chunks; papers and sections are not altered.
    expect(
      sql.match(
        /alter table public\.(papers|paper_chunks|paper_sections)(?![a-z_])/g,
      ),
    ).toEqual(['alter table public.paper_chunks'])
    expect(sql).not.toMatch(/alter table public\.papers(?![a-z_])/)
  })

  it('references chunks and the model profile, one embedding per chunk per profile', () => {
    expect(embeddings).toMatch(/primary key \(chunk_id, model_id\)/)
    expect(embeddings).toMatch(
      /model_id text not null references public\.embedding_models \(id\) on delete restrict/,
    )
  })

  it('cannot attach a vector to another user or paper (composite FK), and cascades from chunks', () => {
    expect(embeddings).toMatch(
      /foreign key \(chunk_id, paper_id, user_id\)\s+references public\.paper_chunks \(id, paper_id, user_id\) on delete cascade/,
    )
    expect(embeddings).toMatch(/paper_id uuid not null/)
    expect(embeddings).toMatch(/user_id uuid not null/)
  })

  it('has an optional, validated content hash of the embedded input', () => {
    expect(embeddings).toMatch(
      /content_hash text check \(content_hash is null or content_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/,
    )
  })

  it('does not put embeddings on paper_chunks', () => {
    expect(sql).not.toMatch(/alter table public\.paper_chunks\s+add column/)
  })
})

describe('migration 0006: paper_embedding_jobs lifecycle', () => {
  const jobs = table('paper_embedding_jobs')

  it('has one logical job per paper and model profile, cascading from the paper', () => {
    expect(jobs).toMatch(/primary key \(paper_id, model_id\)/)
    expect(jobs).toMatch(
      /foreign key \(paper_id, user_id\)\s+references public\.papers \(id, user_id\) on delete cascade/,
    )
    expect(jobs).toMatch(
      /model_id text not null references public\.embedding_models \(id\) on delete restrict/,
    )
  })

  it('supports pending, embedding, complete and failed', () => {
    expect(jobs).toMatch(
      /status in \('pending', 'embedding', 'complete', 'failed'\)/,
    )
    expect(jobs).toMatch(/status text not null default 'pending'/)
  })

  it('tracks attempts, safe error, fencing, timestamps and progress counts', () => {
    for (const column of [
      'attempts int not null default 0',
      'last_error text',
      'claim_started_at timestamptz',
      'completed_at timestamptz',
      'chunk_count int',
      'embedded_count int not null default 0',
    ]) {
      expect(jobs).toContain(column)
    }
    expect(jobs).toMatch(/char_length\(last_error\) <= 1000/)
  })

  it('records the processing generation it covers, so reprocessing invalidates it', () => {
    expect(jobs).toMatch(/source_completed_at timestamptz not null/)
    expect(raw).toMatch(
      /job\.source_completed_at = papers\.processing_completed_at/,
    )
  })

  it('keeps job state self-consistent (claim only while embedding, complete means all chunks)', () => {
    expect(jobs).toMatch(
      /\(status = 'embedding'\) = \(claim_started_at is not null\)/,
    )
    expect(jobs).toMatch(/\(status = 'failed'\) = \(last_error is not null\)/)
    expect(jobs).toMatch(/embedded_count = chunk_count/)
    expect(jobs).toMatch(/embedded_count <= chunk_count/)
  })

  it('creates no jobs and does not touch existing papers or chunks', () => {
    expect(sql).not.toMatch(/insert into public\.paper_embedding_jobs/)
    expect(sql).not.toMatch(/insert into public\.chunk_embeddings/)
    expect(sql).not.toMatch(
      /\b(update|delete from)\s+public\.(papers|paper_chunks|paper_sections)\b/,
    )
    expect(sql).not.toMatch(/\b(drop|truncate)\b/i)
  })
})

describe('migration 0006: separate from the PDF processing lifecycle', () => {
  it('adds no columns or status values to papers', () => {
    expect(sql).not.toMatch(/alter table public\.papers(?![a-z_])/)
    expect(sql).not.toMatch(/'uploaded'|'processing'|'ready'/)
  })

  it('does not redefine any function from migration 0005', () => {
    for (const name of [
      'claim_next_paper',
      'complete_paper_processing',
      'fail_paper_processing',
    ]) {
      expect(sql).not.toContain(name)
    }
  })
})

describe('migration 0006: RLS and grants', () => {
  it('enables RLS on all three new tables', () => {
    for (const name of [
      'embedding_models',
      'chunk_embeddings',
      'paper_embedding_jobs',
    ]) {
      expect(sql).toContain(
        `alter table public.${name} enable row level security;`,
      )
    }
  })

  it('revokes every browser privilege first', () => {
    expect(sql).toMatch(
      /revoke all on public\.embedding_models, public\.chunk_embeddings, public\.paper_embedding_jobs\s+from anon, authenticated;/,
    )
  })

  it('gives browsers no way to read or write raw embeddings', () => {
    expect(sql).not.toMatch(/create policy [^;]*on public\.chunk_embeddings/)
    expect(sql).not.toMatch(
      /grant [^;]*on public\.chunk_embeddings[^;]*to (anon|authenticated)/,
    )
    expect(sql).not.toMatch(
      /grant [^;]*chunk_embeddings[^;]*to (anon|authenticated)/,
    )
  })

  it('lets owners read only a safe subset of their own job status', () => {
    expect(sql).toMatch(
      /create policy "Users read own embedding job status" on public\.paper_embedding_jobs\s+for select to authenticated using \(user_id = \(select auth\.uid\(\)\)\)/,
    )
    const grant = sql.match(
      /grant select \(([^)]*)\) on public\.paper_embedding_jobs to authenticated;/,
    )
    expect(grant).not.toBeNull()
    const columns = grant![1].split(',').map((c) => c.trim())
    expect(columns).toEqual(
      expect.arrayContaining([
        'paper_id',
        'model_id',
        'status',
        'chunk_count',
        'embedded_count',
        'source_completed_at',
        'completed_at',
      ]),
    )
    // Fencing, retry bookkeeping, error text and the ownership column stay hidden.
    for (const hidden of [
      'claim_started_at',
      'attempts',
      'last_error',
      'user_id',
    ]) {
      expect(columns).not.toContain(hidden)
    }
  })

  it('never lets browsers write jobs', () => {
    expect(sql).not.toMatch(
      /grant (insert|update|delete|all)[^;]*paper_embedding_jobs[^;]*to (anon|authenticated)/,
    )
    expect(sql).not.toMatch(
      /create policy [^;]*on public\.paper_embedding_jobs\s+for (insert|update|delete|all)/,
    )
  })

  it('exposes only non-secret model metadata, read-only', () => {
    expect(sql).toMatch(
      /create policy "Signed-in users read embedding models" on public\.embedding_models\s+for select to authenticated using \(true\)/,
    )
    expect(sql).toMatch(
      /grant select on public\.embedding_models to authenticated;/,
    )
    expect(sql).not.toMatch(
      /create policy [^;]*on public\.embedding_models\s+for (insert|update|delete|all)/,
    )
  })

  it('gives the service role direct table access', () => {
    expect(sql).toMatch(
      /grant select, insert, update, delete\s+on public\.embedding_models, public\.chunk_embeddings, public\.paper_embedding_jobs\s+to service_role;/,
    )
  })

  it('pins search_path on its functions and runs as one transaction', () => {
    expect(sql.match(/set search_path = ''/g)).toHaveLength(1)
    expect(sql.trimStart().startsWith('begin;')).toBe(true)
    expect(sql.trimEnd().endsWith('commit;')).toBe(true)
  })
})

describe('earlier migrations stay untouched', () => {
  // sha256 of each file with line endings normalized to LF. If you edit an applied
  // migration this fails on purpose: add a new migration instead.
  const pinned: Record<string, string> = {
    '0001_foundation.sql':
      '07deecc51ca11c224c28b5c604a040313881211dcfd746b683ca662f6e705987',
    '0002_paper_ingestion.sql':
      '8ab8edac85e81b61ef1998603d87a6c4866e48a14a315865623ab43440ca627b',
    '0003_paper_project_links.sql':
      '2c9a70b0ae35deba121bf4b2a2b16becccc365a33a140fcf2d0224a5b8bdd4f7',
    '0004_paper_processing.sql':
      'd5d0cb59669966fefe08f3388ebfbd29e26f98cc7bcb9c736312e1114b484cbd',
    '0005_processing_worker.sql':
      '13c8b93cc141d2b6dd5dae21c1d80bbc7b207c1b6a37a44c5c71b1346125240d',
  }

  it.each(Object.entries(pinned))('%s is unchanged', (name, hash) => {
    expect(createHash('sha256').update(read(name)).digest('hex')).toBe(hash)
  })
})
