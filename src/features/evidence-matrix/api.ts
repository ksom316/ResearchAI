import { z } from 'zod'
import { getSupabaseBrowserClient } from '#/lib/supabase/client'
import { EVIDENCE_SCHEMA_VERSION, FIELD_KEYS } from './fields'
import type {
  ExtractionField,
  ExtractionOverview,
  ExtractionSource,
  FieldItem,
  FieldKey,
  RequestResult,
} from './types'

/**
 * Browser data access for the Evidence Matrix. READ-ONLY plus one RPC:
 *  - reads use the owner-scoped extraction views/tables under RLS
 *  - the only write path is request_paper_extraction (never a direct table write)
 *
 * IMPORTANT: authenticated browsers have COLUMN-level grants on the extraction tables
 * (no user_id, attempts, claim token, last_error, or the fields' run marker). A
 * select('*') would fail with "permission denied", so every select lists its columns.
 */
export const OVERVIEW_COLUMNS =
  'paper_id, schema_version, status, source_completed_at, completed_at, provider, model, created_at, updated_at, is_stale'
export const FIELD_COLUMNS =
  'paper_id, schema_version, field_key, state, value, created_at, updated_at'
export const SOURCE_COLUMNS =
  'paper_id, schema_version, field_key, item_index, ord, chunk_id, section_id, section_title, section_type, page_start, page_end, excerpt'

/** Most paper ids per request, so a large project cannot overflow the URL. */
export const PAPER_IDS_PER_REQUEST = 100

const overviewRow = z.object({
  paper_id: z.string(),
  schema_version: z.number(),
  status: z.enum(['pending', 'running', 'complete', 'partial', 'failed']),
  source_completed_at: z.string(),
  completed_at: z.string().nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  is_stale: z.boolean(),
})

const fieldRow = z.object({
  paper_id: z.string(),
  schema_version: z.number(),
  field_key: z.enum(FIELD_KEYS),
  state: z.enum(['extracted', 'not_reported', 'failed']),
  value: z.unknown(),
  created_at: z.string(),
  updated_at: z.string(),
})

const sourceRow = z.object({
  paper_id: z.string(),
  schema_version: z.number(),
  field_key: z.enum(FIELD_KEYS),
  item_index: z.number(),
  ord: z.number(),
  chunk_id: z.string().nullable(),
  section_id: z.string().nullable(),
  section_title: z.string(),
  section_type: z.string(),
  page_start: z.number().nullable(),
  page_end: z.number().nullable(),
  excerpt: z.string().nullable(),
})

const requestResult = z.enum(['requested', 'unchanged', 'not_ready', 'not_found'])

/** Sorted, de-duplicated ids: the same set always yields the same request and key. */
export function normalizePaperIds(paperIds: readonly string[]): string[] {
  return [...new Set(paperIds)].sort()
}

/**
 * The stored value is {"items":[{"text":"..."}]}. Anything else is treated as
 * malformed: usable items are kept, the rest dropped, and the flag is set. Never throws.
 */
export function parseFieldValue(value: unknown): {
  items: FieldItem[]
  malformed: boolean
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { items: [], malformed: true }
  }
  const raw = (value as { items?: unknown }).items
  if (!Array.isArray(raw)) return { items: [], malformed: true }
  const items: FieldItem[] = []
  let malformed = false
  for (const entry of raw as unknown[]) {
    const text =
      typeof entry === 'object' && entry !== null
        ? (entry as { text?: unknown }).text
        : undefined
    if (typeof text === 'string' && text.trim() !== '') items.push({ text })
    else malformed = true
  }
  return { items, malformed }
}

function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/** Overview rows for these papers (schema version 1). Invalid rows are dropped. */
export async function listExtractionOverviews(
  paperIds: readonly string[],
): Promise<ExtractionOverview[]> {
  const ids = normalizePaperIds(paperIds)
  if (ids.length === 0) return []
  const supabase = getSupabaseBrowserClient()
  const pages = await Promise.all(
    chunks(ids, PAPER_IDS_PER_REQUEST).map(async (batch) => {
      const { data, error } = await supabase
        .from('paper_extraction_overview')
        .select(OVERVIEW_COLUMNS)
        .eq('schema_version', EVIDENCE_SCHEMA_VERSION)
        .in('paper_id', batch)
      if (error) throw error
      return data as unknown[]
    }),
  )
  return pages.flat().flatMap((row) => {
    const parsed = overviewRow.safeParse(row)
    if (!parsed.success) return []
    const r = parsed.data
    return [
      {
        paperId: r.paper_id,
        schemaVersion: r.schema_version,
        status: r.status,
        sourceCompletedAt: r.source_completed_at,
        completedAt: r.completed_at,
        provider: r.provider,
        model: r.model,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        isStale: r.is_stale,
      },
    ]
  })
}

/** Field rows (with normalized items) for these papers (schema version 1). */
export async function listExtractionFields(
  paperIds: readonly string[],
): Promise<ExtractionField[]> {
  const ids = normalizePaperIds(paperIds)
  if (ids.length === 0) return []
  const supabase = getSupabaseBrowserClient()
  const pages = await Promise.all(
    chunks(ids, PAPER_IDS_PER_REQUEST).map(async (batch) => {
      const { data, error } = await supabase
        .from('paper_extraction_fields')
        .select(FIELD_COLUMNS)
        .eq('schema_version', EVIDENCE_SCHEMA_VERSION)
        .in('paper_id', batch)
      if (error) throw error
      return data as unknown[]
    }),
  )
  return pages.flat().flatMap((row) => {
    const parsed = fieldRow.safeParse(row)
    if (!parsed.success) return []
    const r = parsed.data
    const { items, malformed } = parseFieldValue(r.value)
    return [
      {
        paperId: r.paper_id,
        schemaVersion: r.schema_version,
        fieldKey: r.field_key,
        state: r.state,
        items,
        itemsMalformed: malformed,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      },
    ]
  })
}

/**
 * Provenance for ONE field of ONE paper, loaded lazily (when a claim is opened):
 * ordered by claim (item_index), then by source order within the claim (ord).
 */
export async function listExtractionSources(
  paperId: string,
  fieldKey: FieldKey,
): Promise<ExtractionSource[]> {
  if (!FIELD_KEYS.includes(fieldKey)) {
    throw new Error('Unknown evidence field')
  }
  const { data, error } = await getSupabaseBrowserClient()
    .from('paper_extraction_sources')
    .select(SOURCE_COLUMNS)
    .eq('schema_version', EVIDENCE_SCHEMA_VERSION)
    .eq('paper_id', paperId)
    .eq('field_key', fieldKey)
    .order('item_index', { ascending: true })
    .order('ord', { ascending: true })
  if (error) throw error
  return (data as unknown[]).flatMap((row) => {
    const parsed = sourceRow.safeParse(row)
    if (!parsed.success) return []
    const r = parsed.data
    return [
      {
        paperId: r.paper_id,
        schemaVersion: r.schema_version,
        fieldKey: r.field_key,
        itemIndex: r.item_index,
        ord: r.ord,
        chunkId: r.chunk_id,
        sectionId: r.section_id,
        sectionTitle: r.section_title,
        sectionType: r.section_type,
        pageStart: r.page_start,
        pageEnd: r.page_end,
        excerpt: r.excerpt,
      },
    ]
  })
}

/**
 * Asks for (re-)extraction of one owned, ready paper. The ONLY write path: the database
 * function takes just the paper id, derives the caller from auth, and decides whether
 * anything needs to happen. An unrecognized answer fails instead of being trusted.
 */
export async function requestPaperExtraction(
  paperId: string,
): Promise<RequestResult> {
  const { data, error } = await getSupabaseBrowserClient().rpc(
    'request_paper_extraction',
    { p_paper_id: paperId },
  )
  if (error) throw error
  const parsed = requestResult.safeParse(data)
  if (!parsed.success) {
    throw new Error('Unexpected response while requesting extraction.')
  }
  return parsed.data
}
