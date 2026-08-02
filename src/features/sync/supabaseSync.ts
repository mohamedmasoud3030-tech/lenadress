/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSupabaseClient, isSupabaseConfigured } from '../../lib/supabaseClient';
import type { Reservation } from '../../features/reservations/reservation.types';
import type { Dress } from '../../features/dresses/dress.types';
import type { Customer } from '../../features/customers/customer.types';
import type { PaymentRecord } from '../../features/payments/payment.types';

type SyncResult = { ok: boolean; error?: string };

function isSyncEnabled(): boolean {
  try {
    if (!isSupabaseConfigured()) return false;
    if (typeof window === 'undefined') return false;
    // Only sync when we have an authenticated session (profiles table requires authenticated)
    // We check synchronously if possible, but supabase client session is async, so we try best-effort
    // For write path, we attempt and ignore if not authenticated (RLS will block)
    return true;
  } catch {
    return false;
  }
}

async function getClient() {
  if (!isSyncEnabled()) return null;
  try {
    return getSupabaseClient();
  } catch {
    return null;
  }
}

// ── Mappers ──

function mapReservationToSupabaseRow(reservation: Reservation): Record<string, unknown> {
  return {
    id: reservation.id,
    reservation_number: reservation.reservationNumber,
    customer_id: reservation.customerId,
    dress_id: reservation.inventoryItemId,
    reservation_date: reservation.pickupDate, // legacy field, using pickup as reservation date for now
    pickup_date: reservation.pickupDate,
    return_date: reservation.returnDate,
    status: reservation.status,
    rental_price: reservation.rentalPrice,
    deposit_amount: reservation.depositAmount, // legacy compat: map deprecated field to DB column
    total_amount: reservation.totalAmount,
    paid_amount: reservation.paidAmount,
    remaining_amount: reservation.remainingAmount,
    notes: reservation.notes,
    // New canonical columns from 0014
    booking_advance_amount: reservation.bookingAdvanceAmount ?? 0,
    security_deposit_amount: reservation.securityDepositAmount ?? reservation.depositAmount ?? 0, // legacy compat
    security_deposit_collected_amount: reservation.securityDepositCollectedAmount ?? 0,
    security_deposit_refunded_amount: reservation.securityDepositRefundedAmount ?? 0,
    security_deposit_retained_amount: reservation.securityDepositRetainedAmount ?? 0,
    legacy_deposit_amount: reservation.legacyDepositAmount,
    legacy_deposit_classification: reservation.legacyDepositClassification,
    needs_financial_classification: reservation.needsFinancialClassification ?? false,
    classification_reason: reservation.classificationReason,
    classified_at: reservation.classifiedAt,
    // Cancellation policy fields from 0015
    cancellation_reason: (reservation as any).cancellationReason,
    cancelled_at: (reservation as any).cancelledAt,
    cancelled_by: (reservation as any).cancelledBy,
    cancellation_policy_ack: (reservation as any).cancellationPolicyAck ?? false,
  };
}

export function getRemoteCatalogueImageUrl(images: string[] | undefined): string | null {
  for (const image of images ?? []) {
    try {
      const url = new URL(image);
      if (url.protocol === 'https:' || url.protocol === 'http:') return url.toString();
    } catch {
      // Local data URLs and malformed values must never be written into a URL column.
    }
  }
  return null;
}

function mapDressToSupabaseRow(dress: Dress): Record<string, unknown> {
  return {
    id: dress.id,
    code: dress.code,
    name: dress.name,
    description: dress.description,
    category: dress.category,
    color: dress.color,
    size: dress.size,
    purchase_price: dress.purchasePrice,
    rental_price: dress.rentalPrice,
    sale_price: dress.salePrice,
    deposit_amount: dress.depositAmount, // legacy compat
    default_security_deposit_amount: (dress as any).defaultSecurityDepositAmount ?? dress.depositAmount ?? 0, // legacy compat
    status: dress.status,
    is_for_rent: dress.isForRent,
    is_for_sale: dress.isForSale,
    main_image_url: getRemoteCatalogueImageUrl(dress.images),
    notes: dress.notes,
  };
}

function mapCustomerToSupabaseRow(customer: Customer): Record<string, unknown> {
  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    address: (customer as any).address,
    notes: (customer as any).notes,
    status: customer.status,
  };
}

function mapPaymentToSupabaseRow(payment: PaymentRecord, reservationId?: string, customerId?: string): Record<string, unknown> {
  return {
    id: payment.id,
    reservation_id: reservationId,
    customer_id: customerId,
    amount: payment.amount,
    payment_type: payment.type,
    payment_method: payment.method,
    payment_date: payment.paymentDate,
    notes: payment.notes,
    // New columns from 0014
    booking_advance_amount: payment.type === 'booking_advance' ? payment.amount : 0,
    security_deposit_amount: payment.type === 'security_deposit_collection' ? payment.amount : 0,
    retention_reason: payment.retentionReason,
    idempotency_key: payment.idempotencyKey,
  };
}

// ── Push functions (best-effort, no throw) ──

export async function pushReservationToSupabase(reservation: Reservation): Promise<SyncResult> {
  const client = await getClient();
  if (!client) return { ok: false, error: 'supabase not configured' };
  try {
    const row = mapReservationToSupabaseRow(reservation);
    // Remove undefined values
    Object.keys(row).forEach((k) => row[k] === undefined && delete row[k]);
    const { error } = await client.from('reservations').upsert(row as any, { onConflict: 'id' });
    if (error) {
      console.warn('Supabase push reservation failed', error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e: any) {
    console.warn('Supabase push reservation exception', e?.message);
    return { ok: false, error: e?.message };
  }
}

export async function pushDressToSupabase(dress: Dress): Promise<SyncResult> {
  const client = await getClient();
  if (!client) return { ok: false };
  try {
    const row = mapDressToSupabaseRow(dress);
    Object.keys(row).forEach((k) => (row as any)[k] === undefined && delete (row as any)[k]);
    const { error } = await client.from('dresses').upsert(row as any, { onConflict: 'id' });
    if (error) {
      console.warn('Supabase push dress failed', error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message };
  }
}

export async function pushCustomerToSupabase(customer: Customer): Promise<SyncResult> {
  const client = await getClient();
  if (!client) return { ok: false };
  try {
    const row = mapCustomerToSupabaseRow(customer);
    const { error } = await client.from('customers').upsert(row as any, { onConflict: 'id' });
    if (error) {
      console.warn('Supabase push customer failed', error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message };
  }
}

export async function pushPaymentToSupabase(payment: PaymentRecord): Promise<SyncResult> {
  const client = await getClient();
  if (!client) return { ok: false };
  try {
    // Need to resolve reservation_id and customer_id from reservationNumber
    // For now, try to find reservation by reservation_number to get its id
    let reservationId: string | undefined;
    let customerId: string | undefined;
    try {
      const { data: resData } = await client.from('reservations').select('id, customer_id').eq('reservation_number', payment.reservationNumber).limit(1).single();
      if (resData) {
        reservationId = (resData as any).id;
        customerId = (resData as any).customer_id;
      }
    } catch {
      // ignore, will try with payment's own info
    }

    const row = mapPaymentToSupabaseRow(payment, reservationId, customerId);
    const { error } = await client.from('payments').upsert(row as any, { onConflict: 'id' });
    if (error) {
      console.warn('Supabase push payment failed', error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message };
  }
}

// ── Pull functions (for future use, not blocking) ──

export async function pullReservationsFromSupabase(): Promise<Reservation[]> {
  const client = await getClient();
  if (!client) return [];
  try {
    const { data, error } = await client.from('reservations').select('*').limit(1000);
    if (error) {
      console.warn('pull reservations failed', error.message);
      return [];
    }
    // Map back to local Reservation type (partial)
    return (data ?? []).map((row: any) => ({
      id: row.id,
      reservationNumber: row.reservation_number,
      customerId: row.customer_id,
      inventoryItemId: row.dress_id,
      customerName: row.customer_name ?? '',
      customerPhone: row.customer_phone ?? '',
      dressCode: row.dress_code ?? '',
      dressName: row.dress_name ?? '',
      pickupDate: row.pickup_date,
      returnDate: row.return_date,
      status: row.status,
      rentalPrice: row.rental_price,
      depositAmount: row.deposit_amount, // legacy compat: DB column maps to deprecated local field
      securityDepositAmount: row.security_deposit_amount,
      bookingAdvanceAmount: row.booking_advance_amount,
      totalAmount: row.total_amount,
      paidAmount: row.paid_amount,
      remainingAmount: row.remaining_amount,
      securityDepositCollectedAmount: row.security_deposit_collected_amount,
      securityDepositRefundedAmount: row.security_deposit_refunded_amount,
      securityDepositRetainedAmount: row.security_deposit_retained_amount,
      legacyDepositAmount: row.legacy_deposit_amount,
      legacyDepositClassification: row.legacy_deposit_classification,
      needsFinancialClassification: row.needs_financial_classification,
      notes: row.notes,
      cancellationReason: row.cancellation_reason,
      cancelledAt: row.cancelled_at,
      cancelledBy: row.cancelled_by,
      cancellationPolicyAck: row.cancellation_policy_ack,
    })) as Reservation[];
  } catch (e) {
    console.warn('pull reservations exception', (e as any)?.message);
    return [];
  }
}

// ── Background sync trigger ──

let syncInProgress = false;

export async function triggerBackgroundSync(): Promise<void> {
  if (syncInProgress) return;
  if (!isSyncEnabled()) return;
  syncInProgress = true;
  try {
    // For now, just log that sync is enabled and tables exist
    // Future: implement full bi-directional sync
    const client = await getClient();
    if (!client) return;
    const { data: session } = await client.auth.getSession();
    if (!session?.session) {
      // No authenticated user, skip sync (RLS will block)
      return;
    }
    // Could pull latest reservations and dresses to update local cache
    // This is best-effort, non-blocking
  } catch {
    // ignore
  } finally {
    syncInProgress = false;
  }
}
