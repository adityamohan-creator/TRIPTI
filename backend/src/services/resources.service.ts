import { availableQuantity, isExpired } from '../engine/inventory.js'
import { conflict, forbidden, notFound } from '../lib/errors.js'
import { recordStatusChange } from '../lib/history.js'
import type { AuthUser } from '../middleware/auth.js'
import * as repo from '../repositories/resources.repo.js'
import type {
  CreateResourceInput,
  ListResourcesQuery,
  UpdateResourceInput,
} from '../schemas/resources.js'
import type { ResourceRow } from '../types/db.js'

/** Roles that may publish supply. A citizen reports needs, not stock. */
const CAN_CREATE = ['donor', 'ngo', 'volunteer', 'coordinator', 'admin']
const STAFF = ['coordinator', 'admin']
/** Roles that need to see the whole pool to plan against it. */
const CAN_SEE_POOL = ['volunteer', 'ngo', 'coordinator', 'admin']

export interface ResourceView extends ResourceRow {
  /** quantity - reserved_quantity. Null stays null for unmetered resources. */
  available_quantity: number | null
  expired: boolean
}

function present(row: ResourceRow): ResourceView {
  return {
    ...row,
    available_quantity: availableQuantity({
      quantity: row.quantity,
      reservedQuantity: row.reserved_quantity,
    }),
    expired: isExpired(row.expiry_time),
  }
}

export async function listResources(user: AuthUser, query: ListResourcesQuery) {
  // A donor sees their own listings. Everyone operational sees the whole pool,
  // because they are planning against it — unless they asked for just theirs.
  const scoped =
    query.mine || !CAN_SEE_POOL.includes(user.role) ? user.id : undefined

  const page = await repo.list(query, scoped)
  return { resources: page.resources.map(present), total: page.total }
}

export async function getResource(user: AuthUser, id: string): Promise<ResourceView> {
  const row = await repo.findById(id)
  if (!row) throw notFound('No such resource')

  // The service-role client bypasses RLS, so the check the database would have
  // made has to be made here instead.
  const isOwner = row.owner_id === user.id
  if (!isOwner && !CAN_SEE_POOL.includes(user.role)) throw notFound('No such resource')

  return present(row)
}

export async function createResource(
  user: AuthUser,
  input: CreateResourceInput,
): Promise<ResourceView> {
  if (!CAN_CREATE.includes(user.role)) {
    throw forbidden('Your role cannot publish resources')
  }
  if (isExpired(input.expiry_time ?? null)) {
    throw conflict('That expiry time has already passed')
  }

  const row = await repo.insert({
    owner_id: user.id,
    label: input.label,
    description: input.description ?? null,
    kind: input.kind,
    quantity: input.quantity ?? null,
    unit: input.unit ?? null,
    address: input.address ?? null,
    lat: input.lat ?? null,
    lon: input.lon ?? null,
    expiry_time: input.expiry_time ?? null,
    perishable: input.perishable,
    status: 'available',
  })

  await recordStatusChange({
    entityType: 'resource',
    entityId: row.id,
    fromStatus: null,
    toStatus: 'available',
    changedBy: user.id,
    note: row.label,
  })

  return present(row)
}

export async function updateResource(
  user: AuthUser,
  id: string,
  input: UpdateResourceInput,
): Promise<ResourceView> {
  const existing = await repo.findById(id)
  if (!existing) throw notFound('No such resource')

  const isOwner = existing.owner_id === user.id
  if (!isOwner && !STAFF.includes(user.role)) {
    throw forbidden('Only the owner or a coordinator can change this resource')
  }

  // Reserved stock is a promise already made to a need. Cutting the quantity
  // below it would silently break that promise, so the caller has to release
  // those matches first rather than let the numbers quietly disagree.
  if (input.quantity != null && input.quantity < existing.reserved_quantity) {
    const unit = existing.unit ?? 'units'
    throw conflict(
      `${existing.reserved_quantity} ${unit} are already committed. Release those matches before reducing the quantity.`,
    )
  }

  const row = await repo.update(id, input)
  if (!row) throw notFound('No such resource')

  if (input.status && input.status !== existing.status) {
    await recordStatusChange({
      entityType: 'resource',
      entityId: id,
      fromStatus: existing.status,
      toStatus: input.status,
      changedBy: user.id,
    })
  }

  return present(row)
}

export async function deleteResource(user: AuthUser, id: string): Promise<void> {
  const existing = await repo.findById(id)
  if (!existing) throw notFound('No such resource')

  const isOwner = existing.owner_id === user.id
  if (!isOwner && !STAFF.includes(user.role)) {
    throw forbidden('Only the owner or a coordinator can remove this resource')
  }

  // Deleting a resource a mission is counting on cascades the match away and
  // leaves a volunteer driving out to collect nothing.
  if (await repo.activeMatchCount(id)) {
    throw conflict(
      'This resource is committed to an active match. Release it before removing it.',
    )
  }

  await repo.remove(id)

  await recordStatusChange({
    entityType: 'resource',
    entityId: id,
    fromStatus: existing.status,
    toStatus: 'deleted',
    changedBy: user.id,
    note: existing.label,
  })
}
