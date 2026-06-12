# Postback Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `Postback` mode into generate-first: pick a tracker, get a correct, paste-ready BuyGoods postback, with the existing validator kept one click away as "Check".

**Architecture:** All in the single `index.html` classic `<script>` (global scope, so pure functions are unit-testable via Playwright `page.evaluate`). A declarative `TRACKER_POSTBACKS` data table drives a pure `buildPostback()` string builder. The `Postback` panel gains a `Generate | Check` sub-toggle: Generate renders controls + output from the data table; Check is today's validator, unchanged in behavior and DOM ids.

**Tech Stack:** Vanilla JS in `index.html`, Playwright regression suite in `test.mjs` (Node, headless Chromium).

**Spec:** `docs/superpowers/specs/2026-06-12-postback-generator-design.md`

---

## File structure

- **Modify `index.html`:**
  - Data: replace string-template `TRACKER_POSTBACKS` (`index.html:1914-1933`) with structured entries + 5 new trackers; add `CLICK_SLOTS` / `DEFAULT_CLICK_SLOT`; add pure `buildPostback()` and `customTracker()`.
  - HTML: restructure `#postbackPanel` (`index.html:1199-1206`) into a `Generate | Check` toggle wrapping a new `#pbGenerate` and the existing check UI moved into `#pbCheck`.
  - CSS: add generator styles near the existing `.pbref` block (`index.html:789-805`).
  - Behavior: split `renderPostback` (`index.html:3770-3793`) into a dispatcher + `renderPostbackCheck` + new `renderPostbackGenerate`; add postback state vars; wire toggle + control events; extend `syncHash`/`restoreFromHash` (`index.html:3887-3911`).
- **Modify `test.mjs`:** update FEATURE 11 (PB5/PB6 now target the generator) and add a new FEATURE block for builder unit tests + generator UI tests.
- **Modify `README.md`:** update the Postback mode line and the "What it knows" / modes sections to describe generate-first.

All param names below are transcribed from each tracker's own docs (2026-06-12); sources are stored in each entry's `source` and asserted in tests.

---

### Task 1: Data model + pure builder

**Files:**
- Modify: `index.html:1914-1933` (the `TRACKER_POSTBACKS` block) and insert new constants/functions directly after it.
- Modify: `index.html:3741-3768` (`renderTrackerReference`, make it consume `buildPostback` so Check's empty-state reference keeps working).
- Test: `test.mjs` (new FEATURE block "12.5 — postback builder", plus PB5 updates).

- [ ] **Step 1: Write failing unit tests for `buildPostback`**

Add this block in `test.mjs` immediately after the FEATURE 11 closing (after the PB6 block, before `// FEATURE 12`). It calls the global `buildPostback` in page scope:

```javascript
// ============================================================
//  FEATURE 11.5 — postback generator: pure builder
// ============================================================
const build = (id, opts) => page.evaluate(([id, opts]) => {
  const t = TRACKER_POSTBACKS.find(x => x.id === id);
  return buildPostback(t, opts || {});
}, [id, opts]);

{
  // default click slot is subid2 for every curated tracker
  check("BLD1 voluum default", await build("voluum") ===
    "https://YOUR-VOLUUM-DOMAIN/postback?cid={SUBID2}&payout={COMMISSION_AMOUNT}&txid={ORDERID}", await build("voluum"));
  check("BLD1 cpvlab default", await build("cpvlab") ===
    "https://YOUR-CPVLAB-DOMAIN/adclick.php?subid={SUBID2}&revenue={COMMISSION_AMOUNT}", await build("cpvlab"));
  check("BLD1 anytrack default", await build("anytrack") ===
    "https://YOUR-ANYTRACK-POSTBACK?click_id={SUBID2}&value={COMMISSION_AMOUNT}&transactionId={ORDERID}", await build("anytrack"));
  check("BLD1 redtrack default", await build("redtrack") ===
    "https://YOUR-REDTRACK-DOMAIN/postback?clickid={SUBID2}&sum={COMMISSION_AMOUNT}&type=Sale", await build("redtrack"));
  check("BLD1 binom default", await build("binom") ===
    "https://YOUR-BINOM-DOMAIN/click.php?cnv_id={SUBID2}&payout={COMMISSION_AMOUNT}", await build("binom"));
  check("BLD1 bemob default", await build("bemob") ===
    "https://YOUR-BEMOB-DOMAIN/postback?cid={SUBID2}&payout={COMMISSION_AMOUNT}&txid={ORDERID}", await build("bemob"));
  check("BLD1 funnelflux default", await build("funnelflux") ===
    "https://YOUR-FUNNELFLUX-DOMAIN/pb/?hit={SUBID2}&rev={COMMISSION_AMOUNT}&tx={ORDERID}", await build("funnelflux"));
  check("BLD1 clickmagick default", await build("clickmagick") ===
    "https://www.clkmg.com/api/s/post/?uid=XXXXXX&s1={SUBID2}&amt={COMMISSION_AMOUNT}", await build("clickmagick"));
}
{
  // click-slot selector rewrites ONLY the click token
  check("BLD2 slot subid (slot 1)", await build("voluum", { clickSlot: "" }) ===
    "https://YOUR-VOLUUM-DOMAIN/postback?cid={SUBID}&payout={COMMISSION_AMOUNT}&txid={ORDERID}", await build("voluum",{clickSlot:""}));
  check("BLD2 slot subid3", await build("voluum", { clickSlot: "3" }) ===
    "https://YOUR-VOLUUM-DOMAIN/postback?cid={SUBID3}&payout={COMMISSION_AMOUNT}&txid={ORDERID}", await build("voluum",{clickSlot:"3"}));
}
{
  // personalize: domain trackers strip scheme/trailing slash; clickmagick fills uid
  check("BLD3 voluum domain", await build("voluum", { personalize: "abc.voluum.com" }) ===
    "https://abc.voluum.com/postback?cid={SUBID2}&payout={COMMISSION_AMOUNT}&txid={ORDERID}", await build("voluum",{personalize:"abc.voluum.com"}));
  check("BLD3 voluum domain sanitized", await build("voluum", { personalize: "https://abc.voluum.com/" }) ===
    "https://abc.voluum.com/postback?cid={SUBID2}&payout={COMMISSION_AMOUNT}&txid={ORDERID}", await build("voluum",{personalize:"https://abc.voluum.com/"}));
  check("BLD3 clickmagick uid", await build("clickmagick", { personalize: "9f2a10" }) ===
    "https://www.clkmg.com/api/s/post/?uid=9f2a10&s1={SUBID2}&amt={COMMISSION_AMOUNT}", await build("clickmagick",{personalize:"9f2a10"}));
}
{
  // every curated tracker cites a source URL
  const srcs = await page.evaluate(() => TRACKER_POSTBACKS.map(t => t.source));
  check("BLD4 all trackers sourced", srcs.length === 8 && srcs.every(s => /^https?:\/\//.test(s)), JSON.stringify(srcs));
}
{
  // custom tracker builds from user-named params, marked not-verified
  const customUrl = await page.evaluate(() => buildPostback(
    customTracker({ domain: "t.example.com", clickParam: "cid", payoutParam: "amount", orderParam: "oid" }),
    { personalize: "" }));
  check("BLD5 custom url", customUrl ===
    "https://t.example.com?cid={SUBID2}&amount={COMMISSION_AMOUNT}&oid={ORDERID}", customUrl);
}
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npm test`
Expected: FAIL, "buildPostback is not defined" / "customTracker is not defined" on the BLD checks.

- [ ] **Step 3: Replace the `TRACKER_POSTBACKS` block with the structured data + builders**

Replace `index.html:1914-1933` (the whole `const TRACKER_POSTBACKS = [ ... ];`) with:

```javascript
const TRACKER_POSTBACKS = [
  { id: "voluum", label: "Voluum",
    source: "https://doc.voluum.com/article/parameters-in-postback-urls",
    host: "YOUR-VOLUUM-DOMAIN", path: "/postback",
    personalize: { label: "Your Voluum domain", token: "YOUR-VOLUUM-DOMAIN", kind: "domain" },
    query: [{ key: "cid", click: true }, { key: "payout", token: "COMMISSION_AMOUNT" }, { key: "txid", token: "ORDERID" }],
    note: "cid carries the click ID (required); payout the revenue; txid an optional transaction ID." },

  { id: "cpvlab", label: "CPV Lab Pro",
    source: "https://cpvlab.pro/docs/postback-url.html",
    host: "YOUR-CPVLAB-DOMAIN", path: "/adclick.php",
    personalize: { label: "Your CPV Lab domain", token: "YOUR-CPVLAB-DOMAIN", kind: "domain" },
    query: [{ key: "subid", click: true }, { key: "revenue", token: "COMMISSION_AMOUNT" }],
    note: "subid carries the click ID; revenue the payout. Called at adclick.php on your CPV Lab domain." },

  { id: "anytrack", label: "AnyTrack",
    source: "https://readme.anytrack.io/docs/event-attributes",
    host: "YOUR-ANYTRACK-POSTBACK", path: "",
    personalize: { label: "Your AnyTrack postback domain", token: "YOUR-ANYTRACK-POSTBACK", kind: "domain" },
    query: [{ key: "click_id", click: true }, { key: "value", token: "COMMISSION_AMOUNT" }, { key: "transactionId", token: "ORDERID" }],
    note: "click_id carries the click ID; value the conversion value; transactionId the order ID." },

  { id: "redtrack", label: "RedTrack",
    source: "https://help.redtrack.io/knowledgebase/kb/conversion-tracking/postback-offer-source/",
    host: "YOUR-REDTRACK-DOMAIN", path: "/postback",
    personalize: { label: "Your RedTrack domain", token: "YOUR-REDTRACK-DOMAIN", kind: "domain" },
    query: [{ key: "clickid", click: true }, { key: "sum", token: "COMMISSION_AMOUNT" }, { key: "type", value: "Sale" }],
    note: "clickid carries the click ID; sum the payout; type the conversion event name (rename 'Sale' to your RedTrack conversion type)." },

  { id: "binom", label: "Binom",
    source: "https://docs.binom.org/postback-url.php",
    host: "YOUR-BINOM-DOMAIN", path: "/click.php",
    personalize: { label: "Your Binom domain", token: "YOUR-BINOM-DOMAIN", kind: "domain" },
    query: [{ key: "cnv_id", click: true }, { key: "payout", token: "COMMISSION_AMOUNT" }],
    note: "cnv_id carries the click ID; payout the revenue. Add &cnv_status= if you track conversion statuses." },

  { id: "bemob", label: "BeMob",
    source: "https://docs.bemob.com/en/postback-settings-of-traffic-source",
    host: "YOUR-BEMOB-DOMAIN", path: "/postback",
    personalize: { label: "Your BeMob domain", token: "YOUR-BEMOB-DOMAIN", kind: "domain" },
    query: [{ key: "cid", click: true }, { key: "payout", token: "COMMISSION_AMOUNT" }, { key: "txid", token: "ORDERID" }],
    note: "cid carries the click ID (required); payout the revenue; txid the order ID." },

  { id: "funnelflux", label: "FunnelFlux Pro",
    source: "https://help.funnelflux.pro/en/article/46-integration-guide-for-clickbank",
    host: "YOUR-FUNNELFLUX-DOMAIN", path: "/pb/",
    personalize: { label: "Your FunnelFlux domain", token: "YOUR-FUNNELFLUX-DOMAIN", kind: "domain" },
    query: [{ key: "hit", click: true }, { key: "rev", token: "COMMISSION_AMOUNT" }, { key: "tx", token: "ORDERID" }],
    note: "hit carries the hit/click ID; rev the revenue; tx an optional transaction ID." },

  { id: "clickmagick", label: "ClickMagick",
    source: "https://www.clickmagick.com/kb/?answer=582",
    host: "www.clkmg.com", path: "/api/s/post/",
    personalize: { label: "Your ClickMagick UID", token: "XXXXXX", kind: "raw" },
    query: [{ key: "uid", fill: "XXXXXX" }, { key: "s1", click: true }, { key: "amt", token: "COMMISSION_AMOUNT" }],
    note: "uid is your ClickMagick account ID; s1 carries the click ID; amt the revenue. Host is fixed (clkmg.com)." },
];

/* BuyGoods subid slots the affiliate's click ID can live in. Default subid2,
   the slot a tracker usually reads (see the param dictionary). Suffix "" = slot 1 = {SUBID}. */
const CLICK_SLOTS = [
  { value: "",  label: "subid"  },
  { value: "2", label: "subid2" },
  { value: "3", label: "subid3" },
  { value: "4", label: "subid4" },
  { value: "5", label: "subid5" },
];
const DEFAULT_CLICK_SLOT = "2";

/** Pure: build a tracker's postback string. opts: { clickSlot, personalize }.
    The click param gets {SUBID<slot>}; token params get {TOKEN}; fill/value are literals.
    A non-empty personalize replaces the tracker's personalize.token (domain sanitized). */
function buildPostback(tracker, opts = {}) {
  const slot = opts.clickSlot != null ? opts.clickSlot : DEFAULT_CLICK_SLOT;
  const pairs = tracker.query.map((q) => {
    let v;
    if (q.click) v = "{SUBID" + slot + "}";
    else if (q.token) v = "{" + q.token + "}";
    else if (q.fill != null) v = q.fill;
    else v = q.value;
    return q.key + "=" + v;
  });
  let url = "https://" + tracker.host + tracker.path + "?" + pairs.join("&");
  const fill = (opts.personalize || "").trim();
  if (fill && tracker.personalize) {
    const clean = tracker.personalize.kind === "domain"
      ? fill.replace(/^https?:\/\//, "").replace(/\/+$/, "")
      : fill;
    url = url.split(tracker.personalize.token).join(clean);
  }
  return url;
}

/** Pure: a synthetic tracker for the "Other / custom" option. Params are the
    affiliate's own names; values map to BuyGoods tokens. Not doc-verified. */
function customTracker({ domain, clickParam, payoutParam, orderParam }) {
  const query = [{ key: (clickParam || "clickid").trim(), click: true }];
  if (payoutParam && payoutParam.trim()) query.push({ key: payoutParam.trim(), token: "COMMISSION_AMOUNT" });
  if (orderParam && orderParam.trim()) query.push({ key: orderParam.trim(), token: "ORDERID" });
  return {
    id: "custom", label: "Custom",
    host: (domain && domain.trim()) ? domain.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "") : "YOUR-TRACKER-DOMAIN",
    path: "", personalize: null, source: null, query,
    note: "Custom tracker: these param names are yours, not verified against tracker docs.",
  };
}
```

- [ ] **Step 4: Point `renderTrackerReference` at `buildPostback` (keeps Check empty-state working)**

In `renderTrackerReference` (`index.html:3753-3761`), the line that splits `t.template` no longer has a `template` field. Replace the template build + copy wiring. Change:

```javascript
    const tmpl = el("div", "pbref-tmpl");
    const code = el("code", "pbref-code");
    t.template.split(/(\{[A-Z_]+\})/).forEach((seg) => {
      if (/^\{[A-Z_]+\}$/.test(seg)) code.append(el("span", "tok", seg));
      else code.append(document.createTextNode(seg));
    });
    tmpl.append(code);
    const copy = el("button", "btn ghost pbref-copy", "Copy"); copy.type = "button"; copy.dataset.label = "Copy";
    copy.addEventListener("click", () => copyAndFlash(t.template, copy));
```

to:

```javascript
    const tmpl = el("div", "pbref-tmpl");
    const built = buildPostback(t);
    const code = el("code", "pbref-code");
    built.split(/(\{[A-Z_]+\})/).forEach((seg) => {
      if (/^\{[A-Z_]+\}$/.test(seg)) code.append(el("span", "tok", seg));
      else code.append(document.createTextNode(seg));
    });
    tmpl.append(code);
    const copy = el("button", "btn ghost pbref-copy", "Copy"); copy.type = "button"; copy.dataset.label = "Copy";
    copy.addEventListener("click", () => copyAndFlash(built, copy));
```

- [ ] **Step 5: Update PB5 assertions for the new default slot (subid2) and 8 trackers**

In `test.mjs`, the PB5 block (around `test.mjs:806-823`) asserts the old `{SUBID}` templates. Update the three code assertions and the count:

```javascript
  check("PB5 reference shows trackers", ref && /Voluum/.test(ref.names.join()) && /RedTrack/.test(ref.names.join()) && /ClickMagick/.test(ref.names.join()), JSON.stringify(ref?.names));
  check("PB5 voluum click ID = cid subid2", ref && ref.codes.some(c => /cid=\{SUBID2\}/.test(c)), JSON.stringify(ref?.codes));
  check("PB5 cpvlab = subid + revenue", ref && ref.codes.some(c => /subid=\{SUBID2\}.*revenue=\{COMMISSION_AMOUNT\}/.test(c)), JSON.stringify(ref?.codes));
  check("PB5 anytrack click ID = click_id", ref && ref.codes.some(c => /click_id=\{SUBID2\}/.test(c)), JSON.stringify(ref?.codes));
  check("PB5 each tracker cites a source", ref && ref.srcs.length === 8 && ref.srcs.every(s => /^https?:/.test(s)), JSON.stringify(ref?.srcs));
  check("PB5 copy buttons present", ref && ref.copyBtns === 8, JSON.stringify(ref));
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, all BLD1-BLD5 and updated PB5 green; PB1-PB4, PB6 still green.

- [ ] **Step 7: Commit**

```bash
git add index.html test.mjs
git commit -m "Postback: structured tracker data + pure buildPostback, add RedTrack/Binom/BeMob/FunnelFlux/ClickMagick"
```

---

### Task 2: Generate/Check toggle scaffold (HTML + CSS)

**Files:**
- Modify: `index.html:1199-1206` (`#postbackPanel`).
- Modify: `index.html` CSS, insert after `index.html:805` (end of `.pbref-note`).
- Test: `test.mjs` (new structural checks).

- [ ] **Step 1: Write failing structural tests**

Add after the FEATURE 11.5 block in `test.mjs`:

```javascript
// ============================================================
//  FEATURE 11.6 — postback generate/check toggle
// ============================================================
{
  await page.click("#modePostback");
  check("TG1 generate is default view", await page.isVisible("#pbGenerate") && !(await page.isVisible("#pbCheck")), "generate not default");
  await page.click("#pbViewCheck");
  check("TG2 check shows validator", await page.isVisible("#pbCheck") && await page.isVisible("#srcPostback"), "check not shown");
  await page.click("#pbViewGenerate");
  check("TG3 back to generate", await page.isVisible("#pbGenerate") && !(await page.isVisible("#pbCheck")), "generate not restored");
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL on TG1, `#pbGenerate` not found.

- [ ] **Step 3: Restructure `#postbackPanel`**

Replace `index.html:1199-1206` with:

```html
    <section id="postbackPanel" role="tabpanel" aria-labelledby="modePostback" hidden>
      <div class="pb-toggle" role="tablist" aria-label="Postback tool">
        <button id="pbViewGenerate" class="pb-vtab on" type="button" role="tab" aria-selected="true">Generate</button>
        <button id="pbViewCheck" class="pb-vtab" type="button" role="tab" aria-selected="false">Check</button>
      </div>

      <div id="pbGenerate">
        <div id="pbGenControls" class="pbgen-controls"></div>
        <div id="pbGenOut" aria-live="polite"></div>
      </div>

      <div id="pbCheck" hidden>
        <div class="input-block">
          <p class="eyebrow">Paste a postback URL</p>
          <textarea id="srcPostback" spellcheck="false" autocomplete="off"
            placeholder="https://tracker.com/postback?subid={SUBID}&orderid={ORDERID}&amount={COMMISSION_AMOUNT}"></textarea>
        </div>
        <div id="pbOut" aria-live="polite"></div>
      </div>
    </section>
```

- [ ] **Step 4: Add generator CSS**

Insert after `index.html:805` (the `.pbref-note` rule):

```css
  /* postback generate/check toggle + generator */
  .pb-toggle { display: inline-flex; gap: 4px; background: var(--field); border: 1px solid var(--rule); border-radius: 8px; padding: 3px; margin-bottom: 16px; }
  .pb-vtab { font-size: 13px; font-weight: 600; color: var(--ink-soft); background: none; border: none; border-radius: 6px; padding: 6px 16px; cursor: pointer; }
  .pb-vtab.on { color: var(--ink); background: var(--bg); box-shadow: 0 1px 2px rgba(0,0,0,.06); }
  .pbgen-controls { display: flex; flex-wrap: wrap; gap: 14px 22px; align-items: flex-end; margin-bottom: 16px; }
  .pbgen-field { display: flex; flex-direction: column; gap: 5px; }
  .pbgen-field label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--ink-faint); }
  .pbgen-field select, .pbgen-field input {
    font-size: 13.5px; color: var(--ink); background: var(--field);
    border: 1px solid var(--rule); border-radius: 6px; padding: 8px 10px; min-width: 180px;
    font-family: inherit;
  }
  .pbgen-out { margin-top: 4px; }
  .pbgen-line { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 10px; }
  .pbgen-url {
    flex: 1 1 auto; font-family: var(--mono); font-size: 12.5px; color: var(--ink);
    background: var(--field); border: 1px solid var(--rule); border-radius: 6px;
    padding: 10px 12px; word-break: break-all; line-height: 1.55;
  }
  .pbgen-url .tok { color: var(--ok); font-weight: 600; }
  .pbgen-copy { flex: none; font-size: 12px; padding: 8px 13px; }
  .pbgen-full-label { font-size: 11.5px; color: var(--ink-soft); margin: 2px 0 5px; }
  .pbgen-note { margin: 6px 0 14px; }
  .pbgen-note summary { cursor: pointer; font-size: 12.5px; color: var(--ink); font-weight: 600; }
  .pbgen-note p { font-size: 12.5px; color: var(--ink-soft); line-height: 1.5; margin: 8px 0 0; }
  .pbgen-src { font-size: 11px; color: var(--ink-faint); margin: 8px 0 0; }
  .pbgen-personalize { border-top: 1px solid var(--rule); margin-top: 14px; padding-top: 14px; }
  .pbgen-personalize .eyebrow { margin-bottom: 9px; }
  .pbgen-custom { display: flex; flex-wrap: wrap; gap: 12px 18px; }
```

(Verified: `--accent` is not defined in this file, so the CSS above already uses `var(--ink)`. No substitution needed.)

- [ ] **Step 5: Run to verify TG1-TG3 fail only on missing JS wiring**

Run: `npm test`
Expected: FAIL on TG2/TG3 (toggle has no click handler yet), TG1 may pass since `#pbGenerate` exists and `#pbCheck` is `hidden`. This is expected, the wiring lands in Task 3.

- [ ] **Step 6: Commit**

```bash
git add index.html test.mjs
git commit -m "Postback: Generate/Check toggle scaffold (HTML + CSS)"
```

---

### Task 3: Generator behavior (render, controls, output, copy, note, personalize)

**Files:**
- Modify: `index.html` postback section (`index.html:3770-3795`): split into dispatcher + check + generate; add state vars and wiring.
- Test: `test.mjs` (generator UI tests; finalize TG2/TG3).

- [ ] **Step 1: Write failing generator UI tests**

Add after the FEATURE 11.6 block:

```javascript
// ============================================================
//  FEATURE 11.7 — postback generator behavior
// ============================================================
async function gen() {
  await page.click("#modePostback");
  await page.click("#pbViewGenerate");
  return page.evaluate(() => document.querySelector("#pbGenOut .pbgen-url")?.textContent ?? null);
}
{
  await page.click("#modePostback");
  await page.click("#pbViewGenerate");
  await page.selectOption("#pbTrackerSel", "redtrack");
  let url = await page.evaluate(() => document.querySelector("#pbGenOut .pbgen-url").textContent);
  check("GEN1 tracker select drives output", /clickid=\{SUBID2\}&sum=\{COMMISSION_AMOUNT\}&type=Sale/.test(url), url);

  await page.selectOption("#pbSlotSel", "3");
  url = await page.evaluate(() => document.querySelector("#pbGenOut .pbgen-url").textContent);
  check("GEN2 slot selector rewrites click token", /clickid=\{SUBID3\}/.test(url) && /sum=\{COMMISSION_AMOUNT\}/.test(url), url);

  await page.selectOption("#pbSlotSel", "2");
  await page.fill("#pbPersonalize", "abc.redtrack.io");
  const full = await page.evaluate(() => document.querySelector("#pbGenFull .pbgen-url")?.textContent ?? null);
  check("GEN3 personalize builds complete URL", full === "https://abc.redtrack.io/postback?clickid={SUBID2}&sum={COMMISSION_AMOUNT}&type=Sale", full);

  check("GEN4 has 'what do I do' note", await page.evaluate(() => !!document.querySelector("#pbGenOut .pbgen-note")), "no note");
  check("GEN5 note cites source", await page.evaluate(() => /redtrack\.io/.test(document.querySelector("#pbGenOut .pbgen-src a")?.getAttribute("href") || "")), "no source link");
}
{
  // Check view still validates exactly as before
  await page.click("#modePostback");
  await page.click("#pbViewCheck");
  await page.fill("#srcPostback", "");
  await page.fill("#srcPostback", "https://trk.com/pb?subid={SUBID}&amount={COMMISSION_AMOUNT}");
  const ok = await page.evaluate(() => [...document.querySelectorAll("#pbOut .prow.pb:not(.colhead) .gutter")].every(g => g.classList.contains("ok")));
  check("GEN6 check still validates", ok, "check broke");
}
```

Also replace the TG2/TG3 placeholder expectations from Task 2, they now must pass with real wiring (no code change needed if they already assert visibility).

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL on GEN1, `#pbTrackerSel` not found.

- [ ] **Step 3: Add postback state vars**

In `index.html`, just after `const pbTarget = document.getElementById("pbOut");` (`index.html:3673`), add:

```javascript
let pbView = "generate";                 // "generate" | "check"
let pbTrackerId = TRACKER_POSTBACKS[0].id;
let pbClickSlot = DEFAULT_CLICK_SLOT;
let pbPersonalize = "";
const pbCustom = { domain: "", clickParam: "", payoutParam: "", orderParam: "" };
const pbGenControls = document.getElementById("pbGenControls");
const pbGenOut = document.getElementById("pbGenOut");
const pbGenerate = document.getElementById("pbGenerate");
const pbCheck = document.getElementById("pbCheck");
```

- [ ] **Step 4: Rename the existing render body to `renderPostbackCheck` and add the dispatcher**

Rename the existing `function renderPostback() {` (`index.html:3770`) to `function renderPostbackCheck() {` (body unchanged). Then add, immediately before it, the dispatcher and view wiring:

```javascript
function setPbView(view) {
  pbView = view === "check" ? "check" : "generate";
  pbGenerate.hidden = pbView !== "generate";
  pbCheck.hidden = pbView !== "check";
  document.getElementById("pbViewGenerate").classList.toggle("on", pbView === "generate");
  document.getElementById("pbViewGenerate").setAttribute("aria-selected", String(pbView === "generate"));
  document.getElementById("pbViewCheck").classList.toggle("on", pbView === "check");
  document.getElementById("pbViewCheck").setAttribute("aria-selected", String(pbView === "check"));
  renderPostback();
  syncHash();
}
document.getElementById("pbViewGenerate").addEventListener("click", () => setPbView("generate"));
document.getElementById("pbViewCheck").addEventListener("click", () => setPbView("check"));

function renderPostback() {
  if (pbView === "check") { renderPostbackCheck(); return; }
  renderPostbackGenerate();
}
```

Also in `renderPostbackCheck`, delete the two `pbTarget.append(renderTrackerReference());` lines (`index.html:3779` and `:3792`), the generator now owns templates. (`renderTrackerReference` becomes dead code; removed in Task 6.)

- [ ] **Step 5: Add the generator renderer**

Add after the dispatcher:

```javascript
/** Render a token-highlighted URL into a .pbgen-url code element. */
function pbUrlCode(url) {
  const code = el("code", "pbgen-url");
  url.split(/(\{[A-Z_0-9]+\})/).forEach((seg) => {
    if (/^\{[A-Z_0-9]+\}$/.test(seg)) code.append(el("span", "tok", seg));
    else code.append(document.createTextNode(seg));
  });
  return code;
}

/** A url line: highlighted code + a Copy button bound to the raw string. */
function pbUrlLine(url, wrapId) {
  const line = el("div", "pbgen-line");
  if (wrapId) line.id = wrapId;
  line.append(pbUrlCode(url));
  const copy = el("button", "btn ghost pbgen-copy", "Copy"); copy.type = "button";
  copy.addEventListener("click", () => copyAndFlash(url, copy));
  line.append(copy);
  return line;
}

function activeTracker() {
  if (pbTrackerId === "custom") return customTracker(pbCustom);
  return TRACKER_POSTBACKS.find((t) => t.id === pbTrackerId) || TRACKER_POSTBACKS[0];
}

/** Rebuild only the output region (template line, complete-URL line, note). */
function refreshGenOut() {
  const tracker = activeTracker();
  pbGenOut.replaceChildren();
  const wrap = el("div", "pbgen-out reveal");

  wrap.append(pbUrlLine(buildPostback(tracker, { clickSlot: pbClickSlot }), null));

  if (tracker.personalize && pbPersonalize.trim()) {
    wrap.append(el("p", "pbgen-full-label", "Complete URL:"));
    wrap.append(pbUrlLine(buildPostback(tracker, { clickSlot: pbClickSlot, personalize: pbPersonalize }), "pbGenFull"));
  }

  const note = el("details", "pbgen-note");
  note.append(el("summary", null, "What do I do with this?"));
  note.append(el("p", null, "Paste this into your tracker's postback / S2S settings. BuyGoods fills the {TOKEN} values automatically at sale time, you do not edit those. " + tracker.note));
  wrap.append(note);

  if (tracker.source) {
    const srcP = el("p", "pbgen-src", "Param names from ");
    const a = el("a", null, tracker.label + " docs"); a.href = tracker.source; a.target = "_blank"; a.rel = "noopener noreferrer";
    srcP.append(a);
    wrap.append(srcP);
  }
  pbGenOut.append(wrap);
}

/** Build the persistent controls (tracker + slot selects, personalize/custom fields). */
function renderPostbackGenerate() {
  pbGenControls.replaceChildren();

  const tField = el("div", "pbgen-field");
  tField.append(el("label", null, "Tracker"));
  const tSel = el("select"); tSel.id = "pbTrackerSel";
  TRACKER_POSTBACKS.forEach((t) => { const o = el("option", null, t.label); o.value = t.id; tSel.append(o); });
  const customOpt = el("option", null, "Other / custom"); customOpt.value = "custom"; tSel.append(customOpt);
  tSel.value = pbTrackerId;
  tSel.addEventListener("change", () => { pbTrackerId = tSel.value; pbPersonalize = ""; renderPostbackGenerate(); syncHash(); });
  tField.append(tSel);
  pbGenControls.append(tField);

  const sField = el("div", "pbgen-field");
  sField.append(el("label", null, "Click ID is in"));
  const sSel = el("select"); sSel.id = "pbSlotSel";
  CLICK_SLOTS.forEach((s) => { const o = el("option", null, s.label); o.value = s.value; sSel.append(o); });
  sSel.value = pbClickSlot;
  sSel.addEventListener("change", () => { pbClickSlot = sSel.value; refreshGenOut(); syncHash(); });
  sField.append(sSel);
  pbGenControls.append(sField);

  // personalize / custom fields live outside refreshGenOut so they keep focus while typing
  const tracker = activeTracker();
  const pBox = el("div", "pbgen-personalize");
  if (pbTrackerId === "custom") {
    pBox.append(el("p", "eyebrow", "Custom tracker"));
    const grid = el("div", "pbgen-custom");
    const field = (label, key, ph) => {
      const f = el("div", "pbgen-field");
      f.append(el("label", null, label));
      const inp = el("input"); inp.id = "pbCustom_" + key; inp.placeholder = ph; inp.value = pbCustom[key];
      inp.addEventListener("input", () => { pbCustom[key] = inp.value; refreshGenOut(); syncHash(); });
      f.append(inp); return f;
    };
    grid.append(field("Tracker domain", "domain", "t.example.com"));
    grid.append(field("Click ID param", "clickParam", "clickid"));
    grid.append(field("Payout param", "payoutParam", "payout"));
    grid.append(field("Order ID param", "orderParam", "oid"));
    pBox.append(grid);
  } else if (tracker.personalize) {
    pBox.append(el("p", "eyebrow", "Personalize (optional)"));
    const f = el("div", "pbgen-field");
    f.append(el("label", null, tracker.personalize.label));
    const inp = el("input"); inp.id = "pbPersonalize"; inp.placeholder = tracker.personalize.kind === "domain" ? "abc.example.com" : "your id";
    inp.value = pbPersonalize;
    inp.addEventListener("input", () => { pbPersonalize = inp.value; refreshGenOut(); syncHash(); });
    f.append(inp);
    pBox.append(f);
  }
  pbGenControls.append(pBox);

  refreshGenOut();
}
```

- [ ] **Step 6: Update the PANELS render hook**

`PANELS.postback` (`index.html:3921`) already references `renderPostback`; the dispatcher keeps that name, so no change. Verify `renderPostback` is defined before `const PANELS` runs (it is, both are in the same script and PANELS is built later at `index.html:3917`). Also set the initial view on load: after `const PANELS = {...}` is created, the first `setMode` will call `renderPostback` which honors `pbView` default "generate". No extra call needed.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, GEN1-GEN6, TG1-TG3 green; PB1-PB6 still green.

- [ ] **Step 8: Commit**

```bash
git add index.html test.mjs
git commit -m "Postback: generate-first UI (tracker + slot selectors, personalize, sourced note)"
```

---

### Task 4: Custom tracker output

**Files:**
- Test: `test.mjs` (custom tracker UI test). Behavior already implemented in Task 3, Step 5; this task verifies the UI path end-to-end.

- [ ] **Step 1: Write failing custom-tracker UI test**

Add after FEATURE 11.7:

```javascript
// ============================================================
//  FEATURE 11.8 — postback generator: custom tracker
// ============================================================
{
  await page.click("#modePostback");
  await page.click("#pbViewGenerate");
  await page.selectOption("#pbTrackerSel", "custom");
  await page.fill("#pbCustom_domain", "t.example.com");
  await page.fill("#pbCustom_clickParam", "cid");
  await page.fill("#pbCustom_payoutParam", "amount");
  const url = await page.evaluate(() => document.querySelector("#pbGenOut .pbgen-url").textContent);
  check("CUS1 custom builds from user params", url === "https://t.example.com?cid={SUBID2}&amount={COMMISSION_AMOUNT}", url);
  check("CUS2 custom marked not-verified", await page.evaluate(() => /not verified/i.test(document.querySelector("#pbGenOut .pbgen-note p").textContent)), "no not-verified note");
}
```

- [ ] **Step 2: Run to verify it fails or passes**

Run: `npm test`
Expected: PASS if Task 3 implemented the custom branch correctly. If FAIL, fix the `customTracker`/custom-field wiring from Task 3 Step 5 until green. (No new source code is expected here; this task is the regression lock for the custom path.)

- [ ] **Step 3: Commit**

```bash
git add test.mjs
git commit -m "Postback: lock custom-tracker generator path with tests"
```

---

### Task 5: Shareable generator state (URL hash)

**Files:**
- Modify: `index.html` `syncHash` (`index.html:3887-3897`) and `restoreFromHash` (`index.html:3899-3911`).
- Test: `test.mjs` (hash round-trip).

- [ ] **Step 1: Write failing hash test**

Add after FEATURE 11.8:

```javascript
// ============================================================
//  FEATURE 11.9 — postback generator: shareable hash
// ============================================================
{
  await page.click("#modePostback");
  await page.click("#pbViewGenerate");
  await page.selectOption("#pbTrackerSel", "binom");
  await page.selectOption("#pbSlotSel", "4");
  await page.fill("#pbPersonalize", "go.binom.dev");
  const hash = await page.evaluate(() => location.hash);
  check("SH1 hash carries generator state", /pv=generate/.test(hash) && /pt=binom/.test(hash) && /ps=4/.test(hash) && /pd=go\.binom\.dev/.test(hash), hash);

  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.evaluate(() => restoreFromHash());
  const url = await page.evaluate(() => document.querySelector("#pbGenFull .pbgen-url")?.textContent ?? null);
  check("SH2 restore rebuilds personalized URL", url === "https://go.binom.dev/click.php?cnv_id={SUBID4}&payout={COMMISSION_AMOUNT}", url);
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL on SH1, hash lacks `pt`/`ps`/`pd`.

- [ ] **Step 3: Extend `syncHash`**

In `syncHash` (`index.html:3887-3897`), replace the postback line:

```javascript
  if (activeMode === "postback") add("p", srcPostback.value);
```

with:

```javascript
  if (activeMode === "postback") {
    add("p", srcPostback.value);
    add("pv", pbView);
    if (pbView === "generate") {
      add("pt", pbTrackerId);
      add("ps", pbClickSlot);
      add("pd", pbTrackerId === "custom" ? "" : pbPersonalize);
    }
  }
```

- [ ] **Step 4: Extend `restoreFromHash`**

In `restoreFromHash` (`index.html:3899-3911`), before the `setMode(mode);` line, add:

```javascript
  if (p.get("pt") && (TRACKER_POSTBACKS.some((t) => t.id === p.get("pt")) || p.get("pt") === "custom")) pbTrackerId = p.get("pt");
  if (p.get("ps") != null && CLICK_SLOTS.some((s) => s.value === p.get("ps"))) pbClickSlot = p.get("ps");
  if (p.get("pd")) pbPersonalize = p.get("pd");
  if (p.get("pv")) pbView = p.get("pv") === "check" ? "check" : "generate";
```

And, after `setMode(mode);`, ensure the postback sub-view reflects restored state:

```javascript
  if (mode === "postback") setPbView(pbView);
```

(`setPbView` calls `renderPostback` which rebuilds controls from the restored state, so `#pbPersonalize` is repopulated and `#pbGenFull` re-renders.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, SH1-SH2 green; all prior tests green.

- [ ] **Step 6: Commit**

```bash
git add index.html test.mjs
git commit -m "Postback: shareable generator state in URL hash"
```

---

### Task 6: Remove dead code, update README, full regression

**Files:**
- Modify: `index.html` (delete unused `renderTrackerReference` and orphaned `.pbref*` CSS if no longer referenced).
- Modify: `README.md`.
- Test: full `npm test`.

- [ ] **Step 1: Confirm `renderTrackerReference` is unreferenced, then remove it**

Run: `grep -n "renderTrackerReference\|pbref" index.html`
If the only `renderTrackerReference` hit is its definition (`index.html:3742`), delete the whole function (`index.html:3741-3768`). If `pbref` CSS classes (`index.html:789-805`) have no remaining HTML/JS references, delete those CSS rules too. If any reference remains, leave the code in place and note why.

- [ ] **Step 2: Remove the stale PB5/PB6 reference tests if they target removed DOM**

PB5/PB6 (`test.mjs`) assert `#pbOut .pbref` (the Check empty-state reference card). Since Task 3 removed `renderTrackerReference` from the Check flow, this card no longer exists. Delete the PB5 and PB6 blocks entirely (the generator's GEN/BLD tests now cover per-tracker templates and sourcing).

- [ ] **Step 3: Update README**

In `README.md`:
- Replace the modes-table Postback row (`README.md:32`) with:
  `| You picked a **tracker** (Voluum, RedTrack, Binom…) | The exact postback to paste, with BuyGoods tokens pre-filled | **Postback** |`
- Replace the Postback bullet (`README.md:48`) with:
  `- **Postback**, generate-first: pick your tracker and get a correct, paste-ready postback with BuyGoods tokens already mapped (`{SUBID}`…`{ORDERID}`, `{COMMISSION_AMOUNT}`). Pick which `subid` slot your click ID rides in, optionally drop in your tracker domain for a complete URL, or choose "Other / custom" for any tracker. A **Check** tab still validates an existing postback against BuyGoods' token set. Param names for each tracker are sourced from that tracker's own docs.`
- In "What it knows about BuyGoods" (`README.md:63`), change the Postback-tokens bullet to mention the generator covers Voluum, CPV Lab, AnyTrack, RedTrack, Binom, BeMob, FunnelFlux, ClickMagick.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS, entire suite green (no orphaned PB5/PB6 failures, all BLD/TG/GEN/CUS/SH green).

- [ ] **Step 5: Commit**

```bash
git add index.html test.mjs README.md
git commit -m "Postback: remove superseded reference card, document generate-first mode"
```

---

## Self-review

**Spec coverage:**
- Generate-first with Generate|Check toggle, Generate default → Tasks 2-3. ✓
- Progressive disclosure (instant template, optional note, optional personalize) → Task 3 Step 5 (`refreshGenOut` order: template line always; note `<details>`; personalize outside refresh for focus). ✓
- Both audiences → expert gets template on select; beginner gets note + complete URL. ✓
- Expanded sourced tracker set (RedTrack, Binom, BeMob, FunnelFlux, ClickMagick) + custom fallback → Task 1 data + `customTracker`. ✓
- subid-slot selector defaulting subid2, rewrites only the click token → Task 1 (`CLICK_SLOTS`, `buildPostback`), Task 3 (`#pbSlotSel`), tests BLD2/GEN2. ✓
- Per-tracker personalization (domain vs ClickMagick uid) → `personalize.kind`, tests BLD3. ✓
- Pure `buildPostback`, one-entry-per-tracker data, single `POSTBACK_TOKENS` source → Task 1. ✓
- Check unchanged → `#srcPostback`/`#pbOut` ids preserved, PB1-PB4 untouched, GEN6 regression. ✓
- Testing list (each tracker template, slot rewrite, domain completion, custom round-trip, copy, check regression) → BLD/GEN/CUS/SH. ✓
- Shareable view → Task 5. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; every test shows assertions. The two conditional notes (`--accent` fallback in Task 2 Step 4; `renderTrackerReference` removal guarded by grep in Task 6 Step 1) are explicit verify-then-act instructions, not deferrals.

**Type/name consistency:** `buildPostback(tracker, {clickSlot, personalize})`, `customTracker({domain,clickParam,payoutParam,orderParam})`, `activeTracker()`, `refreshGenOut()`, `renderPostbackGenerate()`, `renderPostbackCheck()`, `renderPostback()` dispatcher, `setPbView()` used consistently across tasks. DOM ids consistent: `#pbViewGenerate/#pbViewCheck`, `#pbGenerate/#pbCheck`, `#pbGenControls/#pbGenOut`, `#pbTrackerSel/#pbSlotSel/#pbPersonalize/#pbGenFull`, `#pbCustom_<key>`. Hash keys `pv/pt/ps/pd`. State vars `pbView/pbTrackerId/pbClickSlot/pbPersonalize/pbCustom`.
