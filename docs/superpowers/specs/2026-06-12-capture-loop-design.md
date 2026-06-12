# Param-Dictionary Capture Loop — Slice #3

**Date:** 2026-06-12
**Slice:** #3 of the "best param utility" initiative
**Status:** Design — pending review

## Context

The dictionary is the moat, and its value is being *right*. Slice #2 added the trust spine: params are **confirmed** (shipped, team-trusted) or **inferred** (shipped best-guess, dashed badge). The undocumented BuyGoods params (`pfnid`, `vtid`, `fnid`, …) sit at `inferred` because their real meanings live only in the team's heads — I can't invent them without destroying the moat.

This slice builds the **mechanism that lets the team supply that truth**, so the dictionary grows and the inferred guesses get promoted to verified meanings over time — without a deploy, and without leaving the browser. Every param an AM identifies makes the tool smarter on the next link.

## Design

### Third trust level: `noted`

A param's meaning can now be in one of three states:

- **confirmed** — shipped in `PARAM_CONFIG`, no badge.
- **inferred** — shipped best-guess, dashed grey `inferred` badge (slice #2).
- **noted** — the user has written/confirmed the meaning locally; solid `noted` badge (device-only, like saved names). This is "we vouch for this here."

### Device-local store (mirrors saved names / QA templates)

`PARAM_NOTES`, localStorage key `param-decoder-param-notes-v1`, shape `{ [lcKey]: { label?, desc } }`. Same load/persist/remove lifecycle as `AFFILIATE_NAMES`. 100% client-side — nothing sent (the privacy guarantee is non-negotiable).

### `lookupConfig` becomes notes-aware

Split the current function into `lookupConfigBuiltin(key)` (today's logic) and `lookupConfig(key)` = **a local note first, else the built-in**. A note returns `{ label, desc, trust: "noted" }` and merges over any built-in label. `classifyParam` and the row badge both call `lookupConfig`, so a noted param immediately explains itself and loses the `inferred` badge. `CANON_KEYS` (typo detection) keeps using built-in keys only.

`paramNoteState(key)` → `"noted" | "unknown" | "inferred" | "confirmed"`, used to decide the capture affordance.

### Inline capture affordance (in-flow, where the question arises)

In each Inspect row's key cell, a small control mirroring the existing `nameAffordance` / `fixbtn` pattern:

- **unknown** param → `+ describe` → inline input → save → row now `noted`.
- **inferred** param → `confirm / correct` → inline input prefilled with the inferred desc → save → promotes to `noted`.
- **noted** param → `edit` (and the `noted` badge shows).
- **confirmed** → no control (don't invite casual overrides of shipped truth).

Saving writes to `PARAM_NOTES` and **rebuilds the table** (so the badge + note refresh), the same way the `add aff_id` banner fix rebuilds.

### Help-tab manager

A new "Param notes" section (`#savedParams`), listing each `key → desc` with a Remove control, identical in style to "Saved names". Wired into `renderHelpManagers()`.

## Non-goals (YAGNI)

- No server sync / shared team dictionary — device-local only (privacy + simplicity). A future "export/import notes" could share them, but not now.
- No editing of shipped **confirmed** params (avoid eroding trusted truth).
- No auto-promotion — a human vouches for every `noted` entry.

## Testing

- A note for an unknown param makes it explain itself + show the `noted` badge; persists across re-parse (in-session).
- Confirming an `inferred` param removes the `inferred` badge and shows `noted`.
- The Help manager lists and removes notes.
- Unknown params with no note still default OK (no regression); confirmed params show no capture control.

## Sequence

Slice #3 of 4. After this: ticket-ready verdict (slice #4). This slice makes the dictionary self-improving, which is what "best" compounds on.
