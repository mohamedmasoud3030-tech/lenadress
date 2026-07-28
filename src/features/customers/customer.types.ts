export type CustomerStatus = 'normal' | 'trusted' | 'warning' | 'blocked';

export type Customer = {
  id: string;
  name: string;
  phone: string;
  address: string;
  measurements: string;
  notes?: string;
  status: CustomerStatus;
  totalReservations: number;
  activeReservations: number;
  totalPaid: number;
  remainingBalance: number;
  lastReservationDate?: string;
  /** Set when the customer is archived instead of deleted; history stays intact. */
  archivedAt?: string;
};

export type CustomerFilters = {
  search: string;
  status: 'all' | CustomerStatus;
  balance: 'all' | 'with_balance' | 'clear';
};

export type CustomerSummary = {
  total: number;
  trusted: number;
  withBalance: number;
  blockedOrWarning: number;
};
