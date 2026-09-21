import { describe, expect, it } from 'vitest'
import {
  CLAIM_CHECK_JSON_SCHEMA,
  claimCheckModelOutputSchema,
  MAX_CLAIM_CHECK_RATIONALE_CHARS,
  MAX_CLAIM_CHECK_SUMMARY_CHARS,
} from './model-schema'

const valid = {
  overall_support: 'supported',
  summary: 'The claim is explicitly supported.',
  unsupported_fragments: [],
  citation_assessments: [
    { evidence_id: 'C1', support: 'supported', rationale: 'Direct support.' },
  ],
}

describe('Claim Checker model schema', () => {
  it('accepts the strict structured response and exposes strict JSON Schema', () => {
    expect(claimCheckModelOutputSchema.safeParse(valid).success).toBe(true)
    expect(CLAIM_CHECK_JSON_SCHEMA.schema.additionalProperties).toBe(false)
    expect(
      CLAIM_CHECK_JSON_SCHEMA.schema.properties.citation_assessments.items
        .additionalProperties,
    ).toBe(false)
  })

  it.each([
    ['top-level extra', { ...valid, confidence: 0.9 }],
    [
      'citation extra',
      {
        ...valid,
        citation_assessments: [
          { ...valid.citation_assessments[0], paperTitle: 'forged' },
        ],
      },
    ],
    ['invalid enum', { ...valid, overall_support: 'mostly_supported' }],
    ['oversized summary', { ...valid, summary: 's'.repeat(MAX_CLAIM_CHECK_SUMMARY_CHARS + 1) }],
    [
      'oversized rationale',
      {
        ...valid,
        citation_assessments: [
          { ...valid.citation_assessments[0], rationale: 'r'.repeat(MAX_CLAIM_CHECK_RATIONALE_CHARS + 1) },
        ],
      },
    ],
    ['malformed id', { ...valid, citation_assessments: [{ ...valid.citation_assessments[0], evidence_id: 'W1' }] }],
    ['empty result', {}],
  ])('rejects %s', (_name, output) => {
    expect(claimCheckModelOutputSchema.safeParse(output).success).toBe(false)
  })
})
