import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AskOutcome, ChatCitation } from '../types'
import { AnswerView, SourcePanel } from './answer-view'
import { ChatSession } from './chat-session'
import type { AskFn } from './chat-session'
import { ERROR_MESSAGES, NO_EVIDENCE_MESSAGE } from './messages'

const PROJECT = '33333333-3333-4333-8333-333333333333'
const CHUNK = 'chunk-uuid-should-never-show'

const citation = (n: number): ChatCitation => ({
  id: `S${n}`,
  paperId: `paper-${n}`,
  paperTitle: `Paper <b>${n}</b>`,
  chunkId: CHUNK,
  sectionTitle: `Section ${n}`,
  sectionType: 'related_work',
  pageStart: n,
  pageEnd: n + 1,
})

const answered: AskOutcome = {
  ok: true,
  status: 'answered',
  segments: [
    { text: 'First claim <script>alert(1)</script>.', citations: ['S1'] },
    { text: 'Second claim.', citations: ['S1', 'S2'] },
  ],
  citations: [citation(1), citation(2)],
  explanation: null,
  limitations: 'Only two papers cover this.',
  followUps: [],
  coverage: [],
}

const other = (
  over: Partial<Extract<AskOutcome, { ok: true }>>,
): AskOutcome => ({
  ok: true,
  status: 'no_evidence',
  segments: [],
  citations: [],
  explanation: null,
  limitations: null,
  followUps: [],
  coverage: [],
  ...over,
})

const render = (outcome: AskOutcome, selectedId: string | null = null) =>
  renderToStaticMarkup(
    createElement(AnswerView, {
      outcome,
      selectedId,
      onSelectCitation: () => undefined,
      viewPaper: (paperId: string) =>
        createElement('a', { href: `/papers/${paperId}` }, 'View paper'),
    }),
  )

function session(outcome: AskOutcome | (() => Promise<AskOutcome>)) {
  const ask = vi.fn(async (_options: Parameters<AskFn>[0]) =>
    typeof outcome === 'function' ? outcome() : outcome,
  )
  return { ask, chat: new ChatSession(PROJECT, ask) }
}

describe('ChatSession requests', () => {
  it('sends only question + project scope, exactly once per submission', async () => {
    const { ask, chat } = session(answered)
    expect(await chat.submit('  What are the main findings?  ')).toBe('sent')
    expect(ask).toHaveBeenCalledTimes(1)
    expect(ask).toHaveBeenCalledWith({
      data: {
        question: 'What are the main findings?',
        scope: { type: 'project', projectId: PROJECT },
      },
    })
    expect(Object.keys(ask.mock.calls[0][0].data).sort()).toEqual([
      'question',
      'scope',
    ])
  })

  it('does not send earlier turns back: every request is independent', async () => {
    const { ask, chat } = session(answered)
    await chat.submit('First question here')
    await chat.submit('Second question here')
    expect(ask).toHaveBeenCalledTimes(2)
    const second = JSON.stringify(ask.mock.calls[1][0])
    expect(second).not.toContain('First question here')
    expect(second).not.toContain('First claim')
    expect(chat.getSnapshot().turns.map((t) => t.question)).toEqual([
      'First question here',
      'Second question here',
    ])
  })

  it('ignores a second submission while one is running (no duplicate request)', async () => {
    let finish: (o: AskOutcome) => void = () => undefined
    const { ask, chat } = session(
      () => new Promise<AskOutcome>((resolve) => (finish = resolve)),
    )
    const first = chat.submit('Slow question here')
    expect(chat.getSnapshot().busy).toBe(true)
    expect(await chat.submit('Double click question')).toBe('busy')
    expect(await chat.submit('Another one here')).toBe('busy')
    expect(ask).toHaveBeenCalledTimes(1)
    finish(answered)
    await first
    expect(chat.getSnapshot().busy).toBe(false)
    expect(chat.getSnapshot().turns).toHaveLength(1)
  })

  it('rejects empty and invalid questions without calling the backend', async () => {
    const { ask, chat } = session(answered)
    for (const bad of ['', '   ', '?', '!!!', 'x'.repeat(1001)]) {
      expect(await chat.submit(bad)).toBe('invalid')
    }
    expect(ask).not.toHaveBeenCalled()
    expect(chat.getSnapshot().turns).toEqual([])
  })

  it('turns a thrown backend failure into a safe error without retrying', async () => {
    const ask = vi.fn(async (_o: Parameters<AskFn>[0]): Promise<AskOutcome> => {
      throw new Error('boom sk-or-SECRET stack trace')
    })
    const chat = new ChatSession(PROJECT, ask)
    await chat.submit('A real question here')
    expect(ask).toHaveBeenCalledTimes(1)
    const outcome = chat.getSnapshot().turns[0].outcome
    expect(outcome).toEqual({ ok: false, error: 'answer_unavailable' })
    expect(JSON.stringify(outcome)).not.toContain('SECRET')
  })
})

describe('AnswerView', () => {
  it('renders segments as text with clickable citation chips', () => {
    const html = render(answered)
    expect(html).toContain('First claim')
    expect(html).toContain('[S1]')
    expect(html).toContain('[S2]')
    expect(html).toContain('aria-pressed="false"')
    expect(html).toContain('Limitations: Only two papers cover this.')
  })

  it('escapes model text and titles (no HTML injection)', () => {
    const html = render(answered, 'S1')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<b>1</b>')
  })

  it('shows the source panel for the selected citation only', () => {
    expect(render(answered)).not.toContain('aria-label="Source S1"')
    const html = render(answered, 'S2')
    expect(html).toContain('aria-label="Source S2"')
    expect(html).toContain('Section 2')
    expect(html).toContain('related work')
    expect(html).toContain('pp. 2–3')
    expect(html).toContain('href="/papers/paper-2"')
    expect(html).toContain('aria-pressed="true"')
  })

  it('never displays chunk ids, scores or other internal metadata', () => {
    const html = render(answered, 'S1')
    expect(html).not.toContain(CHUNK)
    expect(html).not.toMatch(
      /similarity|embedding|content_hash|user_id|storage_path/i,
    )
  })

  it('does not render a chip for a citation id the server did not build', () => {
    const html = render({
      ...answered,
      segments: [{ text: 'Claim.', citations: ['S1', 'S99'] }],
    })
    expect(html).toContain('[S1]')
    expect(html).not.toContain('S99')
  })

  it('explains no_evidence', () => {
    expect(render(other({ status: 'no_evidence' }))).toContain(
      NO_EVIDENCE_MESSAGE.slice(0, 40),
    )
  })

  it.each(['insufficient_evidence', 'out_of_scope'] as const)(
    'shows the server explanation for %s',
    (status) => {
      const html = render(other({ status, explanation: 'Not covered here.' }))
      expect(html).toContain('Not covered here.')
      expect(html).not.toContain('[S')
    },
  )

  it.each(Object.keys(ERROR_MESSAGES))(
    'maps error code %s to friendly copy',
    (code) => {
      const html = render({ ok: false, error: code } as AskOutcome)
      const message = ERROR_MESSAGES[code as keyof typeof ERROR_MESSAGES]
      expect(html).toContain(message.slice(0, 25))
      expect(html).not.toContain(code)
    },
  )

  it('falls back safely on an unknown error code', () => {
    const html = render({
      ok: false,
      error: 'weird_internal',
    } as unknown as AskOutcome)
    expect(html).not.toContain('weird_internal')
    expect(html).toContain('An answer could not be produced')
  })
})

describe('SourcePanel', () => {
  it('shows paper, section and pages but never the chunk id', () => {
    const html = renderToStaticMarkup(
      createElement(SourcePanel, { citation: citation(1), viewPaper: null }),
    )
    expect(html).toContain('Section 1')
    expect(html).toContain('pp. 1–2')
    expect(html).not.toContain(CHUNK)
  })
})

describe('chat UI boundaries', () => {
  const dir = new URL('.', import.meta.url).pathname.replace(
    /^\/([A-Za-z]:)/,
    '$1',
  )
  const files = readdirSync(dir).filter(
    (f) => /\.tsx?$/.test(f) && !f.endsWith('.test.ts'),
  )
  const code = (f: string) => readFileSync(join(dir, f), 'utf8')

  it('never uses innerHTML and never touches search, RPCs, env or service role', () => {
    for (const file of files) {
      const text = code(file)
      expect(text, file).not.toMatch(/dangerouslySetInnerHTML|innerHTML/)
      expect(text, file).not.toMatch(
        /semanticSearchFn|runSemanticSearch|\.rpc\(|supabase|process\.env|import\.meta\.env|service_role/i,
      )
    }
  })

  it('askResearchFn is the only backend entry point, with project scope built in one place', () => {
    const importers = files.filter((f) => /ask\.functions/.test(code(f)))
    expect(importers).toEqual(['chat-panel.tsx'])
    expect(code('chat-session.ts')).toMatch(
      /scope: \{ type: 'project', projectId: this\.projectId \}/,
    )
  })
})
