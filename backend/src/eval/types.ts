/**
 * The shapes the evaluation works in.
 *
 * Defined before the loader exists on purpose. The official TREC-IS files have
 * not been read yet, so their exact field names are unknown — but what the
 * metrics need from a record is not, and pinning that down first means the
 * loader has a target to map onto rather than the metrics bending to whatever
 * the file happens to look like.
 *
 * Nothing here invents a taxonomy. `informationTypes` is a list of opaque
 * label strings; the official set is supplied by the loader and validated
 * against the labels the files actually contain.
 */

/** One message as it arrives, before anything is predicted about it. */
export interface CrisisReport {
  /**
   * The message's own identifier, carried through untouched.
   *
   * This is the evidence anchor. Every prediction, cluster and metric traces
   * back through it, so it is never regenerated, reformatted or replaced — an
   * invented id makes an unfalsifiable claim.
   */
  id: string
  /** The TREC-IS event this belongs to, e.g. one of 35-49. */
  eventId: string
  text: string
  /** Epoch milliseconds, where the source records one. */
  postedAt: number | null
  lat: number | null
  lon: number | null
  /**
   * Set when this record is a generated variant, naming the message it came
   * from. Null for an original.
   *
   * Load-bearing for splitting: a variant and its source are the same
   * underlying report, and must never be separated across a split.
   */
  variantOf: string | null
}

/** Ground truth for one message, as published with the dataset. */
export interface ReportLabels {
  id: string
  /** Official information-type labels. Opaque here — never enumerated in code. */
  informationTypes: string[]
  /** Official priority label, verbatim from the dataset. */
  priority: string
  /**
   * Which underlying incident this message is about, where the data provides
   * it. Pairwise clustering is scored against this.
   */
  clusterId: string | null
}

/** What the system predicts for one message. */
export interface ReportPrediction {
  itemId: string
  predictedClusterId: string
  predictedInformationCategory: string
  /** Continuous, for ranking. NDCG needs an order, not a band. */
  priorityScore: number
  /**
   * Every source id that supports this prediction, including the item itself.
   * Never invented — see `engine/evidence.ts`.
   */
  evidenceIds: string[]
}

/** A train/evaluation split, kept at source level. */
export interface Split {
  train: CrisisReport[]
  evaluation: CrisisReport[]
}
