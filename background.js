"use strict";
importScripts("shared.js");
const { DEFAULTS, DEFAULT_DOMAINS, FILES, configuredDomains, patterns, allowed } = MiaojiShared;
const SCRIPT_ID = "miaoji-export-custom-domains";
let queue = Promise.resolve();
async function synchronize() {
  const settings = await chrome.storage.sync.get(DEFAULTS);
  const domains = configuredDomains(settings.domains);
  const candidates = domains.filter(domain => !DEFAULT_DOMAINS.includes(domain)).flatMap(patterns);
  const permissions = await Promise.all(candidates.map(origin => chrome.permissions.contains({ origins: [origin] })));
  const matches = candidates.filter((_, index) => permissions[index]).sort();
  const [existing] = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  if (existing && (!settings.enabled || JSON.stringify(existing.matches.slice().sort()) !== JSON.stringify(matches))) {
    await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  }
  if (settings.enabled && matches.length && (!existing || JSON.stringify(existing.matches.slice().sort()) !== JSON.stringify(matches))) {
    await chrome.scripting.registerContentScripts([{ id: SCRIPT_ID, matches, js: [...FILES], runAt: "document_idle", persistAcrossSessions: true }]);
  }
  if (!settings.enabled || !domains.length) return;
  const available = await Promise.all(domains.flatMap(patterns).map(async origin => await chrome.permissions.contains({ origins: [origin] }) ? origin : null));
  if (!available.some(Boolean)) return;
  const tabs = await chrome.tabs.query({ url: available.filter(Boolean) });
  await Promise.allSettled(tabs.filter(tab => tab.id && allowed(tab.url, settings)).map(tab => chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [...FILES] })));
}
function scheduleSync() {
  queue = queue.catch(() => {}).then(synchronize).catch(error => console.error("[妙记导出] 域名同步失败", error.message));
  return queue;
}
chrome.runtime.onInstalled.addListener(scheduleSync);
chrome.runtime.onStartup.addListener(scheduleSync);
chrome.storage.onChanged.addListener((changes, area) => { if (area === "sync" && (changes.domains || changes.enabled)) scheduleSync(); });
chrome.permissions.onAdded.addListener(scheduleSync);
chrome.permissions.onRemoved.addListener(scheduleSync);
scheduleSync();
