import { admin } from '../supabase.js'

export type HistoryEntity = 'incident' | 'need' | 'resource' | 'mission' | 'plan'

export interface StatusChange {
  entityType: HistoryEntity
  entityId: string
  /** Null when the entity is being created. */
  fromStatus: string | null
  toStatus: string
  changedBy: string | null
  note?: string | null
}

/**
 * Appends to the audit trail. `status_history` is insert-only by design — a
 * post-incident review has to be able to reconstruct what was known when, and a
 * table that can be edited afterwards cannot support that.
 *
 * Deliberately never throws. A failed audit write must not roll back a delivery
 * that actually happened or block a coordinator mid-incident; it is logged loudly
 * instead, so the gap is visible without costing anyone a response.
 */
export async function recordStatusChange(change: StatusChange): Promise<void> {
  const { error } = await admin.from('status_history').insert({
    entity_type: change.entityType,
    entity_id: change.entityId,
    from_status: change.fromStatus,
    to_status: change.toStatus,
    changed_by: change.changedBy,
    note: change.note ?? null,
  })

  if (error) {
    console.error('AUDIT WRITE FAILED', {
      entity: `${change.entityType}:${change.entityId}`,
      transition: `${change.fromStatus ?? '(new)'} -> ${change.toStatus}`,
      error: error.message,
    })
  }
}

/** Reads an entity's history, oldest first — the order a reviewer reads it in. */
export async function readHistory(entityType: HistoryEntity, entityId: string) {
  const { data, error } = await admin
    .from('status_history')
    .select('id, from_status, to_status, changed_by, note, changed_at')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('changed_at', { ascending: true })

  if (error) throw error
  return data
}
