(function (scope) {
  "use strict";
  function parseTime(value) {
    const match = String(value || "").trim().match(/^(?:(\d{1,3}):)?(\d{1,3}):([0-5]\d)(?:[.,](\d{1,3}))?$/);
    if (!match || (match[1] && Number(match[2]) > 59)) return null;
    return ((Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000) + Number((match[4] || "").padEnd(3, "0"));
  }
  function formatTime(ms) {
    if (!Number.isFinite(ms) || ms < 0) return "";
    const seconds = Math.floor(ms / 1000);
    const pad = value => String(value).padStart(2, "0");
    return seconds >= 3600 ? `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}` : `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
  }
  function escapeMarkdown(value) {
    return String(value).replace(/([\\`*_{}\[\]<>#!|~])/g, "\\$1")
      .replace(/^([ \t]*)([-+])(?=\s)/gm, "$1\\$2")
      .replace(/^([ \t]*\d+)([.)])(?=\s)/gm, "$1\\$2");
  }
  function filename(title, extension) {
    let name = String(title || "妙记文字记录").replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, "_").replace(/[.\s]+$/g, "").trim();
    name = Array.from(name).slice(0, 90).join("") || "妙记文字记录";
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = "_" + name;
    return name + "." + extension;
  }
  function serialize(record, format = "md", options = {}) {
    if (!record?.segments?.length) throw new Error("没有可导出的文字记录");
    const settings = { speaker: true, timestamp: true, metadata: true, ...options };
    if (format === "json") return { text: JSON.stringify(record, null, 2) + "\n", mime: "application/json;charset=utf-8", filename: filename(record.title, "json") };
    if (!["md", "txt"].includes(format)) throw new Error("不支持的导出格式");
    const markdown = format === "md";
    const escape = markdown ? escapeMarkdown : String;
    const lines = [markdown ? "# " + escape(record.title) : record.title, ""];
    if (settings.metadata) {
      lines.push("来源：" + record.sourceUrl, "采集时间：" + record.capturedAt, "");
    }
    for (const warning of record.warnings || []) lines.push((markdown ? "> " : "提示：") + escape(warning), "");
    for (const segment of record.segments) {
      const label = [settings.timestamp ? formatTime(segment.startMs) : "", settings.speaker ? segment.speaker : ""].filter(Boolean).map(escape).join(" · ");
      if (label) lines.push(markdown ? "**" + label + "**" : label);
      lines.push(escape(segment.text), "");
    }
    return { text: lines.join("\n"), mime: (markdown ? "text/markdown" : "text/plain") + ";charset=utf-8", filename: filename(record.title, format) };
  }
  const api = { parseTime, formatTime, escapeMarkdown, filename, serialize };
  scope.MiaojiExporter = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
