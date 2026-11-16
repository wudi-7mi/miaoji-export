"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const shared = require("../shared.js");
const exporter = require("../exporter.js");
test("domain normalization, tenant matching and lookalike rejection", () => {
  assert.deepEqual(shared.readDomains("HTTPS://Example.COM/minutes/demo\n*.example.com\nxfchat.iflytek.com"), ["example.com", "xfchat.iflytek.com"]);
  assert.equal(shared.matchesDomain("tenant.xfchat.iflytek.com", "xfchat.iflytek.com"), true);
  for (const host of ["evilxfchat.iflytek.com", "xfchat.iflytek.com.evil.com"]) assert.equal(shared.matchesDomain(host, "xfchat.iflytek.com"), false);
  for (const value of ["https://user:password@example.com", "http://example.com", "<all_urls>", "example.com:1234", "*.com", "127.0.0.1", "example..com"]) assert.throws(() => shared.normalizeDomain(value));
  assert.equal(shared.allowed("https://tenant.xfchat.iflytek.com/minutes/demo", shared.DEFAULTS), true);
  assert.equal(shared.allowed("https://tenant.xfchat.iflytek.com/docx/demo", shared.DEFAULTS), false);
  assert.equal(shared.allowed("https://tenant.xfchat.iflytek.com/minutes/", shared.DEFAULTS), false);
  assert.equal(shared.allowed("https://tenant.xfchat.iflytek.com/minutes/demo", { ...shared.DEFAULTS, enabled: false }), false);
});
test("timestamps retain zero, long recordings and fractions", () => {
  assert.equal(exporter.parseTime("00:00"), 0);
  assert.equal(exporter.parseTime("92:03.5"), 5523500);
  assert.equal(exporter.parseTime("01:02:03,045"), 3723045);
  for (const value of ["hello", "12:99", "1:67:01", "", null]) assert.equal(exporter.parseTime(value), null);
  assert.equal(exporter.formatTime(3723045), "01:02:03");
});
test("exports preserve text, escape Markdown and retain JSON structure", () => {
  const record = { schemaVersion: 1, title: "会议 <草稿>", sourceUrl: "https://example.com/minutes/test", capturedAt: "2026-01-01T00:00:00Z", warnings: ["仅当前已加载内容"], segments: [{ speaker: "张*三", startMs: 0, text: "# 标题\n<iframe>\n- 列表\n正常中文🙂" }] };
  const md = exporter.serialize(record, "md").text;
  assert.ok(md.includes("**00:00 · 张\\*三**")); assert.ok(md.includes("\\<iframe\\>")); assert.ok(md.includes("\\# 标题"));
  const txt = exporter.serialize(record, "txt", { speaker: false, timestamp: false, metadata: false }).text;
  assert.ok(txt.includes(record.segments[0].text)); assert.ok(!txt.includes("张*三")); assert.ok(!txt.includes(record.sourceUrl)); assert.ok(txt.includes("仅当前已加载内容"));
  assert.deepEqual(JSON.parse(exporter.serialize(record, "json").text), record);
  assert.equal(exporter.escapeMarkdown("1. 正文\n2) 正文"), "1\\. 正文\n2\\) 正文");
  assert.throws(() => exporter.serialize({ segments: [] }, "md"));
});
test("filenames work on Windows", () => {
  assert.equal(exporter.filename("CON", "md"), "_CON.md");
  assert.equal(exporter.filename('会议:/?*. ', "txt"), "会议____.txt");
  assert.equal(exporter.filename("", "json"), "妙记文字记录.json");
});
