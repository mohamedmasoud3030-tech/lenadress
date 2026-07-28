# UX hardening — reported phone defects and the audit around them

Triggered by real-device feedback from the installed PWA. Each reported symptom
is recorded with its actual root cause, because in every case the obvious
explanation was not the real one.

| PR | Branch | Head SHA | Merge SHA | Checks |
| --- | --- | --- | --- | --- |
| [#110](https://github.com/mohamedmasoud3030-tech/lenadress/pull/110) | `fix/print-and-mobile-shell-20260729` | `684a9e0e7e044016dc2ec5b33b10aa29cd8aacde` | `044b0ccd177b74708f84d9efc19fa48f55388940` | Build #250, Verify #222 |
| [#111](https://github.com/mohamedmasoud3030-tech/lenadress/pull/111) | `fix/page-consistency-and-a11y-20260729` | `cf5a7d9ad96f1756fde46fdc341a0a3656d90ed4` | `16599a78e760cafdacf05597d50740604bfa1e87` | Build #252, Verify #224 |

## 1. Reported defects

### 1.1 The print view trapped the operator

**Symptom:** opening a rental contract or a barcode label showed the document
with no way back. The app had to be killed. Reported as happening "in many
places" — correct, because every print path shared one boundary.

**Root cause:** `window.open('', '_blank')`. In a standalone PWA, and in the iOS
in-app browser, that opens a bare view with no address bar, no back button and
no close affordance. On a desktop browser the same call produces a normal window
with full chrome, which is why it was never caught.

**Fix:** documents render in a same-document overlay iframe. The app stays
mounted underneath and there are three independent exits — an explicit Arabic
close button, Escape, and the system back gesture (`popstate`). A second print
replaces the first view rather than stacking. `@media print` keeps both the app
behind it and the overlay chrome off the paper. No `window.open` remains in
`src/`.

**File:** `src/platform/printing/printDocument.ts`.

### 1.2 The screen zoomed in and out

**Root cause:** iOS force-zooms the viewport whenever a focused form control
renders below 16px. Every field in the app used `text-sm`, which is 14px.

**Fix:** form controls render at 16px on touch devices only
(`@media (hover: none) and (pointer: coarse)`), removing the trigger without
changing the desktop type scale.

**Rejected alternative:** `maximum-scale=1, user-scalable=no` would have stopped
the zoom in one line, but it also removes pinch-zoom from a user who needs it.
That trades an accessibility failure for a cosmetic fix. A contract test now
fails the build if either appears in the viewport tag.

### 1.3 The page slid left and right while scrolling

**Root cause:** `overflow-x: hidden` was already set, and it does not stop a
touch drag from rubber-banding the page sideways on iOS. It only clips
*layout* overflow, not *scroll* overscroll.

**Fix:** `overscroll-behavior: none` pins both axes. It also stops
pull-to-refresh firing in the middle of a form, which was a second latent bug.

### 1.4 Dialogs jumped when the keyboard opened

**Root cause:** the scroll lock set `position: fixed` on `<body>` with a negative
`top`. Every focus and blur re-laid out the fixed body, so the sheet visibly
jumped while typing, and a long form's submit button ended up under the keyboard.

**Fix:** the lock now only stops the body scrolling and preserves the reading
position. The dialog is sized to `window.visualViewport`, so the keyboard
*shrinks* the sheet instead of displacing it. Locks are counted, so a nested
dialog cannot unlock the page early, and focus returns to whatever opened the
dialog.

**File:** `src/components/shared/Modal.tsx`.

### 1.5 The dashboard was empty

**Root cause:** it rendered four stock counts and a shortcut grid. It answered
"how much do I own" and never "what must I do today, and what have I not
collected".

**Fix:** the board now leads with an uncollected-money alert — the total owed,
how many bookings it spans, how much sits on rentals whose period already ended,
the largest balances, and a route to collection, with overdue money sorted
first — followed by today's pickups and returns ordered by their real time, a
separate late-returns list, live inventory/accessory/service state, and an
onboarding empty state for a showroom that has not started.

`dashboard.service.ts` reads only from the existing operational and finance
layers. Today's cash comes from `getFinanceTotals`, so the board cannot disagree
with the reports or the daily close.

### 1.6 Input forms and pages needed tightening and shared components

Delivered as `FormField`, `TextField`, `MoneyField`, `SelectField`,
`TextAreaField`, `FormActions`, `Section`, `ScrollArea`, `FilterBar`,
`SearchFilter` and `SelectFilter`. The correct version is now the default one:
labels tied to controls, 44px targets, errors always `role="alert"` and wired
through `aria-describedby` with `aria-invalid`, numeric keypads on money fields,
and `aria-busy` on a pending submit.

## 2. Defects found by auditing, not reported

| # | Defect | Why it mattered |
| --- | --- | --- |
| 1 | The expense form had **no double-submit guard and no idempotency key** | A second tap posted the same cost twice; the books silently lost money |
| 2 | The sale-invoice form had the same gap | A second tap created a second invoice and marked the same stock sold twice, double-counting revenue |
| 3 | The appointment form had the same gap | Duplicate fittings |
| 4 | `addAppointment` generated ids with `Math.random()` | Collision risk, and the weak-randomness pattern already removed elsewhere in this codebase |
| 5 | Image ids in the IndexedDB repository had the same problem | Same |
| 6 | Appointments had **no validation at all** | No required fields, no check that the end time follows the start, no room double-booking guard |
| 7 | The appointment form's labels were not tied to their controls | None of its fields were reachable by assistive tech, and its inputs were below the tap target |
| 8 | Accessory costs could not be attributed to an accessory | Cleaning a veil disappeared into general expenses instead of reaching that veil's profitability row |
| 9 | Four controls used `focus:ring` instead of `focus-visible:ring` | A focus ring appeared on mouse click, which is noise and dilutes the keyboard indicator |
| 10 | Every list-page filter select had **no accessible name** | A screen reader announced a bare "combo box" with no indication of what it filtered |
| 11 | "No results" never distinguished *nothing recorded* from *nothing matches* | Two very different situations shown identically to the operator |

## 3. Guardrails added

These fail the build, so none of the above can silently return:

- printing must render in a dismissible in-app view with Escape and back exits,
  and no `window.open` may reappear;
- form controls must render at 16px on touch devices, both overscroll axes must
  be pinned, and zoom must **not** be locked;
- the modal must follow the visual viewport and must not reintroduce the
  fixed-body lock;
- all nine write modals must guard against double submit;
- no persisted identifier may come from `Math.random()`;
- no component may use a mouse-triggered focus ring;
- every list page must use the shared header, cards, filter bar and empty state,
  must keep `min-w-0`, and must not hand-roll an `h1`;
- the dashboard must surface uncollected money from the canonical source.

## 4. Test coverage

Full gate: **33 suites, 263 passing assertions**, all green alongside
`typecheck`, `lint` and `build`.

New in this stage:

| Suite | Tests | Focus |
| --- | --- | --- |
| `tests/dashboard-operations.test.mjs` | 11 | Empty showroom, pickup/return ordering, default-time fallback, uncollected totals and collection order, overdue money, paid bookings leaving the list, cash matching the finance layer, overdue returns, accessory counts, cancelled bookings, seven-day preview |
| `tests/helpers/dom.mjs` | — | Minimal DOM double for the print overlay, deliberately small so tests pin the exact behaviour rather than a library's |
| `tests/ui-contract.test.mjs` | +10 | All guardrails in section 3 |
| `capability-recovery`, `print-sale-invoice`, `barcode-lifecycle`, `inventory-performance-export` | migrated | The overlay print contract |

## 5. Still requires a real device

Everything above is enforced by automated contract tests, but the contract tests
verify the *code*, not the *phone*. These must still be confirmed on hardware
before the release tag, and remain tracked in `docs/RUNTIME_QA.md`:

- the print overlay opening and closing cleanly in the installed PWA;
- no auto-zoom when tapping a field at 390×844 and at 360×740;
- no sideways drift while scrolling a long list;
- a dialog staying stable with the software keyboard open, with its submit
  button reachable;
- a real camera barcode scan;
- printing a contract and labels from a physical printer.

**No release tag was created.** It stays withheld until this evidence exists.
