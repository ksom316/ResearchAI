/**
 * Conservative, deterministic text normalization for matching. Deliberately NOT done:
 * stemming, lemmatization, singularization, fuzzy or edit-distance matching, acronym
 * expansion. "neural network" and "neural networks" stay different terms.
 */
export type Token = {
  /** As written (after NFKC). */
  text: string
  /** Lowercased matching form. */
  norm: string
  /** Offsets into the returned `text`. */
  start: number
  end: number
}

// A decimal number, or a run of letters/digits (optionally ending in +/#, so "c++" and "c#"
// survive). Hyphens, slashes and underscores are not part of a token: they separate tokens.
const TOKEN = /\p{N}+(?:\.\p{N}+)+|[\p{L}\p{N}\p{M}]+(?:[+#]+)?/gu

/** Unicode NFKC, with possessives and intra-word apostrophes removed ("BERT's" -> "BERT"). */
export function canonicalText(source: string): string {
  return source
    .normalize('NFKC')
    .replace(/['’]s\b/gu, '')
    .replace(/(?<=\p{L})['’](?=\p{L})/gu, '')
}

export function tokenize(source: string): { text: string; tokens: Token[] } {
  const text = canonicalText(source)
  const tokens: Token[] = []
  for (const match of text.matchAll(TOKEN)) {
    const start = match.index
    tokens.push({
      text: match[0],
      norm: match[0].toLowerCase(),
      start,
      end: start + match[0].length,
    })
  }
  return { text, tokens }
}

const LEADING_ARTICLES = new Set(['a', 'an', 'the'])

/**
 * The matching key for a phrase: NFKC, lowercase, separators and punctuation collapsed to
 * single spaces, leading articles dropped. "Convolutional-Neural  Network!" ->
 * "convolutional neural network".
 */
export function normalizePhrase(source: string): string {
  const words = tokenize(source).tokens.map((t) => t.norm)
  while (words.length > 1 && LEADING_ARTICLES.has(words[0])) words.shift()
  if (words.length === 1 && LEADING_ARTICLES.has(words[0])) return ''
  return words.join(' ')
}
