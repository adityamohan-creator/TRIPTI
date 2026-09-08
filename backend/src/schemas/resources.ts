import { z } from 'zod'
import { RESOURCE_KINDS } from '../types/db.js'

const lat = z.number().min(-90).max(90)
const lon = z.number().min(-180).max(180)

/** A coordinate is a pair or it is nothing. Half of one is worse than none. */
const coordinatePair = <T extends { lat?: number | null; lon?: number | null }>(value: T) =>
  (value.lat == null) === (value.lon == null)

export const CreateResource = z
  .object({
    label: z.string().min(2).max(160),
    description: z.string().max(2000).nullish(),
    kind: z.enum(RESOURCE_KINDS),
    quantity: z.number().nonnegative().nullish(),
    unit: z.string().max(32).nullish(),
    address: z.string().max(300).nullish(),
    lat: lat.nullish(),
    lon: lon.nullish(),
    expiry_time: z.iso.datetime().nullish(),
    perishable: z.boolean().default(false),
  })
  .refine(coordinatePair, { message: 'lat and lon must be provided together' })
  // Perishable stock without a deadline cannot be scheduled against, and food
  // that quietly loses its expiry is exactly the failure this project exists to
  // prevent.
  .refine((v) => !v.perishable || v.expiry_time != null, {
    message: 'perishable resources need an expiry_time',
  })

export const UpdateResource = z
  .object({
    label: z.string().min(2).max(160).optional(),
    description: z.string().max(2000).nullish(),
    quantity: z.number().nonnegative().nullish(),
    unit: z.string().max(32).nullish(),
    address: z.string().max(300).nullish(),
    lat: lat.nullish(),
    lon: lon.nullish(),
    expiry_time: z.iso.datetime().nullish(),
    perishable: z.boolean().optional(),
    status: z.enum(['available', 'committed', 'depleted', 'offline']).optional(),
  })
  .refine(coordinatePair, { message: 'lat and lon must be provided together' })

export const ListResources = z.object({
  kind: z.enum(RESOURCE_KINDS).optional(),
  status: z.enum(['available', 'committed', 'depleted', 'offline']).optional(),
  /** Only stock that has not passed its deadline. */
  usable: z.stringbool().optional(),
  mine: z.stringbool().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

export type CreateResourceInput = z.infer<typeof CreateResource>
export type UpdateResourceInput = z.infer<typeof UpdateResource>
export type ListResourcesQuery = z.infer<typeof ListResources>
