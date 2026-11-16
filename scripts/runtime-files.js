"use strict";
const fs = require("node:fs");
const path = require("node:path");
const FILES = Object.freeze(["manifest.json", "shared.js", "exporter.js", "extractor.js", "content.js", "background.js", "popup.html", "popup.css", "popup.js", "icons", "LICENSE", "PRIVACY.md"]);
function copyRuntime(root, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const file of FILES) fs.cpSync(path.join(root, file), path.join(destination, file), { recursive: true });
}
module.exports = { FILES, copyRuntime };
