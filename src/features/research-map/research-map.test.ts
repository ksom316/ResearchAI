import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type {
  ExtractionField,
  ExtractionOverview,
  ExtractionStatus,
  FieldKey,
} from '#/features/evidence-matrix/types'
import { deriveResearchMap } from './derive'
import type { DeriveInput } from './derive'
import { normalizePhrase, tokenize } from './normalize'
import { extractCandidates } from './terms'
import type { FindingNode, ResearchMap, TermNode } from './types'

type P = DeriveInput['papers'][number]
const paper = (id: string, over: Partial<P> = {}): P => ({ id, title: `Paper ${id}`, status: 'ready', ...over })

const overview = (
  paperId: string,
  status: ExtractionStatus = 'complete',
  isStale = false,
): ExtractionOverview => ({
  paperId, schemaVersion: 1, status, sourceCompletedAt: 'a', completedAt: 'b', provider: null,
  model: null, createdAt: 'c', updatedAt: 'd', isStale,
})

const ext = (
  paperId: string,
  fieldKey: FieldKey,
  texts: string[],
  over: Partial<ExtractionField> = {},
): ExtractionField => ({
  paperId, schemaVersion: 1, fieldKey, state: 'extracted', items: texts.map((text) => ({ text })),
  itemsMalformed: false, createdAt: 'x', updatedAt: 'y', ...over,
})

const derive = (input: Partial<DeriveInput> & { papers: P[] }): ResearchMap =>
  deriveResearchMap({ overviews: [], fields: [], ...input })

const terms = (map: ResearchMap) => map.nodes.filter((n): n is TermNode => n.type === 'term')
const findings = (map: ResearchMap) => map.nodes.filter((n): n is FindingNode => n.type === 'finding')
const termKeys = (map: ResearchMap) => terms(map).map((t) => `${t.kind}:${t.key}`)

describe('normalization', () => {
  it.each([
    ['Convolutional Neural Network', 'convolutional neural network'],
    ['  convolutional   NEURAL\tnetwork  ', 'convolutional neural network'],
    ['Convolutional-Neural  Network!', 'convolutional neural network'],
    ['convolutional/neural_network', 'convolutional neural network'],
    ['(Fine-tuning),', 'fine tuning'],
    ['The Transformer', 'transformer'],
    ['an  Encoder', 'encoder'],
    ['A', ''],
  ])('%j -> %j', (input, expected) => {
    expect(normalizePhrase(input)).toBe(expected)
  })

  it('applies Unicode NFKC (ligatures, fullwidth letters, non-breaking hyphens)', () => {
    expect(normalizePhrase('ﬁne‑tuning')).toBe('fine tuning')
    expect(normalizePhrase('ＢＥＲＴ')).toBe('bert')
    expect(normalizePhrase('Ｎｅｕｒａｌ　ｎｅｔｗｏｒｋ')).toBe('neural network')
  })

  it('keeps C++ and C# meaningful and drops possessives', () => {
    expect(normalizePhrase('C++')).toBe('c++')
    expect(normalizePhrase('written in C#')).toBe('written in c#')
    expect(normalizePhrase("BERT’s encoder")).toBe('bert encoder')
    expect(normalizePhrase('GPT-3.5')).toBe('gpt 3.5')
  })

  it('does NOT stem, singularize or fuzzy-match: plurals stay separate', () => {
    expect(normalizePhrase('neural network')).not.toBe(normalizePhrase('neural networks'))
    expect(normalizePhrase('dataset')).not.toBe(normalizePhrase('datasets'))
    expect(normalizePhrase('learn')).not.toBe(normalizePhrase('learning'))
    expect(normalizePhrase('colour')).not.toBe(normalizePhrase('color'))
  })

  it('tokenizes with offsets into the canonical text', () => {
    const { text, tokens } = tokenize('Fine-tuning of BERT')
    expect(tokens.map((t) => text.slice(t.start, t.end))).toEqual(['Fine', 'tuning', 'of', 'BERT'])
  })
})

describe('candidate terms', () => {
  const keys = (s: string) => extractCandidates(s).map((c) => c.key)

  it('extracts 1-4 word phrases without crossing function words or clause punctuation', () => {
    const k = keys('A convolutional neural network for image classification')
    expect(k).toContain('convolutional neural network')
    expect(k).toContain('image classification')
    expect(k).not.toContain('network for image')
    expect(k.every((x) => x.split(' ').length <= 4)).toBe(true)
    expect(keys('graph attention, message passing')).not.toContain('attention message')
  })

  it('rejects generic, function-word-edged and numeric-only candidates', () => {
    expect(keys('The proposed approach')).toEqual([])
    expect(keys('training data')).toEqual([])
    expect(keys('model')).toEqual([])
    expect(keys('in the of and')).toEqual([])
    expect(keys('2019 2020')).toEqual([])
    expect(keys('is based on')).toEqual([])
    expect(keys('results of experiments')).toEqual([])
  })

  it('allows a weak word inside or at the end of a phrase with a meaningful word', () => {
    expect(keys('language model')).toContain('language model')
    expect(keys('bag of words')).toContain('bag of words')
  })

  it('keeps C++ and a trailing number', () => {
    expect(keys('Implemented in C++')).toContain('c++')
    expect(keys('GPT-4')).toContain('gpt 4')
    expect(keys('4 gpt')).not.toContain('4 gpt')
  })

  it('records the phrase as written', () => {
    expect(extractCandidates('Fine-tuning BERT').find((c) => c.key === 'fine tuning')?.phrase).toBe('Fine-tuning')
  })
})

describe('shared terms', () => {
  it('the same term in two papers becomes ONE shared node with both papers', () => {
    const map = derive({
      papers: [paper('a'), paper('b')],
      overviews: [overview('a'), overview('b')],
      fields: [
        ext('a', 'concepts', ['Convolutional neural network for image classification']),
        ext('b', 'concepts', ['We use a convolutional neural network']),
      ],
    })
    const t = terms(map)
    expect(t.map((x) => x.key)).toEqual(['convolutional neural network'])
    expect(t[0]).toMatchObject({ kind: 'concept', id: 'term:concept:convolutional neural network', paperIds: ['a', 'b'] })
  })

  it('a term repeated inside ONE paper is not shared', () => {
    const map = derive({
      papers: [paper('a'), paper('b')],
      fields: [
        ext('a', 'concepts', ['Attention mechanism', 'Attention mechanism again', 'Attention mechanism']),
        ext('b', 'concepts', ['Reinforcement learning']),
      ],
    })
    expect(terms(map)).toEqual([])
    expect(map.diagnostics.unsharedCandidates.concept).toBeGreaterThan(0)
  })

  it('formatting variants merge: case, hyphenation, punctuation, whitespace', () => {
    const map = derive({
      papers: [paper('a'), paper('b'), paper('c')],
      fields: [
        ext('a', 'methodology', ['Fine-tuning']),
        ext('b', 'methodology', ['fine   tuning.']),
        ext('c', 'methodology', ['FINE TUNING']),
      ],
    })
    expect(terms(map)).toHaveLength(1)
    expect(terms(map)[0]).toMatchObject({ key: 'fine tuning', paperIds: ['a', 'b', 'c'] })
  })

  it('C++ and GPT-4 style tokens merge with their variants', () => {
    const map = derive({
      papers: [paper('a'), paper('b')],
      fields: [
        ext('a', 'methodology', ['C++ implementation', 'GPT-4']),
        ext('b', 'methodology', ['Written in C++', 'gpt 4']),
      ],
    })
    expect(termKeys(map)).toEqual(['methodology:c++', 'methodology:gpt 4'])
  })

  it('plurals stay separate terms', () => {
    const map = derive({
      papers: [paper('a'), paper('b'), paper('c'), paper('d')],
      fields: [
        ext('a', 'concepts', ['Knowledge graph']),
        ext('b', 'concepts', ['Knowledge graph']),
        ext('c', 'concepts', ['Knowledge graphs']),
        ext('d', 'concepts', ['Knowledge graphs']),
      ],
    })
    const graph = terms(map).find((t) => t.key === 'knowledge graph')
    const graphs = terms(map).find((t) => t.key === 'knowledge graphs')
    expect(graph?.paperIds).toEqual(['a', 'b'])
    expect(graphs?.paperIds).toEqual(['c', 'd'])
    expect(graph?.id).not.toBe(graphs?.id)
    // "knowledge" alone is an ordinary word (single-word eligibility rejects it); only
    // the two distinct multi-word phrases remain, correctly unmerged
    expect(termKeys(map)).toEqual(['concept:knowledge graph', 'concept:knowledge graphs'])
  })

  it('concept, methodology and dataset namespaces stay separate', () => {
    const map = derive({
      papers: [paper('a'), paper('b')],
      fields: [
        ext('a', 'concepts', ['ImageNet']),
        ext('b', 'concepts', ['ImageNet']),
        ext('a', 'methodology', ['ImageNet']),
        ext('b', 'methodology', ['ImageNet']),
        ext('a', 'dataset', ['ImageNet']),
        ext('b', 'dataset', ['ImageNet']),
      ],
    })
    expect(terms(map).map((t) => t.id)).toEqual([
      'term:concept:imagenet',
      'term:methodology:imagenet',
      'term:dataset:imagenet',
    ])
    expect(map.edges.map((e) => e.type)).toEqual([
      ...Array<string>(2).fill('paper_has_concept'),
      ...Array<string>(2).fill('paper_uses_methodology'),
      ...Array<string>(2).fill('paper_uses_dataset'),
    ])
  })

  it('uses only the concepts, methodology, dataset and findings fields', () => {
    const map = derive({
      papers: [paper('a'), paper('b')],
      fields: [
        ext('a', 'objective', ['Contrastive representation learning']),
        ext('b', 'objective', ['Contrastive representation learning']),
        ext('a', 'limitations', ['Small sample']),
        ext('b', 'limitations', ['Small sample']),
        ext('a', 'future_work', ['Larger corpora']),
        ext('b', 'future_work', ['Larger corpora']),
      ],
    })
    expect(map.nodes.filter((n) => n.type !== 'paper')).toEqual([])
    expect(map.edges).toEqual([])
  })

  it('single-paper terms are hidden', () => {
    const map = derive({
      papers: [paper('a'), paper('b')],
      fields: [ext('a', 'concepts', ['Reinforcement learning']), ext('b', 'concepts', ['Graph theory'])],
    })
    expect(terms(map)).toEqual([])
    expect(map.diagnostics.unsharedCandidates.concept).toBeGreaterThan(0)
  })

  it('generic phrases never become terms', () => {
    const map = derive({
      papers: [paper('a'), paper('b')],
      fields: [
        ext('a', 'concepts', ['Training data', 'The proposed approach', 'Results of experiments']),
        ext('b', 'concepts', ['Training data', 'The proposed approach', 'Results of experiments']),
      ],
    })
    expect(terms(map)).toEqual([])
  })

  it('malformed fields contribute nothing (item positions cannot be trusted)', () => {
    const map = derive({
      papers: [paper('a'), paper('b')],
      fields: [
        ext('a', 'concepts', ['Attention mechanism'], { itemsMalformed: true }),
        ext('b', 'concepts', ['Attention mechanism']),
      ],
    })
    expect(terms(map)).toEqual([])
  })

  it('not_reported, failed and empty fields contribute nothing', () => {
    const map = derive({
      papers: [paper('a'), paper('b'), paper('c')],
      fields: [
        ext('a', 'concepts', [], { state: 'not_reported' }),
        ext('b', 'concepts', ['Attention mechanism'], { state: 'failed' }),
        ext('c', 'concepts', []),
      ],
    })
    expect(terms(map)).toEqual([])
  })
})

describe('overlap suppression', () => {
  it('keeps only the longest shared phrase when its support is the same', () => {
    const map = derive({
      papers: [paper('a'), paper('b')],
      fields: [
        ext('a', 'concepts', ['Convolutional neural network']),
        ext('b', 'concepts', ['Convolutional neural network']),
      ],
    })
    expect(termKeys(map)).toEqual(['concept:convolutional neural network'])
    for (const dropped of ['neural', 'network', 'neural network', 'convolutional', 'convolutional neural']) {
      expect(termKeys(map)).not.toContain(`concept:${dropped}`)
    }
  })

  it('keeps a shorter term whose support differs', () => {
    const map = derive({
      papers: [paper('a'), paper('b'), paper('c'), paper('d')],
      fields: [
        ext('a', 'concepts', ['Neural network']),
        ext('b', 'concepts', ['Neural network']),
        ext('c', 'concepts', ['Convolutional neural network']),
        ext('d', 'concepts', ['Convolutional neural network']),
      ],
    })
    expect(termKeys(map)).toEqual(['concept:convolutional neural network', 'concept:neural network'])
  })
})

describe('false merge: "neural network" vs "convolutional neural network"', () => {
  const map = derive({
    papers: [paper('a'), paper('b'), paper('c'), paper('d')],
    fields: [
      ext('a', 'concepts', ['Neural network']),
      ext('b', 'concepts', ['Neural network']),
      ext('c', 'concepts', ['Convolutional neural network']),
      ext('d', 'concepts', ['Convolutional neural network']),
    ],
  })

  it('are two different nodes, never the same one', () => {
    const cnn = terms(map).find((t) => t.key === 'convolutional neural network')
    const nn = terms(map).find((t) => t.key === 'neural network')
    expect(cnn).toBeDefined()
    expect(nn).toBeDefined()
    expect(cnn?.id).not.toBe(nn?.id)
    expect(cnn?.paperIds).toEqual(['c', 'd'])
    expect(nn?.paperIds).toEqual(expect.arrayContaining(['a', 'b']))
  })

  it('have no term-to-term relationship: every edge starts at a paper', () => {
    expect(map.edges.every((e) => e.from.startsWith('paper:'))).toBe(true)
    expect(map.edges.every((e) => !e.to.startsWith('paper:'))).toBe(true)
    expect(map.edges.map((e) => e.type)).not.toContain('related_concept' as never)
  })

  it('a paper that only says "neural network" never reaches the CNN node', () => {
    const cnnEdges = map.edges.filter((e) => e.to === 'term:concept:convolutional neural network')
    expect(cnnEdges.map((e) => e.from).sort()).toEqual(['paper:c', 'paper:d'])
  })
})

describe('evidence', () => {
  const map = derive({
    papers: [paper('a'), paper('b')],
    fields: [
      ext('a', 'concepts', ['Attention mechanism', 'Something else entirely', 'Self-attention mechanism']),
      ext('b', 'concepts', ['The attention mechanism']),
    ],
  })

  it('one paper-term edge aggregates every supporting claim with its item index and field', () => {
    const edges = map.edges.filter((e) => e.to === 'term:concept:attention mechanism' && e.from === 'paper:a')
    expect(edges).toHaveLength(1)
    expect(edges[0].evidence).toEqual([
      { paperId: 'a', fieldKey: 'concepts', itemIndex: 0, matchedPhrase: 'Attention mechanism' },
      { paperId: 'a', fieldKey: 'concepts', itemIndex: 2, matchedPhrase: 'attention mechanism' },
    ])
  })

  it('the other paper keeps its own reference and wording', () => {
    const edge = map.edges.find((e) => e.to === 'term:concept:attention mechanism' && e.from === 'paper:b')
    expect(edge?.evidence).toEqual([
      { paperId: 'b', fieldKey: 'concepts', itemIndex: 0, matchedPhrase: 'attention mechanism' },
    ])
  })

  it('carries no excerpts or source data, only references', () => {
    for (const edge of map.edges) {
      for (const ref of edge.evidence) {
        expect(Object.keys(ref).sort()).toEqual(['fieldKey', 'itemIndex', 'matchedPhrase', 'paperId'])
      }
    }
  })

  it('picks a deterministic display label: most frequent form, then longest, then lexical', () => {
    const labelOf = (a: string[], b: string[]) =>
      terms(
        derive({
          papers: [paper('a'), paper('b')],
          fields: [ext('a', 'concepts', a), ext('b', 'concepts', b)],
        }),
      )[0].label
    // most frequent wins
    expect(labelOf(['fine-tuning', 'fine-tuning results'], ['Fine tuning'])).toBe('fine-tuning')
    // tie on count and length: the lexically smaller
    expect(labelOf(['Fine-tuning'], ['fine-tuning'])).toBe('Fine-tuning')
    // tie on count: the longer form
    expect(labelOf(['fine tuning'], ['fine  tuning'])).toBe('fine  tuning')
  })
})

describe('findings', () => {
  it('creates one finding node per extracted item, attached to its own paper', () => {
    const map = derive({
      papers: [paper('a')],
      fields: [ext('a', 'findings', ['Accuracy improved by 5 points.', 'Latency dropped.'])],
    })
    expect(findings(map).map((f) => f.id)).toEqual(['finding:a:0', 'finding:a:1'])
    expect(findings(map)[1]).toMatchObject({
      paperId: 'a', itemIndex: 1, text: 'Latency dropped.',
      evidence: { paperId: 'a', fieldKey: 'findings', itemIndex: 1, matchedPhrase: null },
    })
    expect(map.edges.map((e) => [e.type, e.from, e.to])).toEqual([
      ['paper_reports_finding', 'paper:a', 'finding:a:0'],
      ['paper_reports_finding', 'paper:a', 'finding:a:1'],
    ])
  })

  it('identical finding text in two papers stays two nodes', () => {
    const map = derive({
      papers: [paper('a'), paper('b')],
      fields: [ext('a', 'findings', ['Accuracy improved.']), ext('b', 'findings', ['Accuracy improved.'])],
    })
    expect(findings(map).map((f) => f.id)).toEqual(['finding:a:0', 'finding:b:0'])
    expect(terms(map)).toEqual([])
  })

  it('not_reported, failed and malformed findings produce none', () => {
    const map = derive({
      papers: [paper('a'), paper('b'), paper('c')],
      fields: [
        ext('a', 'findings', [], { state: 'not_reported' }),
        ext('b', 'findings', ['x y z'], { state: 'failed' }),
        ext('c', 'findings', ['Accuracy improved.'], { itemsMalformed: true }),
      ],
    })
    expect(findings(map)).toEqual([])
    expect(map.summary.findings).toBe(0)
  })
})

describe('paper nodes, status and coverage', () => {
  const papers = [
    paper('cur'), paper('old'), paper('pend'), paper('run'), paper('part'),
    paper('fail'), paper('none'), paper('proc', { status: 'processing' }),
  ]
  const map = derive({
    papers,
    overviews: [
      overview('cur'), overview('old', 'complete', true), overview('pend', 'pending'),
      overview('run', 'running'), overview('part', 'partial'), overview('fail', 'failed'),
    ],
    fields: [
      ext('cur', 'concepts', ['Attention mechanism']),
      ext('old', 'concepts', ['Attention mechanism']),
      ext('part', 'concepts', ['Attention mechanism']),
      ext('cur', 'findings', ['Accuracy improved.']),
      ext('run', 'findings', ['Latency dropped.']),
    ],
  })
  const node = (id: string) => map.nodes.find((n) => n.id === `paper:${id}`)

  it('every paper is a node, whatever its state, with its status metadata', () => {
    expect(map.nodes.filter((n) => n.type === 'paper')).toHaveLength(8)
    expect(node('cur')).toMatchObject({ statusKey: 'extracted', isStale: false, extractionStatus: 'complete' })
    expect(node('old')).toMatchObject({ statusKey: 'out_of_date', isStale: true })
    expect(node('pend')).toMatchObject({ statusKey: 'queued', extractionStatus: 'pending' })
    expect(node('run')).toMatchObject({ statusKey: 'extracting' })
    expect(node('part')).toMatchObject({ statusKey: 'partial' })
    expect(node('fail')).toMatchObject({ statusKey: 'failed' })
    expect(node('none')).toMatchObject({ statusKey: 'not_extracted', extractionStatus: null })
    expect(node('proc')).toMatchObject({ statusKey: 'waiting' })
  })

  it('stale, partial and running papers still contribute their evidence', () => {
    expect(terms(map)[0].paperIds).toEqual(['cur', 'old', 'part'])
    expect(node('old')).toMatchObject({ contributes: true })
    expect(node('part')).toMatchObject({ contributes: true })
    expect(node('run')).toMatchObject({ contributes: true }) // via a finding
  })

  it('papers without evidence are isolated nodes', () => {
    for (const id of ['pend', 'fail', 'none', 'proc']) {
      expect(node(id)).toMatchObject({ contributes: false })
      expect(map.edges.some((e) => e.from === `paper:${id}`)).toBe(false)
    }
  })

  it('computes the summary exactly', () => {
    expect(map.summary).toEqual({
      totalPapers: 8,
      contributingPapers: 4, // cur, old, part, run
      currentPapers: 1, // cur
      stalePapers: 1, // old
      activePapers: 2, // pend (queued), run (extracting)
      unextractedPapers: 2, // none, proc: no extraction record
      incompletePapers: 2, // part, fail
      sharedConcepts: 1,
      sharedMethodologies: 0,
      sharedDatasets: 0,
      findings: 2,
    })
  })

  it('ignores extraction data for papers that are not in the project', () => {
    const only = derive({
      papers: [paper('a')],
      overviews: [overview('a'), overview('ghost')],
      fields: [ext('ghost', 'findings', ['Ghost finding.']), ext('ghost', 'concepts', ['Attention mechanism'])],
    })
    expect(only.nodes).toHaveLength(1)
    expect(only.summary.totalPapers).toBe(1)
  })
})

describe('determinism', () => {
  const papers = [paper('a'), paper('b'), paper('c'), paper('d'), paper('e')]
  const overviews = [overview('a'), overview('b', 'complete', true), overview('c', 'partial'), overview('d', 'pending')]
  const fields = [
    ext('a', 'concepts', ['Fine-tuning of BERT', 'Convolutional neural network']),
    ext('b', 'concepts', ['fine tuning', 'Neural network']),
    ext('c', 'concepts', ['Fine-Tuning', 'Neural network', 'Convolutional neural network']),
    ext('a', 'methodology', ['Attention mechanism', 'C++ implementation']),
    ext('b', 'methodology', ['The attention mechanism', 'Written in C++']),
    ext('c', 'methodology', ['Self-attention mechanism']),
    ext('a', 'dataset', ['ImageNet', 'CIFAR-10']),
    ext('b', 'dataset', ['imagenet', 'cifar 10']),
    ext('a', 'findings', ['Accuracy improved.', 'Latency dropped.']),
    ext('c', 'findings', ['Accuracy improved.']),
  ]
  const permute = <T,>(list: readonly T[], seed: number): T[] => {
    const out = [...list]
    let s = seed
    for (let i = out.length - 1; i > 0; i--) {
      s = (s * 1103515245 + 12345) % 2147483648
      const j = s % (i + 1)
      ;[out[i], out[j]] = [out[j], out[i]]
    }
    return out
  }

  it('shuffled papers, overviews and fields give the identical graph', () => {
    const base = deriveResearchMap({ papers, overviews, fields })
    expect(base.nodes.length).toBeGreaterThan(10)
    for (const seed of [1, 2, 3, 4, 5, 99]) {
      const shuffled = deriveResearchMap({
        papers: permute(papers, seed),
        overviews: permute(overviews, seed + 1),
        fields: permute(fields, seed + 2),
      })
      expect(shuffled).toEqual(base)
    }
  })

  it('a duplicated record does not change the result or depend on order', () => {
    const base = deriveResearchMap({ papers, overviews, fields })
    const dupes = deriveResearchMap({
      papers: [...papers, paper('a')],
      overviews: [...overviews, overview('a')],
      fields: [...fields, ext('a', 'concepts', ['Fine-tuning of BERT', 'Convolutional neural network'])],
    })
    expect(dupes).toEqual(base)
  })

  it('nodes and edges are explicitly ordered', () => {
    const map = deriveResearchMap({ papers, overviews, fields })
    expect(map.nodes.map((n) => n.type)).toEqual(
      [...map.nodes.map((n) => n.type)].sort((x, y) => ['paper', 'term', 'finding'].indexOf(x) - ['paper', 'term', 'finding'].indexOf(y)),
    )
    const ids = map.edges.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(map.nodes.filter((n) => n.type === 'paper').map((n) => n.id)).toEqual(['paper:a', 'paper:b', 'paper:c', 'paper:d', 'paper:e'])
  })
})

describe('useful merges seen end to end', () => {
  it('finds shared concepts, methods and datasets across differently worded claims', () => {
    const map = derive({
      papers: [paper('a'), paper('b'), paper('c')],
      fields: [
        ext('a', 'concepts', ['Bidirectional transformer pre-training']),
        ext('b', 'concepts', ['Pre-training of bidirectional transformers.']),
        ext('a', 'methodology', ['Masked language modeling']),
        ext('c', 'methodology', ['Masked language modeling objective']),
        ext('a', 'dataset', ['BooksCorpus and English Wikipedia']),
        ext('b', 'dataset', ['English Wikipedia (2,500M words)']),
      ],
    })
    expect(termKeys(map)).toEqual(
      expect.arrayContaining(['concept:pre training', 'methodology:masked language modeling', 'dataset:english wikipedia']),
    )
  })
})

describe('scale', () => {
  it('derives 100 papers quickly and deterministically', () => {
    const papers = Array.from({ length: 100 }, (_, i) => paper(`p${String(i).padStart(3, '0')}`))
    const fields = papers.flatMap((p, i) => [
      ext(p.id, 'concepts', [`Topic ${i % 10} representation learning`, `Graph neural network variant ${i % 7}`]),
      ext(p.id, 'methodology', [`Contrastive pre-training ${i % 5}`, 'Stochastic gradient descent']),
      ext(p.id, 'dataset', [`Corpus ${i % 3}`]),
      ext(p.id, 'findings', [`Finding ${i}`, `Another finding ${i}`, `Third finding ${i}`]),
    ])
    const started = Date.now()
    const map = derive({ papers, overviews: papers.map((p) => overview(p.id)), fields })
    expect(Date.now() - started).toBeLessThan(3000)
    expect(map.summary.totalPapers).toBe(100)
    expect(map.summary.findings).toBe(300)
    expect(map.summary.contributingPapers).toBe(100)
    expect(map.summary.sharedConcepts).toBeGreaterThan(0)
  })
})

describe('boundaries', () => {
  const dir = new URL('./', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  const code = (f: string) =>
    readFileSync(join(dir, f), 'utf8')
      .replace(/\r\n/g, '\n')
      .replace(/\/\*[^]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('has the expected pure modules', () => {
    // view-model.ts (6B.3) is the UI's pure consumption layer, added alongside the
    // frozen derivation modules; it does not change derive/normalize/terms.
    expect(files.sort()).toEqual(['derive.ts', 'normalize.ts', 'terms.ts', 'types.ts', 'view-model.ts'])
  })

  it('imports no Supabase, LLM, worker, network or browser-data code', () => {
    for (const f of files) {
      const c = code(f)
      expect(c, f).not.toMatch(/supabase|openrouter|voyage|#\/lib\/llm|worker|process\.env|fetch\(|XMLHttpRequest|localStorage/i)
      expect(c, f).not.toMatch(/from '#\/features\/evidence-matrix\/(api|queries|ui|matrix-model|extract|prompt|schema)/)
      expect(c, f).not.toMatch(/from '#\/features\/chat/)
    }
  })

  it('only depends on evidence-matrix constants and types', () => {
    const imports = files.flatMap((f) => [...code(f).matchAll(/from '(#\/features\/[^']+)'/g)].map((m) => m[1]))
    expect([...new Set(imports)].sort()).toEqual([
      '#/features/evidence-matrix/fields',
      '#/features/evidence-matrix/status',
      '#/features/evidence-matrix/types',
      '#/features/papers/types',
    ])
  })
})

describe('single-word eligibility', () => {
  const keys = (s: string) => extractCandidates(s).map((c) => c.key)

  it.each(['Prior', 'Sequence', 'Learning', 'Network', 'Knowledge', 'Training'])(
    'rejects the ordinary word "%s" on its own (capitalized-first-letter only is not a technical signal)',
    (word) => {
      expect(keys(word)).toEqual([])
    },
  )

  it('rejects the same ordinary words when written in lowercase (no case signal at all)', () => {
    for (const word of ['prior', 'sequence', 'learning', 'network', 'knowledge']) {
      expect(keys(word)).toEqual([])
    }
  })

  it.each(['BERT', 'SQL', 'ImageNet', 'PyTorch', 'ResNet'])(
    'keeps the technical/entity-like single token "%s"',
    (word) => {
      expect(keys(word)).toEqual([word.toLowerCase()])
    },
  )

  it('keeps technical symbol tokens C++ and C#', () => {
    expect(keys('Implemented in C++')).toContain('c++')
    expect(keys('written in C#')).toContain('c#')
  })

  it('still splits GPT-4 into a two-word candidate, unaffected by the single-word rule', () => {
    expect(keys('GPT-4')).toContain('gpt 4')
    expect(keys('gpt 4')).toContain('gpt 4')
  })

  it('an all-lowercase acronym occurrence (no case signal) is not treated as technical', () => {
    // the occurrence itself carries no evidence; a differently-cased occurrence elsewhere
    // is judged on its own merits (covered in the derive-level tests below)
    expect(keys('the gpt update')).not.toContain('gpt')
  })

  it('does not merely relax the old length>=3 threshold: long ordinary words still fail', () => {
    expect(keys('Representation')).toEqual([])
    expect(keys('Classification')).toEqual([])
  })
})

describe('derive: single-word tuning (real-data motivated)', () => {
  it('A: two unrelated papers whose only lexical overlap is ordinary single words share NOTHING', () => {
    const map = derive({
      papers: [paper('a'), paper('b')],
      fields: [
        ext('a', 'concepts', ['Prior feature-based methods expose pretrained representations.']),
        ext('a', 'methodology', ['BERT packs question and passage into one sequence.']),
        ext('b', 'concepts', ['Prior Tesseract-based table extraction performs poorly.']),
        ext('b', 'methodology', ['Formulate table recognition as predicting a target token sequence.']),
      ],
    })
    expect(terms(map)).toEqual([])
    expect(map.summary.sharedConcepts).toBe(0)
    expect(map.summary.sharedMethodologies).toBe(0)
  })

  it('B: two papers sharing a meaningful multi-word technical phrase still produce a shared term', () => {
    const map = derive({
      papers: [paper('a'), paper('b')],
      fields: [
        ext('a', 'methodology', ['We use masked language modeling for pre-training.']),
        ext('b', 'methodology', ['Masked language modeling is our training objective.']),
      ],
    })
    expect(termKeys(map)).toContain('methodology:masked language modeling')
  })

  it('C: a technical single-token term in >=2 papers still becomes shared', () => {
    const map = derive({
      papers: [paper('a'), paper('b')],
      fields: [ext('a', 'concepts', ['We build on BERT.']), ext('b', 'concepts', ['BERT is widely used.'])],
    })
    expect(termKeys(map)).toEqual(['concept:bert'])
    expect(terms(map)[0]).toMatchObject({ label: 'BERT', paperIds: ['a', 'b'] })
  })

  it('D: a technical token repeated only within one paper is not shared', () => {
    const map = derive({
      papers: [paper('a'), paper('b')],
      fields: [
        ext('a', 'concepts', ['BERT is deep.', 'BERT is bidirectional.', 'BERT uses attention.']),
        ext('b', 'concepts', ['Reinforcement learning basics.']),
      ],
    })
    expect(terms(map)).toEqual([])
  })

  it('E: namespace separation remains intact for a technical single token', () => {
    const map = derive({
      papers: [paper('a'), paper('b')],
      fields: [
        ext('a', 'concepts', ['ImageNet']), ext('b', 'concepts', ['ImageNet']),
        ext('a', 'methodology', ['ImageNet']), ext('b', 'methodology', ['ImageNet']),
        ext('a', 'dataset', ['ImageNet']), ext('b', 'dataset', ['ImageNet']),
      ],
    })
    expect(terms(map).map((t) => t.id)).toEqual(['term:concept:imagenet', 'term:methodology:imagenet', 'term:dataset:imagenet'])
  })

  it('F: longest-phrase suppression stays support-set aware (multi-word candidates unaffected)', () => {
    const same = derive({
      papers: [paper('a'), paper('b')],
      fields: [ext('a', 'concepts', ['Convolutional neural network']), ext('b', 'concepts', ['Convolutional neural network'])],
    })
    expect(termKeys(same)).toEqual(['concept:convolutional neural network'])
    const differ = derive({
      papers: [paper('a'), paper('b'), paper('c'), paper('d')],
      fields: [
        ext('a', 'concepts', ['Neural network']), ext('b', 'concepts', ['Neural network']),
        ext('c', 'concepts', ['Convolutional neural network']), ext('d', 'concepts', ['Convolutional neural network']),
      ],
    })
    expect(termKeys(differ)).toEqual(['concept:convolutional neural network', 'concept:neural network'])
  })

  it('G: evidence refs and item indexes are unchanged by the tuning', () => {
    const map = derive({
      papers: [paper('a'), paper('b')],
      fields: [
        ext('a', 'concepts', ['We build on BERT.', 'Something unrelated.', 'BERT is bidirectional.']),
        ext('b', 'concepts', ['BERT is widely used.']),
      ],
    })
    const edgeA = map.edges.find((e) => e.to === 'term:concept:bert' && e.from === 'paper:a')
    expect(edgeA?.evidence).toEqual([
      { paperId: 'a', fieldKey: 'concepts', itemIndex: 0, matchedPhrase: 'BERT' },
      { paperId: 'a', fieldKey: 'concepts', itemIndex: 2, matchedPhrase: 'BERT' },
    ])
  })

  it('H: findings are unaffected by the tuning', () => {
    const map = derive({
      papers: [paper('a'), paper('b')],
      fields: [ext('a', 'findings', ['Accuracy improved.']), ext('b', 'findings', ['Accuracy improved.'])],
    })
    expect(findings(map).map((f) => f.id)).toEqual(['finding:a:0', 'finding:b:0'])
  })

  it('I: shuffled inputs still produce an identical graph with the tuned rule active', () => {
    const papers = [paper('a'), paper('b'), paper('c')]
    const fields = [
      ext('a', 'concepts', ['Prior work.', 'We build on BERT.']),
      ext('b', 'concepts', ['Prior studies.', 'BERT is widely used.']),
      ext('c', 'concepts', ['Unrelated content entirely.']),
    ]
    const overviews = [overview('a'), overview('b'), overview('c')]
    const base = deriveResearchMap({ papers, overviews, fields })
    expect(termKeys(base)).toEqual(['concept:bert'])
    for (const seed of [1, 2, 3]) {
      const shuffled = deriveResearchMap({
        papers: [...papers].reverse(),
        overviews: overviews.slice(seed % 3).concat(overviews.slice(0, seed % 3)),
        fields: [...fields].sort(() => 0.5 - (seed % 2)),
      })
      expect(shuffled).toEqual(base)
    }
  })
})
