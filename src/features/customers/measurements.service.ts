import { STANDARD_SIZES, type CustomerMeasurements, type PieceFit, type SizeSuggestion, type StandardSize } from './measurements.types';
import type { Dress } from '../dresses/dress.types';

/**
 * Size suggestion from body measurements.
 *
 * The ranges below are the common Middle-East women's bridal/evening chart in
 * centimetres. They are deliberately conservative and are offered as a
 * *suggestion*: the operator, who can see the customer and the garment, always
 * decides. A wrong automatic decision here costs a ruined fitting.
 *
 * Bust is weighted most heavily because a bodice that does not close cannot be
 * worn at all, whereas a waist or hip that is slightly out is usually alterable
 * on a rental gown.
 */

type SizeRange = { size: StandardSize; bust: [number, number]; waist: [number, number]; hips: [number, number] };

const SIZE_CHART: SizeRange[] = [
  { size: 'XS', bust: [76, 82], waist: [58, 64], hips: [84, 90] },
  { size: 'S', bust: [83, 88], waist: [65, 70], hips: [91, 96] },
  { size: 'M', bust: [89, 94], waist: [71, 76], hips: [97, 102] },
  { size: 'L', bust: [95, 100], waist: [77, 83], hips: [103, 108] },
  { size: 'XL', bust: [101, 107], waist: [84, 90], hips: [109, 115] },
  { size: 'XXL', bust: [108, 115], waist: [91, 98], hips: [116, 122] },
  { size: 'XXXL', bust: [116, 125], waist: [99, 108], hips: [123, 132] },
];

const MEASUREMENT_LABELS: Record<string, string> = {
  bust: 'محيط الصدر',
  waist: 'محيط الخصر',
  hips: 'محيط الأرداف',
  shoulder: 'عرض الكتف',
  length: 'الطول من الكتف',
  armLength: 'طول الذراع',
  height: 'الطول الكلي',
  heelHeight: 'ارتفاع الكعب',
};

export function getMeasurementLabel(field: string): string {
  return MEASUREMENT_LABELS[field] ?? field;
}

export function hasAnyMeasurement(measurements?: CustomerMeasurements): boolean {
  if (!measurements) return false;
  return ['bust', 'waist', 'hips', 'shoulder', 'length', 'armLength', 'height']
    .some((field) => typeof measurements[field as keyof CustomerMeasurements] === 'number');
}

function isWithin(value: number, [min, max]: [number, number]): boolean {
  return value >= min && value <= max;
}

/** Distance outside a range; 0 when inside it. */
function distanceFrom(value: number, [min, max]: [number, number]): number {
  if (value < min) return min - value;
  if (value > max) return value - max;
  return 0;
}

/**
 * Picks the size whose chart entry the body sits closest to.
 *
 * Bust carries double weight; a gown that will not close over the bust is
 * unwearable, while a waist or hip difference is usually taken in or let out.
 */
export function suggestSize(measurements?: CustomerMeasurements): SizeSuggestion {
  const missing: string[] = [];
  if (!measurements?.bust) missing.push(MEASUREMENT_LABELS.bust);
  if (!measurements?.waist) missing.push(MEASUREMENT_LABELS.waist);
  if (!measurements?.hips) missing.push(MEASUREMENT_LABELS.hips);

  // The bust alone can still produce a usable suggestion.
  if (!measurements?.bust) {
    return {
      suggestedSize: null,
      reason: 'أدخلي محيط الصدر على الأقل لاقتراح المقاس.',
      missing,
    };
  }

  const scored = SIZE_CHART.map((entry) => {
    const bustDistance = distanceFrom(measurements.bust as number, entry.bust) * 2;
    const waistDistance = measurements.waist ? distanceFrom(measurements.waist, entry.waist) : 0;
    const hipsDistance = measurements.hips ? distanceFrom(measurements.hips, entry.hips) : 0;
    return { entry, score: bustDistance + waistDistance + hipsDistance };
  }).sort((left, right) => left.score - right.score);

  const best = scored[0];
  const exact = isWithin(measurements.bust, best.entry.bust)
    && (!measurements.waist || isWithin(measurements.waist, best.entry.waist))
    && (!measurements.hips || isWithin(measurements.hips, best.entry.hips));

  const reason = exact
    ? `المقاسات ضمن نطاق ${best.entry.size} في جدول القياسات.`
    : `أقرب مقاس هو ${best.entry.size}، مع فروق بسيطة قد تحتاج تعديلاً.`;

  return {
    suggestedSize: best.entry.size,
    reason: missing.length > 0 ? `${reason} الاقتراح تقريبي لنقص: ${missing.join('، ')}.` : reason,
    missing,
  };
}

function normalizeSize(size: string): StandardSize | null {
  const upper = size.trim().toUpperCase().replace(/\s+/g, '');
  return (STANDARD_SIZES as string[]).includes(upper) ? (upper as StandardSize) : null;
}

/**
 * How a specific piece is likely to fit this customer.
 *
 * A non-standard size label (a numeric size, or a one-off) returns `unknown`
 * rather than guessing: silently mapping "42" to a letter size would be a
 * fabrication, and the operator would trust it.
 */
export function assessPieceFit(dress: Pick<Dress, 'code' | 'size'>, measurements?: CustomerMeasurements): PieceFit {
  const base = { dressCode: dress.code, size: dress.size };

  if (!hasAnyMeasurement(measurements)) {
    return { ...base, level: 'unknown', note: 'لا توجد مقاسات مسجلة لهذه العميلة.' };
  }

  const suggestion = suggestSize(measurements);
  const pieceSize = normalizeSize(dress.size);

  if (!suggestion.suggestedSize) {
    return { ...base, level: 'unknown', note: suggestion.reason };
  }
  if (!pieceSize) {
    return { ...base, level: 'unknown', note: `مقاس القطعة "${dress.size}" غير قياسي، يلزم القياس يدوياً.` };
  }

  const suggestedIndex = STANDARD_SIZES.indexOf(suggestion.suggestedSize);
  const pieceIndex = STANDARD_SIZES.indexOf(pieceSize);
  const gap = pieceIndex - suggestedIndex;

  if (gap === 0) return { ...base, level: 'exact', note: 'يطابق المقاس المقترح.' };
  // A larger piece can be taken in; a smaller one often cannot be let out enough.
  if (gap === 1) return { ...base, level: 'close', note: 'أكبر بمقاس واحد، غالباً يمكن تضييقه.' };
  if (gap === 2) return { ...base, level: 'alterable', note: 'أكبر بمقاسين، يحتاج تعديلاً واضحاً.' };
  if (gap === -1) return { ...base, level: 'alterable', note: 'أصغر بمقاس واحد، قد لا يُغلق. يلزم القياس.' };

  return {
    ...base,
    level: 'unsuitable',
    note: gap > 0 ? 'أكبر من المقاس المناسب بفارق كبير.' : 'أصغر من المقاس المناسب بفارق كبير.',
  };
}

/**
 * Whether a floor-length gown will drag or sit short.
 *
 * Length is measured shoulder-to-hem, so the heel she will wear changes the
 * answer — a 3cm difference is the gap between elegant and unwearable.
 */
export function assessLength(dressLengthCm: number | undefined, measurements?: CustomerMeasurements): string | null {
  if (!dressLengthCm || !measurements?.length) return null;

  const effective = measurements.length + (measurements.heelHeight ?? 0);
  const difference = dressLengthCm - effective;

  if (Math.abs(difference) <= 2) return 'الطول مناسب.';
  if (difference > 2) return `الفستان أطول بـ ${difference.toFixed(0)} سم، قد يحتاج تقصيراً.`;
  return `الفستان أقصر بـ ${Math.abs(difference).toFixed(0)} سم عن الطول المطلوب.`;
}

/**
 * Reads a legacy free-text measurement note.
 *
 * Existing records hold text like "الطول 165 المقاس M". Rather than discard it
 * or force re-entry, recognised numbers are pulled out so the customer's
 * history keeps working, and anything unparsed is preserved verbatim.
 */
export function parseLegacyMeasurements(text: string): CustomerMeasurements {
  if (!text.trim()) return {};

  const read = (patterns: string[]): number | undefined => {
    for (const pattern of patterns) {
      const match = new RegExp(`${pattern}\\s*[:：]?\\s*(\\d{2,3})`).exec(text);
      if (match) {
        const value = Number.parseInt(match[1], 10);
        if (Number.isFinite(value)) return value;
      }
    }
    return undefined;
  };

  return {
    bust: read(['الصدر', 'صدر', 'bust']),
    waist: read(['الخصر', 'خصر', 'waist']),
    hips: read(['الأرداف', 'الارداف', 'ورك', 'hips']),
    height: read(['الطول الكلي', 'الطول', 'طول', 'height']),
    // Anything not recognised must not be lost.
    notes: text.trim(),
  };
}
