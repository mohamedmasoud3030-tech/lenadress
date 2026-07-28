type SummaryCardTone = 'default' | 'positive' | 'warning' | 'danger' | 'accent';

type SummaryCardProps = {
  label: string;
  value: string | number;
  hint?: string;
  tone?: SummaryCardTone;
};

/**
 * Summary tile.
 *
 * The previous version faded every tone `to-white` on an almost-white page, so
 * the cards had no edge and the whole screen read as one flat white sheet —
 * reported from a phone as "the pages look pale, everything is white". Each
 * tone now keeps a real tinted surface and a solid accent bar, so a tile is
 * visibly a tile and its status is readable at a glance in daylight.
 */
const toneStyles: Record<SummaryCardTone, { surface: string; accent: string; value: string }> = {
  default: { surface: 'bg-white ring-slate-200', accent: 'bg-slate-400', value: 'text-slate-950' },
  positive: { surface: 'bg-emerald-50/80 ring-emerald-200', accent: 'bg-emerald-500', value: 'text-emerald-800' },
  warning: { surface: 'bg-amber-50/90 ring-amber-200', accent: 'bg-amber-500', value: 'text-amber-900' },
  danger: { surface: 'bg-rose-50/90 ring-rose-200', accent: 'bg-rose-500', value: 'text-rose-800' },
  accent: { surface: 'bg-violet-50/80 ring-violet-200', accent: 'bg-violet-500', value: 'text-violet-900' },
};

export function SummaryCard({ label, value, hint, tone = 'default' }: SummaryCardProps) {
  const styles = toneStyles[tone];

  return (
    <article className={`min-w-0 rounded-2xl p-4 shadow-sm ring-1 transition sm:p-5 ${styles.surface}`}>
      <div className={`mb-3 h-1 w-10 rounded-full ${styles.accent}`} />
      <p className="text-xs font-bold text-slate-600 sm:text-sm">{label}</p>
      {/* Long money strings must shrink rather than overflow a 2-up phone grid. */}
      <p className={`mt-1.5 truncate text-xl font-extrabold sm:text-2xl ${styles.value}`}>{value}</p>
      {hint && <p className="mt-1.5 truncate text-xs text-slate-500">{hint}</p>}
    </article>
  );
}
