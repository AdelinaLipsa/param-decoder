# Param Decoder

An internal tool for reading, validating, fixing, and comparing BuyGoods checkout and offer URLs.

Paste any link and it explains every parameter in plain English, flags what matters (missing or empty `aff_id`, the click-ID-vs-commission distinction, duplicates, malformed UTMs), and hands back a clean rebuilt link.

**Everything runs in your browser — nothing you paste is sent, stored, or logged**, so live links are safe to paste.

## Use it

It's a single self-contained `index.html` — no build, no install. Either:

- open `index.html` directly in a browser, or
- visit the hosted version on GitHub Pages.

## Modes

- **Inspect** — decode one link: plain-English summary, a labelled param table with status flags, inline edits and one-click fixes, and a rebuilt "clean" link to copy. Reads the funnel out of the path (VSL variant, lander, geo) and decodes Base64 `redirect=` targets.
- **Compare** — two links side by side, merged by param, so you can see *why one tracks and the other doesn't* (`aff_id` and `subid` differences stand out most).
- **Batch** — paste a column of links and get a green/red pass-fail audit, with CSV export and a bulk "fill missing `aff_id`" action.
- **Postback** — check a tracker's postback URL against the exact tokens BuyGoods fills (`{SUBID}`…`{SUBID5}`, `{ORDERID}`, `{COMMISSION_AMOUNT}`, …).
- **How to use** — a built-in guide.

You can save affiliate and offer names (stored on your device only) and share an exact view via the page URL.

## Tests

A Playwright regression suite drives the real page in headless Chromium:

```bash
npm install
npx playwright install chromium
npm test
```
