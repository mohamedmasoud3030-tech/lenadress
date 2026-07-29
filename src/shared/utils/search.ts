/**
 * Arabic-aware search normalisation.
 *
 * Every list screen used to filter with a bare `toLowerCase().includes()`, which
 * is only correct for Latin text. In an Arabic showroom that produced two
 * failures the operator hits daily:
 *
 *   1. Orthographic variants. "فاطمه" never matched the stored "فاطمة", and
 *      "احمد" never matched "أحمد". The operator concluded the customer was not
 *      registered and created a duplicate record — which then split her history,
 *      her balance and her conduct score across two rows.
 *   2. Phone formatting. Numbers are stored the way they were typed
 *      ("+968 9191 8186"), so searching "91918186" returned nothing even though
 *      the customer was right there in the list.
 *
 * The fix is a single normalisation pass applied on both sides of the
 * comparison, plus a digit-aware branch so a numeric query is matched against
 * the digits of every field rather than its punctuation.
 *
 * Rejected alternatives:
 *   - `Intl.Collator` with `sensitivity: 'base'`: it folds diacritics but not
 *     hamza seats or ta marbuta, so "فاطمه"/"فاطمة" still fail, and it has no
 *     substring search — only comparison.
 *   - `String.prototype.normalize('NFKD')` alone: decomposes tashkeel (good) but
 *     leaves أ/إ/آ as distinct base letters (bad), and does nothing for ى/ي.
 *   - A fuzzy matcher (Levenshtein/trigram): too permissive for phone numbers
 *     and item codes, where a one-character difference is a *different* record.
 */

/** Combining marks: tashkeel, superscript alef, and the Quranic annotation range. */
const ARABIC_DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;

/** Kashida/tatweel is pure decoration and carries no meaning for matching. */
const ARABIC_TATWEEL = /\u0640/g;

const ARABIC_INDIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const EASTERN_ARABIC_INDIC_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/**
 * Letter folds. Each group collapses to the form the operator is most likely to
 * type on a phone keyboard, which is the bare/simple form.
 */
const LETTER_FOLDS: Array<[RegExp, string]> = [
  // Alef with any hamza seat, madda, or wasla → bare alef.
  [/[\u0622\u0623\u0625\u0671\u0672\u0673\u0675]/g, '\u0627'],
  // Alef maqsura → ya. Arabic keyboards on iOS and Android disagree about which
  // one a final "ى" produces, so the two must be interchangeable.
  [/\u0649/g, '\u064A'],
  // Ta marbuta → ha. "فاطمه" and "فاطمة" are the same name.
  [/\u0629/g, '\u0647'],
  // Standalone hamza and its waw/ya seats → a single hamza, so "مسؤول" matches
  // "مسئول" and "مسءول".
  [/[\u0624\u0626]/g, '\u0621'],
  // Persian/Urdu keyboard variants that reach Gulf phones through some IMEs.
  [/\u06A9/g, '\u0643'],
  [/[\u06CC\u06D2]/g, '\u064A'],
];

/** Converts Arabic-Indic and Eastern Arabic-Indic digits to ASCII digits. */
export function normalizeDigits(value: string): string {
  let result = '';
  for (const character of value) {
    const arabicIndex = ARABIC_INDIC_DIGITS.indexOf(character);
    if (arabicIndex >= 0) {
      result += String(arabicIndex);
      continue;
    }
    const easternIndex = EASTERN_ARABIC_INDIC_DIGITS.indexOf(character);
    if (easternIndex >= 0) {
      result += String(easternIndex);
      continue;
    }
    result += character;
  }
  return result;
}

/**
 * Folds an Arabic string to a comparable form: no diacritics, no tatweel,
 * unified letter shapes, ASCII digits, lowercased, and whitespace collapsed.
 *
 * Safe for Latin text too, so every list can call it unconditionally.
 */
export function normalizeSearchText(value: string): string {
  if (!value) return '';

  let normalized = normalizeDigits(value)
    .replace(ARABIC_DIACRITICS, '')
    .replace(ARABIC_TATWEEL, '');

  for (const [pattern, replacement] of LETTER_FOLDS) {
    normalized = normalized.replace(pattern, replacement);
  }

  return normalized.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Reduces a phone number to its digits so formatting never blocks a match.
 *
 * The Omani country code is dropped when it prefixes a local 8-digit number:
 * the same customer is stored as "+968 9191 8186" by one operator and
 * "91918186" by another, and both must be findable by either query. The check
 * is length-guarded so a Saudi "+966 50 868 8213" or an Egyptian
 * "+20 121 210 1073" is left intact — stripping a prefix from those would make
 * unrelated numbers collide.
 */
export function normalizePhoneForSearch(value: string): string {
  const digits = normalizeDigits(value ?? '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('968')) return digits.slice(3);
  if (digits.length === 11 && digits.startsWith('00')) return digits.slice(2);
  return digits;
}

/** True when the query is worth treating as a phone/code lookup. */
function isDigitQuery(query: string): boolean {
  const digits = query.replace(/\D/g, '');
  // Three digits is the shortest useful numeric lookup (e.g. the tail of a
  // reservation number); below that every record matches and the list is noise.
  return digits.length >= 3 && digits.length === query.replace(/[\s+()-]/g, '').length;
}

/**
 * Matches a user query against a record's searchable fields.
 *
 * Text queries are compared on the normalised forms. Numeric queries are
 * additionally compared against the digits of every field, which is what makes
 * "91918186" find "+968 9191 8186" and "1042" find "RSV-001042".
 */
export function matchesSearchQuery(query: string, fields: Array<string | undefined | null>): boolean {
  const needle = normalizeSearchText(query);
  if (!needle) return true;

  const present = fields.filter((field): field is string => typeof field === 'string' && field.length > 0);

  if (present.some((field) => normalizeSearchText(field).includes(needle))) return true;

  if (isDigitQuery(needle)) {
    const digitsNeedle = normalizePhoneForSearch(needle);
    if (!digitsNeedle) return false;
    return present.some((field) => {
      const digitsField = normalizePhoneForSearch(field);
      return digitsField.length > 0 && digitsField.includes(digitsNeedle);
    });
  }

  return false;
}

/**
 * Builds a reusable predicate, for call sites that filter a long list and
 * should not re-normalise the query once per row.
 */
export function createSearchMatcher(query: string): (fields: Array<string | undefined | null>) => boolean {
  const needle = normalizeSearchText(query);
  if (!needle) return () => true;
  return (fields) => matchesSearchQuery(needle, fields);
}
