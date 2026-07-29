# Customer conduct, operator attribution and the waiting list

Three features that share one property: they answer questions the showroom was
already asking verbally, using data the app already held.

Implementation: `src/features/customers/customerConduct.service.ts`,
`src/features/operators/operator.service.ts`,
`src/features/waitlist/waitlist.service.ts`.
Tests: `tests/conduct-waitlist.test.mjs`.

## 1. Customer conduct

### The gap

The customer record carried a status (`normal`, `trusted`, `warning`,
`blocked`) with **no reason and no history**. An operator could see that someone
was blocked but not why, when, or by whom — and could not discover that a
customer had been late three times until she was already at the counter asking
for a fourth booking.

### Derived, not maintained

Everything countable is read from records the showroom already creates:

| Signal | Source |
| --- | --- |
| Late return | A delivery record with a late fee or `late` status |
| Damage or loss | A delivery record with a damage fee or `damaged` status |
| Cancellation | A reservation with status `cancelled` |
| No-show | A reservation past its pickup date **with no delivery record** |
| Outstanding money | Remaining amounts across her non-cancelled bookings |

Maintaining these by hand would rot on the first busy day. Only deliberate human
judgements are stored, and each carries its reason and its author.

### A bug worth recording

No-shows were first detected as bookings still `pending` or `confirmed` past
their pickup date. That silently missed most of them: the reservation layer
projects **any** past-due booking to `overdue`, including one that was never
collected. Detection now treats the **absence of a delivery record** as the
proof nobody came, and accepts `overdue` as a candidate state. The tests caught
this before it shipped.

### Reliability score

Incidents are weighted by what they actually cost the showroom, not counted
equally:

```
penalty = late×12 + damage×20 + noShow×25 + cancellation×5 + severeNotes×15
loyaltyCredit = min(completedRentals × 3, 15)
score = clamp(100 − penalty + loyaltyCredit, 0, 100)
```

A no-show costs a lost day of rental and an idle dress; a cancellation made in
advance usually costs nothing. A long clean history absorbs one old mistake.

The **suggested status** is advice, shown next to the current one. The operator
always decides; the app never silently reclassifies a customer.

### Where it appears

The first advisory shows **directly on the customer card**. A warning that only
exists behind a click is a warning nobody reads before taking the booking.

## 2. Operator attribution

### This is not authentication

The product is single-showroom and local-first with **no server**. There is
nothing to authenticate against, no way to enforce a login, and no way to stop
someone simply switching the name. Presenting it as security would be theatre,
so the UI states plainly that it is not a login and does not protect the app.

**Real protection is a separate, still-outstanding item** (a device PIN), listed
in the audit as a higher priority than this.

### What it does provide

When more than one person works the counter, the audit trail must be able to
answer *who cancelled this booking*, *who granted this discount*, *who wrote
this warning*. Without attribution every entry is anonymous and the log cannot
answer the only question it exists for.

- The operator is stamped **centrally inside `recordAudit`**, so no caller can
  forget to record it.
- The field is **optional**, because every entry written before attribution
  existed has none. Inventing an author for historical entries would be worse
  than admitting it is unknown.
- The active operator is a **device preference**, stored through the platform
  port. Two phones in the same showroom have different people holding them, so
  it is not showroom data.
- Removed operators stay listed, so old log entries remain readable.

## 3. Waiting list

### The gap

A customer asks for a dress already booked on her date. She leaves. If that
booking is later cancelled, nobody remembers she wanted it — so the dress sits
idle **and** the sale is lost. The revenue is lost twice.

### Recorded against a design

An entry points at a **design** rather than a specific piece, because she wants
*that dress* and any piece of it in her size will do. That is the reason designs
exist. A specific piece is also allowed, and an optional size or colour narrows
the want when only one will do.

### Availability is never stored

Whether a wanted period is free is **recomputed** from the reservations through
the shared conflict rule every time the list is read. A cached "available" flag
would send the operator to phone a customer about a dress that was re-booked an
hour ago.

### Queue fairness

Opportunities are ordered by **when each customer asked**, not by who appears
first in the list. A period that has already passed is never offered.

A `notified` entry keeps appearing as an opportunity, because being contacted is
not the same as replying — it disappears only when it converts to a booking or
is explicitly closed.

### Preventing a pointless queue

The add form shows how many pieces are free for her exact period. If the answer
is "available now", it says so explicitly, so the operator creates a booking
instead of queueing a customer for something she could take today.

## 4. Deposit liability on the dashboard

Refundable deposits were visible only inside a report. That is money sitting in
the drawer that **is not the showroom's**. Spending it and then facing several
refunds in the same week is a common way a profitable business runs out of cash.

The dashboard now shows the total held next to the day's takings, explicitly
labelled as owed rather than earned, and computed over all time rather than
today — the liability is everything still held, whenever it was collected.
