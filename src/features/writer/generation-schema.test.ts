import { describe, expect, it } from 'vitest'
import {
  MAX_WRITER_GENERATED_CHARS,
  MAX_WRITER_PARAGRAPHS,
  MAX_WRITER_UNIT_CHARS,
  MAX_WRITER_UNIT_CITATIONS,
  MAX_WRITER_UNITS,
  MAX_WRITER_UNITS_PER_PARAGRAPH,
  WRITER_DRAFT_JSON_SCHEMA,
  writerModelOutputSchema,
} from './generation-schema'

const unit = (overrides: Record<string, unknown> = {}) => ({
  text: 'A supported statement.',
  citation_ids: ['W1'],
  ...overrides,
})
const generated = (paragraphs: unknown[] = [{ units: [unit()] }]) => ({
  status: 'generated',
  paragraphs,
})

describe('Writer model output schema', () => {
  it('accepts a valid generated response', () => {
    expect(writerModelOutputSchema.safeParse(generated()).success).toBe(true)
  })

  it('accepts only an empty insufficient-evidence response', () => {
    expect(
      writerModelOutputSchema.safeParse({
        status: 'insufficient_evidence',
        paragraphs: [],
      }).success,
    ).toBe(true)
    expect(
      writerModelOutputSchema.safeParse({
        status: 'insufficient_evidence',
        paragraphs: [{ units: [unit()] }],
      }).success,
    ).toBe(false)
    expect(
      writerModelOutputSchema.safeParse({
        status: 'insufficient_evidence',
        paragraphs: [],
        explanation: 'Model-authored explanation',
      }).success,
    ).toBe(false)
  })

  it.each([
    ['top-level', { ...generated(), explanation: 'model text' }],
    [
      'paragraph',
      generated([{ units: [unit()], heading: 'Unsupported heading' }]),
    ],
    ['unit', generated([{ units: [unit({ confidence: 0.9 })] }])],
  ])('rejects extra %s fields', (_name, value) => {
    expect(writerModelOutputSchema.safeParse(value).success).toBe(false)
  })

  it('enforces paragraph and per-paragraph unit limits', () => {
    expect(
      writerModelOutputSchema.safeParse(
        generated(
          Array.from({ length: MAX_WRITER_PARAGRAPHS + 1 }, () => ({
            units: [unit()],
          })),
        ),
      ).success,
    ).toBe(false)
    expect(
      writerModelOutputSchema.safeParse(
        generated([
          {
            units: Array.from(
              { length: MAX_WRITER_UNITS_PER_PARAGRAPH + 1 },
              () => unit(),
            ),
          },
        ]),
      ).success,
    ).toBe(false)
  })

  it('enforces the total unit limit', () => {
    const paragraphs = Array.from({ length: 4 }, () => ({
      units: Array.from({ length: 3 }, () => unit()),
    }))
    expect(
      paragraphs.flatMap((paragraph) => paragraph.units).length,
    ).toBeGreaterThan(MAX_WRITER_UNITS)
    expect(
      writerModelOutputSchema.safeParse(generated(paragraphs)).success,
    ).toBe(false)
  })

  it('enforces unit and total text limits', () => {
    expect(
      writerModelOutputSchema.safeParse(
        generated([
          { units: [unit({ text: 'x'.repeat(MAX_WRITER_UNIT_CHARS + 1) })] },
        ]),
      ).success,
    ).toBe(false)
    const paragraphs = Array.from({ length: 4 }, (_, paragraph) => ({
      units: Array.from({ length: paragraph < 3 ? 3 : 1 }, () =>
        unit({ text: 'x'.repeat(401) }),
      ),
    }))
    expect(
      paragraphs
        .flatMap((value) => value.units)
        .reduce((sum, value) => sum + String(value.text).length, 0),
    ).toBeGreaterThan(MAX_WRITER_GENERATED_CHARS)
    expect(
      writerModelOutputSchema.safeParse(generated(paragraphs)).success,
    ).toBe(false)
  })

  it('enforces citation count and identifier syntax', () => {
    expect(
      writerModelOutputSchema.safeParse(
        generated([
          {
            units: [
              unit({
                citation_ids: Array.from(
                  { length: MAX_WRITER_UNIT_CITATIONS + 1 },
                  (_, index) => `W${index + 1}`,
                ),
              }),
            ],
          },
        ]),
      ).success,
    ).toBe(false)
    for (const id of ['S1', 'W0x', 'W 1', 'w1', 'W1000']) {
      expect(
        writerModelOutputSchema.safeParse(
          generated([{ units: [unit({ citation_ids: [id] })] }]),
        ).success,
      ).toBe(false)
    }
  })

  it('publishes equivalent strict provider-side structural limits', () => {
    const root = WRITER_DRAFT_JSON_SCHEMA.schema
    expect(root.additionalProperties).toBe(false)
    expect(root.properties.paragraphs.maxItems).toBe(MAX_WRITER_PARAGRAPHS)
    const paragraph = root.properties.paragraphs.items
    expect(paragraph.additionalProperties).toBe(false)
    expect(paragraph.properties.units.maxItems).toBe(
      MAX_WRITER_UNITS_PER_PARAGRAPH,
    )
    const providerUnit = paragraph.properties.units.items
    expect(providerUnit.additionalProperties).toBe(false)
    expect(providerUnit.properties.text.maxLength).toBe(MAX_WRITER_UNIT_CHARS)
    expect(providerUnit.properties.citation_ids.maxItems).toBe(
      MAX_WRITER_UNIT_CITATIONS,
    )
  })
})
