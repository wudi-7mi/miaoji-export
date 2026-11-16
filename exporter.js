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
  function prepare(record, options = {}) {
    if (!record?.segments?.length) throw new Error("没有可导出的文字记录");
    const fromMs = options.fromMs ?? null, toMs = options.toMs ?? null;
    for (const boundary of [fromMs, toMs]) if (boundary !== null && (!Number.isFinite(boundary) || boundary < 0)) throw new Error("时间范围必须是有效的非负时间");
    if (fromMs !== null && toMs !== null && fromMs > toMs) throw new Error("开始时间不能晚于结束时间");
    if (options.speakers != null && !Array.isArray(options.speakers)) throw new Error("发言人筛选必须是列表");
    const speakers = options.speakers == null ? null : new Set(options.speakers);
    const timeFiltered = fromMs !== null || toMs !== null;
    const filtered = timeFiltered || speakers !== null;
    const warnings = [...(record.warnings || [])];
    let missingTime = 0, selectedCount = 0, previousIndex = -2;
    const segments = [];
    record.segments.forEach((segment, index) => {
      if (speakers && !speakers.has(segment.speaker || "")) return;
      if (timeFiltered && !Number.isFinite(segment.startMs)) { missingTime++; return; }
      if (fromMs !== null && segment.startMs < fromMs || toMs !== null && segment.startMs > toMs) return;
      selectedCount++;
      const previous = segments.at(-1);
      // Keep original adjacency: filtering out another speaker must not join
      // two separate turns by the same speaker.
      if (options.mergeConsecutive && previous && segment.speaker && previous.speaker === segment.speaker && previousIndex === index - 1) {
        const tail = previous.text.match(/([\p{L}\p{N}])[.!?,;:)"']*$/u)?.[1];
        const head = segment.text.match(/^([\p{L}\p{N}])/u)?.[1];
        const wordBoundary = tail && head && !/\p{Script=Han}/u.test(tail) && !/\p{Script=Han}/u.test(head);
        previous.text += (wordBoundary ? " " : "") + segment.text;
        previous.lastStartMs = segment.startMs;
        previous.sourceIds.push(segment.id ?? null);
        previous.sourceCount++;
      } else {
        segments.push(options.mergeConsecutive ? { ...segment, sourceIds: [segment.id ?? null], sourceCount: 1, lastStartMs: segment.startMs } : { ...segment });
      }
      previousIndex = index;
    });
    if (!segments.length) throw new Error("当前筛选条件下没有文字记录，请调整发言人或时间范围");
    if (missingTime) warnings.push(`时间筛选已排除 ${missingTime} 段缺少时间戳的文字。`);
    if (filtered) warnings.push(`文字记录已筛选：原 ${record.segments.length} 段，选中 ${selectedCount} 段；时间条件按段落起始时间判断，包含边界。`);
    const output = { ...record, segments };
    if (filtered || options.mergeConsecutive) output.exportSelection = { speakers: speakers ? [...speakers] : null, fromMs, toMs, mergeConsecutive: Boolean(options.mergeConsecutive), originalCount: record.segments.length, selectedCount, outputCount: segments.length };
    if (options.includeNotes === false) delete output.meetingNotes;
    else if (record.meetingNotes) {
      if (record.meetingNotes.status !== "captured") warnings.push(record.meetingNotes.message || "会议纪要暂无内容。");
      else if (filtered) warnings.push("筛选仅作用于文字记录，会议纪要保留全文。");
    } else if (options.includeNotes === true) {
      warnings.push("本次尚未采集会议纪要，请勾选「同时采集会议纪要」后重新采集。");
    }
    if (warnings.length || record.warnings) output.warnings = warnings;
    return output;
  }
  function serialize(record, format = "md", options = {}) {
    const settings = { speaker: true, timestamp: true, metadata: true, ...options };
    const output = prepare(record, settings);
    if (format === "json") return { text: JSON.stringify(output, null, 2) + "\n", mime: "application/json;charset=utf-8", filename: filename(record.title, "json") };
    if (!["md", "txt"].includes(format)) throw new Error("不支持的导出格式");
    const markdown = format === "md";
    const escape = markdown ? escapeMarkdown : String;
    const lines = [markdown ? "# " + escape(record.title) : record.title, ""];
    if (settings.metadata) {
      lines.push("来源：" + record.sourceUrl, "采集时间：" + record.capturedAt, "");
    }
    for (const warning of output.warnings || []) lines.push((markdown ? "> " : "提示：") + escape(warning), "");
    if (output.meetingNotes?.status === "captured") {
      lines.push(markdown ? "## 会议纪要" : "会议纪要", "");
      for (const block of output.meetingNotes.blocks) {
        const prefix = block.type === "heading" ? (markdown ? "#".repeat(Math.min(6, Math.max(3, (block.level || 1) + 2))) + " " : "") : block.type === "list-item" ? "- " : "";
        lines.push(prefix + escape(block.text), "");
      }
      lines.push(markdown ? "## 文字记录" : "文字记录", "");
    }
    for (const segment of output.segments) {
      const range = segment.sourceCount > 1 && Number.isFinite(segment.startMs) && Number.isFinite(segment.lastStartMs) && segment.lastStartMs !== segment.startMs
        ? formatTime(segment.startMs) + "–" + formatTime(segment.lastStartMs) : formatTime(segment.startMs);
      const label = [settings.timestamp ? range : "", settings.speaker ? segment.speaker : ""].filter(Boolean).map(escape).join(" · ");
      if (label) lines.push(markdown ? "**" + label + "**" : label);
      lines.push(escape(segment.text), "");
    }
    return { text: lines.join("\n"), mime: (markdown ? "text/markdown" : "text/plain") + ";charset=utf-8", filename: filename(record.title, format) };
  }
  const api = { parseTime, formatTime, escapeMarkdown, filename, prepare, serialize };
  scope.MiaojiExporter = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
