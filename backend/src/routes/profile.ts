import { Router } from 'express'
import { z } from 'zod'
import { notFound } from '../lib/errors.js'
import { ROLES, requireAuth, requireRole } from '../middleware/auth.js'
import { admin } from '../supabase.js'

export const profileRouter = Router()

profileRouter.use(requireAuth)

const PROFILE_COLUMNS = 'id, full_name, phone, org, role, created_at'

/** The caller's own profile. The role here is the authoritative one. */
profileRouter.get('/', async (req, res, next) => {
  try {
    const { data, error } = await admin
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('id', req.user!.id)
      .single()

    if (error) throw error
    res.json({ profile: data })
  } catch (err) {
    next(err)
  }
})

const UpdateProfile = z.object({
  full_name: z.string().min(1).max(120).nullish(),
  phone: z.string().max(32).nullish(),
  org: z.string().max(160).nullish(),
})

/**
 * Self-service profile edit. Note what is absent: `role`. A user cannot change
 * their own role through this route at any status code — the database pins it
 * too (see pin_profile_role in migration 0003), so this is defence in depth
 * rather than the only guard.
 */
profileRouter.patch('/', async (req, res, next) => {
  try {
    const parsed = UpdateProfile.safeParse(req.body)
    if (!parsed.success || Object.keys(parsed.data).length === 0) {
      res.status(400).json({ error: 'Invalid profile payload' })
      return
    }

    const { data, error } = await admin
      .from('profiles')
      .update(parsed.data)
      .eq('id', req.user!.id)
      .select(PROFILE_COLUMNS)
      .single()

    if (error) throw error
    res.json({ profile: data })
  } catch (err) {
    next(err)
  }
})

const ListQuery = z.object({
  role: z.enum(ROLES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

/** Roster view. Coordinators need to know who is available; citizens do not. */
profileRouter.get('/all', requireRole('coordinator', 'admin'), async (req, res, next) => {
  try {
    const parsed = ListQuery.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query parameters' })
      return
    }

    let query = admin
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(parsed.data.limit)
    if (parsed.data.role) query = query.eq('role', parsed.data.role)

    const { data, error } = await query
    if (error) throw error
    res.json({ profiles: data })
  } catch (err) {
    next(err)
  }
})

const SetRole = z.object({ role: z.enum(ROLES) })

/**
 * Role grants are an admin-only action and the only path that can produce a
 * coordinator or an admin. Signup clamps itself to the self-service roles, and
 * the profiles trigger rejects a role change made with a user's own token, so
 * this service-role write is the single deliberate way in.
 */
profileRouter.patch('/:id/role', requireRole('admin'), async (req, res, next) => {
  try {
    const parsed = SetRole.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid role' })
      return
    }

    const { data, error } = await admin
      .from('profiles')
      .update({ role: parsed.data.role })
      .eq('id', req.params.id)
      .select(PROFILE_COLUMNS)
      .maybeSingle()

    if (error) throw error
    if (!data) throw notFound('No such profile')

    res.json({ profile: data })
  } catch (err) {
    next(err)
  }
})
