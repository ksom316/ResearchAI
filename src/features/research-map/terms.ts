import { tokenize } from './normalize'
import type { Token } from './normalize'

/**
 * Candidate terms from one claim. Plain token/phrase logic, no NLP: the aim is to miss a
 * relationship rather than invent one.
 */
export const MAX_TERM_WORDS = 4

// Function words: never part of a candidate (except "of" strictly inside one).
const STOPWORDS = new Set(
  `a an the and or but nor of in on at to for from by with without within into onto over
  under between among through during before after above below up down out off again
  further then once here there when where why how all any both each few more most other
  some such no not only own same so than too very can will just should now is are was were
  be been being have has had having do does did doing this that these those i we you he she
  it they them their our your its his her my me us who whom which what whose as if while
  because until about against also however thus therefore via per et al e g etc may might
  must shall would could whether either neither yet still even much many several various
  one two three first second third`.split(/\s+/),
)

// Vague words: never at the edge of a candidate.
const GENERIC = new Set(
  `paper papers study studies work works result results approach approaches novel new
  proposed propose proposes present presents show shows shown demonstrate demonstrates
  demonstrated improve improves improved improvement introduce introduces introduced
  author authors research based use uses used using apply applied applies achieve achieves
  achieved obtain obtained different general standard existing recent effective efficient
  significant significantly better best high higher large larger small important main key
  way ways case cases example examples step steps overall various simple`.split(/\s+/),
)

// Weak on their own: fine at the edge of a phrase that has a meaningful word ("language
// model"), but a candidate made only of these ("training data", "model") is rejected.
const WEAK = new Set(
  `model models method methods system systems framework frameworks technique techniques
  task tasks data performance analysis training evaluation experiment experiments
  experimental problem problems algorithm algorithms process processes set sets number
  type types dataset datasets`.split(/\s+/),
)

const NUMERIC = /^[\p{N}.]+$/u
const HAS_SYMBOL = /[+#]/
const LETTER = /\p{L}/u
const UPPER_LETTER = /\p{Lu}/u

const isStop = (t: Token) => STOPWORDS.has(t.norm)
const isNumeric = (t: Token) => NUMERIC.test(t.norm)
const longEnough = (t: Token) => t.norm.length >= 2 || HAS_SYMBOL.test(t.norm)

/**
 * Deterministic, lexical-only signal that a single token is a technical/entity name
 * rather than an ordinary word: an acronym-like all-uppercase form ("BERT", "SQL"), or a
 * mixed-case form with a capital letter beyond the first ("ImageNet", "PyTorch",
 * "ResNet"). Inspects the token AS WRITTEN (before normalization discards case), so an
 * ordinary capitalized word ("Prior", "Sequence", "Learning") - which has a capital only
 * at position 0 - does not qualify. No curated allowlist is needed for this: every
 * required technical example is recoverable from its written form alone.
 */
function isTechnicalToken(t: Token): boolean {
  const letters = [...t.text].filter((ch) => LETTER.test(ch))
  if (letters.length < 2 || !letters.some((ch) => UPPER_LETTER.test(ch))) return false
  const allUpper = letters.every((ch) => UPPER_LETTER.test(ch))
  return allUpper || UPPER_LETTER.test(t.text.slice(1))
}

/** A word that carries meaning by itself. */
const isMeaningful = (t: Token) =>
  !isStop(t) &&
  !GENERIC.has(t.norm) &&
  !WEAK.has(t.norm) &&
  !isNumeric(t) &&
  longEnough(t)

// Punctuation between two tokens that ends a phrase (hyphens and slashes do not).
const BREAK = /[,;:.!?()[\]{}"“”‘’…—–]/u

export type TermCandidate = {
  /** Normalized matching key: lowercased tokens joined by single spaces. */
  key: string
  /** The phrase as written (NFKC), for display and for highlighting later. */
  phrase: string
  /** Number of words in the phrase. */
  words: number
}

function validWindow(window: readonly Token[]): boolean {
  const first = window[0]
  const last = window[window.length - 1]
  // Edges: no function words, no vague words. A number may end a phrase ("gpt 4") but not
  // start one.
  if (isStop(first) || GENERIC.has(first.norm) || isNumeric(first) || !longEnough(first)) return false
  if (isStop(last) || GENERIC.has(last.norm)) return false
  if (!isNumeric(last) && !longEnough(last)) return false
  // Inside: no function words, except "of" ("bag of words").
  for (let i = 1; i < window.length - 1; i++) {
    if (isStop(window[i]) && window[i].norm !== 'of') return false
  }
  if (!window.some(isMeaningful)) return false
  if (window.length === 1) {
    // An ordinary single word ("prior", "sequence", "network") no longer qualifies on
    // its own: it must be a technical symbol token (C++, C#) or look like a technical
    // name/entity by its written form (BERT, ImageNet). See isTechnicalToken.
    const only = window[0]
    return HAS_SYMBOL.test(only.norm) || isTechnicalToken(only)
  }
  return true
}

/**
 * Every 1-4 word candidate in the claim, unique by key (the first occurrence's wording is
 * kept). Windows never cross clause punctuation or a function word.
 */
export function extractCandidates(claim: string): TermCandidate[] {
  const { text, tokens } = tokenize(claim)
  const out = new Map<string, TermCandidate>()

  // Split into runs at clause punctuation.
  const runs: Token[][] = []
  let run: Token[] = []
  for (const [i, token] of tokens.entries()) {
    if (i > 0 && BREAK.test(text.slice(tokens[i - 1].end, token.start))) {
      runs.push(run)
      run = []
    }
    run.push(token)
  }
  if (run.length > 0) runs.push(run)

  for (const r of runs) {
    for (let i = 0; i < r.length; i++) {
      for (let len = 1; len <= MAX_TERM_WORDS && i + len <= r.length; len++) {
        const window = r.slice(i, i + len)
        if (!validWindow(window)) continue
        const key = window.map((t) => t.norm).join(' ')
        if (out.has(key)) continue
        out.set(key, {
          key,
          phrase: text.slice(window[0].start, window[len - 1].end),
          words: len,
        })
      }
    }
  }
  return [...out.values()]
}
