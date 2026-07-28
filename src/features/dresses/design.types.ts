import type { DressCategory } from './dress.types';

/**
 * A **design** is the model the customer actually chooses: "the ivory mermaid
 * gown". A showroom normally owns several physical pieces of the same design in
 * different sizes and colours.
 *
 * The existing `Dress` record is, and stays, the **physical piece**: it carries
 * its own never-reused stock code, its own barcode, its own condition and its
 * own booking history. That is correct and must not change — you cannot hand a
 * customer "a design", you hand her one specific garment.
 *
 * What was missing is the grouping above it. Without a design, a showroom with
 * five sizes of one gown had five unrelated records, so:
 *
 * - the operator could not answer "do we have this dress in size L?";
 * - a booking clash on one size looked like the design was unavailable;
 * - reports counted five separate items instead of one design's performance.
 *
 * A design owns no availability of its own. Availability is always resolved
 * through its pieces and the existing central conflict rule.
 */
export type DressDesign = {
  id: string;
  /** Monotonic, never-reused design code, e.g. `DSG-001`. */
  code: string;
  name: string;
  description: string;
  category: DressCategory;
  /** Suggested prices for new pieces; each piece may still differ. */
  defaultRentalPrice: number;
  defaultSalePrice: number;
  defaultDepositAmount: number;
  /** Shared look images. A piece may add its own. */
  images: string[];
  notes?: string;
  /** Set when the design is retired; its pieces keep their history. */
  archivedAt?: string;
};

export type AddDressDesignInput = {
  name: string;
  description?: string;
  category: DressCategory;
  defaultRentalPrice: number;
  defaultSalePrice: number;
  defaultDepositAmount: number;
  images?: string[];
  notes?: string;
};

export type UpdateDressDesignInput = Partial<Omit<DressDesign, 'id' | 'code'>>;

/** One physical piece to create under a design. */
export type DesignVariantInput = {
  size: string;
  color: string;
  /** Overrides the design default when provided. */
  rentalPrice?: number;
  salePrice?: number;
  depositAmount?: number;
  /** How many identical pieces of this size and colour to create. */
  quantity?: number;
};

export type DesignVariantSummary = {
  size: string;
  color: string;
  /** Pieces of this size and colour that are not retired. */
  total: number;
  /** Pieces physically available right now. */
  available: number;
  /** Pieces free across a requested period, when one was supplied. */
  freeInPeriod?: number;
};

export type DressDesignSummary = {
  design: DressDesign;
  /** Every non-archived piece belonging to the design. */
  pieceCount: number;
  availableCount: number;
  /** Distinct sizes and colours currently stocked. */
  sizes: string[];
  colors: string[];
  variants: DesignVariantSummary[];
  lowestRentalPrice: number;
};
