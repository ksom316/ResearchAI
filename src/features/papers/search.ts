import type { Paper } from './types'

export function matchesSearch(paper: Paper, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [
    paper.title,
    paper.original_filename,
    paper.authors.join(' '),
    paper.publication_year?.toString(),
  ].some((field) => field?.toLowerCase().includes(q))
}
