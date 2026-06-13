# Manual-grounded module updates

**Date:** 2026-06-13
**Status:** implemented

## Source

The BuyGoods Affiliate Manager training manual (shared by the user) plus web
research on decline-code handling. Key facts encoded: BuyGoods is the retailer +
**payment processor** (liable for refunds/chargebacks, 1% chargeback ceiling);
three pillars (customer / vendor / affiliate); **HG = HelpGrid**, the
customer-support partner; `aff_id` = account nickname, last-touch attribution on
a 90-day cookie; subids are campaign tracking tags surfaced in Sales-by-SubID /
SID2 reports; postback supports up to 5 subid slots and beats a pixel for
reliability (works on mobile).

## Decline module — reframe around the decision

**Problem:** the module led with the code *definition* (soft/hard + meaning),
which is the Googleable question. A generic lookup or Stripe's own docs answer it.

**Change:** lead with **who fixes this and what to do**, the question staff
actually have. New `DECLINE_OWNERS` table with five owners, each carrying the
internal next step (`route`):

- **customer** — HelpGrid coaches the buyer (re-enter / different card)
- **customer_bank** — buyer uses another card or contacts their bank; don't
  re-run the same card right away
- **transient** — technical hiccup, safe to retry; escalate if persistent
- **fraud** — don't retry, mask specifics; **a burst off one affiliate's traffic
  is a card-testing signal, flag the traffic to the AM** (chargeback / 1% risk)
- **platform** — gateway / merchant-account config, not the buyer's or
  affiliate's fault, escalate to BuyGoods tech

Each `DECLINE_CATS` entry gains an `owner`. `lookupDecline` threads it through.
`declineCard()` now leads with a toned owner-verdict block (label + route),
demotes the definition to a supporting `.dc-title` line, and keeps the
HelpGrid-ready customer message, retry chip, and cited source. Soft/hard stays as
secondary detail. Help concept copy rewritten around the three pillars.

**In lane:** the tool only interprets a single code and gives guidance. It does
NOT compute decline rates or analyze traffic (that stays in clickcrm). The
card-testing line is interpretive guidance shown on fraud-bucket codes.

**Non-Googleable moat:** owner-routing tied to BuyGoods' structure + the
affiliate card-testing interpretation.

## Param dictionary — manual-confirmed enrichment

- `aff_id`: "the affiliate's account nickname, who earns the commission;
  last-touch attribution on a 90-day cookie."
- `subid`: "campaign tracking tag (e.g. subid=facebook); shows in Sales by SubID."
- `subid2`: "usually the click ID from the affiliate's tracker; Sales by SID2."

All confirmed by the manual (a team source), so they stay `confirmed` (no badge).
Also swept remaining "your tracker" / "if you track" second-person phrasing to the
internal-staff voice (the affiliate owns the tracker, not the reader).

## Postback — manual context

Added to the generated-postback note: BuyGoods supports up to 5 subid slots, and
postback (S2S) is recommended over a pixel (more reliable, works on mobile). No
change to validation or the confirmed token set.

## Testing

`test.mjs` extended: `declineCard` reader now captures owner label / tone /
route; DC6 integrity check asserts every category has a valid owner; new DC7
block asserts the owner verdict + actionable route for customer / customer-bank /
fraud (incl. the affiliate card-testing signal) / platform / transient codes.
**353 assertions, all passing.**
