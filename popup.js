"use strict";
const $ = id => document.getElementById(id);
const { DEFAULTS, DEFAULT_DOMAINS, FILES, readDomains, configuredDomains, patterns, matchesDomain, isMinutesUrl } = MiaojiShared;
let currentTab = null;
function message(text, error = false) { $("message").textContent = text; $("message").classList.toggle("error", error); }
async function missing(domains) {
  const origins = domains.filter(domain => !DEFAULT_DOMAINS.includes(domain)).flatMap(patterns);
  const granted = await Promise.all(origins.map(origin => chrome.permissions.contains({ origins: [origin] })));
  return origins.filter((_, index) => !granted[index]);
}
async function updateStatus() {
  const settings = await chrome.storage.sync.get(DEFAULTS);
  const domains = configuredDomains(settings.domains);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); currentTab = tab;
  let url; try { url = new URL(tab?.url); } catch (_) { /* Browser internal page. */ }
  $("hostname").textContent = url?.protocol === "https:" ? url.hostname : "请打开妙记的文字记录页面";
  let label = "非妙记页面", state = "", ready = false;
  if (url && isMinutesUrl(url.href)) {
    const configured = domains.some(domain => matchesDomain(url.hostname, domain));
    const granted = await chrome.permissions.contains({ origins: [url.origin + "/*"] });
    if (!settings.enabled) label = "已关闭";
    else if (!configured) { label = "未配置域名"; state = "warn"; }
    else if (!granted) { label = "需要授权"; state = "warn"; }
    else { label = "可以导出"; state = "ok"; ready = true; }
  }
  $("page-status").textContent = label; $("page-status").className = "badge " + state;
  $("open-export").disabled = !ready;
  const absent = await missing(domains);
  $("permission-state").textContent = absent.length ? "有企业域名尚未授权，点击「保存并授权」。" : "已保存的域名均已授权。";
}
async function saveDomains(domains) {
  const { domains: previous } = await chrome.storage.sync.get(DEFAULTS);
  await chrome.storage.sync.set({ domains });
  const retained = new Set(domains.filter(domain => !DEFAULT_DOMAINS.includes(domain)).flatMap(patterns));
  const removed = configuredDomains(previous).filter(domain => !DEFAULT_DOMAINS.includes(domain)).flatMap(patterns).filter(origin => !retained.has(origin));
  if (removed.length) await chrome.permissions.remove({ origins: removed });
  $("domains").value = domains.join("\n"); $("domains").setAttribute("aria-invalid", "false");
  await updateStatus();
}
function validateDomains() {
  try { const domains = readDomains($("domains").value); $("domains").setAttribute("aria-invalid", "false"); return domains; }
  catch (error) { $("domains").setAttribute("aria-invalid", "true"); throw error; }
}
function handle(task) { return async () => { try { await task(); } catch (error) { message(error.message, true); } }; }
$("enabled").addEventListener("change", handle(async () => {
  await chrome.storage.sync.set({ enabled: $("enabled").checked });
  await updateStatus(); message($("enabled").checked ? "已开启" : "已关闭");
}));
$("save-domains").addEventListener("click", handle(async () => { await saveDomains(validateDomains()); message("域名已保存"); }));
$("grant-domains").addEventListener("click", handle(async () => {
  const domains = validateDomains();
  const origins = domains.filter(domain => !DEFAULT_DOMAINS.includes(domain)).flatMap(patterns);
  // Request before any await to preserve the browser's user-gesture requirement.
  const granted = !origins.length || await chrome.permissions.request({ origins });
  if (!granted) { message("未授予权限，域名设置尚未保存。", true); return; }
  await saveDomains(domains); message("域名已保存并授权");
}));
$("reset-domains").addEventListener("click", handle(async () => { await saveDomains([...DEFAULT_DOMAINS]); message("已恢复默认域名"); }));
$("save-selectors").addEventListener("click", handle(async () => {
  const selectors = {};
  for (const key of Object.keys(DEFAULTS.selectors)) {
    const value = $("selector-" + key).value.trim();
    if (value) { try { document.querySelector(value); } catch (_) { throw new Error(key + " 不是有效的 CSS 选择器"); } }
    selectors[key] = value;
  }
  await chrome.storage.sync.set({ selectors }); message("适配设置已保存，回到页面重新采集即可。");
}));
$("open-export").addEventListener("click", handle(async () => {
  if (!currentTab?.id) throw new Error("无法读取当前标签页");
  const target = { tabId: currentTab.id };
  await chrome.scripting.executeScript({ target, files: [...FILES] });
  const result = await chrome.tabs.sendMessage(currentTab.id, { type: "miaoji:open" });
  if (!result?.opened) throw new Error("请检查功能开关、域名和当前页面。");
  window.close();
}));
async function load() {
  const settings = await chrome.storage.sync.get(DEFAULTS);
  $("version").textContent = "v" + chrome.runtime.getManifest().version;
  $("enabled").checked = settings.enabled; $("domains").value = configuredDomains(settings.domains).join("\n");
  for (const key of Object.keys(DEFAULTS.selectors)) $("selector-" + key).value = settings.selectors?.[key] || "";
  await updateStatus();
}
chrome.permissions.onAdded.addListener(() => updateStatus().catch(error => message(error.message, true)));
chrome.permissions.onRemoved.addListener(() => updateStatus().catch(error => message(error.message, true)));
load().catch(error => message(error.message, true));
