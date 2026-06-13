# Example chips per mode (demo affordance)

**Date:** 2026-06-13
**Status:** approved

## Problem

Each secondary mode (Compare, Batch, Postback Check, Decline) offers at most one
worked example. For presenting the tool to affiliate managers and tech support,
one example shows *that* a mode works but not the *range* of what it catches. A
presenter needs to click through distinct, labeled scenarios that each tell a
different story on screen.

Inspect is out of scope: it already has its hero "Try this in Inspect" example.

## Design

A single reusable helper, `exampleChips(examples)`, renders a labeled row of
small ghost buttons in a mode's empty state. It replaces the single
`exampleButton(...)` call in each affected mode.

```
exampleChips([{ label, run }, ...]) -> HTMLElement (.ex-chips wrapping .ex-btn)
```

Each chip's `run` callback sets the mode's input(s), re-renders that mode, and
calls `syncHash()` — exactly what the current single buttons do. The existing
`exampleButton` helper is kept for any single-example use; `exampleChips` is the
multi-example sibling. Reuse the existing `.ex-btn` style; add a flex-wrap
`.ex-chips` container with a small gap.

### Chip sets (every scenario is a real, already-implemented behavior)

**Compare** (`#cmpOut`, inputs `#srcA` / `#srcB`):
- **Tracked vs not** — A carries `subid2={clickid}`, B is identical without it;
  highlights the click-ID gap between two otherwise-equal links.
- **Two affiliates** — same offer, `aff_id=162939` vs `aff_id=53838`; shows the
  attribution difference.

**Batch** (`#batchOut`, input `#srcBatch`):
- **Campaign audit** — the existing mixed pass/fail `EXAMPLE_BATCH`.
- **All clean** — three links that each pass (aff_id + a click-ID slot).
- **Common mistakes** — missing aff_id, no click-ID, duplicate subid.

**Postback Check** (`#pbOut`, input `#srcPostback`, view = check):
- **Valid** — all-supported uppercase tokens → green "Postback looks valid".
- **Unsupported token** — includes `{PRODUCT_CODENAME}` → red "Unsupported token".
- **Lowercase token** — `{subid}` → amber (BuyGoods expects `{SUBID}`).

**Decline** (`#declineOut`, input `#srcDecline`):
- **Soft / retry** — `insufficient_funds` (soft, safe to retry).
- **Hard** — `fraudulent` (hard, reason masked, do not retry).
- **Numeric (Braintree)** — `2001` → shows it reads processor numbers, not just
  Stripe strings.
- **Fixable by customer** — `incorrect_cvc` → re-enter the code and retry.

Postback Generate is unchanged — its 8-tracker dropdown already provides many
worked examples.

### Data

New worked-example constants live beside `EXAMPLE_POSTBACK` / `EXAMPLE_BATCH`.
No validation logic changes — chips only feed existing inputs through existing
render paths.

## Testing

Extend `test.mjs` (Playwright/headless). For each mode: assert the chip row
renders the expected number of `.ex-btn`, then click each chip and assert its
characteristic outcome:
- Compare: both `#srcA` and `#srcB` filled, comparison table renders.
- Batch: `#srcBatch` filled, audit rows render; "Common mistakes" yields at least
  one error row.
- Postback: "Valid" → info banner "looks valid"; "Unsupported token" → error
  banner; "Lowercase token" → a warn token row.
- Decline: each code resolves to the expected soft/hard verdict.

Run `node test.mjs`; all assertions (currently 329) plus the new ones must pass.
```
