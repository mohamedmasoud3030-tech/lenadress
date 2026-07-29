# Database Session Preparation Document

**Date:** 2026-07-29
**Author:** Arena.ai Agent Mode
**Repository:** mohamedmasoud3030-tech/lenadress
**Branch:** feat/multi-item-contracts

## 1. Current Data Model

The application uses localStorage as its persistence layer, managed through a persistence engine (`src/engines/persistence/`). Each entity is stored as a JSON array in a localStorage key prefixed with `dress-roomshow:`.

### Collections (registered in `collectionRegistry.ts`):
- `customers` — Customer records with name, phone, status, conduct scores
- `dresses` — Inventory items (dresses, veils, accessories) with code, pricing, status, images
- `dress-designs` — Design groups with size/colour variants
- `accessories` — Separate accessory catalogue
- `reservation-accessories` — Links between reservations and accessories
- `reservations` — Booking records (now with `lines` array for multi-item)
- `appointments` — Appointment scheduling
- `payments` — Financial movements (income, refund, settlement)
- `expenses` — Expense records
- `delivery-return` — Delivery/return tracking records
- `sales`, `sales-invoices`, `sale-returns` — Direct sale workflow
- `service-tasks` — Service/maintenance tracking
- `audit-log`, `audit` — Audit trail
- `daily-closings` — Day close records
- `counters` — Auto-increment counters for codes
- `command-log` — Command execution log for idempotency
- `reminder-dismissals` — Reminder handling state
- `operators` — Operator/staff records
- `customer-conduct-notes` — Customer behaviour records
- `waitlist` — Waiting list entries
- `print-settings` — Print configuration
- `retired-codes` — Retired code tracking
- `preferences` — App preferences
- `showroom-profile` — Showroom business profile
- `stocktake-sessions` — Stocktake sessions
- `message-templates` — WhatsApp message templates
- `images` — Catalogue images (IndexedDB)

### Reservation Model (after multi-item update):
```typescript
type Reservation = {
  id: string;
  reservationNumber: string;
  customerId?: string;
  inventoryItemId?: string;        // First line's item (backward compat)
  customerName: string;
  customerPhone: string;
  dressCode: string;                // First line's code (backward compat)
  dressName: string;                // First line's name (backward compat)
  customerNameSnapshot?: string;
  customerPhoneSnapshot?: string;
  dressCodeSnapshot?: string;
  dressNameSnapshot?: string;
  pickupDate: string;               // First line's date (backward compat)
  pickupTime?: string;
  returnDate: string;
  returnTime?: string;
  status: ReservationStatus;
  rentalPrice: number;              // First line's price (backward compat)
  listRentalPrice?: number;
  depositAmount: number;
  totalAmount: number;              // Sum of all lines
  paidAmount: number;
  remainingAmount: number;
  assessedFeesAmount?: number;
  refundedAmount?: number;
  settledDepositAmount?: number;
  retainedDepositAmount?: number;
  notes?: string;
  lines?: ContractLine[];           // Multi-item contract lines
};

type ContractLine = {
  id: string;
  inventoryItemId?: string;
  dressCodeSnapshot: string;
  dressNameSnapshot: string;
  pickupDate: string;
  pickupTime?: string;
  returnDate: string;
  returnTime?: string;
  rentalPrice: number;
  listRentalPrice?: number;
  depositAmount: number;
  deliveryStatus: LineDeliveryStatus;
  deliveryPhotos?: ConditionPhoto[];
  returnPhotos?: ConditionPhoto[];
  lateFee: number;
  damageFee: number;
  notes?: string;
};
```

## 2. Current Constraints

- **Storage limit**: localStorage has ~5MB limit per origin; condition photos (data URLs) inside records consume significant space.
- **No indexing**: All queries are full-collection scans (O(n)), acceptable for single-showroom scale (~hundreds of records) but not for multi-showroom.
- **No transactions**: The persistence engine simulates transactions via compensated operations, but true atomicity is impossible in localStorage.
- **No concurrency**: localStorage is single-threaded; concurrent tabs can overwrite each other's writes.
- **No backup integrity beyond full export/import**: Backup is a JSON dump of all collections; partial restoration or conflict resolution is manual.
- **Condition photos stored inline**: Photos as data URLs in delivery-return records blow up the collection size and backup file.
- **Images collection is IndexedDB**: Catalogue photos use a separate IndexedDB store keyed by dress ID, but backup/restore handles them alongside localStorage data.
- **Search is full-scan**: Arabic-aware search runs across all records on every keystroke, adequate for hundreds but slow for thousands.

## 3. Risks of Local Storage

1. **Data loss**: Browser cache clear, accidental localStorage wipe, or device failure destroys all business data.
2. **Size ceiling**: Condition photos and backup growth will hit the localStorage limit, causing silent write failures.
3. **No multi-device sync**: A showroom with two phones or a desktop has no way to share data.
4. **No access control**: Any script in the browser can read/write all collections.
5. **No audit trail persistence beyond export**: The audit log grows unbounded in localStorage.
6. **Backup file size**: A showroom with 200+ bookings and condition photos produces a backup file over 10MB, slow to share via WhatsApp.

## 4. Entities That Need Database Tables

All current collections should migrate to Supabase tables:

| Collection | Table Name | Notes |
|---|---|---|
| customers | customers | Add `created_at`, `updated_at` timestamps |
| dresses | inventory_items | Rename for clarity; add `is_for_rent`, `is_for_sale` flags |
| dress-designs | designs | Design groups with variants |
| accessories | accessories | Separate accessory catalogue |
| reservation-accessories | reservation_accessories | Link table (FK to reservations, accessories) |
| reservations | reservations | Add `lines` as separate table (contract_lines) |
| **NEW** | contract_lines | Per-line items in multi-item contracts |
| appointments | appointments | Scheduling |
| payments | payments | Financial movements |
| expenses | expenses | Expense records |
| delivery-return | delivery_returns | Handover tracking |
| sales | sales | Direct sale records |
| sales-invoices | sales_invoices | Invoice headers |
| sale-returns | sale_returns | Sale return records |
| service-tasks | service_tasks | Service/maintenance |
| audit-log | audit_entries | Central audit trail |
| daily-closings | daily_closings | Day close records |
| counters | counters | Auto-increment (can be handled by Supabase sequences) |
| command-log | command_log | Idempotency tracking |
| reminder-dismissals | reminder_dismissals | Dismissed reminders |
| operators | operators | Staff records |
| customer-conduct-notes | customer_conduct_notes | Behaviour notes |
| waitlist | waitlist_entries | Waiting list |
| print-settings | print_settings | Print config (single row) |
| retired-codes | retired_codes | Retired code tracking |
| preferences | preferences | App preferences (single row) |
| showroom-profile | showroom_profile | Business profile (single row) |
| stocktake-sessions | stocktake_sessions | Stocktake sessions with scans |
| message-templates | message_templates | WhatsApp templates (single row) |
| images | images | Catalogue images (Supabase Storage) |
| condition-photos | condition_photos | NEW: Separate from delivery records |

## 5. Relationships Required for Multi-Item Contracts

```
reservations
  ├─ contract_lines (1:N, FK: reservation_id)
  │    ├─ inventory_items (FK: inventory_item_id)
  │    ├─ condition_photos (delivery) (1:N, FK: contract_line_id, context: 'delivery')
  │    ├─ condition_photos (return) (1:N, FK: contract_line_id, context: 'return')
  │    └─ reservation_accessories (line-specific accessories)
  ├─ customers (FK: customer_id)
  ├─ payments (1:N, FK: reservation_id)
  └─ audit_entries (1:N, FK: reservation_id)
```

Key relationships:
- `contract_lines.reservation_id → reservations.id` (required)
- `contract_lines.inventory_item_id → inventory_items.id` (optional, for integrity)
- `condition_photos.contract_line_id → contract_lines.id` (new)
- `condition_photos.context` enum: 'delivery' | 'return' (new)
- `reservation_accessories.reservation_number → reservations.reservation_number` (keep existing)

## 6. Data Migration Plan

### Phase 1: Schema Creation
1. Create all Supabase tables with proper FKs, indexes, and constraints
2. Create `contract_lines` table with columns mirroring the TypeScript type
3. Create `condition_photos` table to move inline photos out of records
4. Set up Supabase Storage buckets for catalogue images and condition photos
5. Create database functions for computed fields (remaining_amount, conflict checks)

### Phase 2: Data Migration
1. Export all localStorage data via existing `exportDatabaseBackup()`
2. Transform the JSON into Supabase insert statements
3. For legacy single-item reservations:
   - Insert into `reservations` table (keeping top-level fields)
   - Create one `contract_line` record derived from top-level fields
4. For multi-item reservations (with `lines` array):
   - Insert reservation row (total amounts from line aggregation)
   - Insert each line as a `contract_line` row
5. For condition photos currently inline in delivery-return records:
   - Extract data URLs → upload to Supabase Storage
   - Replace inline data with storage URLs in `condition_photos` table
6. Validate row counts match local counts after migration

### Phase 3: App Adaptation
1. Replace `readCollection/writeCollection` calls with Supabase queries
2. Replace `generateId/generateNumber` with Supabase UUID/sequences
3. Replace `findItemConflicts` with Supabase RPC or indexed queries
4. Replace inline photo storage with Supabase Storage references
5. Implement real-time subscriptions for multi-device sync
6. Keep localStorage as offline cache (IndexedDB for larger data)

### Phase 4: Rollback Plan
1. Maintain `exportDatabaseBackup()` capability from Supabase data
2. Keep localStorage write path as fallback for offline mode
3. Test full round-trip: Supabase → export → localStorage → import → Supabase
4. Document rollback procedure per table

## 7. Proposed Supabase Plan

### Project Setup
- Supabase project: `dress-roomshow`
- Region: Closest to Oman (e.g., Middle East or EU)
- Plan: Pro plan for production (Free tier for development)

### Authentication
- Email/password auth for operators
- Phone number as alternative login
- Row Level Security: operators can only access their showroom's data
- Service role for admin operations

### Storage
- Bucket: `catalogue-images` — Dress/accessory photos (public read, auth write)
- Bucket: `condition-photos` — Delivery/return evidence (auth read/write, no public access)
- Bucket: `backups` — Automated backup storage (service role only)
- Image transformation: Resize to WebP on upload (Supabase edge function)

### Backup/Restore
- Supabase pg_dump for daily backups (automated)
- App-level export/import for manual migration
- Incremental sync for offline-first (see section 9)

## 8. Offline-First and Synchronization

### Strategy
1. **Write locally first**: All operations write to IndexedDB (or localStorage) immediately
2. **Queue for sync**: Each write creates a sync queue entry
3. **Background sync**: When online, push queued changes to Supabase
4. **Conflict resolution**: Last-write-wins for simple fields; manual resolution for financial records
5. **Read-through cache**: When online, Supabase is source of truth; when offline, local cache is authoritative

### Conflict Resolution Rules
- Customer data: Last-write-wins (operator edits are independent)
- Reservation creation: Reject if Supabase already has a reservation with the same number
- Financial records: Never auto-merge; manual audit required if two devices record different payments
- Inventory status: Supabase wins (the item might have been rented by another device's booking)

## 9. Security and Permissions

### RLS Policies
- `customers`: Operators can read/write their showroom's customers
- `reservations`: Operators can read/write their showroom's reservations
- `contract_lines`: Follows reservation's showroom
- `payments`: Read-only after creation (no modification without audit)
- `inventory_items`: Read for all operators, write for managers only
- `audit_entries`: Read-only for all, service role for creation

### Data Privacy
- Customer phone numbers: Encrypted at rest
- Financial records: Manager-level access only
- Condition photos: Auth-only access, no public URLs

## 10. Implementation Order

1. **Supabase project setup** (tables, auth, RLS)
2. **Schema creation** (all tables including contract_lines, condition_photos)
3. **Storage buckets** (catalogue-images, condition-photos, backups)
4. **Edge functions** (conflict check RPC, image transformation)
5. **Data migration tool** (localStorage → Supabase)
6. **App adaptation** (replace localStorage calls with Supabase queries + offline cache)
7. **Multi-device sync** (real-time subscriptions + sync queue)
8. **Backup automation** (pg_dump + app-level export)
9. **Testing** (integration, migration, rollback)
10. **Production deployment** (gradual rollout with fallback)

## 11. Acceptance Criteria

- All existing functionality works identically after migration
- Multi-item contracts work correctly on Supabase
- Condition photos stored in Supabase Storage, not inline in records
- Backup file size reduced by >80% (no inline photos)
- Offline mode works for at least 24 hours without connectivity
- Sync completes within 30 seconds of connectivity restoration
- No data loss during migration (row count validation per table)
- RLS prevents cross-showroom data access
- Financial records are immutable after creation (no silent overwrites)
- Performance: Search queries under 200ms for 500+ records

## 12. Migration and Backward Compatibility Tests

- Legacy single-item reservations read correctly from Supabase
- Multi-item reservations with multiple lines read correctly
- Contract lines with per-line delivery status work
- Condition photos in Supabase Storage render correctly
- Export from Supabase produces valid localStorage import
- Import from localStorage produces valid Supabase records
- Offline-first: Create reservation offline, sync when online
- Offline-first: Record payment offline, sync when online
- Concurrent device writes resolve without data loss
- RLS prevents unauthorized cross-showroom access
- Backup restore completes within 5 minutes for 200+ reservations
