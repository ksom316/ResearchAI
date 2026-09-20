import { FIELD_KEYS } from '#/features/evidence-matrix/fields'
import { describeExtraction } from '#/features/evidence-matrix/status'
import type {
  ExtractionField,
  ExtractionOverview,
  FieldKey,
} from '#/features/evidence-matrix/types'
import type { Paper } from '#/features/papers/types'
import { extractCandidates } from './terms'
import type {
  EdgeType,
  EvidenceRef,
  FindingNode,
  PaperNode,
  ResearchMap,
  ResearchMapEdge,
  ResearchMapNode,
  ResearchMapSummary,
  TermKind,
  TermNode,
} from './types'

export type DeriveInput = {
  papers: readonly Pick<Paper, 'id' | 'title' | 'status'>[]
  overviews: readonly ExtractionOverview[]
  fields: readonly ExtractionField[]
}

/** The only extraction fields that feed the map. */
const TERM_FIELD: Record<TermKind, FieldKey> = {
  concept: 'concepts',
  methodology: 'methodology',
  dataset: 'dataset',
}
const TERM_KINDS: readonly TermKind[] = ['concept', 'methodology', 'dataset']
const EDGE_TYPE: Record<TermKind, EdgeType> = {
  concept: 'paper_has_concept',
  methodology: 'paper_uses_methodology',
  dataset: 'paper_uses_dataset',
}
const EDGE_ORDER: readonly EdgeType[] = [
  'paper_has_concept',
  'paper_uses_methodology',
  'paper_uses_dataset',
  'paper_reports_finding',
]
const FINDINGS_FIELD: FieldKey = 'findings'
const MIN_PAPERS_FOR_SHARED_TERM = 2

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const paperNodeId = (paperId: string) => `paper:${paperId}`

function compareEvidence(a: EvidenceRef, b: EvidenceRef): number {
  return (
    cmp(a.paperId, b.paperId) ||
    FIELD_KEYS.indexOf(a.fieldKey) - FIELD_KEYS.indexOf(b.fieldKey) ||
    a.itemIndex - b.itemIndex ||
    cmp(a.matchedPhrase ?? '', b.matchedPhrase ?? '')
  )
}

/** Later updatedAt wins; an exact tie breaks on content, so input order never matters. */
function newest<T extends { updatedAt: string }>(a: T | undefined, b: T): T {
  if (!a) return b
  if (b.updatedAt !== a.updatedAt) return b.updatedAt > a.updatedAt ? b : a
  return JSON.stringify(b) > JSON.stringify(a) ? b : a
}

type TermAcc = {
  key: string
  words: number
  /** paperId -> its supporting claims. */
  papers: Map<string, EvidenceRef[]>
  /** Observed wording -> how many claims used it. */
  forms: Map<string, number>
  /** `paperId|itemIndex` of every supporting claim. */
  claims: Set<string>
}

/** Most frequent form; then the longer one; then the lexically smaller. Order-independent. */
function chooseLabel(forms: ReadonlyMap<string, number>): string {
  let best = ''
  let bestCount = -1
  for (const [form, count] of forms) {
    if (
      count > bestCount ||
      (count === bestCount &&
        (form.length > best.length || (form.length === best.length && form < best)))
    ) {
      best = form
      bestCount = count
    }
  }
  return best
}

function sameClaims(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false
  for (const claim of a) if (!b.has(claim)) return false
  return true
}

/**
 * Derives the Research Map from persisted Evidence Matrix data. Pure and deterministic:
 * the same papers/overviews/fields in ANY order give the same graph.
 *
 *  - paper nodes for every project paper, whatever its extraction state
 *  - shared term nodes (concept / methodology / dataset) supported by >= 2 distinct papers
 *  - one finding node per extracted finding, never merged across papers
 *  - no term-to-term edges
 *
 * A field is used only when it is 'extracted' and well formed: a malformed value means the
 * item positions cannot be trusted, so the field contributes nothing.
 */
export function deriveResearchMap(input: DeriveInput): ResearchMap {
  // --- inputs, made order-independent -------------------------------------------------
  const byId = new Map<string, DeriveInput['papers'][number]>()
  for (const p of input.papers) {
    const seen = byId.get(p.id)
    // a duplicate id keeps the lexically smaller title, whatever the input order
    if (!seen || cmp(p.title, seen.title) < 0) byId.set(p.id, p)
  }
  const papers = [...byId.values()].sort((a, b) => cmp(a.id, b.id))
  const paperIds = new Set(papers.map((p) => p.id))

  const overviews = new Map<string, ExtractionOverview>()
  for (const o of input.overviews) {
    if (paperIds.has(o.paperId)) {
      overviews.set(o.paperId, newest(overviews.get(o.paperId), o))
    }
  }
  const fieldOf = new Map<string, ExtractionField>() // `${paperId}|${fieldKey}`
  for (const f of input.fields) {
    if (!paperIds.has(f.paperId)) continue
    const id = `${f.paperId}|${f.fieldKey}`
    fieldOf.set(id, newest(fieldOf.get(id), f))
  }
  const usable = (paperId: string, key: FieldKey): string[] | null => {
    const f = fieldOf.get(`${paperId}|${key}`)
    if (!f || f.state !== 'extracted' || f.itemsMalformed || f.items.length === 0) return null
    return f.items.map((i) => i.text)
  }

  // --- candidate terms, indexed by normalized key --------------------------------------
  const accs: Record<TermKind, Map<string, TermAcc>> = {
    concept: new Map(),
    methodology: new Map(),
    dataset: new Map(),
  }
  for (const paper of papers) {
    for (const kind of TERM_KINDS) {
      const fieldKey = TERM_FIELD[kind]
      const items = usable(paper.id, fieldKey)
      if (!items) continue
      for (const [itemIndex, text] of items.entries()) {
        for (const c of extractCandidates(text)) {
          let acc = accs[kind].get(c.key)
          if (!acc) {
            acc = { key: c.key, words: c.words, papers: new Map(), forms: new Map(), claims: new Set() }
            accs[kind].set(c.key, acc)
          }
          const refs = acc.papers.get(paper.id) ?? []
          refs.push({ paperId: paper.id, fieldKey, itemIndex, matchedPhrase: c.phrase })
          acc.papers.set(paper.id, refs)
          acc.forms.set(c.phrase, (acc.forms.get(c.phrase) ?? 0) + 1)
          acc.claims.add(`${paper.id}|${itemIndex}`)
        }
      }
    }
  }

  // --- shared terms, overlap suppression -------------------------------------------------
  const termNodes: TermNode[] = []
  const edges: ResearchMapEdge[] = []
  const diagnostics = { unsharedCandidates: { concept: 0, methodology: 0, dataset: 0 } }

  for (const kind of TERM_KINDS) {
    const shared = new Map<string, TermAcc>()
    for (const acc of accs[kind].values()) {
      if (acc.papers.size >= MIN_PAPERS_FOR_SHARED_TERM) shared.set(acc.key, acc)
      else diagnostics.unsharedCandidates[kind]++
    }

    // A shorter shared phrase is dropped when every claim that has it also has a longer
    // shared phrase containing it (same supporting claims, hence the same papers). Only
    // the sub-phrases of each shared phrase are looked up: no all-pairs comparison.
    const suppressed = new Set<string>()
    for (const longer of shared.values()) {
      const words = longer.key.split(' ')
      for (let i = 0; i < words.length; i++) {
        for (let j = i + 1; j <= words.length; j++) {
          if (j - i === words.length) continue
          const sub = shared.get(words.slice(i, j).join(' '))
          if (sub && sameClaims(sub.claims, longer.claims)) suppressed.add(sub.key)
        }
      }
    }

    for (const acc of shared.values()) {
      if (suppressed.has(acc.key)) continue
      const id = `term:${kind}:${acc.key}`
      termNodes.push({
        id,
        type: 'term',
        kind,
        key: acc.key,
        label: chooseLabel(acc.forms),
        paperIds: [...acc.papers.keys()].sort(cmp),
      })
      for (const [paperId, refs] of acc.papers) {
        edges.push({
          id: `edge:${EDGE_TYPE[kind]}:${paperNodeId(paperId)}->${id}`,
          type: EDGE_TYPE[kind],
          from: paperNodeId(paperId),
          to: id,
          evidence: [...refs].sort(compareEvidence),
        })
      }
    }
  }

  // --- findings: paper-specific, never merged --------------------------------------------
  const findingNodes: FindingNode[] = []
  for (const paper of papers) {
    const items = usable(paper.id, FINDINGS_FIELD)
    if (!items) continue
    for (const [itemIndex, text] of items.entries()) {
      if (text.trim() === '') continue
      const id = `finding:${paper.id}:${itemIndex}`
      findingNodes.push({
        id,
        type: 'finding',
        paperId: paper.id,
        itemIndex,
        text,
        evidence: { paperId: paper.id, fieldKey: FINDINGS_FIELD, itemIndex, matchedPhrase: null },
      })
      edges.push({
        id: `edge:paper_reports_finding:${paperNodeId(paper.id)}->${id}`,
        type: 'paper_reports_finding',
        from: paperNodeId(paper.id),
        to: id,
        evidence: [{ paperId: paper.id, fieldKey: FINDINGS_FIELD, itemIndex, matchedPhrase: null }],
      })
    }
  }

  // --- paper nodes ------------------------------------------------------------------------
  const contributing = new Set(edges.map((e) => e.from))
  const paperNodes: PaperNode[] = papers.map((p) => {
    const overview = overviews.get(p.id)
    const status = describeExtraction(p.status, overview)
    return {
      id: paperNodeId(p.id),
      type: 'paper',
      paperId: p.id,
      title: p.title,
      statusKey: status.key,
      extractionStatus: overview?.status ?? null,
      isStale: overview?.isStale ?? false,
      contributes: contributing.has(paperNodeId(p.id)),
    }
  })

  // --- deterministic ordering -----------------------------------------------------------
  const kindOrder = (k: TermKind) => TERM_KINDS.indexOf(k)
  termNodes.sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind) || cmp(a.key, b.key))
  findingNodes.sort((a, b) => cmp(a.paperId, b.paperId) || a.itemIndex - b.itemIndex)
  edges.sort(
    (a, b) =>
      EDGE_ORDER.indexOf(a.type) - EDGE_ORDER.indexOf(b.type) ||
      cmp(a.from, b.from) ||
      cmp(a.to, b.to),
  )
  const nodes: ResearchMapNode[] = [...paperNodes, ...termNodes, ...findingNodes]

  const count = (kind: TermKind) => termNodes.filter((t) => t.kind === kind).length
  const summary: ResearchMapSummary = {
    totalPapers: paperNodes.length,
    contributingPapers: paperNodes.filter((p) => p.contributes).length,
    currentPapers: paperNodes.filter((p) => p.statusKey === 'extracted').length,
    stalePapers: paperNodes.filter((p) => p.statusKey === 'out_of_date').length,
    activePapers: paperNodes.filter((p) => p.statusKey === 'queued' || p.statusKey === 'extracting').length,
    unextractedPapers: paperNodes.filter((p) => p.extractionStatus === null).length,
    incompletePapers: paperNodes.filter((p) => p.statusKey === 'partial' || p.statusKey === 'failed').length,
    sharedConcepts: count('concept'),
    sharedMethodologies: count('methodology'),
    sharedDatasets: count('dataset'),
    findings: findingNodes.length,
  }

  return { nodes, edges, summary, diagnostics }
}
