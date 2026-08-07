import { useEffect, useState } from 'react';
import { Plus, Clock } from 'lucide-react';
import { AddAppointmentModal } from './AddAppointmentModal';
import { getTodaysAppointments } from './appointment.service';
import type { Appointment } from './appointment.types';
import { PageHeader } from '../../components/shared/PageHeader';
import { Section } from '../../components/shared/Section';
import { EmptyState } from '../../components/shared/StateViews';
import { AMBER_FOCUS_RING_CLASS_NAME } from '../../shared/domain/formConstants';

const APPOINTMENT_STATUS_BADGES: Record<string, string> = {
  confirmed: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  pending: 'bg-amber-50 text-amber-900 ring-amber-200',
  cancelled: 'bg-rose-50 text-rose-800 ring-rose-200',
};

const APPOINTMENT_STATUS_LABELS: Record<string, string> = {
  confirmed: 'مؤكد',
  pending: 'معلق',
  cancelled: 'ملغي',
};

export function AppointmentsPage() {
  const [showAddModal, setShowAddModal] = useState(false);
  const [todayAppointments, setTodayAppointments] = useState<Appointment[]>([]);

  useEffect(() => {
    setTodayAppointments(getTodaysAppointments());
  }, []);

  const handleAppointmentCreated = (appointment: Appointment) => {
    setTodayAppointments((current) => [...current, appointment]);
    setShowAddModal(false);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="المواعيد"
        title="المواعيد"
        description="إدارة مواعيد التجربة والقياسات"
      />

      <Section
        title="مواعيد اليوم"
        description="مواعيد التجربة والقياسات المقررة اليوم."
        action={
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800 ${AMBER_FOCUS_RING_CLASS_NAME}`}
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            حجز موعد
          </button>
        }
      >
        {todayAppointments.length === 0 ? (
          <EmptyState
            icon={<Clock className="h-10 w-10" />}
            title="لا توجد مواعيد اليوم"
            description="أضيفي أول موعد تجربة أو قياس من زر «حجز موعد»."
          />
        ) : (
          <ul className="space-y-3">
            {todayAppointments.map((apt) => (
              <li
                key={apt.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-stone-50 p-3 transition hover:bg-stone-100"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-900">{apt.customerName}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {apt.startTime} - {apt.endTime}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${APPOINTMENT_STATUS_BADGES[apt.status] ?? 'bg-stone-100 text-slate-700 ring-slate-200'}`}>
                  {APPOINTMENT_STATUS_LABELS[apt.status] ?? apt.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Add Appointment Modal */}
      {showAddModal && (
        <AddAppointmentModal
          open={showAddModal}
          onClose={() => setShowAddModal(false)}
          onCreated={handleAppointmentCreated}
        />
      )}
    </div>
  );
}
