/**
 * Customer measurements.
 *
 * The customer record kept measurements as one free-text field. That is fine
 * for a note and useless for anything else: the app could not compare a
 * customer against a dress, could not warn that a piece would not fit, and
 * could not suggest a size. Two staff members also wrote the same body
 * differently ("طول ١٦٥" vs "165 سم"), so the text was not even reliably
 * readable by a human later.
 *
 * Structured fields are all optional. A showroom often takes only the bust and
 * the length at a first visit, and refusing to save a partial record would push
 * staff straight back to the notes field.
 */

/** Standard garment sizes, ordered from smallest to largest. */
export type StandardSize = 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL' | 'XXXL';

export const STANDARD_SIZES: StandardSize[] = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];

export type CustomerMeasurements = {
  /** Centimetres. */
  bust?: number;
  waist?: number;
  hips?: number;
  shoulder?: number;
  /** Shoulder to hem, the measurement that decides whether a gown drags. */
  length?: number;
  armLength?: number;
  /** Centimetres, used with `length` to judge a floor-length gown. */
  height?: number;
  /** Heel height she intends to wear, which changes the effective length. */
  heelHeight?: number;
  /** Anything that does not fit a field, kept so nothing is lost. */
  notes?: string;
  /** When the measurements were taken; bodies change. */
  measuredAt?: string;
};

/** How well a specific piece matches a customer. */
export type SizeMatchLevel = 'exact' | 'close' | 'alterable' | 'unsuitable' | 'unknown';

export type SizeSuggestion = {
  /** The size the measurements point to, when they are sufficient. */
  suggestedSize: StandardSize | null;
  /** Why that size, in Arabic, so the operator can sanity-check it. */
  reason: string;
  /** Which measurements were missing, if the suggestion is partial. */
  missing: string[];
};

export type PieceFit = {
  dressCode: string;
  size: string;
  level: SizeMatchLevel;
  /** Short Arabic explanation shown next to the piece. */
  note: string;
};
