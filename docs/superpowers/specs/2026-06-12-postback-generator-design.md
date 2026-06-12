# Postback Generator, design

**Status:** approved, ready for implementation plan
**Date:** 2026-06-12
**Origin:** First-round partner feedback (Serban, partner-network tech team). The decode/validate modes read as redundant to an expert tech team that already owns clickid lookups (ClickCRM) and offer QA. The one feature they explicitly asked for: select your 3rd-party tracker, get a default-configured postback the affiliate can paste or edit. Named user: beginner affiliates who do not know what params BuyGoods uses or what a postback should look like.

## Goal

Turn `Postback` mode from a validator-only feature into **generate-first**: pick a tracker, get a correct, paste-ready BuyGoods postback. Serve **both** audiences from one screen, the beginner who needs a complete URL plus plain-English context, and the expert who wants the string in two clicks and no hand-holding. The existing validator stays, one click away.

This is the smallest build that directly answers what a partner asked for, and it leans on the tracker dictionary the tool already has (`TRACKER_POSTBACKS`, `POSTBACK_TOKENS`), which is exactly the asset a generic tool cannot copy.

## Non-goals

- No reporting, redirect tracing, or analytics. Scope stays "parameter utility" per the README.
- No change to Inspect / Compare / Batch / Decline.
- No server. Everything stays 100% client-side in the single `index.html`.
- Not removing or de-emphasizing the decode modes. They simply are not Serban's job to use; they keep serving support and onboarding.

## UX

`Postback` mode gains a `Generate | Check` toggle. **Generate** is the default tab (now the more common need and the one a partner asked for). **Check** is today's validator, behavior unchanged.

### Generate layout

```
Tracker  [ Voluum v ]            curated list + "Other / custom"
Click ID is in:  [ subid2 v ]    subid ... subid5; default subid2

  https://YOUR-VOLUUM-DOMAIN/postback?cid={SUBID2}&payout={COMMISSION_AMOUNT}&txid={ORDERID}
                                                               [ Copy ]
  > What do I do with this?       collapsed plain-English note (beginner)

  Personalize (optional)
  Your Voluum domain  [ abc.voluum.com ]
  -> https://abc.voluum.com/postback?cid={SUBID2}&payout={COMMISSION_AMOUNT}&txid={ORDERID}   [ Copy ]
```

Pick a tracker, the correct template appears instantly with BuyGoods tokens pre-mapped. The expert copies and leaves. The beginner expands the note and fills the domain field to get a complete URL.

### Dual audience via progressive disclosure (not two designs)

- **Expert path:** template renders the instant a tracker is selected; copy and done. The note and the personalize block are visually quiet and fully ignorable.
- **Beginner path:** the "What do I do with this?" note explains, in plain English, "Paste this into your tracker's postback / S2S settings. BuyGoods fills the `{...}` tokens automatically at sale time, you do not edit those." The domain field turns the template into a real URL.
- Nothing is required. No wizard, no gating steps.

### Custom / Other tracker

Selecting "Other / custom" reveals fields for the affiliate's own click-param name (and optional payout/order params) plus domain. Handles the long tail and is itself a both-audiences feature: an expert with an obscure tracker is not stuck. Output is built the same way, custom params just are not doc-cited.

## Click-ID slot correctness (decided: selector, default subid2)

The affiliate's tracker passes its click ID **into** BuyGoods through a `subid` slot on the offer URL (most commonly `subid2`, per the README). BuyGoods passes it **back** through the postback. The postback must echo the **same slot** the click ID was stored in, otherwise the conversion does not credit the affiliate's tracker.

Decision: a `Click ID is in: [ subid2 v ]` selector (options `subid`...`subid5`, default `subid2`). Changing it rewrites only the click-ID token in the output (e.g. `{SUBID2}` -> `{SUBID3}`). The payout and order tokens are unaffected. This is correctness-critical and a natural both-audiences control: the beginner keeps the sensible default, the expert who knows their setup overrides it.

Per-tracker templates therefore store the click param with a **slot-agnostic marker**, and the build function substitutes the chosen slot. The other token mappings (payout, order ID) are fixed per tracker.

## Tracker dictionary (the moat)

Extend `TRACKER_POSTBACKS`. Each entry is doc-sourced and cited, the same trust standard as the decline tables: only the **param names** are asserted as fact, the **host stays a placeholder** until the affiliate personalizes it, and every card keeps its `source` link.

Curated set:

| Tracker | Status |
|---|---|
| Voluum | already in code, sourced |
| CPV Lab Pro | already in code, sourced |
| AnyTrack | already in code, sourced |
| RedTrack | add, source param names from RedTrack docs at build |
| Binom | add, source from Binom docs at build |
| BeMob | add, source from BeMob docs at build |
| FunnelFlux (Pro) | add, source from FunnelFlux docs at build |
| ClickMagick | add, source from ClickMagick docs at build |
| Other / custom | manual entry, not doc-cited |

The list is chosen for the BuyGoods / VSL / nutra affiliate world. It is adjustable: if Serban later returns his affiliates' actual tracker mix, entries are one-line data additions. Each new tracker's click/payout/order param names MUST be verified against that tracker's own current documentation during implementation, no param name ships unsourced.

## Code shape

Consistent with the existing declarative-config + pure-functions design notes:

- **Data:** each tracker is one entry, shaped roughly
  `{ id, label, source, note, host, clickParam, payoutParam?, orderParam? }`
  where the param fields name the tracker's own keys and the values they receive are BuyGoods tokens. Adding a tracker is a data change, not a logic edit.
- **Pure builder:** `buildPostback(tracker, { domain, clickSlot })` returns the postback string. No DOM, no globals, unit-testable in `test.mjs` style. The click token is derived from `clickSlot`; payout/order tokens are fixed per tracker.
- **Single source of truth:** Generate and Check both read `POSTBACK_TOKENS`. The token set is defined once.
- **Reuse:** the existing per-tracker reference-card rendering and `TRACKER_POSTBACKS` are absorbed into Generate rather than duplicated.

## Testing

Playwright, driving the real page (matches the existing suite):

- Each curated tracker emits its expected template with the correct param names and tokens.
- The `Click ID is in` selector rewrites only the click-ID token (`{SUBID2}` -> `{SUBID3}`), leaving payout/order tokens intact.
- The optional domain field produces the complete, real URL (placeholder host replaced).
- "Other / custom" round-trips a user-entered click-param name into a valid postback.
- Copy places the correct string on the clipboard (template, and personalized).
- Check mode still validates as before (regression).

## Out of this spec, possible follow-ups

- Replying to Serban (confirm the build, ask his affiliates' real tracker mix to tune the curated list).
- Repositioning the wider tool around the beginner affiliate as primary user (hero, copy, mode order). Deliberately deferred; this spec ships the feature he asked for first.
