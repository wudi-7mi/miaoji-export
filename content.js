(function () {
  "use strict";
  if (globalThis.__miaojiExport) { globalThis.__miaojiExport.refresh(); return; }
  let settings = { ...MiaojiShared.DEFAULTS }, host, shadow, controller, record, route = location.href;
  let activeRequest = 0;
  const css = `:host{all:initial;font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;color:#1f2329}*{box-sizing:border-box}button,select,input,textarea{font:inherit}button{cursor:pointer;border:1px solid #d0d5dd;border-radius:7px;background:white;color:#344054;padding:8px 14px}button:hover{background:#f5f7fa}button:disabled{opacity:.5;cursor:not-allowed}.primary{background:#3370ff;color:white;border-color:#3370ff}.primary:hover{background:#245bdb}.launcher{position:fixed;right:24px;bottom:24px;z-index:2147483646;box-shadow:0 4px 18px #1d29392b;padding:11px 19px}.backdrop{position:fixed;inset:0;background:#10182855;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:24px}.panel{width:700px;max-width:100%;max-height:90vh;overflow:auto;background:white;border-radius:12px;box-shadow:0 18px 60px #10182838;padding:24px}header{display:flex;justify-content:space-between;gap:20px;align-items:center}h2{margin:0;font-size:20px}p{margin:7px 0 16px;color:#667085;font-size:13px}.close{border:0;font-size:22px;padding:0 8px}.controls{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin:16px 0}label{display:flex;gap:6px;align-items:center;font-size:13px}select{padding:6px 10px;border:1px solid #d0d5dd;border-radius:6px}textarea{width:100%;height:260px;resize:vertical;border:1px solid #d0d5dd;border-radius:7px;padding:12px;font:13px/1.7 Consolas,"Microsoft YaHei",monospace;color:#344054;background:#fafbfc}footer{display:flex;justify-content:flex-end;gap:10px;margin-top:16px}.status{font-size:13px;color:#475467;white-space:pre-wrap;min-height:24px}.error{color:#b42318}.warnings{font-size:12px;color:#985b10;white-space:pre-wrap;margin:8px 0}.hidden,[hidden]{display:none!important}button:focus-visible,textarea:focus-visible,select:focus-visible{outline:2px solid #3370ff;outline-offset:3px}@media(prefers-reduced-motion:no-preference){.panel{animation:appear .12s ease-out}@keyframes appear{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}}`;
  function $(id) { return shadow?.getElementById(id); }
  function status(message, error = false) { if ($("status")) { $("status").textContent = message; $("status").classList.toggle("error", error); } }
  function options() {
    const choices = [...$("speaker-filters").querySelectorAll("input")];
    const selected = choices.filter(input => input.checked).map(input => input.value);
    function boundary(id) {
      const value = $(id).value.trim();
      if (!value) return null;
      const parsed = MiaojiExporter.parseTime(value);
      if (parsed === null) throw new Error("时间请输入 MM:SS 或 HH:MM:SS，例如 05:00、01:20:00");
      return parsed;
    }
    return { speaker: $("speaker").checked, timestamp: $("timestamp").checked, metadata: $("metadata").checked,
      includeNotes: $("include-notes").checked, mergeConsecutive: $("merge").checked,
      speakers: selected.length === choices.length ? null : selected, fromMs: boundary("from"), toMs: boundary("to") };
  }
  function renderSpeakers() {
    const container = $("speaker-filters"); container.replaceChildren();
    const counts = new Map();
    for (const segment of record.segments) counts.set(segment.speaker || "", (counts.get(segment.speaker || "") || 0) + 1);
    for (const [speaker, count] of counts) {
      const label = document.createElement("label"); label.className = "chip";
      const input = document.createElement("input"); input.type = "checkbox"; input.checked = true; input.value = speaker;
      input.addEventListener("change", updatePreview);
      label.append(input, document.createTextNode((speaker || "未识别发言人") + ` (${count})`)); container.append(label);
    }
  }
  function updatePreview() {
    if (!record) return;
    try {
      const selected = options(), prepared = MiaojiExporter.prepare(record, selected);
      $("preview").value = MiaojiExporter.serialize(record, $("format").value, selected).text;
      $("warnings").textContent = (prepared.warnings || []).join("\n");
      const count = prepared.exportSelection?.selectedCount ?? prepared.segments.length;
      $("preview-state").textContent = `原始 ${record.segments.length} 段 · 选中 ${count} 段 · 导出 ${prepared.segments.length} 段`;
      $("preview-state").classList.remove("error");
      $("notes-state").textContent = !selected.includeNotes ? "本次导出不含会议纪要。" : record.meetingNotes?.status === "captured"
        ? `已采集会议纪要 ${record.meetingNotes.text.length.toLocaleString()} 字符；筛选仅作用于文字记录。`
        : record.meetingNotes?.message || "本次未采集纪要，勾选后重新采集即可。";
      $("download").disabled = Boolean(controller); $("copy").disabled = Boolean(controller);
    } catch (error) {
      $("preview").value = ""; $("preview-state").textContent = error.message; $("preview-state").classList.add("error");
      $("download").disabled = true; $("copy").disabled = true;
    }
  }
  function busy(value) {
    $("capture").disabled = value; $("cancel").hidden = !value;
    for (const input of shadow.querySelectorAll("input,select,#all-speakers")) input.disabled = value;
    if (value || !record) { $("download").disabled = true; $("copy").disabled = true; }
    else updatePreview();
  }
  async function capture() {
    controller?.abort();
    const current = ++activeRequest;
    const localController = new AbortController(); controller = localController;
    record = null; $("preview").value = ""; $("warnings").textContent = ""; $("preview-state").textContent = "";
    $("speaker-filters").replaceChildren(); $("notes-state").textContent = "";
    busy(true); status("正在识别文字记录…");
    try {
      const result = await MiaojiExtractor.captureMeeting({ custom: settings.selectors, full: $("full").checked,
        includeNotes: $("include-notes").checked, signal: localController.signal,
        onProgress: progress => status(progress.stage === "notes" ? "文字记录采集完成，正在读取会议纪要…" : `正在采集：${progress.count} 段 · ${progress.progress}%`) });
      if (current !== activeRequest || !host) return;
      record = result; renderSpeakers();
      status(`已采集 ${result.segments.length} 段 · ${result.segments.reduce((sum, item) => sum + item.text.length, 0).toLocaleString()} 字符`);
      updatePreview();
    } catch (error) {
      if (current !== activeRequest || !host) return;
      status(error.name === "AbortError" ? "已取消采集，可以重新开始。" : error.message, error.name !== "AbortError");
    } finally {
      if (current === activeRequest && host) { controller = null; busy(false); }
    }
  }
  function close() { controller?.abort(); $("dialog").hidden = true; $("open").focus(); }
  function open() {
    if (!MiaojiShared.allowed(location.href, settings)) return false;
    if (!host) mount();
    $("dialog").hidden = false; $("capture").focus(); return true;
  }
  function download() {
    if (!record || controller) return;
    try {
      const output = MiaojiExporter.serialize(record, $("format").value, options());
      const url = URL.createObjectURL(new Blob([output.text], { type: output.mime }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = output.filename;
      shadow.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      status("已发起下载：" + output.filename);
    } catch (error) { status(error.message, true); }
  }
  function mount() {
    if (host?.isConnected) return;
    host = document.createElement("div"); host.id = "miaoji-export-host";
    shadow = host.attachShadow({ mode: "open" });
    const extraCss = `.panel{width:780px;max-height:92vh}textarea{height:230px}input[type=text]{width:125px;padding:6px 9px;border:1px solid #d0d5dd;border-radius:6px}.hint{font-size:12px;color:#667085;margin:6px 0}.filters{border:1px solid #e4e7ec;border-radius:8px;padding:12px 14px;margin:12px 0;background:#fbfcfe}fieldset{border:0;padding:0;margin:0;min-width:0}legend{font-size:13px;font-weight:600;margin-bottom:7px}.chips{display:flex;gap:8px;flex-wrap:wrap}.chip{border:1px solid #e4e7ec;border-radius:6px;padding:4px 8px;background:white}.small{padding:3px 9px;font-size:12px}`;
    shadow.innerHTML = `<style>${css}${extraCss}</style><button id="open" class="launcher primary" type="button">导出文字记录</button>
      <div id="dialog" class="backdrop" hidden><section class="panel" role="dialog" aria-modal="true" aria-labelledby="heading">
      <header><h2 id="heading">导出妙记</h2><button id="close" class="close" aria-label="关闭" type="button">×</button></header>
      <p>采集时请将此标签页保持在前台。插件会读取文字记录及勾选的纪要，结束后恢复原标签和滚动位置。</p>
      <div class="controls"><label><input type="checkbox" id="full" checked>滚动采集长记录</label><label><input type="checkbox" id="include-notes" checked>同时采集会议纪要</label><button id="capture" class="primary" type="button">开始采集</button><button id="cancel" type="button" hidden>取消</button></div>
      <div id="status" class="status" role="status" aria-live="polite">等待采集</div><div id="notes-state" class="hint"></div>
      <div class="filters"><fieldset><legend>筛选发言人 <button id="all-speakers" class="small" type="button">全选</button></legend><div id="speaker-filters" class="chips">采集后可选择发言人</div></fieldset>
      <div class="controls"><label>开始 <input id="from" type="text" placeholder="00:00" aria-label="开始时间" spellcheck="false"></label><label>结束 <input id="to" type="text" placeholder="不限" aria-label="结束时间" spellcheck="false"></label><label><input id="merge" type="checkbox" checked>合并连续同人发言</label></div>
      <p class="hint">按段落起始时间筛选，含起止边界；留空不限。合并仅连接原记录中的相邻同人发言，时间范围表示首末段起始时间。</p></div>
      <div class="controls"><label>格式 <select id="format"><option value="md">Markdown (.md)</option><option value="txt">纯文本 (.txt)</option><option value="json">结构数据 (.json)</option></select></label>
      <label><input id="speaker" type="checkbox" checked>发言人</label><label><input id="timestamp" type="checkbox" checked>时间戳</label><label><input id="metadata" type="checkbox" checked>来源信息</label></div>
      <div id="preview-state" class="status" role="status" aria-live="polite"></div><div id="warnings" class="warnings"></div>
      <p class="hint">筛选、合并和纪要选项同样应用于 JSON；JSON 始终保留所选记录的结构字段。</p><textarea id="preview" readonly aria-label="导出预览" placeholder="采集结果会显示在这里"></textarea>
      <footer><button id="copy" disabled type="button">复制文本</button><button id="download" class="primary" disabled type="button">下载文件</button></footer></section></div>`;
    document.documentElement.append(host);
    $("open").addEventListener("click", open); $("close").addEventListener("click", close);
    $("capture").addEventListener("click", capture); $("cancel").addEventListener("click", () => controller?.abort());
    $("download").addEventListener("click", download);
    $("copy").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText($("preview").value); status("已复制导出文本"); } catch (_) { status("复制失败，请选中预览文本手动复制。", true); }
    });
    for (const id of ["format", "speaker", "timestamp", "metadata", "merge", "include-notes"]) $(id).addEventListener("change", updatePreview);
    for (const id of ["from", "to"]) $(id).addEventListener("input", updatePreview);
    $("all-speakers").addEventListener("click", () => { for (const input of $("speaker-filters").querySelectorAll("input")) input.checked = true; updatePreview(); });
    $("dialog").addEventListener("click", event => { if (event.target === $("dialog")) close(); });
    shadow.addEventListener("keydown", event => {
      if ($("dialog").hidden) return;
      if (event.key === "Escape") { event.stopPropagation(); close(); }
      if (event.key === "Tab") {
        const controls = [...$("dialog").querySelectorAll("button, input, textarea, select")].filter(node => !node.disabled && node.getClientRects().length);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && shadow.activeElement === first) { event.preventDefault(); last.focus(); }
        if (!event.shiftKey && shadow.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });
  }
  function remove() {
    controller?.abort(); controller = null; activeRequest++; record = null;
    host?.remove(); host = null; shadow = null;
  }
  async function refresh() {
    try {
      settings = await chrome.storage.sync.get(MiaojiShared.DEFAULTS);
      MiaojiShared.allowed(location.href, settings) ? mount() : remove();
    } catch (_) { remove(); }
  }
  globalThis.__miaojiExport = { refresh, open };
  chrome.storage.onChanged.addListener((changes, area) => { if (area === "sync" && (changes.domains || changes.enabled || changes.selectors)) refresh(); });
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.type !== "miaoji:open") return;
    refresh().then(() => respond({ opened: open() })); return true;
  });
  // Detect SPA navigation without modifying the site's history methods.
  setInterval(() => { if (route !== location.href) { route = location.href; remove(); refresh(); } }, 750);
  refresh();
})();
