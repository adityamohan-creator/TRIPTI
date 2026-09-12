/**
 * A synthetic corpus for demonstrating report fusion.
 *
 * ## This is invented data. It is not TREC-IS, and not real.
 *
 * Every report below was written for this file. None of it came from TREC-IS,
 * from any social feed, or from any real incident, and nothing in this project
 * has been trained or evaluated on official competition data. The `source`
 * field on every record says so, and the API returns that label alongside the
 * results so a screenshot cannot accidentally imply otherwise.
 *
 * It exists because fusion needs several reports of one incident to have
 * anything to show, and TRIPTI's own seeded incidents are six deliberately
 * distinct events — correct for the coordination demo, useless for this one.
 *
 * The ids follow the REPORT-nnn convention from the brief so they are legible
 * on screen. They are external ids in the sense that matters here: they arrive
 * with the report and are carried into the evidence untouched.
 */

export interface DemoReport {
  /** External identifier, carried into cluster evidence verbatim. */
  sourceId: string
  text: string
  postedAt: string
  lat: number | null
  lon: number | null
  /** Stated headcount where the report gives one. */
  peopleAffected: number | null
  /** Present on every record, and surfaced by the API. */
  source: 'demo-synthetic'
}

/** Minutes before the fixed reference time, so ordering is stable. */
const BASE = Date.parse('2026-09-12T06:00:00.000Z')
const at = (minutes: number) => new Date(BASE + minutes * 60_000).toISOString()

const JAIPUR_STATION = { lat: 26.9196, lon: 75.7878 }
const JAIPUR_WALLED = { lat: 26.9239, lon: 75.8267 }
const GUWAHATI = { lat: 26.1445, lon: 91.7362 }
const LUDHIANA = { lat: 30.901, lon: 75.8573 }
const CHENNAI = { lat: 13.0827, lon: 80.2707 }

export const DEMO_REPORTS: DemoReport[] = [
  // ── One flood at Jaipur railway station, described four ways ────────────
  {
    sourceId: 'REPORT-102',
    text: 'Heavy flooding reported near Jaipur railway station, water entering the main road.',
    postedAt: at(0),
    ...JAIPUR_STATION,
    peopleAffected: null,
    source: 'demo-synthetic',
  },
  {
    sourceId: 'REPORT-109',
    text: 'Water has entered roads around Jaipur railway station. Autos stuck, people wading through.',
    postedAt: at(12),
    ...JAIPUR_STATION,
    peopleAffected: null,
    source: 'demo-synthetic',
  },
  {
    sourceId: 'REPORT-115',
    text: 'Flood situation worsening near Jaipur railway station. Around 400 people stranded on the platform, elderly among them.',
    postedAt: at(31),
    ...JAIPUR_STATION,
    peopleAffected: 400,
    source: 'demo-synthetic',
  },
  {
    sourceId: 'REPORT-121',
    text: 'Jaipur railway station flooding is rising, people trapped on the upper concourse. Urgent rescue needed.',
    postedAt: at(48),
    ...JAIPUR_STATION,
    peopleAffected: null,
    source: 'demo-synthetic',
  },

  // ── A separate building collapse in the walled city ─────────────────────
  {
    sourceId: 'REPORT-131',
    text: 'Old building collapsed in the walled city area. Casualties reported, people buried under rubble.',
    postedAt: at(55),
    ...JAIPUR_WALLED,
    peopleAffected: 25,
    source: 'demo-synthetic',
  },
  {
    sourceId: 'REPORT-134',
    text: 'Building collapse in walled city, rescue teams digging. At least two dead so far.',
    postedAt: at(70),
    ...JAIPUR_WALLED,
    peopleAffected: null,
    source: 'demo-synthetic',
  },

  // ── A water shortage at a relief camp, a thousand kilometres away ───────
  {
    sourceId: 'REPORT-140',
    text: 'No drinking water at the Chennai relief camp since morning. About 800 people staying here.',
    postedAt: at(80),
    ...CHENNAI,
    peopleAffected: 800,
    source: 'demo-synthetic',
  },
  {
    sourceId: 'REPORT-147',
    text: 'Chennai relief camp water shortage getting worse, tanker has not arrived.',
    postedAt: at(95),
    ...CHENNAI,
    peopleAffected: null,
    source: 'demo-synthetic',
  },

  // ── A single fire, uncorroborated ───────────────────────────────────────
  {
    sourceId: 'REPORT-152',
    text: 'Factory fire in Ludhiana industrial area, thick smoke visible from the highway.',
    postedAt: at(101),
    ...LUDHIANA,
    peopleAffected: null,
    source: 'demo-synthetic',
  },

  // ── An offer of help, which must not read as a need ─────────────────────
  {
    sourceId: 'REPORT-158',
    text: 'We have 500 cooked meals available and can provide transport. Ready to help wherever needed.',
    postedAt: at(110),
    lat: null,
    lon: null,
    peopleAffected: null,
    source: 'demo-synthetic',
  },

  // ── A minor report that should stay low ─────────────────────────────────
  {
    sourceId: 'REPORT-163',
    text: 'Some waterlogging on a side street in Guwahati, nobody in danger.',
    postedAt: at(120),
    ...GUWAHATI,
    peopleAffected: null,
    source: 'demo-synthetic',
  },

  // ── A medical need with no location ─────────────────────────────────────
  {
    sourceId: 'REPORT-171',
    text: 'Insulin and oxygen running out at the field clinic. Two patients need dialysis urgently.',
    postedAt: at(133),
    lat: null,
    lon: null,
    peopleAffected: null,
    source: 'demo-synthetic',
  },
]

/** Said out loud wherever the corpus is used. */
export const DEMO_DISCLAIMER =
  'Demo/Synthetic Data — Not TREC-IS. These reports were written for this demonstration and describe no real incident.'
