import { Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppShell } from '@app/shell/AppShell';
import { RouteLoadingFallback } from './RouteLoadingFallback';
import {
  AccessoriesPage,
  AppointmentsPage,
  AuditLogPage,
  CustomersPage,
  DailyClosingPage,
  DashboardWithClosingAlertPage,
  DeliveryReturnPage,
  DressDetailsPage,
  DressesPage,
  ExpensesPage,
  LandingPage,
  NotFoundPage,
  PaymentsPage,
  PreferencesPage,
  ReportsPage,
  ReservationsPage,
  SalesLedgerPage,
  ServiceQueuePage,
} from './routePages';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/landing" element={<LandingPage />} />
      <Route element={<AppShell />}>
        <Route index element={<DashboardWithClosingAlertPage />} />
        <Route path="inventory" element={<DressesPage />} />
        <Route
          path="inventory/:code"
          element={
            <Suspense fallback={<RouteLoadingFallback />}>
              <DressDetailsPage />
            </Suspense>
          }
        />
        <Route path="accessories" element={<AccessoriesPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="reservations" element={<ReservationsPage />} />
        <Route path="appointments" element={<AppointmentsPage />} />
        <Route path="delivery-return" element={<DeliveryReturnPage />} />
        <Route path="sales" element={<SalesLedgerPage />} />
        <Route path="service" element={<ServiceQueuePage />} />
        <Route path="payments" element={<PaymentsPage />} />
        <Route path="expenses" element={<ExpensesPage />} />
        <Route path="daily-closing" element={<DailyClosingPage />} />
        <Route path="audit-log" element={<AuditLogPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="preferences" element={<PreferencesPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
