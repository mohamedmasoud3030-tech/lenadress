import { lazy } from 'react';

export { NotFoundPage } from '../../components/shared/NotFoundPage';
export { AuditLogPage } from '../../features/audit/AuditLogPage';
export { AppointmentsPage } from '../../features/appointments/AppointmentsPage';
export { CustomersPage } from '../../features/customers/CustomersPage';
export { DashboardWithClosingAlertPage } from '../../features/dashboard/DashboardWithClosingAlertPage';
export { DeliveryReturnPage } from '../../features/delivery-return/DeliveryReturnPage';
export { DressesPage } from '../../features/dresses/DressesPage';
export { ExpensesPage } from '../../features/expenses/ExpensesPage';
export { PaymentsPage } from '../../features/payments/PaymentsPage';
export { PreferencesPage } from '../../features/preferences/PreferencesPage';
export { DailyClosingPage } from '../../features/reports/DailyClosingPage';
export { ReportsPage } from '../../features/reports/ReportsPage';
export { ReservationsPage } from '../../features/reservations/ReservationsPage';
export { ServiceQueuePage } from '../../features/service/ServiceQueuePage';
export { LandingPage } from '../../pages/landing/LandingPage';

export const DressDetailsPage = lazy(async () => {
  const module = await import('../../features/dresses/DressDetailsPage');
  return { default: module.DressDetailsPage };
});
