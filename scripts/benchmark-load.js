"use strict";
// Only temporary browser profiles and about:blank; never attaches to a user profile.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { chromium } = require("@playwright/test");
const root = path.resolve(__dirname, "..");
const executablePath = process.env.EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const unpacked = path.resolve(process.env.LOCALAPPDATA || path.join(root, "dist"), "MiaojiExport", "edge");
async function measure(label, directory) {
  if (!fs.existsSync(path.join(directory, "manifest.json"))) throw new Error("先运行 npm run prepare:unpacked");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "miaoji-load-"));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, { executablePath, headless: true, ignoreDefaultArgs: ["--disable-extensions"],
      args: ["--enable-unsafe-extension-debugging", "--disable-background-networking"], timeout: 20000 });
    const session = await context.browser().newBrowserCDPSession();
    const started = performance.now();
    let timer;
    try {
      await Promise.race([session.send("Extensions.loadUnpacked", { path: directory }), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label + ": extension load timed out")), 20000);
      })]);
    } finally { clearTimeout(timer); }
    const result = { label, loadMs: Math.round(performance.now() - started) };
    console.log(JSON.stringify(result));
    return result;
  } finally {
    if (context) await context.close();
    if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir()) || !path.basename(profile).startsWith("miaoji-load-")) throw new Error("Unsafe temporary profile path");
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
(async () => {
  const results = [];
  // Alternate order to reduce the effect of filesystem cache warmup.
  const cases = process.argv.includes("--runtime-only") ? [["runtime", unpacked], ["runtime", unpacked]]
    : [["repository", root], ["runtime", unpacked], ["runtime", unpacked], ["repository", root]];
  for (const [label, directory] of cases) {
    try { results.push(await measure(label, directory)); }
    catch (error) { const failed = { label, loadMs: null, error: error.message }; results.push(failed); console.log(JSON.stringify(failed)); }
  }
  for (const label of new Set(results.map(result => result.label))) {
    const samples = results.filter(result => result.label === label && result.loadMs !== null);
    console.log(JSON.stringify({ label, successfulRuns: samples.length, failedRuns: results.filter(result => result.label === label && result.loadMs === null).length,
      averageLoadMs: samples.length ? Math.round(samples.reduce((sum, result) => sum + result.loadMs, 0) / samples.length) : null }));
  }
  if (!results.some(result => result.loadMs !== null)) process.exitCode = 1;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
