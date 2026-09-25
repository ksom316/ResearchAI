import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/0018_storage_capacity.sql'), 'utf8')

describe('storage capacity migration', () => {
  it('has one configurable default and keeps the 50 MB file limit separate', () => {
    expect(sql).toMatch(/create table public\.storage_capacity_config/)
    expect(sql).toMatch(/values \('default', 209715200, 52428800\)/)
    expect(sql).toMatch(/max_individual_file_bytes bigint/)
  })

  it('reserves quota before upload and consumes reservations transactionally', () => {
    expect(sql).toMatch(/create table public\.storage_reservations/)
    expect(sql).toMatch(/create or replace function public\.reserve_storage_upload/)
    expect(sql).toMatch(/pg_advisory_xact_lock/)
    expect(sql).toMatch(/storage_reservation_required/)
    expect(sql).toMatch(/status = 'consumed'/)
  })

  it('exposes authoritative account storage totals for the UI', () => {
    expect(sql).toMatch(/create or replace function public\.get_my_storage_summary/)
    expect(sql).toMatch(/storage_capacity_bytes bigint/)
    expect(sql).toMatch(/storage_remaining_bytes bigint/)
  })
})
