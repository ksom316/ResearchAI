import { describe, expect, it, vi } from 'vitest'
import { logSemanticSearchDiagnostic } from './diagnostics.server'

describe('semantic search diagnostics', () => {
  it('logs only the fixed content-free diagnostic', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const diagnostic = {
      event: 'semantic_search_failure' as const,
      stage: 'search_rpc' as const,
      errorCode: 'search_unavailable' as const,
      databaseCode: '42501',
      embeddingKind: null,
    }

    logSemanticSearchDiagnostic(diagnostic)

    expect(warn).toHaveBeenCalledWith('[semantic-search]', diagnostic)
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(
      /query|content|embedding vector|api key/i,
    )
    warn.mockRestore()
  })
})
