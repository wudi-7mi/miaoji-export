(function (scope) {
  "use strict";
  const AUTO = {
    root: '.transcript-list, .transcript-container, .minutes-transcript, .minutes-detail-text, .paragraphs-container, [data-testid="transcript"], [data-testid="transcript-list"], [class*="transcript-content"], [class*="transcriptContent"], [class*="transcriptList"], [class*="transcript-list"]',
    row: '[data-paragraph-id], [data-sentence-id], [data-testid="transcript-paragraph"], .transcript-paragraph-item, .transcript-paragraph, .paragraph-item, .paragraph, [class*="paragraph-wrapper"], [class*="paragraphWrapper"], [class*="paragraph-item"]',
    text: '[data-testid="paragraph-text"], .mm-paragraph-content, .paragraph-content-editor, .paragraph-text, .paragraph-content, .sentence-text, .sentence, [class*="paragraphText"], [class*="paragraphContent"], [class*="sentence-text"]',
    speaker: '[data-speaker-name], [user-name-content], [data-testid="speaker-name"], .p-user-name, .speaker-name, .speaker, [class*="speaker-name"], [class*="speakerName"], [class*="speaker_name"]',
    time: '[data-start-ms], [time-content], [data-testid="timestamp"], .p-time, .timestamp, .paragraph-time, .start-time, [class*="timestamp"], [class*="startTime"], [class*="start-time"], [class*="paragraphTime"]'
  };
  const clean = value => String(value || "").replace(/\u00a0/g, " ").replace(/[\u200b\ufeff]/g, "").replace(/\r\n?/g, "\n").trim();
  const VISIBILITY_MESSAGE = "采集已停止：请将妙记标签页保持在前台，再重新开始采集。后台页面可能暂停加载文字。";
  function assertVisible() { if (document.visibilityState === "hidden") throw new Error(VISIBILITY_MESSAGE); }
  const text = node => clean(node?.innerText ?? node?.textContent);
  function visible(node) {
    if (!node?.isConnected || node.closest('#miaoji-export-host, [hidden], [aria-hidden="true"]')) return false;
    return node.getClientRects().length > 0 && getComputedStyle(node).visibility !== "hidden";
  }
  function selectors(custom = {}) {
    const merged = {};
    for (const key of Object.keys(AUTO)) {
      merged[key] = custom[key]?.trim() || AUTO[key];
      try { document.querySelector(merged[key]); } catch (_) { throw new Error("高级适配中的「" + key + "」不是有效的 CSS 选择器"); }
    }
    return merged;
  }
  function outermost(nodes) {
    const set = new Set(nodes);
    return nodes.filter(node => { for (let parent = node.parentElement; parent; parent = parent.parentElement) if (set.has(parent)) return false; return true; });
  }
  function rows(root, rules) { return outermost([...root.querySelectorAll(rules.row)].filter(visible)); }
  function timestamp(node) {
    const raw = node?.getAttribute("data-start-ms");
    if (raw !== null && raw !== undefined && raw.trim() && Number.isFinite(Number(raw)) && Number(raw) >= 0) return Number(raw);
    // Enterprise Minutes renders these attributes through CSS ::before.
    // innerText/textContent are empty even though metadata is visible.
    const label = clean(node?.getAttribute("time-content")) || text(node);
    const found = label.match(/(?:^|\s)(\d{1,3}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)(?:\s|$)/);
    return found ? MiaojiExporter.parseTime(found[1]) : null;
  }
  function readRow(node, rules) {
    const speakerNode = node.querySelector(rules.speaker);
    const timeNode = node.matches(rules.time) ? node : node.querySelector(rules.time);
    const chunks = outermost([...node.querySelectorAll(rules.text)].filter(visible));
    let body;
    if (chunks.length) body = chunks.map(text).filter(Boolean).join("\n");
    else {
      const clone = node.cloneNode(true);
      clone.querySelectorAll(rules.speaker + "," + rules.time + ',button,svg,[role="button"],[role="menu"],script,style,[hidden],[aria-hidden="true"]').forEach(child => child.remove());
      clone.querySelectorAll("br").forEach(child => child.replaceWith("\n"));
      body = clean(clone.textContent);
    }
    if (!body) return null;
    return {
      id: node.getAttribute("data-paragraph-id") || node.getAttribute("data-sentence-id") || node.getAttribute("data-index") || node.querySelector('.paragraph-content-editor[data-zone-id]')?.getAttribute("data-zone-id") || null,
      speaker: clean(speakerNode?.getAttribute("data-speaker-name")) || clean(speakerNode?.getAttribute("user-name-content")) || text(speakerNode),
      startMs: timestamp(timeNode),
      text: body
    };
  }
  function findRoot(rules) {
    const candidates = [...document.querySelectorAll(rules.root)].filter(visible).map(node => {
      const sample = rows(node, rules).slice(0, 30);
      const times = sample.filter(row => row.matches(rules.time) || row.querySelector(rules.time)).length;
      return { node, score: sample.length + times * 5 };
    }).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
    if (!candidates.length) throw new Error("未识别到文字记录。请切换到右侧「文字记录 / 逐字稿」并等待加载；仍无法识别时，在插件设置的「高级适配」填写选择器。");
    return candidates[0].node;
  }
  function findScroller(root, firstRow) {
    function scrollable(node) {
      const overflow = getComputedStyle(node).overflowY;
      return node.clientHeight > 0 && node.scrollHeight > node.clientHeight + 4
        && (/auto|scroll/.test(overflow) || (overflow === "hidden" && node.matches(".rc-virtual-list-holder")));
    }
    for (let node = firstRow?.parentElement || root; node && node !== document.body; node = node.parentElement) {
      if (scrollable(node)) return node;
    }
    const candidates = [...root.querySelectorAll("*")].filter(node => node.contains(firstRow) && scrollable(node));
    return candidates[0] || (document.scrollingElement.scrollHeight > innerHeight + 4 ? document.scrollingElement : null);
  }
  function abortCheck(signal) { if (signal?.aborted) throw new DOMException("已取消采集", "AbortError"); }
  function settle(root, signal, minimum = 180, maximum = 1400) {
    return new Promise((resolve, reject) => {
      let quietTimer, minimumTimer, maximumTimer;
      let ready = false, quiet = false;
      const observer = new MutationObserver(() => { quiet = false; clearTimeout(quietTimer); quietTimer = setTimeout(() => { quiet = true; if (ready) done(); }, 100); });
      function done(error) {
        observer.disconnect(); clearTimeout(quietTimer); clearTimeout(minimumTimer); clearTimeout(maximumTimer);
        signal?.removeEventListener("abort", aborted);
        document.removeEventListener("visibilitychange", visibilityChanged);
        error ? reject(error) : resolve();
      }
      function aborted() { done(new DOMException("已取消采集", "AbortError")); }
      function visibilityChanged() { if (document.visibilityState === "hidden") done(new Error(VISIBILITY_MESSAGE)); }
      if (signal?.aborted) return aborted();
      if (document.visibilityState === "hidden") return visibilityChanged();
      observer.observe(root, { subtree: true, childList: true, characterData: true });
      signal?.addEventListener("abort", aborted, { once: true });
      document.addEventListener("visibilitychange", visibilityChanged);
      quietTimer = setTimeout(() => { quiet = true; if (ready) done(); }, 100);
      minimumTimer = setTimeout(() => { ready = true; if (quiet) done(); }, minimum);
      maximumTimer = setTimeout(() => done(), maximum);
    });
  }
  function title() {
    return text(document.querySelector('[data-testid="minutes-title"], .minutes-title, [class*="minutesTitle"], h1')) || clean(document.title).replace(/\s*[-|·]\s*(飞书妙记|妙记|Feishu Minutes|Lark Minutes).*$/i, "") || "妙记文字记录";
  }
  async function capture({ custom = {}, full = true, signal, onProgress = () => {}, maxDuration = 90000 } = {}) {
    abortCheck(signal);
    assertVisible();
    const pageUrl = location.href;
    const rules = selectors(custom);
    const root = findRoot(rules);
    const scroller = findScroller(root, rows(root, rules)[0]);
    const originalTop = scroller?.scrollTop;
    const originalBehavior = scroller?.style.scrollBehavior;
    const originalAnchor = scroller?.style.overflowAnchor;
    const segments = new Map();
    const start = performance.now();
    let reachedEnd = !scroller, timedOut = false, blocked = false;
    let rounds = 0, bottomStable = 0, previousBottom = "";
    function collect() {
      abortCheck(signal);
      assertVisible();
      if (location.href !== pageUrl || !root.isConnected) throw new Error("页面已切换，采集已停止。请在当前妙记重新采集。");
      const occurrences = new Map();
      for (const row of rows(root, rules)) {
        const segment = readRow(row, rules);
        if (!segment) continue;
        const identity = segment.id !== null ? "id:" + segment.id : JSON.stringify([segment.startMs, segment.speaker, segment.text]);
        const count = occurrences.get(identity) || 0;
        occurrences.set(identity, count + 1);
        segments.set(identity + ":" + count, segment);
      }
      onProgress({ count: segments.size, rounds, progress: scroller ? Math.min(99, Math.round(100 * scroller.scrollTop / Math.max(1, scroller.scrollHeight - scroller.clientHeight))) : 100 });
    }
    try {
      if (full && scroller) {
        scroller.style.scrollBehavior = "auto"; scroller.style.overflowAnchor = "none";
        scroller.scrollTop = 0;
        await settle(root, signal, 300);
      }
      collect();
      while (full && scroller) {
        if (++rounds > 2000 || performance.now() - start > maxDuration) { timedOut = true; break; }
        const before = scroller.scrollTop;
        const bottom = before + scroller.clientHeight >= scroller.scrollHeight - 3;
        if (bottom) {
          const marker = [segments.size, scroller.scrollHeight].join(":");
          bottomStable = marker === previousBottom ? bottomStable + 1 : 0;
          previousBottom = marker;
          if (bottomStable >= 4) { reachedEnd = true; break; }
          await settle(root, signal, 300);
        } else {
          bottomStable = 0;
          scroller.scrollTop = before + Math.max(1, Math.floor(scroller.clientHeight * 0.65));
          await settle(root, signal);
          if (Math.abs(scroller.scrollTop - before) < 1) { blocked = true; break; }
        }
        collect();
      }
    } finally {
      if (scroller?.isConnected && location.href === pageUrl) {
        scroller.scrollTop = originalTop;
        scroller.style.scrollBehavior = originalBehavior;
        scroller.style.overflowAnchor = originalAnchor;
      }
    }
    abortCheck(signal);
    const output = [...segments.values()];
    if (!output.length) throw new Error("识别到了文字区域，但没有提取到段落。请检查高级适配的段落和正文选择器。");
    const warnings = [];
    if (!full) warnings.push("仅采集当前已加载的段落，可能缺少未加载内容。");
    else if (timedOut || blocked || !reachedEnd) warnings.push("采集未完成：" + (timedOut ? "已达到时间上限" : "文字区域无法继续滚动") + "，本次结果可能不完整。");
    else warnings.push("已遍历文字区域至底部；页面未提供总段落数，无法校验是否包含全部记录。");
    if (output.some(segment => !segment.speaker)) warnings.push("部分段落未识别到发言人。");
    if (output.some(segment => segment.startMs === null)) warnings.push("部分段落未识别到时间戳；建议核对重复发言和段落顺序。");
    const url = new URL(pageUrl); url.search = ""; url.hash = "";
    return { schemaVersion: 1, title: title(), sourceUrl: url.href, capturedAt: new Date().toISOString(), coverage: { mode: full ? "scroll" : "loaded", reachedEnd: full && reachedEnd, timedOut, blocked }, warnings, segments: output };
  }
  const NOTES_ROOT = '.summary-notes .meeting-summary-entry, .summary-notes [data-slate-editor], .smart-notes-container [data-slate-editor], [data-testid="meeting-notes-content"], .meeting-notes-content';
  const NOTE_LABELS = ["会议纪要", "AI 纪要", "AI纪要", "AI Notes", "Meeting Notes", "Meeting notes"];
  const TRANSCRIPT_LABELS = ["文字记录", "逐字稿", "Transcript"];
  function tabs() {
    return [...document.querySelectorAll('.page-right-tabs .ud__tabs__tab, [role="tab"], [data-testid="minutes-tab"]')].filter(visible);
  }
  function activeTab() { return tabs().find(node => node.classList.contains("ud__tabs__tab--active") || node.getAttribute("aria-selected") === "true"); }
  function tabFor(labels) { return tabs().find(node => labels.includes(text(node))); }
  function notesRoot() { return [...document.querySelectorAll(NOTES_ROOT)].find(visible); }
  function readNotes(root) {
    const clone = root.cloneNode(true);
    clone.querySelectorAll('script,style,button,svg,input,textarea,[role="button"],[hidden],[aria-hidden="true"],.meeting-summary-empty-text').forEach(node => node.remove());
    for (const section of clone.querySelectorAll(".meeting-summary-section")) {
      const body = section.cloneNode(true);
      body.querySelectorAll(".meeting-summary-section-title").forEach(node => node.remove());
      if (!clean(body.textContent)) section.remove();
    }
    clone.querySelectorAll("br").forEach(node => node.replaceWith("\n"));
    const blocks = [];
    const blockSelector = '.meeting-summary-section-title,h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,.ace-line,[data-node="true"]';
    function visit(node) {
      let inline = "";
      function flush() { if (clean(inline)) blocks.push({ type: "paragraph", text: clean(inline) }); inline = ""; }
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) { inline += child.nodeValue; continue; }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        if (child.matches(blockSelector)) {
          flush();
          const value = clean(child.textContent);
          if (!value) continue;
          const heading = child.matches(".meeting-summary-section-title,h1,h2,h3,h4,h5,h6");
          blocks.push({ type: heading ? "heading" : child.matches("li") ? "list-item" : "paragraph", ...(heading ? { level: /^H[1-6]$/.test(child.tagName) ? Number(child.tagName[1]) : 1 } : {}), text: value });
        } else if (child.querySelector(blockSelector)) { flush(); visit(child); }
        else inline += child.textContent;
      }
      flush();
    }
    visit(clone);
    if (!blocks.length) return { status: "empty", blocks: [], text: "", message: "本妙记的会议纪要暂无内容。" };
    return { status: "captured", blocks, text: blocks.map(block => block.text).join("\n\n") };
  }
  async function waitUntil(predicate, { signal, pageUrl, timeout = 6000 } = {}) {
    const started = performance.now();
    for (;;) {
      abortCheck(signal); assertVisible();
      if (location.href !== pageUrl) throw new Error("页面已切换，采集已停止。请在当前妙记重新采集。");
      if (predicate()) return true;
      if (performance.now() - started > timeout) return false;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(done, 80);
        function aborted() { clearTimeout(timer); signal?.removeEventListener("abort", aborted); reject(new DOMException("已取消采集", "AbortError")); }
        function done() { signal?.removeEventListener("abort", aborted); resolve(); }
        signal?.addEventListener("abort", aborted, { once: true });
      });
    }
  }
  function saveScrolls() {
    return ['.rc-virtual-list-holder', '.transcript-container', '#smart-notes-scroll-container', '.smart-notes-scroll-container', '.meeting-notes-content'].flatMap(selector =>
      [...document.querySelectorAll(selector)].map((node, index) => ({ node, selector, index })).filter(item => visible(item.node))
        .map(item => ({ selector: item.selector, index: item.index, top: item.node.scrollTop })));
  }
  async function captureMeeting({ includeNotes = false, ...options } = {}) {
    abortCheck(options.signal); assertVisible();
    const pageUrl = location.href, previousTab = text(activeTab()), scrolls = saveScrolls();
    try {
      // Starting from notes is supported too. Only click existing navigation tabs.
      const transcriptTab = tabFor(TRANSCRIPT_LABELS);
      if (transcriptTab && previousTab && !TRANSCRIPT_LABELS.includes(previousTab)) {
        transcriptTab.click();
        if (!await waitUntil(() => { try { return Boolean(findRoot(selectors(options.custom))); } catch (_) { return false; } }, { signal: options.signal, pageUrl })) throw new Error("文字记录未能加载，请稍后重试。");
      }
      const result = await capture(options);
      if (!includeNotes) return result;
      options.onProgress?.({ stage: "notes", count: result.segments.length, progress: 100 });
      const noteTab = tabFor(NOTE_LABELS);
      if (!noteTab && !notesRoot()) {
        result.meetingNotes = { status: "unavailable", blocks: [], text: "", message: "未找到会议纪要入口，本次仅导出文字记录。" };
        return result;
      }
      noteTab?.click();
      if (!await waitUntil(() => {
        const root = notesRoot();
        return root && !root.closest('[aria-busy="true"]') && !root.querySelector('[aria-busy="true"]');
      }, { signal: options.signal, pageUrl })) {
        result.meetingNotes = { status: "unavailable", blocks: [], text: "", message: "会议纪要未能加载，本次仅导出文字记录。" };
        return result;
      }
      const root = notesRoot();
      await settle(root, options.signal, 350);
      if (location.href !== pageUrl || !root.isConnected) throw new Error("页面已切换，采集已停止。");
      result.meetingNotes = readNotes(root);
      return result;
    } finally {
      if (location.href === pageUrl) {
        const previous = tabs().find(node => text(node) === previousTab);
        if (previous && text(activeTab()) !== previousTab) {
          previous.click();
          // Restoration also runs after cancellation; do not reuse its signal.
          await new Promise(resolve => setTimeout(resolve, 80));
        }
        for (const saved of scrolls) {
          const node = document.querySelectorAll(saved.selector)[saved.index];
          if (node && visible(node)) node.scrollTop = saved.top;
        }
      }
    }
  }
  scope.MiaojiExtractor = { AUTO, selectors, findRoot, readRow, rows, capture, readNotes, captureMeeting };
})(globalThis);
