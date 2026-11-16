"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { FILES, copyRuntime } = require("./runtime-files.js");
const root = path.resolve(__dirname, "..");
const destination = path.resolve(process.env.LOCALAPPDATA || path.join(root, "dist"), "MiaojiExport", "edge");
execFileSync(process.execPath, [path.join(__dirname, "check.js")], { stdio: "inherit", windowsHide: true });
// This is a dedicated generated directory. Refuse to overwrite unrelated
// content, and never recursively delete or replace a user-selected path.
if (fs.existsSync(destination)) {
  const unexpected = fs.readdirSync(destination).filter(name => !FILES.includes(name) && name !== "_metadata");
  if (unexpected.length) throw new Error("加载目录包含非插件文件，请先检查：" + destination);
}
copyRuntime(root, destination);
function measure(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { const child = measure(file); total.files += child.files; total.bytes += child.bytes; }
    else { total.files++; total.bytes += fs.statSync(file).size; }
    return total;
  }, { files: 0, bytes: 0 });
}
console.log(destination);
console.log(JSON.stringify(measure(destination)));
