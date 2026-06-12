// Render each HTML deck to a 16:9 PDF (one slide per page).
// Usage: node presentation/build-pdf.mjs
import { chromium } from "playwright";
import path from "node:path";
import { pathToFileURL } from "node:url";

const decks = ["overview", "how-to-use"];
const dir = path.resolve("presentation");
const browser = await chromium.launch();
const page = await browser.newPage();

for (const name of decks) {
  const url = pathToFileURL(path.join(dir, name + ".html")).href;
  await page.goto(url, { waitUntil: "networkidle" });
  await page.emulateMedia({ media: "print" });
  await page.pdf({
    path: path.join(dir, name + ".pdf"),
    preferCSSPageSize: true,   // honour @page { size: 1280px 720px }
    printBackground: true,
  });
  console.log("✓ " + name + ".pdf");
}

await browser.close();
