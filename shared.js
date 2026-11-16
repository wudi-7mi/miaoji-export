(function (scope) {
  "use strict";
  const DEFAULT_DOMAINS = Object.freeze(["feishu.cn", "feishuapp.cn", "larksuite.com", "larkoffice.com", "xfchat.iflytek.com"]);
  const DEFAULTS = Object.freeze({ enabled: true, domains: [...DEFAULT_DOMAINS], selectors: { root: "", row: "", text: "", speaker: "", time: "" } });
  const FILES = Object.freeze(["shared.js", "exporter.js", "extractor.js", "content.js"]);
  function normalizeDomain(value) {
    const input = String(value || "").trim().toLowerCase().replace(/^\*\./, "");
    if (!input) return "";
    let url;
    try { url = new URL(input.includes("://") ? input : "https://" + input); } catch (_) { throw new Error("无效域名：" + input); }
    const hostname = url.hostname.replace(/\.$/, "");
    if (url.protocol !== "https:" || url.username || url.password || url.port || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]*$/.test(hostname)) {
      throw new Error("请输入 HTTPS 网站的完整域名：" + input);
    }
    return hostname;
  }
  function readDomains(value) { return [...new Set(String(value).split(/\r?\n/).map(normalizeDomain).filter(Boolean))]; }
  function matchesDomain(hostname, domain) {
    const host = String(hostname).toLowerCase().replace(/\.$/, "");
    return host === domain || host.endsWith("." + domain);
  }
  function patterns(domain) { return ["https://" + domain + "/*", "https://*." + domain + "/*"]; }
  function configuredDomains(domains) {
    return [...new Set((Array.isArray(domains) ? domains : []).flatMap(value => {
      try { const domain = normalizeDomain(value); return domain ? [domain] : []; } catch (_) { return []; }
    }))];
  }
  function isMinutesUrl(value) {
    try { const url = new URL(value); return url.protocol === "https:" && /^\/minutes\/[^/]+\/?$/.test(url.pathname); } catch (_) { return false; }
  }
  function allowed(value, settings) {
    try { const url = new URL(value); return settings.enabled && isMinutesUrl(value) && configuredDomains(settings.domains).some(domain => matchesDomain(url.hostname, domain)); } catch (_) { return false; }
  }
  const api = { DEFAULT_DOMAINS, DEFAULTS, FILES, normalizeDomain, readDomains, matchesDomain, patterns, configuredDomains, isMinutesUrl, allowed };
  scope.MiaojiShared = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
