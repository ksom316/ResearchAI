import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const usageMigration = readFileSync(
  join(process.cwd(), 'supabase/migrations/0013_usage_metering.sql'),
  'utf8',
)
const fixMigration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/0019_fix_usage_summary_projection.sql',
  ),
  'utf8',
)

describe('usage summary projection fix', () => {
  it('reproduces the invoker privilege mismatch in the deployed definition', () => {
    expect(usageMigration).toMatch(/with events as \(\s*select e\.\*/)
    expect(usageMigration).not.toMatch(
      /grant select \([\s\S]*idempotency_key[\s\S]*\) on public\.usage_events to authenticated/,
    )
  })

  it('selects only columns granted to authenticated users', () => {
    expect(fixMigration).not.toMatch(/select e\.\*/)
    expect(fixMigration).toMatch(
      /select\s+e\.feature,\s+e\.event_type,\s+e\.input_tokens,\s+e\.output_tokens,\s+e\.total_tokens,\s+e\.quantity,\s+e\.metadata\s+from public\.usage_events e/,
    )
    expect(fixMigration).not.toMatch(/e\.idempotency_key/)
    expect(fixMigration).toMatch(/security invoker/)
  })

  it('preserves authenticated-only execution of the summary RPC', () => {
    expect(fixMigration).toMatch(
      /revoke all on function public\.get_my_usage_summary\(timestamptz, timestamptz\)\s+from public, anon;/,
    )
    expect(fixMigration).toMatch(
      /grant execute on function public\.get_my_usage_summary\(timestamptz, timestamptz\)\s+to authenticated, service_role;/,
    )
  })
})
