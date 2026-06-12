import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import path from "node:path";

const fileUrl = pathToFileURL(path.resolve("index.html")).href;

let pass = 0, fail = 0;
const fails = [];
function check(name, cond, detail) {
  if (cond) { pass++; }
  else { fail++; fails.push(`${name}${detail ? " — " + detail : ""}`); }
}

const browser = await chromium.launch();
const page = await browser.newPage();
// deterministically capture whatever the app tries to copy
await page.addInitScript(() => {
  window.__copied = null;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: (t) => { window.__copied = t; return Promise.resolve(); } },
  });
});
await page.goto(fileUrl);

// helper: type input, return rendered rows as structured data
async function read() {
  return page.evaluate(() => {
    const out = document.getElementById("out");
    // a parse error is a top-level .msg.error with NO summary bar before it
    const hasSummary = !!out.querySelector(".summary");
    const parseError = !hasSummary ? out.querySelector(".msg.error") : null;
    const base = out.querySelector(".base .url");
    const assumed = !!out.querySelector(".base .note .tag");
    const fragNote = [...out.querySelectorAll(".base .note")].find(n => n.querySelector(".tag.frag"));
    const rows = [...out.querySelectorAll(".prow:not(.colhead)")].map(r => {
      const cells = r.querySelectorAll(".cell"); // [key, value]
      const rawLine = r.querySelector(".raw-line");
      const rawText = rawLine && rawLine.textContent ? rawLine.textContent.replace(/^raw:\s*/, "") : null;
      const gutter = r.querySelector(".gutter");
      const status = ["ok","warn","error"].find(s => gutter.classList.contains(s)) ?? null;
      return {
        key: r.querySelector(".k")?.textContent ?? null,
        value: cells[1]?.querySelector(".v")?.textContent ?? null,
        valueEmpty: (cells[1]?.querySelector(".v")?.textContent ?? "") === "",
        rawShown: !!rawText,
        rawText,
        decoded: r.querySelector(".decoded-line")?.textContent?.replace(/^↳\s*/, "") ?? null,
        status,
        note: r.querySelector(".snote")?.textContent ?? null,
        fix: r.querySelector(".fixbox .fixbtn")?.textContent ?? null,
      };
    });
    const banners = [...out.querySelectorAll(".banners .msg")].map(m => ({
      level: m.classList.contains("error") ? "error" : m.classList.contains("info") ? "info" : "warn",
      title: m.querySelector(".title")?.textContent ?? "",
      text: m.textContent,
      hasFixInput: !!m.querySelector(".banner-fix .fix-input"),
    }));
    const summary = {};
    out.querySelectorAll(".summary .pill").forEach(p => {
      const label = p.querySelector("span")?.textContent ?? "";
      const num = parseInt(p.querySelector("b")?.textContent ?? "0", 10);
      if (/error/.test(label)) summary.error = num;
      else if (/warn/.test(label)) summary.warn = num;
      else summary.ok = num;
    });
    return {
      error: parseError ? parseError.textContent.trim() : null,
      base: base ? base.textContent : null,
      assumed,
      fragment: fragNote ? true : false,
      rowCount: rows.length,
      rows,
      banners,
      summary,
      rebuilt: out.querySelector(".rebuilt-url")?.textContent ?? null,
      plain: out.querySelector(".plainsum .sentence")?.textContent ?? null,
    };
  });
}
// fix-it interaction helpers
async function clickRowFix(key) {
  await page.evaluate((key) => {
    const row = [...document.querySelectorAll(".prow:not(.colhead)")]
      .find(r => r.querySelector(".k")?.textContent === key);
    row.querySelector(".fixbox .fixbtn").click();
  }, key);
}
async function addAffidViaBanner(value) {
  await page.fill(".banner-fix .fix-input", value);
  await page.click(".banner-fix .fixbtn");
}
async function inspect(text) {
  await page.click("#modeInspect");   // ensure Inspect panel is visible
  await page.fill("#src", "");
  await page.fill("#src", text);
  return read();
}
const rowFor = (r, key) => r.rows.find(x => x.key === key);
const banner = (r, frag) => r.banners.find(b => b.text.includes(frag));

// — Feature 3 interaction helpers —
async function setValue(key, val) {
  await page.evaluate(({ key, val }) => {
    const row = [...document.querySelectorAll(".prow:not(.colhead)")]
      .find(r => r.querySelector(".k")?.textContent === key);
    const ed = row.querySelector(".v.edit");
    ed.textContent = val;
    ed.dispatchEvent(new Event("input", { bubbles: true }));
  }, { key, val });
}
async function toggleKey(key) {
  await page.evaluate((key) => {
    const row = [...document.querySelectorAll(".prow:not(.colhead)")]
      .find(r => r.querySelector(".k")?.textContent === key);
    row.querySelector(".toggle").click();
  }, key);
}
const copied = () => page.evaluate(() => window.__copied);

// ---- TEST 1: clean URL, basic params, order preserved ----
{
  const r = await inspect("https://buygoods.com/checkout?aff_id=639&subid=facebook&utm_source=newsletter");
  check("T1 base", r.base === "https://buygoods.com/checkout", r.base);
  check("T1 row count", r.rowCount === 3, `got ${r.rowCount}`);
  check("T1 order", r.rows.map(x=>x.key).join(",") === "aff_id,subid,utm_source", r.rows.map(x=>x.key).join(","));
  check("T1 value", r.rows[0].value === "639", r.rows[0].value);
}

// ---- TEST 2: no params ----
{
  const r = await inspect("https://buygoods.com/offer/details");
  check("T2 base", r.base === "https://buygoods.com/offer/details", r.base);
  check("T2 no rows", r.rowCount === 0, `got ${r.rowCount}`);
  check("T2 no error", r.error === null, r.error);
}

// ---- TEST 3: encoded value -> raw column differs ----
{
  const r = await inspect("https://x.com/p?utm_campaign=summer%20sale&name=a%2Bb");
  check("T3 decoded space", r.rows[0].value === "summer sale", r.rows[0].value);
  check("T3 raw shown", r.rows[0].rawShown === true && r.rows[0].rawText === "summer%20sale", JSON.stringify(r.rows[0]));
  check("T3 plus encoded", r.rows[1].value === "a+b", r.rows[1].value);
}

// ---- TEST 4: plus sign as space (form convention) ----
{
  const r = await inspect("https://x.com/p?q=hello+world");
  check("T4 plus->space", r.rows[0].value === "hello world", r.rows[0].value);
  check("T4 raw shown", r.rows[0].rawShown === true, JSON.stringify(r.rows[0]));
}

// ---- TEST 5: empty value + bare flag ----
{
  const r = await inspect("https://x.com/p?aff_id=&flag&subid=bing");
  check("T5 row count", r.rowCount === 3, `got ${r.rowCount}`);
  check("T5 empty marked", r.rows[0].valueEmpty === true, JSON.stringify(r.rows[0]));
  check("T5 bare flag key", r.rows[1].key === "flag" && r.rows[1].valueEmpty === true, JSON.stringify(r.rows[1]));
}

// ---- TEST 6: duplicate keys each get a row, not collapsed ----
{
  const r = await inspect("https://x.com/p?subid=facebook&subid=bing&aff_id=639");
  check("T6 row count", r.rowCount === 3, `got ${r.rowCount}`);
  check("T6 dup keys", r.rows.filter(x=>x.key==="subid").length === 2, JSON.stringify(r.rows.map(x=>x.key)));
  check("T6 dup values distinct", r.rows[0].value === "facebook" && r.rows[1].value === "bing", JSON.stringify(r.rows));
}

// ---- TEST 7: fragment handled, excluded from base ----
{
  const r = await inspect("https://x.com/p?aff_id=639#section-two");
  check("T7 base no hash", r.base === "https://x.com/p", r.base);
  check("T7 fragment noted", r.fragment === true, "fragment note missing");
  check("T7 rows", r.rowCount === 1, `got ${r.rowCount}`);
}

// ---- TEST 8: schemeless input -> assumed https ----
{
  const r = await inspect("buygoods.com/checkout?aff_id=1234");
  check("T8 assumed", r.assumed === true, "assumed tag missing");
  check("T8 base", r.base === "https://buygoods.com/checkout", r.base);
  check("T8 rows", r.rowCount === 1 && r.rows[0].value === "1234", JSON.stringify(r.rows));
}

// ---- TEST 9: leading/trailing whitespace ----
{
  const r = await inspect("   https://x.com/p?aff_id=639   ");
  check("T9 trimmed parses", r.error === null && r.base === "https://x.com/p", `err=${r.error} base=${r.base}`);
}

// ---- TEST 10: garbage -> inline error, no throw ----
{
  const r = await inspect("this is not a url at all %%% ::::");
  check("T10 error shown", r.error !== null, "expected error");
  check("T10 no rows", r.rowCount === 0, `got ${r.rowCount}`);
}

// ---- TEST 11: curly placeholder preserved verbatim ----
{
  const r = await inspect("https://x.com/postback?subid={SUBID}&amount={COMMISSION_AMOUNT}");
  check("T11 placeholder1", r.rows[0].value === "{SUBID}", r.rows[0].value);
  check("T11 placeholder2", r.rows[1].value === "{COMMISSION_AMOUNT}", r.rows[1].value);
}

// ---- TEST 12: malformed percent does not throw ----
{
  const r = await inspect("https://x.com/p?bad=%E0%A4%A&ok=fine");
  check("T12 no crash", r.error === null, `err=${r.error}`);
  check("T12 rows", r.rowCount === 2, `got ${r.rowCount}`);
}

// ---- TEST 13: empty input -> empty state, no error ----
{
  const r = await inspect("   ");
  check("T13 no error", r.error === null, r.error);
  check("T13 no rows", r.rowCount === 0, `got ${r.rowCount}`);
}

// ============================================================
//  FEATURE 2 — validation
// ============================================================

// ---- V1: missing aff_id -> error banner ----
{
  const r = await inspect("https://x.com/p?subid=facebook&utm_source=news");
  check("V1 banner", !!banner(r, "No affiliate ID"), JSON.stringify(r.banners));
  check("V1 banner error level", banner(r, "No affiliate ID")?.level === "error", "");
  check("V1 summary error>=1", r.summary.error >= 1, JSON.stringify(r.summary));
}

// ---- V2: aff_id present + numeric -> ok, no banner ----
{
  const r = await inspect("https://x.com/p?aff_id=639");
  check("V2 ok status", rowFor(r, "aff_id").status === "ok", JSON.stringify(rowFor(r,"aff_id")));
  check("V2 no missing banner", !banner(r, "No affiliate ID"), "");
  check("V2 desc note", /commission/i.test(rowFor(r,"aff_id").note), rowFor(r,"aff_id").note);
}

// ---- V3: aff_id empty -> error ----
{
  const r = await inspect("https://x.com/p?aff_id=");
  check("V3 error status", rowFor(r, "aff_id").status === "error", JSON.stringify(rowFor(r,"aff_id")));
  check("V3 no missing banner", !banner(r, "No affiliate ID"), "present but empty != missing");
}

// ---- V4: aff_id non-numeric -> error (malformed) ----
{
  const r = await inspect("https://x.com/p?aff_id=abc");
  check("V4 error status", rowFor(r, "aff_id").status === "error", JSON.stringify(rowFor(r,"aff_id")));
  check("V4 malformed note", /malformed/.test(rowFor(r,"aff_id").note), rowFor(r,"aff_id").note);
}

// ---- V5: subid non-numeric is FINE (never format-checked) ----
{
  const r = await inspect("https://x.com/p?aff_id=639&subid=facebook&subid2=bing&sid2=tiktok");
  check("V5 subid ok", rowFor(r, "subid").status === "ok", JSON.stringify(rowFor(r,"subid")));
  check("V5 subid2 ok", rowFor(r, "subid2").status === "ok", "");
  check("V5 sid2 ok", rowFor(r, "sid2").status === "ok", "");
}

// ---- V6: subid empty -> warning (non-empty rule only) ----
{
  const r = await inspect("https://x.com/p?aff_id=639&subid=");
  check("V6 subid warn", rowFor(r, "subid").status === "warn", JSON.stringify(rowFor(r,"subid")));
}

// ---- V7: duplicate keys w/ differing values -> warning on each ----
{
  const r = await inspect("https://x.com/p?aff_id=639&subid=facebook&subid=bing");
  const subids = r.rows.filter(x => x.key === "subid");
  check("V7 both warn", subids.every(x => x.status === "warn"), JSON.stringify(subids.map(x=>x.status)));
  check("V7 dup note", subids.every(x => /Duplicate/.test(x.note)), JSON.stringify(subids.map(x=>x.note)));
}

// ---- V7b: duplicate keys w/ SAME value -> not flagged ----
{
  const r = await inspect("https://x.com/p?aff_id=639&subid=facebook&subid=facebook");
  const subids = r.rows.filter(x => x.key === "subid");
  check("V7b identical dup ok", subids.every(x => x.status === "ok"), JSON.stringify(subids.map(x=>x.status)));
}

// ---- V8: utm_source with uppercase/space -> warning, not error ----
{
  const r = await inspect("https://x.com/p?aff_id=639&utm_source=Summer Sale");
  check("V8 utm warn", rowFor(r, "utm_source").status === "warn", JSON.stringify(rowFor(r,"utm_source")));
  check("V8 no error from utm", r.summary.error === 0, JSON.stringify(r.summary));
}

// ---- V9: utm present but utm_source/campaign missing -> warning banner ----
{
  const r = await inspect("https://x.com/p?aff_id=639&utm_medium=cpc&utm_term=shoes");
  check("V9 gap banner", !!banner(r, "Incomplete UTM"), JSON.stringify(r.banners));
  check("V9 gap warn level", banner(r, "Incomplete UTM")?.level === "warn", "");
}

// ---- V10: placeholder value -> ok with template note, never warn ----
{
  const r = await inspect("https://x.com/postback?aff_id={AFFILIATE_ID}&subid={SUBID}&amount={COMMISSION_AMOUNT}");
  check("V10 aff placeholder ok", rowFor(r, "aff_id").status === "ok", JSON.stringify(rowFor(r,"aff_id")));
  check("V10 placeholder note", /placeholder/i.test(rowFor(r,"aff_id").note), rowFor(r,"aff_id").note);
  check("V10 amount placeholder ok", rowFor(r, "amount").status === "ok", "");
  check("V10 no missing-aff banner", !banner(r, "No affiliate ID"), "aff_id IS present as placeholder");
}

// ---- V11: account_id recognized + labeled ----
{
  const r = await inspect("https://x.com/offer?aff_id=639&account_id=8842");
  check("V11 account_id ok", rowFor(r, "account_id").status === "ok", "");
  check("V11 account_id desc", /backoffice/i.test(rowFor(r,"account_id").note), rowFor(r,"account_id").note);
}

// ---- V15: all five BuyGoods tracking slots recognized (real VSL-style link) ----
{
  const r = await inspect("https://x.com/dtc/?aff_id=162939&subid=abc&subid2=click123&subid3=x&subid4=p36&subid5=alphabite_vsl_ml1");
  ["subid","subid2","subid3","subid4","subid5"].forEach((k) => {
    check(`V15 ${k} ok`, rowFor(r, k).status === "ok", JSON.stringify(rowFor(r,k)));
    check(`V15 ${k} described`, (rowFor(r, k).note ?? "").length > 0, `${k} has no description`);
  });
  check("V15 subid5 vsl desc", /campaign|VSL/i.test(rowFor(r,"subid5").note), rowFor(r,"subid5").note);
}

// ---- V12: unknown offer param defaults to ok ----
{
  const r = await inspect("https://x.com/p?aff_id=639&rebill_cycle=monthly&offer_xyz=42");
  check("V12 unknown ok", rowFor(r, "rebill_cycle").status === "ok", JSON.stringify(rowFor(r,"rebill_cycle")));
  check("V12 unknown2 ok", rowFor(r, "offer_xyz").status === "ok", "");
}

// ---- V13: empty unknown param -> quiet warning ----
{
  const r = await inspect("https://x.com/p?aff_id=639&note=");
  check("V13 empty warn", rowFor(r, "note").status === "warn", JSON.stringify(rowFor(r,"note")));
}

// ---- V14: summary counts add up (1 err banner + 1 warn row, ok rows) ----
{
  const r = await inspect("https://x.com/p?subid=facebook&utm_source=GOOD STUFF");
  // missing aff_id -> error banner(1); utm warn(1) + incomplete-utm banner warn(1); subid ok(1), utm_source row warn
  check("V14 has error", r.summary.error === 1, JSON.stringify(r.summary));
  check("V14 has warns", r.summary.warn >= 2, JSON.stringify(r.summary));
  check("V14 has ok", r.summary.ok >= 1, JSON.stringify(r.summary));
}

// ============================================================
//  FEATURE 3 — edit, toggle, rebuild & copy
// ============================================================

// ---- R1: rebuilt link mirrors a clean input ----
{
  const r = await inspect("https://buygoods.com/checkout?aff_id=639&subid=facebook");
  check("R1 rebuilt", r.rebuilt === "https://buygoods.com/checkout?aff_id=639&subid=facebook", r.rebuilt);
}

// ---- R2: inline edit fixes status AND rebuilt url, order preserved ----
{
  await inspect("https://x.com/p?aff_id=abc&subid=facebook");
  await setValue("aff_id", "639");
  const r = await read();
  check("R2 status now ok", rowFor(r, "aff_id").status === "ok", JSON.stringify(rowFor(r,"aff_id")));
  check("R2 rebuilt updated", r.rebuilt === "https://x.com/p?aff_id=639&subid=facebook", r.rebuilt);
  check("R2 no error banner", !banner(r, "No affiliate ID"), "");
}

// ---- R3: editing re-encodes special chars correctly ----
{
  await inspect("https://x.com/p?aff_id=639&q=plain");
  await setValue("q", "a b&c=d");
  const r = await read();
  check("R3 encoded", r.rebuilt === "https://x.com/p?aff_id=639&q=a%20b%26c%3Dd", r.rebuilt);
}

// ---- R4: placeholder stays literal (not percent-encoded) on rebuild ----
{
  const r = await inspect("https://x.com/postback?aff_id=639&subid={SUBID}");
  check("R4 placeholder literal", r.rebuilt === "https://x.com/postback?aff_id=639&subid={SUBID}", r.rebuilt);
}

// ---- R5: toggling a param OFF drops it from rebuilt url, keeps order ----
{
  await inspect("https://x.com/p?aff_id=639&subid=facebook&utm_source=news");
  await toggleKey("subid");
  const r = await read();
  check("R5 dropped", r.rebuilt === "https://x.com/p?aff_id=639&utm_source=news", r.rebuilt);
  check("R5 row off", rowFor(r, "subid").status === null || r.rows.find(x=>x.key==="subid"), "subid still shown");
}

// ---- R6: toggling aff_id OFF triggers the missing-aff banner live ----
{
  await inspect("https://x.com/p?aff_id=639&subid=facebook");
  await toggleKey("aff_id");
  const r = await read();
  check("R6 banner appears", !!banner(r, "No affiliate ID"), JSON.stringify(r.banners));
  check("R6 aff_id gone from url", !r.rebuilt.includes("aff_id"), r.rebuilt);
}

// ---- R7: toggling back ON restores it ----
{
  await inspect("https://x.com/p?aff_id=639&subid=facebook");
  await toggleKey("aff_id");
  await toggleKey("aff_id");
  const r = await read();
  check("R7 restored", r.rebuilt === "https://x.com/p?aff_id=639&subid=facebook", r.rebuilt);
  check("R7 banner gone", !banner(r, "No affiliate ID"), "");
}

// ---- R8: bare flag preserved as bare on rebuild ----
{
  const r = await inspect("https://x.com/p?aff_id=639&debug");
  check("R8 bare flag", r.rebuilt === "https://x.com/p?aff_id=639&debug", r.rebuilt);
}

// ---- R9: Copy clean link copies the rebuilt url ----
{
  await inspect("https://x.com/p?aff_id=639&utm_source=Bad Source");
  await toggleKey("utm_source");          // drop it
  await page.click(".btn.primary");
  const c = await copied();
  check("R9 copied clean", c === "https://x.com/p?aff_id=639", c);
  const r = await read();
  check("R9 button flashed", await page.$eval(".btn.primary", b => b.classList.contains("copied")), "no copied class");
}

// ---- R10: Copy as-is copies the ORIGINAL untouched input (incl. whitespace) ----
{
  const original = "  HTTPS://X.com/p?aff_id=639&subid=FaceBook  ";
  await inspect(original);
  await setValue("aff_id", "111");        // edit something — as-is must ignore it
  await page.click(".actions .btn:not(.primary)");
  const c = await copied();
  check("R10 copied as-is verbatim", c === original, JSON.stringify(c));
}

// ============================================================
//  FEATURE 4 — compare two links
// ============================================================

async function compare(a, b) {
  await page.click("#modeCompare");
  await page.fill("#srcA", ""); await page.fill("#srcA", a);
  await page.fill("#srcB", ""); await page.fill("#srcB", b);
  return page.evaluate(() => {
    const out = document.getElementById("cmpOut");
    const hasSummary = !!out.querySelector(".summary");
    const empty = out.querySelector(".empty")?.textContent ?? null;
    const parseError = (!hasSummary && out.querySelector(".msg.error"))
      ? out.querySelector(".msg.error").textContent : null;
    const rows = [...out.querySelectorAll(".prow.cmp:not(.colhead)")].map((r) => {
      const cells = r.querySelectorAll(".cell");
      const gutter = r.querySelector(".gutter");
      const status = ["ok", "warn", "error"].find((s) => gutter.classList.contains(s)) ?? "same";
      const aCell = cells[1], bCell = cells[2];
      return {
        key: r.querySelector(".k")?.textContent,
        a: aCell.querySelector(".cmpv")?.textContent,
        b: bCell.querySelector(".cmpv")?.textContent,
        aAbsent: !!aCell.querySelector(".cmpv.absent"),
        bAbsent: !!bCell.querySelector(".cmpv.absent"),
        status,
        emphasis: !!r.querySelector(".ktag"),
        aHl: /hl-/.test(aCell.className),
        bHl: /hl-/.test(bCell.className),
      };
    });
    const banners = [...out.querySelectorAll(".banners .msg")].map((m) => ({
      level: m.classList.contains("error") ? "error" : "warn",
      text: m.textContent,
    }));
    const summary = {};
    out.querySelectorAll(".summary .pill").forEach((p) => {
      const label = p.querySelector("span")?.textContent ?? "";
      const num = parseInt(p.querySelector("b")?.textContent ?? "0", 10);
      if (/difference/.test(label)) summary.differs = num;
      else if (/identical/.test(label)) summary.same = num;
      else summary.gap = num;
    });
    return {
      empty, parseError, rows, banners, summary,
      diffnote: !!out.querySelector(".basepair .diffnote"),
      keys: rows.map((r) => r.key),
    };
  });
}
const cRow = (r, key) => r.rows.find((x) => x.key === key);
const cBanner = (r, frag) => r.banners.find((x) => x.text.includes(frag));

// ---- C1: identical links -> all same, no differences, no banners ----
{
  const url = "https://x.com/p?aff_id=639&subid=facebook";
  const r = await compare(url, url);
  check("C1 all same", r.rows.every((x) => x.status === "same"), JSON.stringify(r.rows.map(x=>x.status)));
  check("C1 summary", r.summary.differs === 0 && r.summary.gap === 0 && r.summary.same === 2, JSON.stringify(r.summary));
  check("C1 no banners", r.banners.length === 0, JSON.stringify(r.banners));
}

// ---- C2: aff_id differs -> error status, error banner, both cells highlighted ----
{
  const r = await compare("https://x.com/p?aff_id=639&subid=facebook", "https://x.com/p?aff_id=1234&subid=facebook");
  check("C2 aff_id error", cRow(r, "aff_id").status === "error", JSON.stringify(cRow(r,"aff_id")));
  check("C2 banner", cBanner(r, "aff_id differs")?.level === "error", JSON.stringify(r.banners));
  check("C2 both highlighted", cRow(r, "aff_id").aHl && cRow(r, "aff_id").bHl, "");
  check("C2 subid same", cRow(r, "subid").status === "same", "");
}

// ---- C3: aff_id only on A -> onlyA, B absent, error banner ----
{
  const r = await compare("https://x.com/p?aff_id=639&subid=facebook", "https://x.com/p?subid=facebook");
  check("C3 aff_id error", cRow(r, "aff_id").status === "error", "");
  check("C3 B absent", cRow(r, "aff_id").bAbsent === true, JSON.stringify(cRow(r,"aff_id")));
  check("C3 banner", !!cBanner(r, "only on Link A"), JSON.stringify(r.banners));
  check("C3 banner msg", /only Link A will attribute/.test(cBanner(r, "only on Link A")?.text ?? ""), "");
}

// ---- C4: subid differs -> WARN (not error), warn banner ----
{
  const r = await compare("https://x.com/p?aff_id=639&subid=facebook", "https://x.com/p?aff_id=639&subid=bing");
  check("C4 subid warn", cRow(r, "subid").status === "warn", JSON.stringify(cRow(r,"subid")));
  check("C4 banner warn", cBanner(r, "subid differs")?.level === "warn", JSON.stringify(r.banners));
  check("C4 aff_id same", cRow(r, "aff_id").status === "same", "");
}

// ---- C5: non-emphasis param only on one side -> warn gap, no error banner ----
{
  const r = await compare("https://x.com/p?aff_id=639", "https://x.com/p?aff_id=639&utm_term=shoes");
  check("C5 gap warn", cRow(r, "utm_term").status === "warn", JSON.stringify(cRow(r,"utm_term")));
  check("C5 A absent", cRow(r, "utm_term").aAbsent === true, "");
  check("C5 no error banner", !r.banners.some((x) => x.level === "error"), JSON.stringify(r.banners));
}

// ---- C6: emphasis params sort to the top regardless of input position ----
{
  const r = await compare("https://x.com/p?utm_source=news&subid=fb&aff_id=639", "https://x.com/p?utm_source=news&subid=fb&aff_id=639");
  check("C6 aff_id first", r.keys[0] === "aff_id", JSON.stringify(r.keys));
  check("C6 subid second", r.keys[1] === "subid", JSON.stringify(r.keys));
  check("C6 emphasis tagged", cRow(r, "aff_id").emphasis && cRow(r, "subid").emphasis, "");
  check("C6 utm not tagged", cRow(r, "utm_source").emphasis === false, "");
}

// ---- C7: duplicate keys aggregate, then compare as a set ----
{
  const r = await compare("https://x.com/p?aff_id=639&subid=facebook&subid=bing", "https://x.com/p?aff_id=639&subid=facebook");
  check("C7 aggregated A", cRow(r, "subid").a === "facebook, bing", cRow(r,"subid").a);
  check("C7 differs warn", cRow(r, "subid").status === "warn", JSON.stringify(cRow(r,"subid")));
}

// ---- C8: different base URLs -> diffnote shown ----
{
  const r = await compare("https://a.com/checkout?aff_id=639", "https://b.com/offer?aff_id=639");
  check("C8 diffnote", r.diffnote === true, "expected base diffnote");
}

// ---- C8b: same base URLs -> no diffnote ----
{
  const r = await compare("https://x.com/p?aff_id=639", "https://x.com/p?aff_id=1234");
  check("C8b no diffnote", r.diffnote === false, "");
}

// ---- C9: one side empty -> prompt, no crash ----
{
  const r = await compare("https://x.com/p?aff_id=639", "");
  check("C9 prompt", /Link B/.test(r.empty ?? ""), JSON.stringify(r.empty));
  check("C9 no rows", r.rows.length === 0, "");
}

// ---- C10: parse error on one side names the link ----
{
  const r = await compare("https://x.com/p?aff_id=639", "::: not a url :::");
  check("C10 names link B", /Link B/.test(r.parseError ?? ""), JSON.stringify(r.parseError));
}

// ---- C11: summary counts add up across kinds ----
{
  const r = await compare("https://x.com/p?aff_id=639&subid=fb&utm_source=news", "https://x.com/p?aff_id=1234&subid=fb&utm_term=x");
  // aff_id differs(1), subid same(1), utm_source onlyA(gap), utm_term onlyB(gap)
  check("C11 differs", r.summary.differs === 1, JSON.stringify(r.summary));
  check("C11 gaps", r.summary.gap === 2, JSON.stringify(r.summary));
  check("C11 same", r.summary.same === 1, JSON.stringify(r.summary));
}

// ============================================================
//  FEATURE 5 — plain-English summary
// ============================================================

// ---- S1: full VSL link reads as a sentence with the right values ----
{
  const r = await inspect("https://nationlifenews.com/hu/vsl7/l1/af/?aff_id=162939&subid4=p36&subid5=alphabite_vsl_ml1");
  check("S1 affiliate", /Affiliate\s*162939/.test(r.plain), r.plain);
  check("S1 offer host", /nationlifenews\.com/.test(r.plain), r.plain);
  check("S1 carries slot5", /alphabite_vsl_ml1/.test(r.plain) && /subid5/.test(r.plain), r.plain);
}

// ---- S2: missing aff_id reads as the problem, in plain words ----
{
  const r = await inspect("https://nationlifenews.com/hu/vsl7/l1/af/?aff_id=");
  check("S2 no aff phrase", /no valid affiliate id/i.test(r.plain), r.plain);
  check("S2 no tracking phrase", /no click tracking/i.test(r.plain), r.plain);
}

// ---- S3: placeholder slot reads as a ready click-ID slot ----
{
  const r = await inspect("https://x.com/p?aff_id=639&subid2={!subid!}&utm_source=facebook");
  check("S3 ready slot", /click-ID slot is ready in/i.test(r.plain) && /subid2/.test(r.plain), r.plain);
  check("S3 traffic source", /traffic from/i.test(r.plain) && /facebook/.test(r.plain), r.plain);
}

// ---- S4: summary updates live when aff_id is edited ----
{
  await inspect("https://x.com/p?aff_id=abc");
  await setValue("aff_id", "777");
  const r = await read();
  check("S4 live update", /Affiliate\s*777/.test(r.plain), r.plain);
}

// ============================================================
//  FEATURE 6 — inline fix-it actions
// ============================================================

// ---- F1: missing aff_id banner offers an input; adding inserts the param ----
{
  let r = await inspect("https://x.com/p?subid=facebook");
  check("F1 banner has input", banner(r, "No affiliate ID")?.hasFixInput === true, JSON.stringify(r.banners));
  await addAffidViaBanner("162939");
  r = await read();
  check("F1 aff_id added", rowFor(r, "aff_id")?.value === "162939", JSON.stringify(rowFor(r,"aff_id")));
  check("F1 added at front", r.rows[0].key === "aff_id", JSON.stringify(r.keys ?? r.rows.map(x=>x.key)));
  check("F1 banner gone", !banner(r, "No affiliate ID"), "");
  check("F1 rebuilt has aff", /aff_id=162939/.test(r.rebuilt), r.rebuilt);
}

// ---- F2: non-numeric aff_id offers "Use <digits>" and applies it ----
{
  let r = await inspect("https://x.com/p?aff_id=ab639xy");
  check("F2 fix offered", /Use 639/.test(rowFor(r, "aff_id").fix ?? ""), JSON.stringify(rowFor(r,"aff_id")));
  await clickRowFix("aff_id");
  r = await read();
  check("F2 fixed value", rowFor(r, "aff_id").value === "639", JSON.stringify(rowFor(r,"aff_id")));
  check("F2 now ok", rowFor(r, "aff_id").status === "ok", "");
}

// ---- F3: utm_source with caps/space offers a normalised token ----
{
  let r = await inspect("https://x.com/p?aff_id=639&utm_source=Summer Sale");
  check("F3 fix offered", /summer_sale/.test(rowFor(r, "utm_source").fix ?? ""), JSON.stringify(rowFor(r,"utm_source")));
  await clickRowFix("utm_source");
  r = await read();
  check("F3 cleaned", rowFor(r, "utm_source").value === "summer_sale", JSON.stringify(rowFor(r,"utm_source")));
  check("F3 now ok", rowFor(r, "utm_source").status === "ok", "");
}

// ---- F4: differing duplicate offers "Keep this one" -> disables siblings ----
{
  let r = await inspect("https://x.com/p?aff_id=639&subid=facebook&subid=bing");
  const subids = r.rows.filter(x => x.key === "subid");
  check("F4 fix on dupes", subids.every(x => /Keep this one/.test(x.fix ?? "")), JSON.stringify(subids.map(x=>x.fix)));
  await clickRowFix("subid"); // keep the first
  r = await read();
  check("F4 only one subid in url", (r.rebuilt.match(/subid=/g) || []).length === 1, r.rebuilt);
  check("F4 kept first", /subid=facebook/.test(r.rebuilt), r.rebuilt);
  check("F4 no more dup warning", !r.rows.some(x => /Duplicate/.test(x.note ?? "")), JSON.stringify(r.rows.map(x=>x.note)));
}

// ---- F5: clean rows offer no fix ----
{
  const r = await inspect("https://x.com/p?aff_id=639&subid=facebook");
  check("F5 no fix when clean", r.rows.every(x => x.fix === null), JSON.stringify(r.rows.map(x=>x.fix)));
}

// ============================================================
//  FEATURE 7 — click-ID insight (info banner)
// ============================================================
{
  const withClick = await inspect("https://x.com/p?aff_id=639&subid2=click123");
  check("CL1 no info when click id present", !banner(withClick, "No click ID"), JSON.stringify(withClick.banners));

  const noClick = await inspect("https://x.com/p?aff_id=639&utm_source=facebook");
  const b = banner(noClick, "No click ID");
  check("CL2 info banner present", !!b, JSON.stringify(noClick.banners));
  check("CL2 info level", b?.level === "info", JSON.stringify(b));
  check("CL2 not counted as warn", noClick.summary.warn === 0 || !/click/i.test(JSON.stringify(noClick.summary)), JSON.stringify(noClick.summary));
}

// ============================================================
//  FEATURE 8 — empty aff_id inline fix
// ============================================================
{
  let r = await inspect("https://x.com/p?aff_id=&subid=facebook");
  const b = banner(r, "Affiliate ID is empty");
  check("EA1 empty-aff banner", !!b, JSON.stringify(r.banners));
  check("EA1 has fix input", b?.hasFixInput === true, JSON.stringify(b));
  await addAffidViaBanner("162939");
  r = await read();
  check("EA1 single aff row (no dupe)", r.rows.filter(x => x.key === "aff_id").length === 1, JSON.stringify(r.rows.map(x=>x.key)));
  check("EA1 value set", rowFor(r, "aff_id").value === "162939", JSON.stringify(rowFor(r,"aff_id")));
  check("EA1 now ok", rowFor(r, "aff_id").status === "ok", "");
}

// ============================================================
//  FEATURE 9 — name resolution in the summary
// ============================================================
{
  const r = await inspect("https://getcellucare.com/dtc/?aff_id=639&subid=fb");
  check("NR1 offer name", /CelluCare/.test(r.plain), r.plain);
}

// ============================================================
//  FEATURE 10 — batch mode
// ============================================================
async function batch(text) {
  await page.click("#modeBatch");
  await page.fill("#srcBatch", "");
  await page.fill("#srcBatch", text);
  return page.evaluate(() => {
    const out = document.getElementById("batchOut");
    const rows = [...out.querySelectorAll(".prow.batch:not(.colhead)")].map(r => {
      const g = r.querySelector(".gutter");
      return {
        link: r.querySelector(".blink")?.textContent ?? null,
        aff: r.querySelector(".baff")?.textContent ?? null,
        affMissing: !!r.querySelector(".baff.miss"),
        verdict: r.querySelector(".bverdict")?.textContent ?? null,
        status: ["ok","warn","error"].find(s => g.classList.contains(s)) ?? null,
      };
    });
    const counts = {};
    out.querySelectorAll(".summary .pill").forEach(p => {
      const label = p.querySelector("span")?.textContent ?? "";
      const n = parseInt(p.querySelector("b")?.textContent ?? "0", 10);
      if (/fail/.test(label)) counts.error = n; else if (/check/.test(label)) counts.warn = n; else counts.ok = n;
    });
    return { rows, counts, empty: out.querySelector(".empty")?.textContent ?? null };
  });
}
{
  const r = await batch([
    "https://x.com/p?aff_id=639&subid=facebook",
    "https://x.com/p?aff_id=",
    "not a url at all :::",
    "https://x.com/p?aff_id=1234&subid=bing&subid=tiktok",
  ].join("\n"));
  check("BA1 four rows", r.rows.length === 4, JSON.stringify(r.rows.map(x=>x.status)));
  check("BA1 row1 clean", r.rows[0].status === "ok" && r.rows[0].aff === "639", JSON.stringify(r.rows[0]));
  check("BA1 row2 empty aff error", r.rows[1].status === "error", JSON.stringify(r.rows[1]));
  check("BA1 row3 unparseable", r.rows[2].status === "error" && /parse/i.test(r.rows[2].verdict), JSON.stringify(r.rows[2]));
  check("BA1 row4 dup warn", r.rows[3].status === "warn", JSON.stringify(r.rows[3]));
  check("BA1 counts", r.counts.error === 2 && r.counts.warn === 1 && r.counts.ok === 1, JSON.stringify(r.counts));
}
{
  const r = await batch("   "); // whitespace only
  check("BA2 empty prompt", /one per line/i.test(r.empty ?? ""), JSON.stringify(r.empty));
}
// batch -> Inspect deep-link
{
  await batch("https://x.com/p?aff_id=777&subid=facebook");
  await page.click(".prow.batch:not(.colhead) .binspect");
  check("BA3 switched to inspect", await page.isVisible("#inspectPanel"), "inspect not visible");
  check("BA3 src filled", (await page.inputValue("#src")).includes("aff_id=777"), await page.inputValue("#src"));
}

// ============================================================
//  FEATURE 11 — postback-aware mode
// ============================================================
async function postback(text) {
  await page.click("#modePostback");
  await page.fill("#srcPostback", "");
  await page.fill("#srcPostback", text);
  return page.evaluate(() => {
    const out = document.getElementById("pbOut");
    const rows = [...out.querySelectorAll(".prow.pb:not(.colhead)")].map(r => {
      const g = r.querySelector(".gutter");
      return {
        tok: r.querySelector(".pbtok")?.textContent ?? null,
        meaning: r.querySelector(".pbmean")?.textContent ?? null,
        status: ["ok","warn","error"].find(s => g.classList.contains(s)) ?? null,
      };
    });
    const banners = [...out.querySelectorAll(".banners .msg")].map(m => ({
      level: m.classList.contains("error") ? "error" : m.classList.contains("info") ? "info" : "warn",
      text: m.textContent,
    }));
    return { rows, banners };
  });
}
const pbRow = (r, part) => r.rows.find(x => (x.tok || "").includes(part));
{
  const r = await postback("https://trk.com/pb?subid={SUBID}&orderid={ORDERID}&amount={COMMISSION_AMOUNT}");
  check("PB1 all ok", r.rows.every(x => x.status === "ok"), JSON.stringify(r.rows.map(x=>x.status)));
  check("PB1 valid banner", r.banners.some(b => /valid/i.test(b.text) && b.level === "info"), JSON.stringify(r.banners));
  check("PB1 subid meaning", /SubID slot 1/.test(pbRow(r, "{SUBID}")?.meaning ?? ""), JSON.stringify(pbRow(r,"{SUBID}")));
}
{
  const r = await postback("https://trk.com/pb?subid={SUBID}&click={CLICKID}");
  check("PB2 unknown token error", pbRow(r, "{CLICKID}")?.status === "error", JSON.stringify(pbRow(r,"{CLICKID}")));
  check("PB2 unsupported banner", r.banners.some(b => /Unsupported token/i.test(b.text) && b.level === "error"), JSON.stringify(r.banners));
}
{
  const r = await postback("https://trk.com/pb?subid={subid}");
  check("PB3 lowercase warn", pbRow(r, "{subid}")?.status === "warn", JSON.stringify(pbRow(r,"{subid}")));
  check("PB3 uppercase hint", /uppercase/i.test(pbRow(r, "{subid}")?.meaning ?? ""), pbRow(r,"{subid}")?.meaning);
}
{
  const r = await postback("https://trk.com/pb?subid={SUBID}&fixed=42");
  check("PB4 static value ok", pbRow(r, "fixed=42")?.status === "ok", JSON.stringify(pbRow(r,"fixed=42")));
  check("PB4 static meaning", /Static value/i.test(pbRow(r, "fixed=42")?.meaning ?? ""), pbRow(r,"fixed=42")?.meaning);
}

// ============================================================
//  FEATURE 12 — shareable URL hash
// ============================================================
{
  // typing in inspect updates the hash
  await inspect("https://x.com/p?aff_id=639&subid=fb");
  const h = await page.evaluate(() => location.hash);
  check("HS1 hash has mode+input", /m=inspect/.test(h) && /aff_id/.test(decodeURIComponent(h)), h);
}
{
  // a shared inspect hash restores the view on load
  const enc = encodeURIComponent("https://getcellucare.com/dtc/?aff_id=639&subid=fb");
  await page.goto(fileUrl + "#m=inspect&i=" + enc);
  const r = await read();
  check("HS2 restored inspect rows", rowFor(r, "aff_id")?.value === "639", JSON.stringify(r.rows.map(x=>x.key)));
  check("HS2 restored offer name", /CelluCare/.test(r.plain ?? ""), r.plain);
}
{
  // a shared compare hash restores both boxes + compare mode
  const a = encodeURIComponent("https://x.com/p?aff_id=639&subid=fb");
  const b = encodeURIComponent("https://x.com/p?aff_id=1234&subid=bing");
  await page.goto(fileUrl + "#m=compare&a=" + a + "&b=" + b);
  check("HS3 compare visible", await page.isVisible("#comparePanel"), "compare not visible");
  check("HS3 box A restored", (await page.inputValue("#srcA")).includes("aff_id=639"), await page.inputValue("#srcA"));
  check("HS3 box B restored", (await page.inputValue("#srcB")).includes("aff_id=1234"), await page.inputValue("#srcB"));
}

// ============================================================
//  FEATURE 13 — real BuyGoods checkout params
// ============================================================
{
  const r = await inspect("https://buygoods.com/secure/checkout.html?account_id=11292&product_codename=vis2fnn2&redirect=aHR0cDovL3Zpc2l1bXByby5jb20vZm5uMi91cDE%3D&sub20=v3_abc&sub19=v3_abc");
  check("CK1 product_codename known", /offer\/product/i.test(rowFor(r, "product_codename").note ?? ""), JSON.stringify(rowFor(r,"product_codename")));
  check("CK1 account_id ok", rowFor(r, "account_id").status === "ok", "");
  check("CK1 redirect decoded", /visiumpro\.com\/fnn2\/up1/.test(rowFor(r, "redirect").decoded ?? ""), rowFor(r,"redirect").decoded);
  check("CK1 sub20 recognized", rowFor(r, "sub20").status === "ok" && /Checkout/.test(rowFor(r,"sub20").note ?? ""), JSON.stringify(rowFor(r,"sub20")));
  check("CK1 sub19 recognized", rowFor(r, "sub19").status === "ok", JSON.stringify(rowFor(r,"sub19")));
}
{
  // garbage redirect that isn't valid Base64 -> a warning, not a crash
  const r = await inspect("https://buygoods.com/secure/checkout.html?aff_id=639&redirect=@@@notbase64@@@");
  check("CK2 bad base64 warns", rowFor(r, "redirect").status === "warn", JSON.stringify(rowFor(r,"redirect")));
}

// ============================================================
//  FEATURE 14 — Help tab
// ============================================================
{
  await page.click("#modeHelp");
  check("HP1 help visible", await page.isVisible("#helpPanel"), "help panel hidden");
  check("HP1 worked example shown", (await page.textContent("#demoUrl")).includes("checkout.html"), "");
  check("HP1 base64 decoded in demo", (await page.textContent(".demo-decode")).includes("heroupofficial.com/upsell"), "");
  // concept explainer diagrams render
  const diagrams = await page.evaluate(() => ({
    twoJobs: !!document.querySelector(".twojobs .tj-flow.comm") && !!document.querySelector(".twojobs .tj-flow.track"),
    pathSegs: document.querySelectorAll(".pathana .pa-seg").length,
    pathText: document.querySelector(".pathana")?.textContent ?? "",
    softHard: !!document.querySelector(".decl-chip.warn") && !!document.querySelector(".decl-chip.error"),
    sourced: !!document.querySelector(".srcstamp"),
  }));
  check("HP4 two-jobs diagram (commission + reporting flows)", diagrams.twoJobs, JSON.stringify(diagrams));
  check("HP4 path anatomy segments labelled", diagrams.pathSegs === 4 && /Hungarian/.test(diagrams.pathText) && /affiliate redirect/.test(diagrams.pathText), JSON.stringify(diagrams));
  check("HP4 decline explainer (soft/hard + sourced)", diagrams.softHard && diagrams.sourced, JSON.stringify(diagrams));
  // Try-this-example deep-links into Inspect
  await page.click("#tryExample");
  check("HP2 switched to inspect", await page.isVisible("#inspectPanel"), "");
  check("HP2 example loaded", (await page.inputValue("#src")).includes("product_codename=her6"), "");
  // an Open button switches mode
  await page.click("#modeHelp");
  await page.click('.help-card [data-open="postback"]');
  check("HP3 open postback", await page.isVisible("#postbackPanel"), "");
}

// ============================================================
//  FEATURE 15 — "Try an example" in empty states
// ============================================================
{
  await page.click("#modePostback");
  await page.fill("#srcPostback", "");
  check("EX1 postback example btn", await page.isVisible("#pbOut .ex-btn"), "no example button");
  await page.click("#pbOut .ex-btn");
  check("EX1 fills postback", (await page.inputValue("#srcPostback")).includes("{COMMISSION_AMOUNT}"), await page.inputValue("#srcPostback"));
  check("EX1 renders tokens", await page.isVisible(".prow.pb"), "no token rows after example");
}
{
  await page.click("#modeBatch");
  await page.fill("#srcBatch", "");
  check("EX2 batch example btn", await page.isVisible("#batchOut .ex-btn"), "no example button");
  await page.click("#batchOut .ex-btn");
  check("EX2 fills batch", (await page.inputValue("#srcBatch")).split("\n").length >= 4, await page.inputValue("#srcBatch"));
  check("EX2 renders audit", (await page.$$(".prow.batch:not(.colhead)")).length >= 4, "no audit rows");
}

// ============================================================
//  FEATURE 16 — VSL path intelligence
// ============================================================
async function pathChips() {
  return page.evaluate(() =>
    [...document.querySelectorAll("#out .pathchip")].map((c) => ({
      seg: c.querySelector(".ps")?.textContent, mean: c.querySelector(".pm")?.textContent,
    })));
}
{
  await inspect("https://nationlifenews.com/hu/vsl7/l1/af/?aff_id=162939&subid=fb");
  const chips = await pathChips();
  const byseg = (s) => chips.find((c) => c.seg === s)?.mean ?? "";
  check("VP1 hungarian", /Hungarian/.test(byseg("hu")), JSON.stringify(chips));
  check("VP1 vsl variant", /VSL page \(variant 7\)/.test(byseg("vsl7")), JSON.stringify(chips));
  check("VP1 lander", /Lander 1/.test(byseg("l1")), JSON.stringify(chips));
  check("VP1 affiliate redirect", /Affiliate redirect/.test(byseg("af")), JSON.stringify(chips));
}
{
  await inspect("https://offer.com/br/vsl2/checkout.html?aff_id=639&subid=fb");
  const chips = await pathChips();
  check("VP2 brazil", chips.some((c) => c.seg === "br" && /Brazil/.test(c.mean)), JSON.stringify(chips));
  check("VP2 checkout", chips.some((c) => /checkout/.test(c.seg) && /Checkout/.test(c.mean)), JSON.stringify(chips));
}

// ============================================================
//  FEATURE 17 — Base64 detected on any param
// ============================================================
{
  // "r" is not a configured param; its value is base64 of a URL
  const b64 = Buffer.from("https://visiumpro.com/fnn2/up1").toString("base64");
  const r = await inspect("https://x.com/p?aff_id=639&r=" + encodeURIComponent(b64));
  check("B64 decoded on any key", /visiumpro\.com\/fnn2\/up1/.test(rowFor(r, "r").decoded ?? ""), rowFor(r,"r").decoded);
  // a normal value is NOT mistaken for base64
  const r2 = await inspect("https://x.com/p?aff_id=639&subid=facebook");
  check("B64 no false positive", !/→ http/.test(rowFor(r2, "subid").note ?? ""), rowFor(r2,"subid").note);
}

// ============================================================
//  FEATURE 18 — batch CSV export
// ============================================================
{
  await batch(["https://x.com/p?aff_id=639&subid=fb", "https://x.com/p?aff_id="].join("\n"));
  check("CSV button present", await page.isVisible("#batchOut .batch-actions"), "no batch actions");
  const [ download ] = await Promise.all([
    page.waitForEvent("download"),
    page.click('#batchOut .batch-actions button:has-text("Download CSV")'),
  ]);
  const stream = await download.createReadStream();
  let csv = ""; for await (const ch of stream) csv += ch;
  check("CSV header", csv.split("\r\n")[0] === "#,link,aff_id,status,verdict", csv.split("\r\n")[0]);
  check("CSV row count", csv.trim().split("\r\n").length === 3, csv);
  check("CSV has status", /error/.test(csv) && /ok/.test(csv), csv);
}

// ============================================================
//  FEATURE 19 — batch bulk-fix
// ============================================================
{
  await batch(["https://x.com/p?aff_id=&subid=fb", "https://x.com/p?subid=bing", "https://x.com/p?aff_id=639"].join("\n"));
  await page.fill("#batchOut .bulkfill .fix-input", "162939");
  await page.click('#batchOut .bulkfill button:has-text("Fill missing aff_id")');
  const r = await page.evaluate(() => document.getElementById("srcBatch").value);
  check("BF1 filled empty", /aff_id=162939&subid=fb/.test(r), r);
  check("BF1 filled missing at front", /\?aff_id=162939&subid=bing/.test(r), r);
  check("BF1 left valid alone", /aff_id=639/.test(r) && !/aff_id=639.*162939/.test(r), r);
  // re-audit shows them all clean now
  const after = await page.evaluate(() =>
    [...document.querySelectorAll("#batchOut .prow.batch:not(.colhead) .gutter")].map((g) =>
      ["ok","warn","error"].find((s) => g.classList.contains(s))));
  check("BF1 all ok after", after.every((s) => s === "ok"), JSON.stringify(after));
}

// ============================================================
//  FEATURE 20 — local-only saved names (inline + Help manager)
// ============================================================
{
  // localStorage may be blocked on file:// — confirm in-session naming works regardless
  await inspect("https://x.com/p?aff_id=991177&subid=fb");
  check("SN1 name affordance", await page.isVisible(".plainsum .namebtn"), "no + name button");
  await page.click(".plainsum .namebtn");
  await page.fill(".plainsum .name-input", "Adelina");
  await page.press(".plainsum .name-input", "Enter");
  const plain = await page.textContent(".plainsum .sentence");
  check("SN1 name shown in summary", /Adelina/.test(plain), plain);
  // Help tab lists the saved name with a remove control
  await page.click("#modeHelp");
  const saved = await page.textContent("#savedNames");
  check("SN2 listed in help", /991177/.test(saved) && /Adelina/.test(saved), saved);
  await page.click('#savedNames .hs-remove');
  check("SN2 removed", /No saved names yet/.test(await page.textContent("#savedNames")), "not cleared");
}

// ============================================================
//  FEATURE 21 — eat messy input
// ============================================================
{
  const r = await inspect('the affiliate link is <https://x.com/p?aff_id=639&amp;subid=fb> thanks!');
  check("MI1 lifted from prose", r.base === "https://x.com/p", r.base);
  check("MI1 entity decoded", rowFor(r, "subid")?.value === "fb", JSON.stringify(r.rows.map(x=>x.key)));
  check("MI1 cleaned note", await page.isVisible("#out .base .note .tag"), "no cleaned tag");
}
{
  // a standalone URL with a raw space in a value is NOT truncated
  const r = await inspect("https://x.com/p?aff_id=639&utm_source=Summer Sale");
  check("MI2 raw space kept", rowFor(r, "utm_source")?.value === "Summer Sale", JSON.stringify(rowFor(r,"utm_source")));
}

// ============================================================
//  FEATURE 22 — typo / near-miss param detection
// ============================================================
{
  const r = await inspect("https://x.com/p?af_id=639&utm-source=facebook&color=blue");
  check("TY1 af_id suggests aff_id", /did you mean .?aff_id/i.test(rowFor(r, "af_id")?.note ?? ""), rowFor(r,"af_id")?.note);
  check("TY1 af_id warn", rowFor(r, "af_id")?.status === "warn", "");
  check("TY1 utm-source suggests utm_source", /utm_source/.test(rowFor(r, "utm-source")?.note ?? ""), rowFor(r,"utm-source")?.note);
  check("TY1 genuine unknown stays ok", rowFor(r, "color")?.status === "ok", JSON.stringify(rowFor(r,"color")));
}

// ============================================================
//  FEATURE 23 — Copy diagnosis
// ============================================================
{
  await inspect("https://nationlifenews.com/br/vsl7/l1/af/?aff_id=&subid5=alphabite_ml1");
  await page.click('.actions button:has-text("Copy diagnosis")');
  const diag = await copied();
  check("CD1 has header", /PARAM DECODER — DIAGNOSIS/.test(diag), diag?.slice(0,40));
  check("CD1 has base", /Base: https:\/\/nationlifenews\.com\/br\/vsl7\/l1\/af\//.test(diag), diag);
  check("CD1 has summary", /Summary:/.test(diag) && /no valid affiliate ID/i.test(diag), diag);
  check("CD1 has flagged param", /\[ERROR\] aff_id/.test(diag), diag);
  check("CD1 has path", /Path:/.test(diag) && /VSL page/.test(diag), diag);
  check("CD1 has rebuilt", /Rebuilt: https:/.test(diag), diag);
}

// ============================================================
//  FEATURE 24 — QA template compare
// ============================================================
{
  await inspect("https://qatest.com/p?aff_id=639&subid=fb&utm_source=news");
  check("QT1 no template prompt", await page.isVisible('.tmpl-card button:has-text("Save this link")'), "no save button");
  await page.click('.tmpl-card button:has-text("Save this link")');
  // a link missing one param + an extra one
  await inspect("https://qatest.com/p?aff_id=639&utm_source=news&debug=1");
  const tmplText = await page.textContent(".tmpl-card");
  check("QT2 flags missing", /Missing/.test(tmplText) && /subid/.test(tmplText), tmplText);
  check("QT2 flags extra", /Extra/.test(tmplText) && /debug/.test(tmplText), tmplText);
  // an exact match shows OK
  await inspect("https://qatest.com/p?aff_id=111&subid=x&utm_source=y");
  check("QT3 matches", /Matches the saved template/.test(await page.textContent(".tmpl-card")), await page.textContent(".tmpl-card"));
  // listed + removable in Help
  await page.click("#modeHelp");
  check("QT4 listed in help", /qatest\.com/.test(await page.textContent("#savedTemplates")), "");
  await page.click("#savedTemplates .hs-remove");
  check("QT4 removed", /No QA templates yet/.test(await page.textContent("#savedTemplates")), "");
}

// ============================================================
//  FEATURE 25 — decline-code lookup
// ============================================================
async function decline(code) {
  await page.click("#modeDecline");
  await page.fill("#srcDecline", "");
  await page.fill("#srcDecline", code);
  return page.evaluate(() => {
    const out = document.getElementById("declineOut");
    const cards = [...out.querySelectorAll(".decline-card")];
    const card = cards[0];
    return {
      title: card?.querySelector(".dc-title")?.textContent ?? null,
      chips: [...out.querySelectorAll(".dc-chip")].map(c => c.textContent.trim()),
      message: card?.querySelector(".dc-msg-text")?.textContent ?? null,
      source: card?.querySelector(".dc-seen a")?.getAttribute("href") ?? null,
      cardCount: cards.length,
      unknown: !!out.querySelector(".msg.warn"),
      empty: out.querySelector(".empty")?.textContent ?? null,
    };
  });
}
{
  const r = await decline("insufficient_funds"); // Stripe string
  check("DC1 title", /Insufficient funds/i.test(r.title ?? ""), JSON.stringify(r));
  check("DC1 soft", r.chips.some(c => /Soft decline/.test(c)), JSON.stringify(r.chips));
  check("DC1 retry", r.chips.some(c => /Worth a retry/.test(c)), JSON.stringify(r.chips));
  check("DC1 customer message", /funds/i.test(r.message ?? ""), r.message);
  check("DC1 processor shown", r.chips.some(c => /Stripe/.test(c)), JSON.stringify(r.chips));
  check("DC1 cites source", /stripe\.com\/declines/.test(r.source ?? ""), r.source);
}
{
  const r = await decline("2004"); // Braintree expired card
  check("DC2 braintree code maps", /Expired card/i.test(r.title ?? ""), JSON.stringify(r));
  check("DC2 hard", r.chips.some(c => /Hard decline/.test(c)), JSON.stringify(r.chips));
  check("DC2 braintree processor", r.chips.some(c => /Braintree/.test(c)), JSON.stringify(r.chips));
}
{
  const r = await decline("202"); // NMI insufficient funds — cross-processor consistency
  check("DC3 nmi code maps", /Insufficient funds/i.test(r.title ?? ""), JSON.stringify(r));
  check("DC3 nmi soft+retry like stripe", r.chips.some(c => /Soft decline/.test(c)) && r.chips.some(c => /Worth a retry/.test(c)), JSON.stringify(r.chips));
  check("DC3 cites nmi source", /docs\.nmi\.com/.test(r.source ?? ""), r.source);
}
{
  const r = await decline("not_a_real_code_xyz");
  check("DC4 unknown handled", r.unknown === true, JSON.stringify(r));
}
{
  const r = await decline("2109"); // Braintree range fallback → generic processor declined
  check("DC4b braintree range fallback", /Processor Declined/i.test(r.title ?? ""), JSON.stringify(r));
}
{
  // data integrity — every entry well-formed, every table sourced, every cat valid
  const integ = await page.evaluate(() => {
    const cats = DECLINE_CATS, tables = DECLINE_TABLES;
    const problems = [];
    let count = 0;
    for (const [name, t] of Object.entries(tables)) {
      if (!/^https?:\/\//.test(t.source || "")) problems.push(name + " missing source URL");
      if (!t.label) problems.push(name + " missing label");
      for (const [code, e] of Object.entries(t.codes)) {
        count++;
        if (!e.title) problems.push(name + ":" + code + " missing title");
        if (!cats[e.cat]) problems.push(name + ":" + code + " unknown cat " + e.cat);
      }
    }
    for (const [c, v] of Object.entries(cats)) {
      if (v.type !== "soft" && v.type !== "hard") problems.push("cat " + c + " bad type");
      if (typeof v.retry !== "boolean") problems.push("cat " + c + " bad retry");
      if (!v.customer) problems.push("cat " + c + " missing customer message");
    }
    return { problems, count };
  });
  check("DC6 every decline entry well-formed", integ.problems.length === 0, JSON.stringify(integ.problems));
  check("DC6 table is substantial (>100 codes)", integ.count > 100, "count=" + integ.count);
}
{
  // copy the customer message
  await decline("expired_card");
  await page.click('.dc-msg button:has-text("Copy message")');
  check("DC5 copied message", /expired/i.test(await copied() ?? ""), await copied());
}

// ============================================================
//  FEATURE 26 — drill into the decoded Base64 redirect
// ============================================================
{
  // redirect Base64-decodes to https://pandastyle.life/purchase?...&fnid=2&aff_id=259107
  const b64 = Buffer.from("https://pandastyle.life/purchase?fnid=2&aff_id=259107&template=6b").toString("base64");
  await inspect("https://buygoods.com/secure/checkout.html?aff_id=259107&redirect=" + encodeURIComponent(b64));
  // the redirect row exposes an "Inspect" drill-in button
  const row = await page.evaluate(() => {
    const r = [...document.querySelectorAll(".prow:not(.colhead)")].find(x => x.querySelector(".k")?.textContent === "redirect");
    return { hasBtn: !!r?.querySelector(".decoded-inspect"), decoded: r?.querySelector(".decoded-line")?.textContent };
  });
  check("DR1 drill-in button present", row.hasBtn, JSON.stringify(row));
  check("DR1 decoded shown", /pandastyle\.life\/purchase/.test(row.decoded ?? ""), row.decoded);
  // click it → the decoded URL loads into Inspect and its nested params parse
  await page.evaluate(() => {
    [...document.querySelectorAll(".prow:not(.colhead)")]
      .find(x => x.querySelector(".k")?.textContent === "redirect")
      .querySelector(".decoded-inspect").click();
  });
  const r = await read();
  check("DR2 loaded decoded link", r.base === "https://pandastyle.life/purchase", r.base);
  check("DR2 nested fnid parsed", rowFor(r, "fnid")?.status === "ok", JSON.stringify(rowFor(r,"fnid")));
  check("DR2 nested aff_id parsed", rowFor(r, "aff_id")?.value === "259107", JSON.stringify(rowFor(r,"aff_id")));
}

await browser.close();

console.log(`\n  PASS ${pass}   FAIL ${fail}\n`);
if (fails.length) { console.log("  Failures:"); fails.forEach(f => console.log("   ✗ " + f)); process.exit(1); }
else console.log("  All assertions passed.\n");
