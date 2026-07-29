# Measurements, sizing and document printing

Two features documented together because both are about **not lying to the
operator**: a size suggestion that overstates its confidence, or a printed
contract that silently loses a section, are worse than not having the feature.

Implementation: `src/features/customers/measurements.service.ts`,
`src/platform/printing/printSettings.ts`.
Tests: `tests/measurements-printing.test.mjs` (24).

## 1. Why measurements became structured

The customer record kept measurements as one free-text field. That is fine as a
note and useless for anything else:

- the app could not compare a customer to a dress, so it could not warn that a
  piece would not fit;
- it could not suggest a size;
- two staff members wrote the same body differently (`طول ١٦٥`, `165 سم`), so
  the text was not reliably readable by a human later either.

### Everything is optional

A showroom often takes only the bust and the length at a first visit. Requiring
a full set would make the form refuse a real, useful record — and staff would go
straight back to typing in the notes field, which is the problem being solved.

### Legacy text is read, not discarded

Existing records are parsed for recognised numbers on open, so a customer's
history starts populated instead of blank, and the original text is preserved
verbatim so nothing that could not be parsed is ever lost.

## 2. How the size is chosen

The chart is the common Middle-East women's bridal/evening sizing in
centimetres. The suggestion picks the size the body sits closest to:

```
score(size) = |bust outside range| × 2
            + |waist outside range|
            + |hips outside range|
```

**Bust carries double weight.** A bodice that will not close cannot be worn at
all; a waist or hip slightly out is routinely taken in or let out on a rental
gown. When the two disagree, the bust must win.

### What it refuses to do

| Situation | Behaviour | Why |
| --- | --- | --- |
| No bust measurement | No suggestion at all | Guessing from waist alone would be dishonest |
| Partial measurements | Suggests, but states what is missing | The operator must know the confidence |
| Piece labelled `42` or similar | Returns `unknown` | Mapping a numeric size to a letter would be a fabrication the operator would then trust |
| No measurements at all | Returns `unknown` | Silence is better than a fake match |

### Fit levels

| Gap from suggested size | Level | Reasoning |
| --- | --- | --- |
| 0 | `exact` | — |
| +1 (larger) | `close` | Usually takes in cleanly |
| +2 (larger) | `alterable` | Needs visible alteration |
| −1 (smaller) | `alterable` | A gown often cannot be let out enough; must be tried |
| Beyond that | `unsuitable` | — |

Smaller is treated as riskier than larger by design: fabric can be removed far
more reliably than it can be added.

### Length

Length is shoulder-to-hem and is compared against the customer's length **plus
the heel she intends to wear**. A 3cm difference is the gap between an elegant
gown and one that drags on the floor.

## 3. Printing

### What was wrong

Every document was hard-coded to one layout: A4-ish padding, full colour,
everything visible. A showroom prints at least three different things on three
different papers.

### What is configurable

| Setting | Options | Why it exists |
| --- | --- | --- |
| Paper | A4, A5, Letter, 80mm & 58mm thermal, 80×45mm label | Contract on A4, barcode on a sticker roll, receipt on thermal |
| Margins | Per edge, 0–40mm | Every printer has a different unprintable edge; a contract that loses its signature line is worthless |
| Colour | Full, grayscale, black & white | Thermal printers have no colour; ink is expensive for a filed copy |
| Density | Comfortable, compact | Fit a contract on one page without shrinking the text |
| Font size | 7–20pt | Below 7pt Arabic diacritics stop being legible |
| Sections | Individually toggled | Terms belong on the customer copy, waste a page on the filing copy |

Settings are stored **per showroom, not per document** — the paper in the
printer does not change between a contract and an invoice.

### Details that would otherwise break it

- **`print-color-adjust: exact`** — without it browsers strip background colours
  from printed output, and every status badge and shaded table header prints
  blank. This is the single most common cause of "it looked fine on screen".
- **`break-inside: avoid` on rows** — a contract row split across a page
  boundary cannot be read.
- **`thead { display: table-header-group }`** — a multi-page table repeats its
  header instead of leaving orphan rows.
- **Continuous paper** stacks the signature lines vertically. Roll paper has no
  fixed width to spread them across.
- **Changing paper resets margins** to that stock's safe defaults. Carrying A4
  margins onto a 58mm receipt would leave almost no printable width.
- **Labels ignore the document paper size** entirely and always use label stock,
  inheriting only the colour mode. Otherwise an A4 setting pushes an 80mm
  sticker onto a full sheet.

### PDF

PDF export goes through the browser's own "Save as PDF" in the print dialog, and
the settings above apply to the generated file.

This is deliberate rather than a limitation. A bundled PDF library would add a
large dependency, would need Arabic font subsetting and RTL shaping handled
manually — the most common source of broken Arabic PDFs — and would duplicate an
engine every device already has. The browser path produces correct Arabic, works
offline, and needs no maintenance.

### The test page

The settings editor prints a page containing every element a real document uses:
heading, table, totals, terms, signatures and footer.

Margins and colour cannot be judged from a form. The only way to know whether a
printer clips the signature line is to print one, so one test sheet proves the
whole setup before a customer is standing at the counter.

## 4. Contact details

The showroom profile carries a primary number, alternate numbers, a WhatsApp
number, a primary mailbox and a secondary one. They appear on printed documents
under the `contact` section, which can be switched off for internal copies.
