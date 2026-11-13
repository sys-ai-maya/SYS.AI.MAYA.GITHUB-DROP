(function () {
  "use strict";
  var TAG = "SYS.AI.MAYA.PERCHANCE";
  var VERSION = "1.0.0";
  var BASE = "https://perchance.org/sys-ai-maya-lore-oracle";
  var FRAME = "https://e0b48b6eb61490b30908b1534e1fb1a7.perchance.org/sys-ai-maya-lore-oracle";
  var OPS = ["manifest", "status", "ask", "search", "verify", "recent"];
  var NEEDS_Q = { ask: 1, search: 1 };
  var LONG = { ask: 1, search: 1, verify: 1 };

  function now() { return Date.now(); }
  function secs(ms) { return (ms / 1000).toFixed(1) + "S"; }
  function fail(op, code, message) { return { ok: false, op: op, error: { code: code, message: message } }; }
  function originOf(u) { try { return new URL(u).origin; } catch (e) { return ""; } }
  function clean(args) {
    var out = {};
    Object.keys(args || {}).forEach(function (k) { var v = args[k]; if (v === undefined || v === null || v === "") return; if (typeof v === "boolean") v = v ? "1" : "0"; out[k] = String(v); });
    return out;
  }
  function check(op, args) {
    if (typeof op !== "string" || OPS.indexOf(op) < 0) return fail(String(op), "E_BAD_OP", "REFUSED :: unknown op '" + op + "' :: known ops are " + OPS.join(", ") + " :: NOTHING WAS SENT.");
    if (NEEDS_Q[op] && !String((args || {}).q || "").trim()) return fail(op, "E_BAD_REQUEST", "REFUSED :: " + op + " needs a question in q :: NOTHING WAS SENT.");
    return null;
  }

  function client(opts) {
    var o = opts || {};
    var base = String(o.base || BASE).replace(/[#?].*$/, "");
    var frameUrl = String(o.frameUrl || FRAME).replace(/[#?].*$/, "");
    var to = String(o.to || TAG);
    var timeoutMs = Number(o.timeoutMs) > 0 ? Number(o.timeoutMs) : 20000;
    var longMs = Number(o.longTimeoutMs) > 0 ? Number(o.longTimeoutMs) : 120000;
    var readyMs = Number(o.readyMs) > 0 ? Number(o.readyMs) : 45000;
    var doc = o.document || (typeof document !== "undefined" ? document : null);
    var win = o.window || (typeof window !== "undefined" ? window : null);
    var target = o.target || null;
    var origin = o.targetOrigin || originOf(frameUrl) || "*";
    var frame = null, ready = null, listening = false, seq = 0;
    var pending = {};
    var log = [];

    function note(rec) { rec.ts = now(); if (!log.length || log[log.length - 1].ts !== rec.ts || log[log.length - 1].op !== rec.op) log.push(rec); else log.push(Object.assign(rec, { ts: rec.ts + 1 })); if (log.length > 200) log.shift(); }

    function url(op, args) {
      var bad = check(op, args);
      if (bad) return bad;
      var a = clean(args);
      var parts = ["agent", "op=" + encodeURIComponent(op)];
      Object.keys(a).forEach(function (k) { parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(a[k]))); });
      return { ok: true, op: op, url: base + "#" + parts.join("&") };
    }

    function onMessage(ev) {
      var m = ev && ev.data;
      if (!m || typeof m !== "object" || m.from !== to || !m.re || !pending[m.re]) return;
      var p = pending[m.re];
      if (p.source && ev.source && ev.source !== p.source) return;
      delete pending[m.re];
      clearTimeout(p.timer);
      var out = {};
      Object.keys(m).forEach(function (k) { if (k !== "from" && k !== "re") out[k] = m[k]; });
      if (out.ok === undefined) out.ok = false;
      note({ op: p.op, ok: !!out.ok, ms: now() - p.t0, code: out.error && out.error.code || null });
      p.resolve(out);
    }

    function listen() {
      if (listening || !win || typeof win.addEventListener !== "function") return;
      win.addEventListener("message", onMessage);
      listening = true;
    }

    function send(op, args, ms) {
      var w = target || (frame && frame.contentWindow);
      if (!w || typeof w.postMessage !== "function") return Promise.resolve(fail(op, "E_NOT_READY", "NOT OPEN :: no oracle window to talk to :: call open() first or pass target :: NOTHING WAS SENT."));
      listen();
      var id = TAG + "." + now().toString(36) + "." + (++seq);
      return new Promise(function (resolve) {
        var t0 = now();
        var timer = setTimeout(function () {
          if (!pending[id]) return;
          delete pending[id];
          note({ op: op, ok: false, ms: now() - t0, code: "E_TIMEOUT" });
          resolve(fail(op, "E_TIMEOUT", "FAILED AFTER " + secs(now() - t0) + " :: op " + op + " :: THE ORACLE DID NOT ANSWER :: NOTHING ELSE WAS TOUCHED."));
        }, ms);
        pending[id] = { op: op, t0: t0, timer: timer, resolve: resolve, source: w };
        try { w.postMessage({ to: to, id: id, op: op, args: clean(args) }, origin); }
        catch (e) { clearTimeout(timer); delete pending[id]; resolve(fail(op, "E_SEND", "SEND REFUSED :: " + String(e && e.message || e).slice(0, 160) + " :: NOTHING ELSE WAS TOUCHED.")); }
      });
    }

    function open() {
      if (ready) return ready;
      if (target) {
        ready = send("manifest", {}, readyMs).then(function (r) { if (!r.ok) ready = null; return r.ok ? { ok: true, op: "open", via: "target", manifest: r.manifest } : r; });
        return ready;
      }
      if (!doc || typeof doc.createElement !== "function") return Promise.resolve(fail("open", "E_NO_DOM", "OPEN REFUSED :: no document to mount the oracle frame in :: use url(op,args) for a no-click link, or pass target :: NOTHING WAS TOUCHED."));
      listen();
      var t0 = now();
      frame = doc.createElement("iframe");
      frame.setAttribute("data-chip", TAG);
      frame.setAttribute("title", "SYS.AI.MAYA lore oracle");
      frame.setAttribute("aria-hidden", "true");
      frame.setAttribute("tabindex", "-1");
      frame.style.cssText = "position:absolute;width:1px;height:1px;left:-9999px;top:-9999px;border:0;opacity:0;pointer-events:none;";
      frame.src = frameUrl + "#agent";
      (doc.body || doc.documentElement).appendChild(frame);
      ready = new Promise(function (resolve) {
        var done = false;
        function attempt() {
          if (done) return;
          if (now() - t0 > readyMs) { done = true; ready = null; resolve(fail("open", "E_NOT_READY", "FAILED AFTER " + secs(now() - t0) + " :: the oracle frame never answered at " + frameUrl + " :: NOTHING ELSE WAS TOUCHED.")); return; }
          send("manifest", {}, 1500).then(function (r) {
            if (done) return;
            if (r.ok && r.manifest) { done = true; resolve({ ok: true, op: "open", via: "frame", ms: now() - t0, manifest: r.manifest }); }
            else if (r.error && r.error.code !== "E_TIMEOUT") { done = true; ready = null; resolve(r); }
            else setTimeout(attempt, 400);
          });
        }
        setTimeout(attempt, 300);
      });
      return ready;
    }

    function call(op, args, co) {
      var bad = check(op, args);
      if (bad) { note({ op: String(op), ok: false, ms: 0, code: bad.error.code }); return Promise.resolve(bad); }
      var ms = co && Number(co.timeoutMs) > 0 ? Number(co.timeoutMs) : (LONG[op] ? longMs : timeoutMs);
      return open().then(function (r) { return r.ok ? send(op, args, ms) : fail(op, r.error.code, r.error.message); });
    }

    function proof() {
      var checks = [];
      function add(name, ok, detail) { checks.push({ name: name, ok: !!ok, detail: detail }); }
      var t0 = now();
      return open().then(function (r) {
        add("open", r.ok, r.ok ? "frame answered in " + r.ms + " ms" : r.error.message);
        if (!r.ok) return null;
        return call("manifest").then(function (a) {
          add("manifest", a.ok && a.manifest && a.manifest.space === TAG, a.ok ? "space " + a.manifest.space + " lane " + a.manifest.lane + " v" + a.manifest.version : a.error.message);
          return call("manifest").then(function (b) {
            add("idempotent", a.ok && b.ok && JSON.stringify(a.manifest) === JSON.stringify(b.manifest), "two manifest calls returned identical documents");
            return call("status");
          });
        }).then(function (s) {
          add("status", s.ok && s.pack_cached !== undefined, s.ok ? "pack_loaded " + !!s.pack + ", pack_cached " + !!s.pack_cached + ", chatlog token_held " + !!(s.chatlog && s.chatlog.token_held) : s.error.message);
          return send("no-such-op", {}, timeoutMs);
        }).then(function (e) {
          add("refusal_remote", !e.ok && e.error && e.error.code === "E_BAD_OP", e.error ? e.error.code + " :: " + e.error.message : "accepted an unknown op");
          return call("ask", { q: "  " });
        }).then(function (q) {
          add("refusal_local", !q.ok && q.error && q.error.code === "E_BAD_REQUEST", q.error ? q.error.code : "accepted an empty question");
        });
      }).then(function () {
        var ok = checks.length >= 6 && checks.every(function (c) { return c.ok; });
        return { ok: ok, op: "proof", tag: TAG, version: VERSION, ms: now() - t0, checks: checks };
      });
    }

    function close() {
      var removed = false;
      Object.keys(pending).forEach(function (id) { var p = pending[id]; clearTimeout(p.timer); delete pending[id]; p.resolve(fail(p.op, "E_CLOSED", "CLOSED :: the client was closed before the oracle answered :: NOTHING ELSE WAS TOUCHED.")); });
      if (listening && win) { win.removeEventListener("message", onMessage); listening = false; }
      if (frame && frame.parentNode) { frame.parentNode.removeChild(frame); removed = true; }
      frame = null; ready = null;
      return { ok: true, op: "close", removed: removed };
    }

    return {
      tag: TAG,
      version: VERSION,
      ops: OPS.slice(),
      url: url,
      open: open,
      call: call,
      manifest: function () { return call("manifest"); },
      status: function () { return call("status"); },
      ask: function (q, a) { return call("ask", Object.assign({}, a || {}, { q: q })); },
      search: function (q, a) { return call("search", Object.assign({}, a || {}, { q: q })); },
      verify: function () { return call("verify"); },
      recent: function (n) { return call("recent", { n: n || 5 }); },
      proof: proof,
      log: function () { return log.slice(); },
      close: close
    };
  }

  var api = { client: client, TAG: TAG, VERSION: VERSION, SPEC: "CHIP SPEC v1", BASE: BASE, FRAME: FRAME, OPS: OPS.slice() };
  if (typeof window !== "undefined") window.SysAiMayaLoreOracle = api;
  if (typeof self !== "undefined" && typeof window === "undefined") self.SysAiMayaLoreOracle = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
