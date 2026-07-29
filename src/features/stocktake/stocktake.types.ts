/**
 * Periodic stocktake.
 *
 * The showroom had no way to answer "is everything we own actually here?".
 * Pieces leave on a booking and come back, go to the laundry, get lent to a
 * relative of the owner, or simply disappear — and nothing in the system ever
 * compares the catalogue against the rail. The first sign of a missing dress
 * was a customer arriving to collect it.
 *
 * A stocktake is a counting session: the operator scans or ticks each piece she
 * can physically see, and on closing the session the system reports what was
 * never found. Items legitimately out of the building (delivered on an active
 * booking) are **expected absent** and must not be reported as missing — that
 * distinction is the entire value of the feature, because a naive count would
 * flag every rented dress and be ignored within a week.
 */

export type StocktakeStatus = 'open' | 'completed' | 'cancelled';

/** Why an item was not physically present at counting time. */
export type StocktakeAbsenceReason =
  | 'out_on_rental'
  | 'in_service'
  | 'sold'
  | 'archived'
  | 'unexplained';

export type StocktakeItemKind = 'dress' | 'accessory';

export type StocktakeScan = {
  /** `dress` or `accessory`; the two catalogues share the scanning flow. */
  kind: StocktakeItemKind;
  /** Stable record id, never the code, so a re-coded item still resolves. */
  itemId: string;
  code: string;
  name: string;
  scannedAt: string;
};

export type StocktakeSession = {
  id: string;
  /** Monotonic session reference, e.g. `STK-001`. */
  sessionNumber: string;
  status: StocktakeStatus;
  startedAt: string;
  completedAt?: string;
  /** Free-text scope note, e.g. "رف الزفاف" — counting is often partial. */
  scope?: string;
  scans: StocktakeScan[];
  notes?: string;
};

/** One line of the closing report. */
export type StocktakeFinding = {
  kind: StocktakeItemKind;
  itemId: string;
  code: string;
  name: string;
  /** Present when the item was expected to be absent. */
  reason: StocktakeAbsenceReason;
  /** Human explanation, including the reservation number when relevant. */
  detail: string;
};

export type StocktakeReport = {
  session: StocktakeSession;
  countedTotal: number;
  /** Items present and scanned. */
  present: StocktakeFinding[];
  /** Absent with a legitimate explanation — not a loss. */
  expectedAbsent: StocktakeFinding[];
  /** Absent with no explanation. This is the number that matters. */
  missing: StocktakeFinding[];
  /** Scanned but not in the catalogue at all. */
  unknownScans: StocktakeScan[];
  summary: {
    expectedPresent: number;
    counted: number;
    missingCount: number;
    expectedAbsentCount: number;
    /** Percentage of expected-present items actually found, 0..100. */
    coveragePercent: number;
  };
};

export const STOCKTAKE_ABSENCE_LABELS: Record<StocktakeAbsenceReason, string> = {
  out_on_rental: 'خارج المحل مع عميلة',
  in_service: 'في الفحص أو المغسلة أو التعديل',
  sold: 'مباع',
  archived: 'مؤرشف',
  unexplained: 'مفقود بلا سبب معروف',
};
