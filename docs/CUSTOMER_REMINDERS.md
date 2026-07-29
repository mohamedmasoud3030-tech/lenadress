# Customer reminders and WhatsApp

How the showroom follows up with customers, and the decisions behind it.

Implementation: `src/features/reminders/*`, `src/platform/messaging/whatsapp.ts`.
Tests: `tests/reminders-whatsapp.test.mjs`.

## 1. What is reminded, and why

A rental showroom loses money in four predictable ways. All four are already
visible in data the app holds, so the app raises them instead of relying on
someone remembering.

| Reminder | Fires when | Urgency | Prevents |
| --- | --- | --- | --- |
| `pickup_tomorrow` | Pickup is tomorrow and the item has not been handed over | info | No-shows |
| `return_tomorrow` | Return is tomorrow **and the item is actually out** | warning | Late returns |
| `overdue_return` | The return date passed and the item is still out | critical | Lost stock |
| `outstanding_balance` | Money is still owed | critical after the rental ends, otherwise info | Unpaid rentals |

Two conditions are deliberately narrow:

- A **return** reminder only fires once the booking is `delivered`. Reminding a
  customer to return a dress she never collected is worse than saying nothing.
- **Money owed** is only urgent once the rental period has ended. A balance on a
  booking three weeks away is normal, not a problem.

Cancelled and completed bookings never produce a reminder.

## 2. Reminders are derived, never stored

Nothing in the reminder list is persisted. Storing reminders would create a
second source of truth that drifts the moment a booking is rescheduled,
cancelled or paid — the list would keep chasing a customer who already settled.

The **only** persisted record is a dismissal: proof the operator handled one.

## 3. Dismissals expire daily

A dismissal carries the business date it applies to. This matters: an item that
is still overdue tomorrow must be chased again, so yesterday's follow-up cannot
silence it permanently. A test asserts exactly this.

Dismissals are pruned after 30 days, since only today's affect behaviour.

## 4. Why WhatsApp is a hand-off, not an automatic send

The app prepares a `wa.me` deep link with the Arabic message ready. The operator
reviews it in WhatsApp and presses send.

It does **not** send by itself, for two reasons:

1. **It could not.** A real automated send requires the WhatsApp Business API, a
   Meta business account, a verified sender number, template pre-approval and
   per-message billing. A single local-first showroom has none of those, and
   none of it works offline — which is a core property of this application.
2. **It should not.** Messaging a customer silently on the showroom's behalf is
   the wrong default. The operator is accountable for what reaches a customer,
   so the exact text is rendered on screen before anything opens.

A deep link needs no account, no API key and no subscription, and works
identically on a phone and on desktop.

## 5. Phone number normalisation

Omani numbers are commonly stored as `9XXXXXXX` with no country code. Passing
that to `wa.me` either fails or routes to the wrong country, so the number is
normalised first:

| Stored | Sent to `wa.me` |
| --- | --- |
| `90000060` | `96890000060` |
| `+968 9000 0060` | `96890000060` |
| `00968 90000060` | `96890000060` |
| `971501234567` | `971501234567` (already international) |

The message is URL-encoded, so newlines and ampersands in Arabic text cannot
break out of the query string. The opened tab uses `noopener`, so it cannot
reach back into the application through `window.opener`.

## 6. Message content

Each message includes what the customer actually needs, so she does not have to
call back and ask:

- the **time**, not just the date, taken from the booking or the showroom
  default;
- the **accessories** attached to the booking, so she knows what to bring or
  expect;
- the **outstanding balance**, when there is one;
- the reservation number and the showroom name.

## 7. What is not covered

- **Push notifications** are not implemented. A local-first PWA with no server
  cannot deliver a push when the app is closed; that requires a push service and
  a backend, which this product deliberately does not have. The dashboard alert
  and the reminders page cover the in-app case.
- **Scheduled/automatic sending** is out of scope for the same reason as
  section 4.
