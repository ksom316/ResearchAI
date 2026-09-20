import { describe, expect, it } from 'vitest'
import { MAX_WRITER_FOCUS_CHARS, writerRequestSchema } from './schemas'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const PAPER_1 = '22222222-2222-4222-8222-222222222222'
const PAPER_2 = '33333333-3333-4333-8333-333333333333'

describe('writer request schema', () => {
  it.each([
    ['literature_synthesis', { focus: '  table recognition  ' }],
    ['compare_studies', { paperIds: [PAPER_1, PAPER_2] }],
    ['methodology_summary', {}],
    ['findings_synthesis', { paperIds: [PAPER_1] }],
    ['limitations_future_work', {}],
  ] as const)('accepts supported mode %s', (mode, extra) => {
    expect(
      writerRequestSchema.safeParse({ projectId: PROJECT, mode, ...extra })
        .success,
    ).toBe(true)
  })

  it('normalizes bounded focus text', () => {
    const parsed = writerRequestSchema.parse({
      projectId: PROJECT,
      mode: 'literature_synthesis',
      focus: '  table\u200B   recognition  ',
    })
    expect(parsed).toMatchObject({
      focus: expect.stringMatching(/^table recognition/),
    })
    expect('focus' in parsed && parsed.focus.length).toBeLessThanOrEqual(
      MAX_WRITER_FOCUS_CHARS,
    )
  })

  it.each([
    { projectId: PROJECT, mode: 'unknown' },
    { projectId: 'not-a-uuid', mode: 'methodology_summary' },
    { projectId: PROJECT, mode: 'literature_synthesis' },
    { projectId: PROJECT, mode: 'literature_synthesis', focus: '   ' },
    {
      projectId: PROJECT,
      mode: 'literature_synthesis',
      focus: 'x'.repeat(MAX_WRITER_FOCUS_CHARS + 1),
    },
    { projectId: PROJECT, mode: 'compare_studies', paperIds: [PAPER_1] },
    {
      projectId: PROJECT,
      mode: 'compare_studies',
      paperIds: [PAPER_1, PAPER_1],
    },
    {
      projectId: PROJECT,
      mode: 'methodology_summary',
      paperIds: Array.from(
        { length: 6 },
        (_, index) => `00000000-0000-4000-8000-00000000000${index}`,
      ),
    },
    {
      projectId: PROJECT,
      mode: 'literature_synthesis',
      focus: 'tables',
      paperIds: [PAPER_1],
    },
    {
      projectId: PROJECT,
      mode: 'findings_synthesis',
      focus: 'irrelevant',
    },
    {
      projectId: PROJECT,
      mode: 'methodology_summary',
      userId: PAPER_1,
    },
    {
      projectId: PROJECT,
      mode: 'limitations_future_work',
      gapCandidateId: 'gap:v2:forged',
    },
  ])('rejects invalid or browser-forbidden input %#', (input) => {
    expect(writerRequestSchema.safeParse(input).success).toBe(false)
  })
})
