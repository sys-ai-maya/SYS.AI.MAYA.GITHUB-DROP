// SYS.AI.MAYA.PERCHANCE - mode :: one job: decide agent or human.
// in:  location (hash + search), navigator   out: { mode: "agent"|"human", reason: string }
// Explicit switch wins (#agent / #human / mode=agent|human). Sniffing is the backup, like old browser detection.
(function () {
  "use strict";
  var BOT_UA = /HeadlessChrome|Headless|bot\b|crawler|spider|python|curl|wget|httpx|aiohttp|node-fetch|undici|playwright|puppeteer|selenium|phantomjs|GPTBot|ChatGPT|ClaudeBot|Claude-Web|anthropic|OpenAI|PerplexityBot|Google-Extended|CCBot/i;
  function params(loc) {
    var out = {}, parts = [];
    var h = String((loc && loc.hash) || "").replace(/^#\/?/, "");
    var s = String((loc && loc.search) || "").replace(/^\?/, "");
    if (s) parts = parts.concat(s.split("&"));
    if (h) parts = parts.concat(h.replace(/^[a-z]+\?/i, function (m) { out._route = m.slice(0, -1); return ""; }).split("&"));
    parts.forEach(function (p) {
      if (!p) return;
      var i = p.indexOf("=");
      var k = decodeURIComponent((i < 0 ? p : p.slice(0, i)).replace(/\+/g, " "));
      var v = i < 0 ? "" : decodeURIComponent(p.slice(i + 1).replace(/\+/g, " "));
      if (k) out[k] = v;
    });
    return out;
  }
  function detect(loc, nav) {
    var p = params(loc);
    var m = String(p.mode || "").toLowerCase();
    if ("agent" in p || m === "agent" || p._route === "agent") return { mode: "agent", reason: "explicit switch", params: p };
    if ("human" in p || m === "human" || p._route === "human") return { mode: "human", reason: "explicit switch", params: p };
    var n = nav || {};
    if (n.webdriver === true) return { mode: "agent", reason: "navigator.webdriver", params: p };
    var ua = String(n.userAgent || "");
    if (BOT_UA.test(ua)) return { mode: "agent", reason: "user-agent: " + (ua.match(BOT_UA) || [""])[0], params: p };
    return { mode: "human", reason: "default", params: p };
  }
  var api = { detect: detect, params: params, BOT_UA: BOT_UA };
  if (typeof window !== "undefined") window.SysAiMayaMode = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
