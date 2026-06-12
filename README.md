# Param Decoder

An internal tool for **affiliate managers and tech support** that reads, validates, fixes, and compares BuyGoods checkout and offer URLs — and looks up payment decline codes — entirely in the browser.

Paste a link and it explains every parameter in plain English, flags what actually matters (missing or empty `aff_id`, the click‑ID‑vs‑commission distinction, duplicates, malformed UTMs, typo'd param names), and hands back a clean rebuilt link. Paste a decline code and it tells you, in plain language, what the gateway meant and what to do next.

> **Scope, on purpose.** This is a *parameter utility*, not an analytics platform. Reporting, redirect‑chain tracing, and dashboards live in the company's own platform (clickcrm.com). This tool does one thing well: it knows BuyGoods links and payment codes cold, so a support person doesn't need to pull in a veteran affiliate manager to read a link.

## Why this over a generic URL decoder

A generic query‑string parser explains `utm_*` and `gclid` but is blind to *our* params. This tool's edge is narrow and specific:

- **It knows BuyGoods.** `aff_id` missing → no commission. The five `subid` slots. The postback token set. What `pfnid` / `vtid` / `external_order_id` / `product_codename` are. The funnel encoded in the URL *path* (`/hu/vsl7/l1/af/`).
- **It validates, not just displays.** It flags the broken thing in BuyGoods terms — not just lists keys.
- **It's private.** Every online parser POSTs your URL to a server. This runs **100% in your browser** — nothing you paste is sent, stored, or logged — so pasting live customer/order links is safe.
- **It hands you a ticket.** Inspect → diagnosis → a copy‑paste, ticket‑ready report, fitted to a support flow.

## Use it

It's a single self‑contained `index.html` — no build, no install. Either:

- open `index.html` directly in a browser, or
- visit the hosted version on GitHub Pages.

## Which mode do I use?

| You have… | You want to know… | Mode |
|---|---|---|
| One offer/checkout **link** | Why it does (or doesn't) track / pay commission | **Inspect** |
| **Two links** | Why one tracks and the other doesn't | **Compare** |
| A **column of links** | A quick pass/fail audit across many | **Batch** |
| A tracker's **postback URL** | Whether its tokens match what BuyGoods sends | **Postback** |
| A **decline code** from a failed charge | What it means, and whether to retry | **Decline** |

> **Note:** a **decline code usually isn't a URL parameter** — it comes from the *transaction* (BuyGoods backoffice, the gateway response, a postback, or the error shown to the customer), so Decline mode is mostly a standalone lookup. The exception: if a failure/thank-you URL *does* carry the code (e.g. `?decline_code=do_not_honor`, `?response_code=202`), **Inspect detects it and explains it inline** — soft/hard, retry-or-not — without leaving the link view.

## Modes

- **Inspect** — decode one link: a plain‑English summary, a labelled parameter table with status flags, inline edits and one‑click fixes, and a rebuilt "clean" link to copy. It also:
  - reads the funnel out of the **path** (VSL variant, lander, geo/language — both the Brazilian affiliate side and the US buyer side),
  - decodes **Base64 `redirect=`** targets and lets you drill into their nested params,
  - flags **typo'd param names** (`af_id`, `affid`, `utm-source`…) and suggests the intended key,
  - tolerates **messy pasted input**,
  - checks a link against a saved per‑offer **QA template**, and
  - exports a ticket‑ready **Copy diagnosis** report.
- **Compare** — two links side by side, merged by param, so you can see *why one tracks and the other doesn't* (`aff_id` and `subid` differences stand out most).
- **Batch** — paste a column of links and get a green/red pass‑fail audit, with CSV export and a bulk "fill missing `aff_id`" action.
- **Postback** — check a tracker's postback URL against the exact tokens BuyGoods fills (`{SUBID}`…`{SUBID5}`, `{ORDERID}`, `{COMMISSION_AMOUNT}`, …).
- **Decline** — paste a Stripe / Braintree / NMI decline code for a plain‑language read: soft vs hard, whether it's worth retrying, and the message to give the customer or HG agent. See [Decline codes](#decline-codes) below.
- **How to use** — a built‑in guide.

You can save affiliate/offer names and per‑offer QA templates (stored **on your device only**) and share an exact view via the page URL.

## What it knows about BuyGoods

This is the part a generic tool can't copy — the knowledge is encoded once so everyone benefits:

- **`aff_id`** — numeric, decides whether the link earns commission. Empty/malformed → flagged as an error.
- **Five tracking slots** — `subid`, `subid2`…`subid5`. Never format‑checked (any value is valid); `subid2` usually carries the click ID a tracker needs to credit the conversion.
- **The key distinction** — `aff_id` pays the *affiliate*; the click ID in a `subid` slot is what the affiliate's *tracker* needs to report the conversion. A link can pay the affiliate yet still not report back to their tracker. The tool calls this out explicitly.
- **Secure‑checkout params** — `account_id`, `product_codename`, `redirect=<Base64>`, the `sub<N>` checkout‑tracking family, and session/funnel identifiers (`pfnid`, `vtid`, `external_order_id`, …).
- **VSL path intelligence** — advertorial/VSL funnels encode the funnel in the path (`/hu/vsl7/l1/af/` = Hungarian, VSL variant 7, lander 1, affiliate redirect). Recognised heuristically, never blocking.
- **Postback tokens** — the fixed set BuyGoods fills at conversion time.

## Decline codes

Decline mode is backed by **~190 codes transcribed verbatim from each payment processor's own published documentation** — not a hand‑written starter set. Every result card **cites the source**.

| Processor | Source |
|---|---|
| **Stripe** | <https://docs.stripe.com/declines/codes> (50 card decline codes) |
| **Braintree / PayPal** | <https://developer.paypal.com/braintree/docs/reference/general/processor-responses/authorization-responses> (full 2xxx declines + 3000 network) |
| **NMI** | <https://docs.nmi.com/reference/response-codes> (detailed response codes) |

How it's organised, and why it's trustworthy:

- **Per‑processor, no collisions.** Codes are keyed by processor (Stripe = strings, Braintree = `2xxx`, NMI = `2xx`/`3xx`/`4xx`), so a numeric code can never false‑match across gateways. A pasted code resolves to exactly one processor.
- **Two layers, kept separate.** Each code's *meaning* (`title`) is the sourced fact. The *guidance* — soft vs hard, retry‑worthiness, and the customer message — is derived from the code's **category**, so it reads consistently across processors: "insufficient funds" is the same answer whether it arrives as Stripe `insufficient_funds`, Braintree `2001`, or NMI `202`.
- **Honest boundaries.** Raw ISO‑8583 codes (`05`, `51`, `54`…) are deliberately *excluded* — they have no clean primary source (the authoritative specs are private card‑network documents). If the team wants them, they'd go in a separate, explicitly team‑confirmed table rather than be passed off as processor‑sourced.

To add or change a code, edit one line under its processor; to change how a whole class reads (e.g. all "limit exceeded" codes), edit its category once.

## Privacy

Everything runs client‑side. Nothing you paste — links, order data, decline codes — is sent, stored, or logged. For a tool you paste live customer and order links into, that's the whole point.

## Tests

A Playwright regression suite drives the real page in headless Chromium:

```bash
npm install
npx playwright install chromium
npm test
```

## Design notes

Implementation favours **declarative config + pure functions**: the param dictionary, decline tables, and decline categories are data, and behaviour is derived from them. Adding a param or a code is a one‑line change, not a logic edit. Design specs for larger changes live in `docs/superpowers/specs/`.
