import { lazy } from 'react';

export { NotFoundPage } from '../../components/shared/NotFoundPage';
export { AccessoriesPage } from '../../features/accessories/AccessoriesPage';
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
export { RemindersPage } from '../../features/reminders/RemindersPage';
export { ReportsPage } from '../../features/reports/ReportsPage';

export const InventoryPerformancePage = lazy(async () => {
  const module = await import('../../features/reports/InventoryPerformancePage');
  return { default: module.InventoryPerformancePage };
});
export { ReservationsPage } from '../../features/reservations/ReservationsPage';
export { SalesLedgerPage } from '../../features/dresses/SalesLedgerPage';
export { ServiceQueuePage } from '../../features/service/ServiceQueuePage';
export { LandingPage } from '../../pages/landing/LandingPage';

export const DesignDetailsPage = lazy(async () => {
  const module = await import('../../features/dresses/DesignDetailsPage');
  return { default: module.DesignDetailsPage };
});

export const DressDetailsPage = lazy(async () => {
  const module = await import('../../features/dresses/DressDetailsPage');
  return { default: module.DressDetailsPage };
});
