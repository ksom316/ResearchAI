import type { createSupabaseServerClient } from '#/lib/supabase/supabase.server'
import { logSupabaseRpcError } from '#/lib/supabase/rpc-diagnostics.server'
import type { SearchDb } from './search-service'

type SupabaseLike = ReturnType<typeof createSupabaseServerClient>

/** Adapts the per-request, cookie-authenticated Supabase client (never a service-role client). */
export function createSupabaseSearchDb(supabase: SupabaseLike): SearchDb {
  return {
    getUserId: async () =>
      (await supabase.auth.getUser()).data.user?.id ?? null,
    coverage: async ({ paperIds, projectId }) => {
      const result = await supabase.rpc('get_search_coverage', {
        p_paper_ids: paperIds,
        p_project_id: projectId,
      })
      if (result.error) {
        logSupabaseRpcError({
          operation: 'search_coverage',
          rpc: 'get_search_coverage',
          error: result.error,
        })
      }
      return result
    },
    activeProfile: async () => {
      const result = await supabase
        .from('embedding_models')
        .select('id, provider, provider_model, dimensions, input_profile')
        .eq('status', 'active')
        .maybeSingle()
      if (result.error) {
        logSupabaseRpcError({
          operation: 'search_profile',
          rpc: 'embedding_models.select',
          error: result.error,
        })
      }
      return result
    },
    search: async (args) => {
      const result = await supabase.rpc('search_paper_chunks', {
        p_query_embedding: args.queryEmbedding,
        p_expected_model_id: args.expectedModelId,
        p_paper_ids: args.paperIds,
        p_project_id: args.projectId,
        p_limit: args.limit,
        p_min_similarity: args.minSimilarity,
        p_include_references: args.includeReferences,
      })
      if (result.error) {
        logSupabaseRpcError({
          operation: 'semantic_search',
          rpc: 'search_paper_chunks',
          error: result.error,
        })
      }
      return result
    },
  }
}
