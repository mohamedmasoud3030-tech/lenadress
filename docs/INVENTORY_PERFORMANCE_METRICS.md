# Inventory performance — definitions and source of truth

This document is the contract for every number shown on **أداء المخزون**
(`/inventory-performance`). If a figure on that screen cannot be traced to a row
in this table, it is a defect.

Implementation: `src/features/reports/inventoryPerformance.service.ts`.
Tests: `tests/inventory-performance.test.mjs`,
`tests/inventory-performance-export.test.mjs`.

## 1. Source of truth per figure

| Figure | Read from | Never read from |
| --- | --- | --- |
| Rental revenue | `payments` rows with `direction: 'income'` and `type: 'rental'`, plus settlement fees (`late_fee`, `damage_fee`, `penalty`) and `retained_deposit`, matched to the item through its reservation. Refunds on those reservations are subtracted. | The listed rental price of a booking, or any UI total. |
| Sale revenue | `sales` rows for the item, minus `sale-returns` rows for the same item. | The payments ledger — a sale is never written twice. |
| Accessory rental revenue | The accessory's agreed `rentalPrice` on a `reservation-accessories` link that was actually **delivered**, on a non-cancelled reservation. | The catalogue price of an accessory that never left the showroom. |
| Discounts | `listRentalPrice − rentalPrice` on the reservation, and `listPrice − amount` on the sale record. Both are snapshots written at the moment the deal was struck. | A comparison against the item's *current* catalogue price. |
| Service cost | `expenses` with category `laundry`, `tailoring` or `maintenance`, linked through `relatedDressCode` or `relatedAccessoryCode`. | A separate maintenance ledger — none exists. |
| Damage and loss cost | `expenses` with category `purchase`, linked the same way. Accessory damage and loss charges are posted here by the return workflow. | A parallel accessory charge ledger — none exists. |
| Occupied days | Booked days of non-cancelled reservations, clipped to the reporting window. | A stored `reserved` flag on the item. |
| Late count | Reservations in the window whose status is `overdue`. | Manual annotation. |
| Damage / loss counts | For accessories, the `returnCondition` recorded on the link when it was closed inside the window. For dresses, maintenance expenses in the window. | Free-text notes. |

A refundable deposit is **never** item revenue. It stays a liability until it is
refunded or explicitly retained; only the retained part is recognised. This
matches `src/features/finance/finance.service.ts`, and a test asserts the report
total equals the finance layer's rental + sale revenue for the same window.

## 2. Formulas

Let the reporting window be `[from, to]` inclusive.

```
periodDays      = (to − from) + 1

availableDays   = 0                       if the item was retired before `from`
                = (retiredOn − from)      if it was retired inside the window
                = periodDays              otherwise

occupiedDays    = Σ over non-cancelled reservations of
                  overlap(booking, [from, to]) , counting both endpoints

utilisationRate = occupiedDays ÷ availableDays          (0 when availableDays = 0)

totalRevenue    = rentalRevenue + saleRevenue
totalCost       = serviceCost + damageCost
netResult       = totalRevenue − totalCost

averageTransactionValue = totalRevenue ÷ (rentalCount + saleCount)
averageRentalDays       = Σ booked days ÷ rentalCount
turnoverRate            = rentalCount ÷ availableDays
costToRevenueRatio      = totalCost ÷ totalRevenue      (null when both are 0)

idleDays        = to − lastUsedDate                     (null when never used)
isIdle          = idleDays ≥ idleThresholdDays
                  or, when never used, periodDays ≥ idleThresholdDays
```

**Discounts are excluded from revenue rather than subtracted from it.** A
discount is money that was never collected, so it is reported as a separate
figure for visibility and does not reduce `netResult` a second time.

**Occupancy counts both endpoints.** A booking from the 10th to the 12th
occupies three days, because the item is out of the showroom on all three. A
same-day pickup and return occupies one day.

## 3. Ranking

`topPerformers` and `lowPerformers` are ranked by:

```
score = netResult × (0.5 + utilisationRate)
```

This deliberately does **not** rank on booking count. A cheap dress booked three
times that barely covers its cleaning must not outrank a quieter dress that
actually earns. Only items with at least one rental or sale are ranked; items
with no movement belong on the idle list, not the low-performer list.

`serviceHeavyItems` are items whose cost is at least 35% of their revenue, or
which have cost and no revenue at all. `chronicallyLateItems` are items with at
least one overdue reservation in the window, ordered by how often.

The idle threshold is configurable per report and defaults to the showroom's
existing dormant-days preference.

## 4. Exclusions

- Cancelled reservations produce no revenue and no occupied days.
- A booking that was never paid contributes occupancy only, never income.
- A refund reduces recognised rental revenue for that item.
- A sale return reverses its own sale revenue in full.
- Movements dated outside the reporting window are not counted, even when the
  item itself is in scope.
- Payments and sales are read from different ledgers by design; the invoice
  writes exactly one `sales` row per line, so the same event is never counted
  twice.

## 5. Export

- CSV is prefixed with a UTF-8 BOM (`\uFEFF`) so Excel renders Arabic instead of
  mojibake.
- Any value beginning with `=`, `+`, `-`, `@`, tab or carriage return is
  prefixed with an apostrophe so a spreadsheet treats it as text. This is the
  CSV-injection defence and it is enforced centrally in
  `src/shared/utils/csv.ts`.
- The printable report goes through the shared printing boundary
  (`@platform/printing`), escapes every value, prints the period and the
  generation timestamp, and hides interactive chrome via `@media print`.
