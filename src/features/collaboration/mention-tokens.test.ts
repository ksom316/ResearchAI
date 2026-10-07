import { describe, expect, it } from 'vitest'
import {
  buildMentionToken,
  extractMentionedUserIds,
  extractMentionTokens,
  findActiveMentionQuery,
  insertMentionToken,
  renderMentionBody,
} from './mention-tokens'

const UID = '11111111-1111-1111-1111-111111111111'
const UID2 = '22222222-2222-2222-2222-222222222222'

describe('buildMentionToken / extractMentionTokens', () => {
  it('round-trips a mention token', () => {
    const token = buildMentionToken(UID, 'Jane Doe')
    expect(extractMentionTokens(`Hi ${token}, thoughts?`)).toEqual([
      { userId: UID, displayName: 'Jane Doe' },
    ])
  })

  it('strips a stray ] from the display name so it cannot break the token', () => {
    const token = buildMentionToken(UID, 'Weird]Name')
    expect(token).not.toContain('Weird]Name')
    expect(extractMentionTokens(token)[0].displayName).toBe('WeirdName')
  })

  it('de-duplicates repeated mentions of the same user', () => {
    const token = buildMentionToken(UID, 'Jane Doe')
    const body = `${token} and also ${token} again`
    expect(extractMentionedUserIds(body)).toEqual([UID])
  })

  it('preserves mention order and supports multiple distinct users', () => {
    const body = `${buildMentionToken(UID2, 'Bob')} then ${buildMentionToken(UID, 'Jane')}`
    expect(extractMentionedUserIds(body)).toEqual([UID2, UID])
  })

  it('returns no tokens for plain text, including an unresolved "@word"', () => {
    expect(extractMentionTokens('just a normal comment @someone')).toEqual([])
  })
})

describe('renderMentionBody', () => {
  it('splits text and mention segments in order', () => {
    const token = buildMentionToken(UID, 'Jane Doe')
    expect(renderMentionBody(`Hi ${token}, thoughts?`)).toEqual([
      { kind: 'text', text: 'Hi ' },
      { kind: 'mention', userId: UID, displayName: 'Jane Doe' },
      { kind: 'text', text: ', thoughts?' },
    ])
  })

  it('returns a single text segment when there are no mentions', () => {
    expect(renderMentionBody('no mentions here')).toEqual([
      { kind: 'text', text: 'no mentions here' },
    ])
  })

  it('handles a body that is only a mention', () => {
    const token = buildMentionToken(UID, 'Jane')
    expect(renderMentionBody(token)).toEqual([
      { kind: 'mention', userId: UID, displayName: 'Jane' },
    ])
  })
})

describe('findActiveMentionQuery', () => {
  it('finds the query right after a bare @', () => {
    expect(findActiveMentionQuery('hello @ja', 9)).toEqual({ start: 6, query: 'ja' })
  })

  it('returns null when there is no @ before the cursor', () => {
    expect(findActiveMentionQuery('hello there', 11)).toBeNull()
  })

  it('returns null for an email-like "a@b" (word character before @)', () => {
    expect(findActiveMentionQuery('contact a@b', 11)).toBeNull()
  })

  it('returns null once the trigger is closed by whitespace', () => {
    expect(findActiveMentionQuery('@jane said hi', 13)).toBeNull()
  })

  it('returns null right after a completed token', () => {
    const token = buildMentionToken(UID, 'Jane')
    const text = `${token} and `
    expect(findActiveMentionQuery(text, text.length)).toBeNull()
  })

  it('finds an empty query right at the @', () => {
    expect(findActiveMentionQuery('@', 1)).toEqual({ start: 0, query: '' })
  })
})

describe('insertMentionToken', () => {
  it('replaces the active query with a token and places the cursor after it', () => {
    const { text, cursor } = insertMentionToken('hi @ja', 3, 6, UID, 'Jane Doe')
    expect(text).toBe(`hi ${buildMentionToken(UID, 'Jane Doe')} `)
    expect(text.slice(0, cursor)).toBe(`hi ${buildMentionToken(UID, 'Jane Doe')} `)
    expect(extractMentionedUserIds(text)).toEqual([UID])
  })
})
