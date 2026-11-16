"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
execFileSync(process.execPath, [path.join(__dirname, "check.js")], { stdio: "inherit", windowsHide: true });
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const staging = fs.mkdtempSync(path.join(os.tmpdir(), "miaoji-package-"));
const files = ["manifest.json", "shared.js", "exporter.js", "extractor.js", "content.js", "background.js", "popup.html", "popup.css", "popup.js", "icons", "LICENSE", "PRIVACY.md"];
try {
  for (const file of files) fs.cpSync(path.join(root, file), path.join(staging, file), { recursive: true });
  fs.mkdirSync(path.join(root, "dist"), { recursive: true });
  const archive = path.join(root, "dist", `miaoji-export-edge-${manifest.version}.zip`);
  const quote = value => "'" + value.replace(/'/g, "''") + "'";
  execFileSync("powershell.exe", ["-NoProfile", "-Command", "Compress-Archive -Path " + quote(path.join(staging, "*")) + " -DestinationPath " + quote(archive) + " -Force"], { stdio: "inherit", windowsHide: true });
  console.log(archive);
} finally { fs.rmSync(staging, { recursive: true, force: true }); }
