# Compare + Batch: last-touch attribution awareness

**Date:** 2026-06-13
**Status:** implemented

## Source

BuyGoods AM manual: attribution is **last-touch on a 90-day cookie**, the last
affiliate link a customer clicks wins the commission. Two manual-specific touches
so Compare and Batch get their own upgrade (not just the inherited param dictionary).

## Compare, last-touch insight

When the two links carry **different `aff_id`**, the existing "aff_id differs"
banner now explains the consequence: with last-touch attribution on a 90-day
cookie, whichever link the customer clicks last wins the commission, not both.
One-line message change in `compareBanners`.

## Batch, attribution-collision flag

`auditLink` now returns `dest` (host + path, query stripped, trailing slash
normalized) = the offer regardless of tracking. New `affCollisions(results)`
groups rows by `dest` and flags any offer promoted under **more than one
non-empty `aff_id`** in the same batch. `renderBatch` shows a warn banner per
collision: the offer, the competing IDs, and the last-touch consequence ("only
the last click is credited, check for a mislabeled link").

This catches the case where every link passes individually but two of them
quietly compete for the same conversions, which a per-link audit can't see.

## Testing

- Compare C2: asserts the aff_id-differs banner carries the last-touch insight.
- Batch BA3: same offer + two aff_ids → collision banner naming both IDs + last-touch.
- BA4: same offer + same aff_id → no false positive.
- BA5: different offers + different aff_ids → no false positive.

**359 assertions, all passing.**
