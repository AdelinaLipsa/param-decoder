# Decline Codes — Authoritative Rebuild

**Date:** 2026-06-12
**Slice:** #1 of the "best param utility" initiative
**Status:** Design — pending user review

## Context

Param Decoder is, by deliberate scope, a **parameter utility for affiliate managers and tech support** at a BuyGoods-affiliated company. Analytics live in the company's own clickcrm.com platform; this tool does not duplicate them. Its edge is being authoritative on BuyGoods-specific truth and never making a junior person guess.

The Decline mode currently ships a ~20-entry starter table labelled *"verify before trusting."* That label is the problem: AMs and support can't rely on it for a real customer's failed payment. This slice makes the decline read **authoritative** — sourced from each processor's own published codes — and removes the disclaimer for the codes we've actually verified.

The processors in scope (confirmed by the user): **Stripe, Braintree/PayPal, NMI.**

## The core problem with today's model

```js
{ codes: ["do_not_honor", "2000", "200", "201", "05"], title: "...", type: "hard", retry: false, customer: "..." }
```

All three processors' codes are merged into one flat `codes` array. This is **wrong for accuracy**: the same numeric string means different things across gateways. `200`, `201`, `204` (NMI/ISO) collide with Braintree's `2xxx` namespace and with each other. A bare `05` is ISO "do not honor," but a bare `2000` is Braintree's. Merging them means a lookup can confidently return the wrong processor's meaning. That is exactly the "echoes a plausible-but-wrong answer" failure the tool exists to prevent.

## Design

### 1. Per-processor data model

Codes are namespaced by processor. Each processor has its own table keyed by that processor's real code.

```js
const DECLINE_TABLES = {
  stripe: {
    label: "Stripe",
    source: "https://docs.stripe.com/declines/codes",   // primary doc, cited in UI
    codes: {
      insufficient_funds: { title: "Insufficient funds", type: "soft", retry: true,
        customer: "...", note: "Stripe decline_code." },
      // ...one entry per real Stripe decline_code
    },
  },
  braintree: {
    label: "Braintree / PayPal",
    source: "https://developer.paypal.com/braintree/docs/reference/general/processor-responses/...",
    codes: { "2000": { title: "Do not honor", type: "hard", retry: false, customer: "..." }, /* ... */ },
  },
  nmi: {
    label: "NMI",
    source: "<NMI response-code reference>",
    codes: { "200": { title: "...", type: "...", retry: ..., customer: "..." }, /* ... */ },
  },
};
```

Field meanings (unchanged where they exist today):
- `title` — short human name.
- `type` — `soft` (issuer/temporary; a retry can succeed) or `hard` (permanent; retrying the same card won't help).
- `retry` — is an automatic/customer retry worth it?
- `customer` — the message to give the buyer or HG agent.
- `note` *(optional)* — disambiguation ("Stripe decline_code", "Braintree processor response").

Each **processor table** carries a `source` URL. That URL is the trust signal for this slice — the same role the confirmed/inferred badge plays for the param dictionary. A code that came from the processor's published table is, by definition, `confirmed`.

### 2. Lookup behavior

`lookupDecline(code, processor?)`:

- **Processor known** (user picked one, or input is unambiguously a Stripe string like `insufficient_funds`): look up directly in that table. Return `{ processor, entry }`.
- **Processor unknown + numeric code** (e.g. `200`): the code may exist in more than one table with *different meanings*. Return **all matches**, each tagged with its processor, rather than silently guessing one. The UI shows "This code means different things by processor — which gateway?" with each reading. Ambiguity surfaced, never hidden.
- **No match:** return null → the existing "not found" message.

This is the key behavioral change: the tool stops pretending one numeric code has one meaning.

### 3. UI

Decline mode gains a small, optional **processor selector** (Stripe / Braintree / NMI / "I don't know"). Default "I don't know" preserves today's paste-and-go flow but routes through the ambiguity-aware lookup. The result card shows the matched processor and a cited **source link**, replacing the blanket "verify before trusting" disclaimer for confirmed codes.

### 4. Scope of the data

- Stripe: the full published `decline_code` list.
- Braintree/PayPal: the published processor response codes (the `1xxx` approved / `2xxx` declined / `3xxx` soft-decline ranges), at minimum every declined/soft code; approvals can be summarized.
- NMI: the published gateway/response codes for declines.

**No code is invented.** Every entry traces to a primary-source URL captured during research. If a processor's doc is ambiguous on soft-vs-hard, the entry is included with the processor's own wording and conservatively marked, never fabricated.

## Non-goals (YAGNI)

- No live API calls to processors (stays 100% client-side — the privacy guarantee is non-negotiable).
- No analytics, decline-rate trends, or reporting — that's clickcrm's job.
- No coverage of processors not in scope (Adyen, Authorize.net, etc.) until the team confirms they're used.

## Testing

Extend `test.mjs`:
- A known Stripe string resolves to the correct single entry with its source.
- A colliding numeric code (e.g. `200`) returns multiple processor-tagged readings, not one.
- A processor-scoped lookup returns only that processor's reading.
- Every entry has a non-empty `title`, valid `type`, boolean `retry`, non-empty `customer`.
- Every processor table has a `source` URL.

## Out of this slice / sequence

This is slice #1. Following slices (separate spec → plan → build each): trust-badge infrastructure + postback macros, param-dictionary depth + capture loop, ticket-ready verdict. The per-processor `source` pattern established here is the template the dictionary's confirmed/inferred badge will follow.
