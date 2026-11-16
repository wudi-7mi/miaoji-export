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

function sampleRecord() {
  return { schemaVersion: 1, title: "讨论记录", sourceUrl: "https://example.com/minutes/test", capturedAt: "2026-01-01T00:00:00Z", warnings: [], segments: [
    { id: "1", speaker: "甲", startMs: 0, text: "你" },
    { id: "2", speaker: "甲", startMs: 10000, text: "好。" },
    { id: "3", speaker: "乙", startMs: 20000, text: "Hello" },
    { id: "4", speaker: "乙", startMs: 30000, text: "world." },
    { id: "5", speaker: "甲", startMs: 40000, text: "另一轮发言。" },
    { id: "6", speaker: "", startMs: 50000, text: "未知发言人一。" },
    { id: "7", speaker: "", startMs: null, text: "未知发言人二。" }
  ] };
}
test("merging preserves text, source IDs, turn boundaries and original records", () => {
  const record = sampleRecord(), before = JSON.stringify(record);
  const output = exporter.prepare(record, { mergeConsecutive: true });
  assert.equal(output.segments.length, 5);
  assert.equal(output.segments[0].text, "你好。");
  assert.equal(output.segments[1].text, "Hello world.");
  assert.deepEqual(output.segments[0].sourceIds, ["1", "2"]);
  assert.equal(output.segments[0].lastStartMs, 10000);
  assert.equal(output.segments[0].sourceCount, 2);
  assert.ok(exporter.serialize(record, "md", { mergeConsecutive: true }).text.includes("00:00–00:10"));
  assert.equal(JSON.stringify(record), before);
  const english = { ...record, segments: [
    { speaker: "A", startMs: 0, text: "First sentence." }, { speaker: "A", startMs: 1000, text: "Next sentence." }
  ] };
  assert.equal(exporter.prepare(english, { mergeConsecutive: true }).segments[0].text, "First sentence. Next sentence.");
});
test("speaker filtering never joins originally separated turns", () => {
  const output = exporter.prepare(sampleRecord(), { speakers: ["甲"], mergeConsecutive: true });
  assert.equal(output.segments.length, 2);
  assert.equal(output.segments[0].text, "你好。");
  assert.equal(output.segments[1].text, "另一轮发言。");
  assert.equal(output.exportSelection.selectedCount, 3);
  assert.equal(exporter.prepare(sampleRecord(), { speakers: [""] }).segments.length, 2);
});
test("time filtering uses inclusive start times and reports missing timestamps", () => {
  const output = exporter.prepare(sampleRecord(), { fromMs: 20000, toMs: 30000 });
  assert.deepEqual(output.segments.map(segment => segment.id), ["3", "4"]);
  assert.ok(output.warnings.some(value => value.includes("缺少时间戳")));
  assert.equal(exporter.prepare(sampleRecord(), { fromMs: 0, toMs: 0 }).segments[0].id, "1");
  for (const options of [{ fromMs: 2, toMs: 1 }, { fromMs: -1 }, { toMs: NaN }, { speakers: [] }, { fromMs: 999999 }]) assert.throws(() => exporter.prepare(sampleRecord(), options));
});
test("combined exports preserve notes structure and apply selections to JSON", () => {
  const record = sampleRecord();
  record.meetingNotes = { status: "captured", text: "决策\n保留 <原文>\n行动项", blocks: [
    { type: "heading", level: 1, text: "决策" }, { type: "paragraph", text: "保留 <原文>" }, { type: "list-item", text: "行动项" }
  ] };
  const options = { speakers: ["甲"], mergeConsecutive: true, includeNotes: true };
  const markdown = exporter.serialize(record, "md", options).text;
  assert.ok(markdown.includes("## 会议纪要\n\n### 决策"));
  assert.ok(markdown.includes("保留 \\<原文\\>"));
  assert.ok(markdown.indexOf("## 会议纪要") < markdown.indexOf("## 文字记录"));
  assert.ok(markdown.includes("纪要保留全文"));
  const json = JSON.parse(exporter.serialize(record, "json", options).text);
  assert.equal(json.segments.length, 2); assert.ok(json.segments.every(segment => segment.speaker === "甲"));
  assert.deepEqual(json.meetingNotes, record.meetingNotes);
  for (const format of ["md", "txt", "json"]) {
    const output = exporter.serialize(record, format, { ...options, includeNotes: false }).text;
    assert.ok(!output.includes("行动项")); assert.ok(!output.includes("保留 <原文>"));
  }
});
test("empty or uncaptured notes are reported without fabricated content", () => {
  const record = sampleRecord();
  record.meetingNotes = { status: "empty", blocks: [], text: "", message: "本妙记的会议纪要暂无内容。" };
  const output = exporter.serialize(record, "md", { includeNotes: true }).text;
  assert.ok(output.includes("会议纪要暂无内容")); assert.ok(!output.includes("## 会议纪要"));
  assert.ok(exporter.serialize(sampleRecord(), "txt", { includeNotes: true }).text.includes("尚未采集会议纪要"));
});
