import { z } from 'zod'
import {
  EVIDENCE_SCHEMA_VERSION,
  FIELD_KEYS,
} from '#/features/evidence-matrix/fields'
import type {
  ExtractionField,
  ExtractionOverview,
  ExtractionSource,
  FieldItem,
  FieldKey,
} from '#/features/evidence-matrix/types'
import type { createSupabaseServerClient } from '#/lib/supabase/supabase.server'
import type { WriterLiveChunk, WriterPaper } from './evidence'

type SupabaseLike = ReturnType<typeof createSupabaseServerClient>

export const WRITER_PROJECT_COLUMNS = 'id, title'
export const WRITER_PAPER_COLUMNS =
  'id, title, status, paper_project_links!inner(project_id)'
export const WRITER_OVERVIEW_COLUMNS =
  'paper_id, schema_version, status, source_completed_at, completed_at, provider, model, created_at, updated_at, is_stale'
export const WRITER_FIELD_COLUMNS =
  'paper_id, schema_version, field_key, state, value, created_at, updated_at'
export const WRITER_SOURCE_COLUMNS =
  'paper_id, schema_version, field_key, item_index, ord, chunk_id, section_id, section_title, section_type, page_start, page_end, excerpt'
export const WRITER_CHUNK_COLUMNS =
  'id, paper_id, section_id, text, page_start, page_end'
export const WRITER_SECTION_COLUMNS =
  'id, paper_id, title, section_type, page_start, page_end'

const BATCH_SIZE = 100

export type WriterProject = { id: string; title: string }
export type WriterSectionRecord = {
  id: string
  paperId: string
  title: string
  sectionType: string
  pageStart: number | null
  pageEnd: number | null
}

export type WriterDb = {
  getUserId: () => Promise<string | null>
  getProject: (projectId: string) => Promise<WriterProject | null>
  listProjectPapers: (projectId: string) => Promise<WriterPaper[]>
  listExtractionOverviews: (
    paperIds: readonly string[],
  ) => Promise<ExtractionOverview[]>
  listExtractionFields: (
    paperIds: readonly string[],
    fieldKeys: readonly FieldKey[],
  ) => Promise<ExtractionField[]>
  listExtractionSources: (
    paperIds: readonly string[],
    fieldKeys: readonly FieldKey[],
  ) => Promise<ExtractionSource[]>
  listChunks: (chunkIds: readonly string[]) => Promise<WriterLiveChunk[]>
  listSections: (
    sectionIds: readonly string[],
  ) => Promise<WriterSectionRecord[]>
}

const projectRow = z.object({ id: z.string(), title: z.string() })
const paperRow = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(['uploaded', 'processing', 'ready', 'failed']),
})
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
  item_index: z.number().int().min(0),
  ord: z.number().int().min(0),
  chunk_id: z.string().nullable(),
  section_id: z.string().nullable(),
  section_title: z.string(),
  section_type: z.string(),
  page_start: z.number().nullable(),
  page_end: z.number().nullable(),
  excerpt: z.string().nullable(),
})
const chunkRow = z.object({
  id: z.string(),
  paper_id: z.string(),
  section_id: z.string(),
  text: z.string(),
  page_start: z.number().nullable(),
  page_end: z.number().nullable(),
})
const sectionRow = z.object({
  id: z.string(),
  paper_id: z.string(),
  title: z.string(),
  section_type: z.string(),
  page_start: z.number().nullable(),
  page_end: z.number().nullable(),
})

function normalizeIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort()
}

function batches<T>(items: readonly T[]): T[][] {
  const output: T[][] = []
  for (let index = 0; index < items.length; index += BATCH_SIZE) {
    output.push(items.slice(index, index + BATCH_SIZE))
  }
  return output
}

function parseFieldValue(value: unknown): {
  items: FieldItem[]
  malformed: boolean
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { items: [], malformed: true }
  }
  const rawItems = (value as { items?: unknown }).items
  if (!Array.isArray(rawItems)) return { items: [], malformed: true }
  const items: FieldItem[] = []
  let malformed = false
  for (const entry of rawItems) {
    const text =
      typeof entry === 'object' && entry !== null
        ? (entry as { text?: unknown }).text
        : undefined
    if (typeof text === 'string' && text.trim() !== '') items.push({ text })
    else malformed = true
  }
  return { items, malformed }
}

async function loadBatches(
  ids: readonly string[],
  query: (batch: string[]) => PromiseLike<{
    data: unknown
    error: { message: string } | null
  }>,
): Promise<unknown[]> {
  const normalized = normalizeIds(ids)
  if (normalized.length === 0) return []
  const pages = await Promise.all(
    batches(normalized).map(async (batch) => {
      const { data, error } = await query(batch)
      if (error) throw new Error('Writer data is unavailable')
      return Array.isArray(data) ? data : []
    }),
  )
  return pages.flat()
}

/** Cookie-authenticated, RLS-scoped reads for Writer evidence preparation. */
export function createSupabaseWriterDb(supabase: SupabaseLike): WriterDb {
  return {
    getUserId: async () =>
      (await supabase.auth.getUser()).data.user?.id ?? null,

    getProject: async (projectId) => {
      const { data, error } = await supabase
        .from('research_projects')
        .select(WRITER_PROJECT_COLUMNS)
        .eq('id', projectId)
        .maybeSingle()
      if (error) throw new Error('Writer project is unavailable')
      if (data === null) return null
      const parsed = projectRow.safeParse(data)
      if (!parsed.success) throw new Error('Writer project is unavailable')
      return parsed.data
    },

    listProjectPapers: async (projectId) => {
      const { data, error } = await supabase
        .from('papers')
        .select(WRITER_PAPER_COLUMNS)
        .eq('paper_project_links.project_id', projectId)
      if (error) throw new Error('Writer papers are unavailable')
      return (Array.isArray(data) ? data : []).flatMap((row) => {
        const parsed = paperRow.safeParse(row)
        return parsed.success ? [parsed.data] : []
      })
    },

    listExtractionOverviews: async (paperIds) => {
      const rows = await loadBatches(paperIds, (batch) =>
        supabase
          .from('paper_extraction_overview')
          .select(WRITER_OVERVIEW_COLUMNS)
          .eq('schema_version', EVIDENCE_SCHEMA_VERSION)
          .in('paper_id', batch),
      )
      return rows.flatMap((row) => {
        const parsed = overviewRow.safeParse(row)
        if (!parsed.success) return []
        const value = parsed.data
        return [
          {
            paperId: value.paper_id,
            schemaVersion: value.schema_version,
            status: value.status,
            sourceCompletedAt: value.source_completed_at,
            completedAt: value.completed_at,
            provider: value.provider,
            model: value.model,
            createdAt: value.created_at,
            updatedAt: value.updated_at,
            isStale: value.is_stale,
          },
        ]
      })
    },

    listExtractionFields: async (paperIds, fieldKeys) => {
      const rows = await loadBatches(paperIds, (batch) =>
        supabase
          .from('paper_extraction_fields')
          .select(WRITER_FIELD_COLUMNS)
          .eq('schema_version', EVIDENCE_SCHEMA_VERSION)
          .in('paper_id', batch)
          .in('field_key', [...fieldKeys]),
      )
      return rows.flatMap((row) => {
        const parsed = fieldRow.safeParse(row)
        if (!parsed.success) return []
        const value = parsed.data
        const parsedValue = parseFieldValue(value.value)
        return [
          {
            paperId: value.paper_id,
            schemaVersion: value.schema_version,
            fieldKey: value.field_key,
            state: value.state,
            items: parsedValue.items,
            itemsMalformed: parsedValue.malformed,
            createdAt: value.created_at,
            updatedAt: value.updated_at,
          },
        ]
      })
    },

    listExtractionSources: async (paperIds, fieldKeys) => {
      const rows = await loadBatches(paperIds, (batch) =>
        supabase
          .from('paper_extraction_sources')
          .select(WRITER_SOURCE_COLUMNS)
          .eq('schema_version', EVIDENCE_SCHEMA_VERSION)
          .in('paper_id', batch)
          .in('field_key', [...fieldKeys]),
      )
      return rows.flatMap((row) => {
        const parsed = sourceRow.safeParse(row)
        if (!parsed.success) return []
        const value = parsed.data
        return [
          {
            paperId: value.paper_id,
            schemaVersion: value.schema_version,
            fieldKey: value.field_key,
            itemIndex: value.item_index,
            ord: value.ord,
            chunkId: value.chunk_id,
            sectionId: value.section_id,
            sectionTitle: value.section_title,
            sectionType: value.section_type,
            pageStart: value.page_start,
            pageEnd: value.page_end,
            excerpt: value.excerpt,
          },
        ]
      })
    },

    listChunks: async (chunkIds) => {
      const rows = await loadBatches(chunkIds, (batch) =>
        supabase
          .from('paper_chunks')
          .select(WRITER_CHUNK_COLUMNS)
          .in('id', batch),
      )
      return rows.flatMap((row) => {
        const parsed = chunkRow.safeParse(row)
        if (!parsed.success) return []
        const value = parsed.data
        return [
          {
            id: value.id,
            paperId: value.paper_id,
            sectionId: value.section_id,
            text: value.text,
            pageStart: value.page_start,
            pageEnd: value.page_end,
          },
        ]
      })
    },

    listSections: async (sectionIds) => {
      const rows = await loadBatches(sectionIds, (batch) =>
        supabase
          .from('paper_sections')
          .select(WRITER_SECTION_COLUMNS)
          .in('id', batch),
      )
      return rows.flatMap((row) => {
        const parsed = sectionRow.safeParse(row)
        if (!parsed.success) return []
        const value = parsed.data
        return [
          {
            id: value.id,
            paperId: value.paper_id,
            title: value.title,
            sectionType: value.section_type,
            pageStart: value.page_start,
            pageEnd: value.page_end,
          },
        ]
      })
    },
  }
}
