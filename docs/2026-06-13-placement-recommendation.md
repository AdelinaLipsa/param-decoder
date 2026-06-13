# Param Decoder: placement recommendation

Prepared for the call with Serban (Serban Ionut Alexandru Popa), 2026-06-13.
This is a recommendation to take into the discussion, not a final decision.

## The decision on the table

Serban's tracker feedback (emailed to Adelina + Mike, 2026-06-12) had two
parts:

1. A dropdown of 3rd-party trackers that auto-fills the postback structure,
   plus an "Other" option for manual entry.
2. Where the tool should live: ideally inside the backoffice
   (maxweb.com / clickcrm), but he also sees value in an article on
   maxweb.com. He wanted a call to discuss.

Part 1 is already built and then some: Postback mode is generate-first, with
8 sourced trackers (Voluum, CPV Lab Pro, AnyTrack, RedTrack, Binom, BeMob,
FunnelFlux Pro, ClickMagick) and an "Other / custom" option. He named 3; the
tool ships 8 + custom. So the call is really about part 2: distribution.

## Constraints that shape the answer

- **It is one self-contained file.** The whole tool is a single 100%
  client-side `index.html`, no backend, no build step, no network calls. That
  is the key fact: the same file can be embedded as a backoffice view and
  published as an interactive article with almost no rework. This is a new
  distribution path, not a rebuild.
- **The audience is internal staff: affiliate managers and tech support, not
  affiliates.** Every placement option must stay internal-facing. The tool
  must not become an affiliate-facing page.
- **The trust promise is "nothing you paste leaves your browser."** That is
  why staff can paste live links. Embedding it (iframe or direct include)
  does not change this, as long as the file stays client-side. Do not let a
  distribution decision pull in a backend.

## Options

### A. Backoffice embed (clickcrm / maxweb backoffice)
The tool appears inside the surface AMs and tech support already work in.

- Pros: lowest friction, highest adoption, it is right where the work happens;
  naturally gated to staff; no separate place to remember.
- Cons: needs a slot in the backoffice nav and coordination with whoever owns
  that surface.

### B. Internal maxweb article
A standalone interactive article hosting the same tool, linkable from training
and onboarding material.

- Pros: great for explaining the tool, onboarding new staff, and deep-linking
  worked examples (the tool already supports shareable `#hash` state); easy to
  point people to in a message.
- Cons: a destination people have to navigate to; lower day-to-day reach than
  living in the backoffice; must be access-gated so it stays internal.

### C. Both, from one source
Embed in the backoffice as the primary surface, and publish the article as a
secondary discovery and onboarding surface, both pointing at the same hosted
file.

## Tradeoffs at a glance

| | Backoffice embed | Internal article | Both |
|---|---|---|---|
| Daily reach | High | Low | High |
| Onboarding / explainer value | Low | High | High |
| Effort | Medium (nav slot) | Low (host + write) | Medium |
| Stays internal | Yes (gated) | Only if gated | Yes |
| Rework on the tool | None | None | None |

## Recommendation

**Do both, sequenced: backoffice embed first, internal article second.**

- The backoffice embed drives adoption, the tool should live where AMs and
  tech support already spend their day. Make that the primary surface.
- The internal article is near-free once the file is hosted, and it is the
  better home for the "How to use" depth, onboarding, and shareable worked
  examples. Ship it second so it links to a tool people already use.
- Serve both from one hosted copy of `index.html` so a single update reaches
  both surfaces at once. No fork, no drift.

This matches Serban's own instinct (backoffice ideally, article as a
complement) and costs little beyond hosting the file once and giving it a
backoffice slot.

## What "no rebuild" means technically

- Host the single `index.html` at one stable internal URL.
- Backoffice embeds it (iframe or direct include); the article embeds the same
  file or links to it.
- The existing `#hash` share already deep-links a prefilled state, useful for
  both surfaces (for example, an onboarding article can link straight to a
  worked example).
- Keep it client-side. Embedding must not introduce a backend, that would
  break the "nothing leaves your browser" promise that makes staff comfortable
  pasting live links.

## Open questions for the call

- **Backoffice slot:** which section / nav entry, and whose team owns that
  surface to add it?
- **Hosting:** where does the single file get served internally, so both
  surfaces point at one source and update together?
- **Access:** the backoffice is already staff-gated. Is the maxweb article
  behind internal access too? It must be, since the audience is staff and the
  tool should not become affiliate-facing.
- **Versioning / ownership:** who owns deploys so both surfaces stay in sync
  from the one source of truth?

## Talking points for Serban

- His tracker-dropdown ask is already shipped (8 trackers + custom), so this
  call is about distribution, not features.
- Because it is a single client-side file, both surfaces are cheap and stay in
  sync from one source.
- Recommend backoffice embed first (adoption), internal article second
  (discovery and onboarding).
- Keep it internal to AMs and tech support; it is not an affiliate-facing
  page.
