import { lazy } from 'react';

export { NotFoundPage } from '../../components/shared/NotFoundPage';

function lazyNamed<T extends Record<K, React.ComponentType>, K extends keyof T>(
  loader: () => Promise<T>,
  name: K,
) {
  return lazy(async () => ({ default: (await loader())[name] }));
}

export const AccessoriesPage = lazyNamed(() => import('../../features/accessories/AccessoriesPage'), 'AccessoriesPage');
export const AuditLogPage = lazyNamed(() => import('../../features/audit/AuditLogPage'), 'AuditLogPage');
export const AvailabilitySearchPage = lazyNamed(() => import('../../features/availability/AvailabilitySearchPage'), 'AvailabilitySearchPage');
export const AppointmentsPage = lazyNamed(() => import('../../features/appointments/AppointmentsPage'), 'AppointmentsPage');
export const CustomersPage = lazyNamed(() => import('../../features/customers/CustomersPage'), 'CustomersPage');
export const DashboardWithClosingAlertPage = lazyNamed(() => import('../../features/dashboard/DashboardWithClosingAlertPage'), 'DashboardWithClosingAlertPage');
export const DeliveryReturnPage = lazyNamed(() => import('../../features/delivery-return/DeliveryReturnPage'), 'DeliveryReturnPage');
export const DressesPage = lazyNamed(() => import('../../features/dresses/DressesPage'), 'DressesPage');
export const ExpensesPage = lazyNamed(() => import('../../features/expenses/ExpensesPage'), 'ExpensesPage');
export const PaymentsPage = lazyNamed(() => import('../../features/payments/PaymentsPage'), 'PaymentsPage');
export const PreferencesPage = lazyNamed(() => import('../../features/preferences/PreferencesPage'), 'PreferencesPage');
export const DailyClosingPage = lazyNamed(() => import('../../features/reports/DailyClosingPage'), 'DailyClosingPage');
export const RemindersPage = lazyNamed(() => import('../../features/reminders/RemindersPage'), 'RemindersPage');
export const WaitlistPage = lazyNamed(() => import('../../features/waitlist/WaitlistPage'), 'WaitlistPage');
export const ReportsPage = lazyNamed(() => import('../../features/reports/ReportsPage'), 'ReportsPage');

export const InventoryPerformancePage = lazy(async () => {
  const module = await import('../../features/reports/InventoryPerformancePage');
  return { default: module.InventoryPerformancePage };
});
export const ReservationsPage = lazyNamed(() => import('../../features/reservations/ReservationsPage'), 'ReservationsPage');
export const SalesLedgerPage = lazyNamed(() => import('../../features/dresses/SalesLedgerPage'), 'SalesLedgerPage');
export const StocktakePage = lazyNamed(() => import('../../features/stocktake/StocktakePage'), 'StocktakePage');
export const ServiceQueuePage = lazyNamed(() => import('../../features/service/ServiceQueuePage'), 'ServiceQueuePage');
export const LandingPage = lazyNamed(() => import('../../pages/landing/LandingPage'), 'LandingPage');

export const DesignDetailsPage = lazy(async () => {
  const module = await import('../../features/dresses/DesignDetailsPage');
  return { default: module.DesignDetailsPage };
});

export const DressDetailsPage = lazy(async () => {
  const module = await import('../../features/dresses/DressDetailsPage');
  return { default: module.DressDetailsPage };
});
