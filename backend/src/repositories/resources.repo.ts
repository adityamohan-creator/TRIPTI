import { admin } from '../supabase.js'
import type { ResourceRow } from '../types/db.js'
import type { ListResourcesQuery } from '../schemas/resources.js'

/**
 * The only place resource rows are read or written. Keeping `admin.from` here
 * means the service layer can be reasoned about without also holding the shape
 * of every Supabase query in your head — and there is one file to change when
 * generated types land.
 */

/**
 * Supabase infers row types from a *literal* select string. COLUMNS is a
 * constant, so inference falls back to GenericStringError and the compiler
 * cannot see the shape. Until generated database types land, narrowing happens
 * here — in one place, against the migrations, rather than at every call site.
 */
function asRow(value: unknown): ResourceRow {
  return value as ResourceRow
}

function asRows(value: unknown): ResourceRow[] {
  return (value ?? []) as ResourceRow[]
}

const COLUMNS =
  'id, owner_id, label, description, kind, quantity, unit, reserved_quantity, ' +
  'address, lat, lon, expiry_time, perishable, status, created_at, updated_at'

export interface ResourcePage {
  resources: ResourceRow[]
  total: number
}

export async function list(
  query: ListResourcesQuery,
  ownerId?: string,
): Promise<ResourcePage> {
  let q = admin
    .from('resources')
    .select(COLUMNS, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(query.offset, query.offset + query.limit - 1)

  if (query.kind) q = q.eq('kind', query.kind)
  if (query.status) q = q.eq('status', query.status)
  if (ownerId) q = q.eq('owner_id', ownerId)
  // `usable` filters at the database rather than in memory so pagination counts
  // stay honest — filtering a page after the fact would report the wrong total.
  if (query.usable) {
    q = q.or(`expiry_time.is.null,expiry_time.gt.${new Date().toISOString()}`)
  }

  const { data, error, count } = await q
  if (error) throw error
  return { resources: asRows(data), total: count ?? 0 }
}

export async function findById(id: string): Promise<ResourceRow | null> {
  const { data, error } = await admin
    .from('resources')
    .select(COLUMNS)
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  return data ? asRow(data) : null
}

export async function insert(
  values: Record<string, unknown>,
): Promise<ResourceRow> {
  const { data, error } = await admin
    .from('resources')
    .insert(values)
    .select(COLUMNS)
    .single()

  if (error) throw error
  return asRow(data)
}

export async function update(
  id: string,
  values: Record<string, unknown>,
): Promise<ResourceRow | null> {
  const { data, error } = await admin
    .from('resources')
    .update(values)
    .eq('id', id)
    .select(COLUMNS)
    .maybeSingle()

  if (error) throw error
  return data ? asRow(data) : null
}

export async function remove(id: string): Promise<void> {
  const { error } = await admin.from('resources').delete().eq('id', id)
  if (error) throw error
}

/** Live matches holding stock against this resource, newest first. */
export async function activeMatchCount(resourceId: string): Promise<number> {
  const { count, error } = await admin
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .eq('resource_id', resourceId)
    .in('status', ['proposed', 'reserved', 'committed'])

  if (error) throw error
  return count ?? 0
}
