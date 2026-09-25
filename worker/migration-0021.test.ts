import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const original = readFileSync(
  join(process.cwd(), 'supabase/migrations/0018_storage_capacity.sql'),
  'utf8',
)
const fix = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/0021_fix_storage_reservation_projection.sql',
  ),
  'utf8',
)

describe('storage reservation projection fix', () => {
  it('reproduces the ambiguous output-column reference in 0018', () => {
    expect(original).toMatch(
      /select capacity_bytes, max_individual_file_bytes into v_capacity/,
    )
  })

  it('qualifies the config projection in a new migration', () => {
    expect(fix).toMatch(
      /select c\.capacity_bytes, c\.max_individual_file_bytes\s+into v_capacity, v_max_file\s+from public\.storage_capacity_config c/,
    )
    expect(fix).not.toMatch(/select capacity_bytes, max_individual_file_bytes/)
  })

  it('preserves authentication, quota locking, and authenticated-only execution', () => {
    expect(fix).toMatch(/v_uid uuid := auth\.uid\(\)/)
    expect(fix).toMatch(/pg_advisory_xact_lock/)
    expect(fix).toMatch(/r\.user_id = v_uid/)
    expect(fix).toMatch(/p\.user_id = v_uid/)
    expect(fix).toMatch(
      /grant execute on function public\.reserve_storage_upload\(bigint\)\s+to authenticated/,
    )
  })

  it('does not alter the trigger that accepts existing rows and validates new reservations', () => {
    expect(original).toMatch(/if new\.storage_path is null then return new/)
    expect(original).toMatch(/v_res\.user_id <> new\.user_id/)
    expect(original).toMatch(/v_res\.bytes <> new\.file_size_bytes/)
    expect(fix).not.toMatch(/create trigger|consume_storage_reservation/)
  })
})
