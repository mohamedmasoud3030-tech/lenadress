import { readCollection, writeCollection } from '../../services/localDatabase';
import { getReservations } from '../reservations/reservation.service';
import type { Reservation } from '../reservations/reservation.types';
import { getReservationLines } from '../reservations/contractLineHelpers';
import type {
  DeliveryReturnFilters,
  DeliveryReturnRecord,
  DeliveryReturnSummary,
} from './deliveryReturn.types';
import { createSearchMatcher } from '../../shared/utils/search';

const COLLECTION = 'delivery-return';
const trackedReservationStatuses = new Set<Reservation['status']>(['pending', 'confirmed', 'delivered', 'overdue']);

export function calculateDepositRefund(
  depositAmount: number,
  lateFee: number,
  damageFee: number,
): number {
  return Math.max(depositAmount - lateFee - damageFee, 0);
}

function createProjectedRecord(reservation: Reservation): DeliveryReturnRecord {
  return {
    id: `queue-${reservation.id}`,
    reservationNumber: reservation.reservationNumber,
    customerId: reservation.customerId,
    inventoryItemId: reservation.inventoryItemId,
    customerName: reservation.customerName,
    customerPhone: reservation.customerPhone,
    dressCode: reservation.dressCode,
    dressName: reservation.dressName,
    status: reservation.status === 'delivered' ? 'delivered' : reservation.status === 'overdue' ? 'late' : 'pending_delivery',
    depositAmount: reservation.depositAmount,
    lateFee: 0,
    damageFee: 0,
    depositRefundAmount: reservation.depositAmount,
  };
}

function getStoredRecords(): DeliveryReturnRecord[] {
  return readCollection<DeliveryReturnRecord>(COLLECTION, []);
}

export function getDeliveryReturnRecords(): DeliveryReturnRecord[] {
  const records = getStoredRecords();
  const projectedRecords = getReservations()
    .filter((reservation) => trackedReservationStatuses.has(reservation.status))
    .filter((reservation) => !records.some((record) => record.reservationNumber === reservation.reservationNumber))
    .map(createProjectedRecord);

  return [...projectedRecords, ...records];
}

export function saveDeliveryReturnRecord(record: DeliveryReturnRecord): DeliveryReturnRecord {
  const records = getStoredRecords();
  writeCollection(
    COLLECTION,
    [record, ...records.filter((item) => item.reservationNumber !== record.reservationNumber)],
  );
  return record;
}

export function filterDeliveryReturnRecords(
  records: DeliveryReturnRecord[],
  filters: DeliveryReturnFilters,
): DeliveryReturnRecord[] {
  const matchesQuery = createSearchMatcher(filters.search);

  return records.filter((record) => {
    const matchStatus = filters.status === 'all' || record.status === filters.status;

    // For multi-item reservations, also search across all line item codes/names
    const reservation = getReservations().find((r) => r.reservationNumber === record.reservationNumber);
    const lineSearchFields = reservation ? getReservationLines(reservation).flatMap((line) => [line.dressCodeSnapshot, line.dressNameSnapshot]) : [];

    const matchSearch = matchesQuery([
      record.reservationNumber,
      record.customerName,
      record.dressCode,
      record.dressName,
      ...lineSearchFields,
    ]);

    return matchStatus && matchSearch;
  });
}

export function summarizeDeliveryReturnRecords(
  records: DeliveryReturnRecord[],
): DeliveryReturnSummary {
  return records.reduce<DeliveryReturnSummary>(
    (summary, record) => {
      if (record.status === 'pending_delivery') {
        summary.pendingDelivery += 1;
      }

      if (record.status === 'delivered') {
        summary.deliveredOut += 1;
      }

      if (record.status === 'returned') {
        summary.returned += 1;
      }

      if (record.status === 'late' || record.status === 'damaged') {
        summary.lateOrDamaged += 1;
      }

      return summary;
    },
    {
      pendingDelivery: 0,
      deliveredOut: 0,
      returned: 0,
      lateOrDamaged: 0,
    },
  );
}
