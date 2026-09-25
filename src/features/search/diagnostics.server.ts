import type { SemanticSearchDiagnostic } from './search-service'

/** Production-safe and content-free. The service controls the complete shape. */
export function logSemanticSearchDiagnostic(
  diagnostic: SemanticSearchDiagnostic,
): void {
  console.warn('[semantic-search]', diagnostic)
}
