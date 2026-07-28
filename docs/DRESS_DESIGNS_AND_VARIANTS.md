# Dress designs and variants

How the application represents "the same dress in several sizes and colours",
and why it is modelled this way.

Implementation: `src/features/dresses/design.types.ts`,
`design.service.ts`, `AddDesignModal.tsx`.
Tests: `tests/dress-designs.test.mjs`.

## 1. The problem

A rental showroom does not own "a dress". It owns a **model** — say an ivory
mermaid gown — and several **physical pieces** of that model in different sizes
and colours, sometimes two identical copies of the same size.

The original model had only the physical piece. Five sizes of one gown were five
unrelated records, which meant:

- the operator could not answer *"do we have this design in size L for that
  weekend?"* without opening every record by hand;
- a booking clash on one size made the whole design look unavailable;
- reports counted five separate items instead of one design's performance.

This was a genuine modelling gap. It was not caught in any earlier phase.

## 2. The two levels

| Level | Record | Owns |
| --- | --- | --- |
| **Design** | `DressDesign` | The name, category, shared images, default prices, and a never-reused `DSG-` code |
| **Piece** | `Dress` (unchanged) | Its own `D-` stock code, its own barcode, its physical condition, and its entire booking and financial history |

The piece stays the unit of truth, because that is what physically exists: you
hand a customer one specific garment, not a design. The design is only a
grouping above it, and the link (`designId`) lives on the piece.

Design codes come from their **own counter**, separate from item codes, so a
design code (`DSG-004`) and a piece code (`D-004`) can never be mistaken for one
another.

## 3. The design owns no availability

This is the most important rule. A design never stores a stock count or an
availability flag. Every question about whether something is free is answered by
looking at its pieces and running the **existing central conflict rule**
(`reservationConflicts.ts`) against each one.

```
freeInPeriod(size, colour, period) =
    count of pieces of that size and colour
    where the piece is rentable (not damaged, not sold, is for rent)
      and findItemConflicts(piece, period) is empty
```

Consequences that fall out for free, and are each covered by a test:

- booking one size leaves every other size of the design bookable;
- a second identical copy of a size stays bookable when the first is taken;
- the configured preparation and cleaning windows apply automatically;
- a damaged or sold piece is never offered, whatever the period.

There is still exactly **one** definition of an occupied period in the
application. Adding designs did not add a second one.

## 4. No migration was required

The `designId` link is deliberately optional:

- a showroom legitimately owns one-off pieces that belong to no design;
- every record created before designs existed simply has no link.

Both keep working untouched, and a test proves it. An existing standalone piece
can be attached to a design later with `assignPieceToDesign`, which changes
**only** the link — never the stock code, the barcode, the price or the history.

## 5. Creating stock

`AddDesignModal` creates a design and all of its pieces in one step, because
that is how stock actually arrives: one model, several sizes, sometimes several
copies each. Each piece still goes through the normal inventory path, so it
receives its own never-reused code, its own derived barcode and its own audit
entry — identical to an item added on its own.

The whole operation runs through `addDesignWithVariantsCommand`, so it is atomic.
A half-created design would leave orphan pieces holding permanently-retired
codes, which is unrecoverable; a test forces that failure and asserts nothing
survives.

A variant may override the design's default rental, sale or deposit price, since
a larger or specially-coloured piece is sometimes priced differently.

## 6. Booking flow

The reservation form is a three-step narrowing:

1. **Search a design** — filtered by name or code, with a live count of how many
   pieces are free for the chosen period.
2. **Pick size and colour** — each option shows its free count, and fully-booked
   options are disabled with the reason stated.
3. **Pick the piece** — only pieces genuinely bookable for that exact period.

Picking a piece directly still works, for one-off items and for an operator who
already knows the code. Doing so reveals which design it belongs to.

## 7. Reporting

Because a piece keeps its own identity and history, all existing per-item
reporting continues to work unchanged. The design grouping is additive: it makes
"how is this model performing across all its pieces" answerable, without
altering how any individual piece's revenue, cost or utilisation is computed.
