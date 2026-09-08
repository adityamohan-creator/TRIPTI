import { Router } from 'express'
import { z } from 'zod'
import { forbidden, notFound } from '../lib/errors.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { admin } from '../supabase.js'

/**
 * Volunteers and vehicles — who can run a mission and what they can run it in.
 *
 * A volunteer record is self-service: people manage their own availability,
 * because they are the only ones who know it. Coordinators can read the roster
 * but do not mark other people available.
 */
export const fleetRouter = Router()

fleetRouter.use(requireAuth)

const coords = {
  lat: z.number().min(-90).max(90).nullish(),
  lon: z.number().min(-180).max(180).nullish(),
}

const pairedCoords = <T extends { lat?: number | null; lon?: number | null }>(v: T) =>
  (v.lat == null) === (v.lon == null)

// ------------------------------------------------------------- volunteers

const VOLUNTEER_COLUMNS =
  'user_id, skills, vehicle_id, availability, lat, lon, max_concurrent_missions, notes, updated_at'

const UpsertVolunteer = z
  .object({
    skills: z.array(z.string().max(40)).max(20).optional(),
    availability: z.enum(['available', 'busy', 'offline']).optional(),
    vehicle_id: z.uuid().nullish(),
    max_concurrent_missions: z.number().int().min(1).max(10).optional(),
    notes: z.string().max(500).nullish(),
    ...coords,
  })
  .refine(pairedCoords, { message: 'lat and lon must be provided together' })

/** The caller's own volunteer record, created on first write. */
fleetRouter.get('/volunteers/me', async (req, res, next) => {
  try {
    const { data, error } = await admin
      .from('volunteers')
      .select(VOLUNTEER_COLUMNS)
      .eq('user_id', req.user!.id)
      .maybeSingle()

    if (error) throw error
    res.json({ volunteer: data })
  } catch (err) {
    next(err)
  }
})

fleetRouter.put('/volunteers/me', async (req, res, next) => {
  try {
    const parsed = UpsertVolunteer.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid volunteer payload' })
      return
    }

    const { data, error } = await admin
      .from('volunteers')
      .upsert({ user_id: req.user!.id, ...parsed.data }, { onConflict: 'user_id' })
      .select(VOLUNTEER_COLUMNS)
      .single()

    if (error) throw error
    res.json({ volunteer: data })
  } catch (err) {
    next(err)
  }
})

/** The roster. Coordinators plan against it; volunteers do not browse each other. */
fleetRouter.get(
  '/volunteers',
  requireRole('coordinator', 'admin'),
  async (_req, res, next) => {
    try {
      const { data, error } = await admin
        .from('volunteers')
        .select(`${VOLUNTEER_COLUMNS}, profiles(full_name, phone, role)`)
        .order('availability', { ascending: true })

      if (error) throw error
      res.json({ volunteers: data })
    } catch (err) {
      next(err)
    }
  },
)

// --------------------------------------------------------------- vehicles

const VEHICLE_COLUMNS =
  'id, owner_id, label, type, capacity_kg, capacity_units, refrigerated, availability, lat, lon, updated_at'

const VehicleBody = z
  .object({
    label: z.string().min(2).max(120),
    type: z.enum(['bike', 'car', 'van', 'truck', 'boat', 'other']).default('van'),
    capacity_kg: z.number().nonnegative().nullish(),
    capacity_units: z.number().nonnegative().nullish(),
    refrigerated: z.boolean().default(false),
    availability: z.enum(['available', 'busy', 'offline']).default('available'),
    ...coords,
  })
  .refine(pairedCoords, { message: 'lat and lon must be provided together' })

fleetRouter.get('/vehicles', async (req, res, next) => {
  try {
    const responder = ['volunteer', 'ngo', 'coordinator', 'admin'].includes(req.user!.role)

    let query = admin.from('vehicles').select(VEHICLE_COLUMNS).order('label')
    // Everyone else sees only what they own — the fleet is operational data.
    if (!responder) query = query.eq('owner_id', req.user!.id)

    const { data, error } = await query
    if (error) throw error
    res.json({ vehicles: data })
  } catch (err) {
    next(err)
  }
})

fleetRouter.post('/vehicles', async (req, res, next) => {
  try {
    const parsed = VehicleBody.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid vehicle payload' })
      return
    }

    const { data, error } = await admin
      .from('vehicles')
      .insert({ ...parsed.data, owner_id: req.user!.id })
      .select(VEHICLE_COLUMNS)
      .single()

    if (error) throw error
    res.status(201).json({ vehicle: data })
  } catch (err) {
    next(err)
  }
})

fleetRouter.patch('/vehicles/:id', async (req, res, next) => {
  try {
    const parsed = VehicleBody.partial().safeParse(req.body)
    if (!parsed.success || Object.keys(parsed.data).length === 0) {
      res.status(400).json({ error: 'Invalid vehicle payload' })
      return
    }

    const { data: existing, error: findError } = await admin
      .from('vehicles')
      .select('owner_id')
      .eq('id', req.params.id)
      .maybeSingle()

    if (findError) throw findError
    if (!existing) throw notFound('No such vehicle')

    const isOwner = existing.owner_id === req.user!.id
    if (!isOwner && !['coordinator', 'admin'].includes(req.user!.role)) {
      throw forbidden('Only the owner or a coordinator can change this vehicle')
    }

    const { data, error } = await admin
      .from('vehicles')
      .update(parsed.data)
      .eq('id', req.params.id)
      .select(VEHICLE_COLUMNS)
      .single()

    if (error) throw error
    res.json({ vehicle: data })
  } catch (err) {
    next(err)
  }
})
