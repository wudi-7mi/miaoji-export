(function () {
  "use strict";
  if (globalThis.__miaojiExport) { globalThis.__miaojiExport.refresh(); return; }
  let settings = { ...MiaojiShared.DEFAULTS }, host, shadow, controller, record, route = location.href;
  let activeRequest = 0;
  const css = `:host{all:initial;font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;color:#1f2329}*{box-sizing:border-box}button,select,input,textarea{font:inherit}button{cursor:pointer;border:1px solid #d0d5dd;border-radius:7px;background:white;color:#344054;padding:8px 14px}button:hover{background:#f5f7fa}button:disabled{opacity:.5;cursor:not-allowed}.primary{background:#3370ff;color:white;border-color:#3370ff}.primary:hover{background:#245bdb}.launcher{position:fixed;right:24px;bottom:24px;z-index:2147483646;box-shadow:0 4px 18px #1d29392b;padding:11px 19px}.backdrop{position:fixed;inset:0;background:#10182855;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:24px}.panel{width:700px;max-width:100%;max-height:90vh;overflow:auto;background:white;border-radius:12px;box-shadow:0 18px 60px #10182838;padding:24px}header{display:flex;justify-content:space-between;gap:20px;align-items:center}h2{margin:0;font-size:20px}p{margin:7px 0 16px;color:#667085;font-size:13px}.close{border:0;font-size:22px;padding:0 8px}.controls{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin:16px 0}label{display:flex;gap:6px;align-items:center;font-size:13px}select{padding:6px 10px;border:1px solid #d0d5dd;border-radius:6px}textarea{width:100%;height:260px;resize:vertical;border:1px solid #d0d5dd;border-radius:7px;padding:12px;font:13px/1.7 Consolas,"Microsoft YaHei",monospace;color:#344054;background:#fafbfc}footer{display:flex;justify-content:flex-end;gap:10px;margin-top:16px}.status{font-size:13px;color:#475467;white-space:pre-wrap;min-height:24px}.error{color:#b42318}.warnings{font-size:12px;color:#985b10;white-space:pre-wrap;margin:8px 0}.hidden,[hidden]{display:none!important}button:focus-visible,textarea:focus-visible,select:focus-visible{outline:2px solid #3370ff;outline-offset:3px}@media(prefers-reduced-motion:no-preference){.panel{animation:appear .12s ease-out}@keyframes appear{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}}`;
  function $(id) { return shadow?.getElementById(id); }
  function status(message, error = false) { if ($("status")) { $("status").textContent = message; $("status").classList.toggle("error", error); } }
  function options() { return { speaker: $("speaker").checked, timestamp: $("timestamp").checked, metadata: $("metadata").checked }; }
  function updatePreview() {
    if (!record) return;
    $("preview").value = MiaojiExporter.serialize(record, $("format").value, options()).text;
    $("download").disabled = false; $("copy").disabled = false;
  }
  function busy(value) {
    $("capture").disabled = value; $("cancel").hidden = !value;
    $("full").disabled = value;
    $("download").disabled = value || !record; $("copy").disabled = value || !record;
  }
  async function capture() {
    controller?.abort();
    const current = ++activeRequest;
    const localController = new AbortController(); controller = localController;
    record = null; $("preview").value = ""; $("warnings").textContent = "";
    busy(true); status("正在识别文字记录…");
    try {
      const result = await MiaojiExtractor.capture({ custom: settings.selectors, full: $("full").checked, signal: localController.signal,
        onProgress: progress => status(`正在采集：${progress.count} 段 · ${progress.progress}%`) });
      if (current !== activeRequest || !host) return;
      record = result; $("warnings").textContent = result.warnings.join("\n");
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
    const output = MiaojiExporter.serialize(record, $("format").value, options());
    const url = URL.createObjectURL(new Blob([output.text], { type: output.mime }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = output.filename;
    shadow.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    status("已发起下载：" + output.filename);
  }
  function mount() {
    if (host?.isConnected) return;
    host = document.createElement("div"); host.id = "miaoji-export-host";
    shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>${css}</style><button id="open" class="launcher primary" type="button">导出文字记录</button>
      <div id="dialog" class="backdrop" hidden><section class="panel" role="dialog" aria-modal="true" aria-labelledby="heading">
      <header><h2 id="heading">导出妙记文字记录</h2><button id="close" class="close" aria-label="关闭" type="button">×</button></header>
      <p>先切换到右侧「文字记录 / 逐字稿」，再开始采集。采集时请将此标签页保持在前台，结束后会恢复滚动位置。</p>
      <div class="controls"><label><input type="checkbox" id="full" checked>滚动采集长记录</label><button id="capture" class="primary" type="button">开始采集</button><button id="cancel" type="button" hidden>取消</button></div>
      <div id="status" class="status" role="status" aria-live="polite">等待采集</div><div id="warnings" class="warnings"></div>
      <div class="controls"><label>格式 <select id="format"><option value="md">Markdown (.md)</option><option value="txt">纯文本 (.txt)</option><option value="json">结构数据 (.json)</option></select></label>
      <label><input id="speaker" type="checkbox" checked>发言人</label><label><input id="timestamp" type="checkbox" checked>时间戳</label><label><input id="metadata" type="checkbox" checked>来源信息</label></div>
      <p>JSON 始终保留全部结构字段。预览中会提示采集范围和缺失信息。</p><textarea id="preview" readonly aria-label="导出预览" placeholder="采集结果会显示在这里"></textarea>
      <footer><button id="copy" disabled type="button">复制文本</button><button id="download" class="primary" disabled type="button">下载文件</button></footer></section></div>`;
    document.documentElement.append(host);
    $("open").addEventListener("click", open); $("close").addEventListener("click", close);
    $("capture").addEventListener("click", capture); $("cancel").addEventListener("click", () => controller?.abort());
    $("download").addEventListener("click", download);
    $("copy").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText($("preview").value); status("已复制导出文本"); } catch (_) { status("复制失败，请选中预览文本手动复制。", true); }
    });
    for (const id of ["format", "speaker", "timestamp", "metadata"]) $(id).addEventListener("change", updatePreview);
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
