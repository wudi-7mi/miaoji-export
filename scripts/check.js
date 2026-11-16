"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
assert.equal(manifest.manifest_version, 3);
const files = [manifest.background.service_worker, manifest.action.default_popup, manifest.options_page, ...Object.values(manifest.icons), ...manifest.content_scripts.flatMap(script => script.js), "popup.js", "popup.css"];
for (const file of new Set(files)) assert.ok(fs.existsSync(path.join(root, file)), "Missing file: " + file);
for (const file of fs.readdirSync(root).filter(name => name.endsWith(".js"))) execFileSync(process.execPath, ["--check", path.join(root, file)], { stdio: "pipe", windowsHide: true });
for (const [size, file] of Object.entries(manifest.icons)) {
  const bytes = fs.readFileSync(path.join(root, file));
  assert.equal(bytes.readUInt32BE(16), Number(size)); assert.equal(bytes.readUInt32BE(20), Number(size));
}
assert.deepEqual(manifest.host_permissions, manifest.content_scripts[0].matches);
assert.ok(!manifest.permissions.includes("cookies"));
console.log("Manifest, runtime JavaScript, resources and icon dimensions passed.");
