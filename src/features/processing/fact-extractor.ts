import { pageAt } from './normalize'
import type { DetectedFact, DetectedTable, NormalizedDocument } from './types'

/**
 * Deterministic structured-fact extraction (R12), scoped to a short list of
 * financial metrics. This is a labeled-value extractor, not a general NLP
 * model or an accounting engine: it only reports a metric when a known label
 * sits next to a number it can parse, and it always keeps the original text
 * so a human can check it against the page.
 */

type MetricRule = { metric: string; pattern: RegExp }

const METRIC_RULES: readonly MetricRule[] = [
  { metric: 'revenue', pattern: /\b(?:total )?revenue[s]?\b/i },
  { metric: 'net_income', pattern: /\bnet income\b/i },
  { metric: 'gross_profit', pattern: /\bgross profit\b/i },
  { metric: 'gross_margin', pattern: /\bgross margin\b/i },
  { metric: 'operating_expenses', pattern: /\boperating expenses?\b/i },
  { metric: 'operating_income', pattern: /\boperating income\b/i },
  { metric: 'total_assets', pattern: /\btotal assets\b/i },
  { metric: 'total_liabilities', pattern: /\btotal liabilities\b/i },
  { metric: 'cash_and_equivalents', pattern: /\bcash and (?:cash )?equivalents\b/i },
  { metric: 'net_margin', pattern: /\bnet margin\b/i },
]

const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  $: 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'JPY',
}

const SCALE: Readonly<Record<string, number>> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  mm: 1e6,
  million: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
}

/** A number with optional currency symbol, thousands separators and scale suffix/word. */
const NUMBER_PATTERN =
  /([$€£¥])?\s?(-?[\d,]+(?:\.\d+)?)\s?(k|mm?|bn?|thousand|million|billion)?\b/gi

/**
 * Finds the first number in `text` that is actually a value for the metric,
 * not an incidental 4-digit year ("FY2025 was $12.4 million" must bind to
 * 12.4M, not 2025): a bare integer with no currency symbol, scale word or
 * decimal point is skipped.
 */
function findValueNumber(text: string): RegExpExecArray | null {
  const pattern = new RegExp(NUMBER_PATTERN)
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    const [, symbol, digits, scale] = match
    const looksLikeValue = Boolean(symbol) || Boolean(scale) || digits.includes('.')
    if (looksLikeValue) return match
  }
  return null
}

const PERCENT_SUFFIX = /%\s*$/

const PERIOD_PATTERN = /\b(?:FY\s?-?\s?(\d{4})|Q[1-4]\s+(\d{4})|(?:19|20)\d{2})\b/i

function parseNumber(raw: {
  symbol?: string
  digits: string
  scale?: string
}): number | null {
  const digits = raw.digits.replace(/,/g, '')
  const value = Number(digits)
  if (!Number.isFinite(value)) return null
  const scale = raw.scale ? SCALE[raw.scale.toLowerCase()] ?? 1 : 1
  return value * scale
}

function findPeriod(windowText: string): string | null {
  const match = PERIOD_PATTERN.exec(windowText)
  if (!match) return null
  if (match[1]) return `FY${match[1]}`
  if (match[2]) return `${match[0].split(/\s+/)[0]} ${match[2]}`
  return match[0]
}

/** Builds a fact from a matched metric + the text window right after its label. */
function buildFact(
  metric: string,
  rest: string,
  rawText: string,
  periodSource: string,
  pageNumber: number | null,
  tableIndex: number | null,
): DetectedFact | null {
  const numberMatch = findValueNumber(rest)
  if (!numberMatch) return null
  const isPercent = PERCENT_SUFFIX.test(
    rest.slice(numberMatch.index, numberMatch.index + numberMatch[0].length + 2),
  )
  const value = parseNumber({
    symbol: numberMatch[1],
    digits: numberMatch[2],
    scale: numberMatch[3],
  })
  const currency = numberMatch[1] ? CURRENCY_SYMBOLS[numberMatch[1]] ?? null : null
  return {
    metric,
    value,
    unit: isPercent ? 'percent' : numberMatch[3] ? numberMatch[3].toLowerCase() : null,
    currency,
    period: findPeriod(periodSource),
    rawText: rawText.trim().slice(0, 300),
    pageNumber,
    tableIndex,
    confidence: value !== null ? 0.7 : 0.3,
  }
}

/**
 * Looks for "<metric label> ... <number>" within one line of prose, so the
 * match stays local and doesn't jump across unrelated sentences.
 */
function extractFromLine(line: string, pageNumber: number | null): DetectedFact[] {
  const facts: DetectedFact[] = []
  for (const rule of METRIC_RULES) {
    const labelMatch = rule.pattern.exec(line)
    if (!labelMatch) continue
    const rest = line.slice(labelMatch.index + labelMatch[0].length)
    const fact = buildFact(rule.metric, rest, line, line, pageNumber, null)
    if (fact) facts.push(fact)
  }
  return facts
}

/** Extracts facts from prose, scanning line by line and mapping each hit to its page. */
export function extractFactsFromText(doc: NormalizedDocument): DetectedFact[] {
  const facts: DetectedFact[] = []
  let offset = 0
  for (const line of doc.text.split('\n')) {
    facts.push(...extractFromLine(line, pageAt(doc, offset)))
    offset += line.length + 1
  }
  return facts
}

/**
 * Extracts facts from detected tables. Financial tables print metrics in two
 * common shapes, and a table can only be read correctly if its shape is
 * known, so both are tried:
 *  - metric-per-COLUMN ("Quarter | Revenue | Net income", one row per
 *    period): a header cell names the metric, each row's cell under it is a
 *    value for that row's period.
 *  - metric-per-ROW ("Net income | FY2024 | FY2025", one column per
 *    period): the row's first cell names the metric, each remaining cell is
 *    a value for the column header's period.
 * Either way, "Net income" and its value are read from the header/row grid
 * from table-detector.ts, never from flattened row text, because they are
 * rarely on the same line in the source table.
 */
export function extractFactsFromTables(tables: readonly DetectedTable[]): DetectedFact[] {
  const facts: DetectedFact[] = []
  for (const table of tables) {
    const metricColumns = table.headers
      .map((header, index) => {
        const rule = METRIC_RULES.find((r) => r.pattern.test(header))
        return rule ? { index, metric: rule.metric } : null
      })
      .filter((c): c is { index: number; metric: string } => c !== null)

    for (const row of table.rows) {
      const rowLabel = row[0] ?? ''
      const rowRule = METRIC_RULES.find((r) => r.pattern.test(rowLabel))

      for (const { index, metric } of metricColumns) {
        const cell = row[index]
        if (!cell) continue
        const fact = buildFact(
          metric,
          cell,
          `${table.headers[index] ?? metric}: ${cell} (row: ${row.join(' | ')})`,
          `${rowLabel} ${cell}`,
          table.pageStart,
          table.tableIndex,
        )
        if (fact) facts.push(fact)
      }

      if (rowRule) {
        row.slice(1).forEach((cell, offset) => {
          const columnIndex = offset + 1
          // Already covered by the column pass above; avoid double-counting.
          if (metricColumns.some((c) => c.index === columnIndex)) return
          const header = table.headers[columnIndex] ?? ''
          const fact = buildFact(
            rowRule.metric,
            cell,
            `${rowLabel}: ${cell} (column: ${header})`,
            `${header} ${cell}`,
            table.pageStart,
            table.tableIndex,
          )
          if (fact) facts.push(fact)
        })
      }
    }
  }
  return facts
}
