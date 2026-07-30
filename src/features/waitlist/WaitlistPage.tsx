import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BellRing, CheckCircle2, Clock, MessageCircle, Plus, XCircle } from 'lucide-react';
import { PageHeader } from '../../components/shared/PageHeader';
import { Section } from '../../components/shared/Section';
import { SummaryCard } from '../../components/shared/SummaryCard';
import { EmptyState } from '../../components/shared/StateViews';
import { FilterBar, SearchFilter, SelectFilter } from '../../components/shared/FilterBar';
import { UserFacingErrorAlert } from '../../components/shared/UserFacingErrorAlert';
import { openWhatsAppChat } from '@platform/messaging';
import { AMBER_FOCUS_RING_CLASS_NAME } from '../../shared/domain/formConstants';
import { AddWaitlistModal } from './AddWaitlistModal';
import {
  closeWaitlistEntry,
  filterWaitlist,
  getWaitlistEntries,
  getWaitlistOpportunities,
  markWaitlistNotified,
  summarizeWaitlist,
} from './waitlist.service';
import type { WaitlistEntry, WaitlistFilters } from './waitlist.types';

const STATUS_LABELS = {
  waiting: 'بالانتظار',
  notified: 'تم إبلاغها',
  converted: 'تحوّل لحجز',
  closed: 'مغلق',
} as const;

const STATUS_STYLES = {
  waiting: 'bg-amber-50 text-amber-800 ring-amber-200',
  notified: 'bg-sky-50 text-sky-800 ring-sky-200',
  converted: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  closed: 'bg-slate-100 text-slate-500 ring-slate-200',
} as const;

const statusOptions = [
  { value: 'all', label: 'كل الحالات' },
  { value: 'waiting', label: 'بالانتظار' },
  { value: 'notified', label: 'تم إبلاغها' },
  { value: 'converted', label: 'تحوّل لحجز' },
  { value: 'closed', label: 'مغلق' },
] as const;

function describeWant(entry: WaitlistEntry): string {
  const what = entry.designName ?? entry.dressCode ?? 'قطعة';
  const details = [entry.size, entry.color].filter(Boolean).join(' · ');
  return details ? `${what} — ${details}` : what;
}

/**
 * The waiting list, led by what is actually actionable.
 *
 * Opportunities come first because they are perishable: the period is free
 * right now and another customer may book it at any moment.
 */
export function WaitlistPage() {
  const [refreshToken, setRefreshToken] = useState(0);
  const [filters, setFilters] = useState<WaitlistFilters>({ search: '', status: 'all' });
  const [showAdd, setShowAdd] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const entries = useMemo(() => getWaitlistEntries(), [refreshToken]);
  const opportunities = useMemo(() => getWaitlistOpportunities(), [refreshToken]);
  const filtered = useMemo(() => filterWaitlist(entries, filters), [entries, filters]);
  const summary = useMemo(() => summarizeWaitlist(entries), [entries, refreshToken]);

  const refresh = (message: string) => {
    setRefreshToken((current) => current + 1);
    setFeedback(message);
    setError(null);
  };

  const handleNotify = (entryId: string, phone: string, message: string, name: string) => {
    setError(null);
    try {
      openWhatsAppChat(phone, message);
      markWaitlistNotified(entryId);
      refresh(`تم فتح محادثة واتساب مع ${name}.`);
    } catch (reason: unknown) {
      setError(reason);
    }
  };

  const handleClose = (entry: WaitlistEntry) => {
    if (!window.confirm(`إغلاق طلب ${entry.customerName}؟`)) return;
    closeWaitlistEntry(entry.id);
    refresh(`تم إغلاق طلب ${entry.customerName}.`);
  };

  return (
    <section className="min-w-0 space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <PageHeader
          eyebrow="قائمة الانتظار"
          title="طلبات بانتظار التوفر"
        />
        <button
          type="button"
          onClick={() => { setFeedback(null); setShowAdd(true); }}
          className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800 ${AMBER_FOCUS_RING_CLASS_NAME}`}
        >
          <Plus aria-hidden="true" className="h-5 w-5" />
          إضافة طلب انتظار
        </button>
      </div>

      {feedback && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">{feedback}</div>}
      {error !== null && <UserFacingErrorAlert error={error} fallback="تعذر تنفيذ العملية." />}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <SummaryCard label="بانتظار التوفر" value={summary.waiting} />
        <SummaryCard label="متاحة الآن" value={summary.ready} tone={summary.ready > 0 ? 'positive' : 'default'} hint="يمكن الاتصال بهن" />
        <SummaryCard label="تم إبلاغهن" value={summary.notified} />
        <SummaryCard label="تحوّلت لحجوزات" value={summary.converted} tone="positive" />
      </div>

      {opportunities.length > 0 && (
        <Section
          title={`أصبحت متاحة الآن (${opportunities.length})`}
          description="تحررت الفترة المطلوبة. الأقدم طلباً أولاً — اتصلي قبل أن يحجزها غيرها."
          className="border-emerald-300 bg-emerald-50/40"
        >
          <ul className="space-y-2">
            {opportunities.map(({ entry, availableCodes, message }) => (
              <li key={entry.id} className="rounded-xl border border-emerald-200 bg-white p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-950">{entry.customerName}</p>
                    <p className="mt-0.5 truncate text-xs text-slate-600">{describeWant(entry)}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {entry.pickupDate} → {entry.returnDate} · متاح: {availableCodes.join('، ')}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleNotify(entry.id, entry.customerPhone, message, entry.customerName)}
                      className={`inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-600 px-3 text-sm font-bold text-white transition hover:bg-emerald-700 ${AMBER_FOCUS_RING_CLASS_NAME}`}
                    >
                      <MessageCircle aria-hidden="true" className="h-4 w-4" />
                      إبلاغها
                    </button>
                    <Link
                      to="/reservations?new=1"
                      className={`inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-bold text-slate-700 transition hover:bg-stone-100 ${AMBER_FOCUS_RING_CLASS_NAME}`}
                    >
                      <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
                      إنشاء الحجز
                    </Link>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <FilterBar>
        <SearchFilter
          label="البحث في قائمة الانتظار"
          value={filters.search}
          onChange={(search) => setFilters((current) => ({ ...current, search }))}
          placeholder="ابحثي باسم العميلة أو التصميم"
        />
        <SelectFilter
          label="حالة الطلب"
          value={filters.status}
          onChange={(status) => setFilters((current) => ({ ...current, status }))}
          options={statusOptions}
        />
      </FilterBar>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Clock className="h-10 w-10" />}
          title={entries.length === 0 ? 'لا توجد طلبات انتظار' : 'لا توجد طلبات مطابقة'}
          description={entries.length === 0
            ? 'عندما تطلب عميلة قطعة محجوزة في تاريخها، سجّليها هنا بدل أن تخرج ولا تعود.'
            : 'غيّري البحث أو الفلتر لعرض نتائج أخرى.'}
        />
      ) : (
        <ul className="space-y-2">
          {filtered.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-slate-950">{entry.customerName}</p>
                <p className="mt-0.5 truncate text-xs text-slate-600">{describeWant(entry)}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {entry.pickupDate} → {entry.returnDate}
                  {entry.reservationNumber ? ` · ${entry.reservationNumber}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1 ${STATUS_STYLES[entry.status]}`}>
                  {STATUS_LABELS[entry.status]}
                </span>
                {(entry.status === 'waiting' || entry.status === 'notified') && (
                  <button
                    type="button"
                    onClick={() => handleClose(entry)}
                    aria-label={`إغلاق طلب ${entry.customerName}`}
                    className={`flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 transition hover:bg-rose-50 hover:text-rose-700 ${AMBER_FOCUS_RING_CLASS_NAME}`}
                  >
                    <XCircle aria-hidden="true" className="h-4 w-4" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="flex items-start gap-2 rounded-xl bg-stone-50 p-4 text-xs leading-6 text-slate-600">
        <BellRing aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        التوفر يُحسب لحظياً من الحجوزات الفعلية، فلا يظهر طلب كمتاح إذا حُجزت القطعة من جديد.
      </p>

      <AddWaitlistModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onCreated={(name) => refresh(`تمت إضافة ${name} إلى قائمة الانتظار.`)}
      />
    </section>
  );
}
