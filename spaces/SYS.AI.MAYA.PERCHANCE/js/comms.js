// SYS.AI.MAYA.PERCHANCE - comms :: one job: carry jobs in and results out. Knows nothing about lore.
// Lines in:  1) the URL (one job per URL: #agent&op=ask&q=...)   2) window.postMessage   3) BroadcastChannel   4) window API
// Envelope in:  { to: "SYS.AI.MAYA.PERCHANCE"|"016"|"MAYA", id?: string, op: string, args?: {} }
// Envelope out: { from: "SYS.AI.MAYA.PERCHANCE", re: id, ok, op, ...result }
(function () {
  "use strict";
  function create(opts) {
    var o = opts || {};
    var space = o.space, accept = o.accept || [space], dispatch = o.dispatch, onEvent = o.onEvent || function () {};
    var bc = null;
    function wanted(m) { return m && typeof m === "object" && typeof m.op === "string" && accept.indexOf(String(m.to || "")) >= 0; }
    async function handle(m, reply, line) {
      onEvent("in", { line: line, id: m.id || null, op: m.op });
      var res;
      try { res = await dispatch(m.op, m.args || {}); }
      catch (e) { res = { ok: false, op: m.op, error: { code: "E_INTERNAL", message: String(e && e.message || e) } }; }
      var out = Object.assign({ from: space, re: m.id || null }, res);
      try { reply(out); } catch (e) { onEvent("reply_failed", { line: line, message: String(e && e.message || e) }); }
      onEvent("out", { line: line, id: m.id || null, op: m.op, ok: !!(res && res.ok) });
      return out;
    }
    function listen() {
      if (typeof window !== "undefined") {
        window.addEventListener("message", function (ev) {
          var m = ev.data;
          if (!wanted(m)) return;
          handle(m, function (out) { if (ev.source && ev.source.postMessage) ev.source.postMessage(out, (ev.origin && ev.origin !== "null") ? ev.origin : "*"); }, "postMessage");
        });
      }
      if (typeof BroadcastChannel !== "undefined" && o.channel) {
        bc = new BroadcastChannel(o.channel);
        bc.onmessage = function (ev) { var m = ev.data; if (!wanted(m)) return; handle(m, function (out) { bc.postMessage(out); }, "broadcast"); };
      }
    }
    function fromParams(p) {
      var op = p.op || (p.q ? "ask" : "");
      if (!op) return null;
      var args = {};
      Object.keys(p).forEach(function (k) { if (k !== "op" && k !== "agent" && k !== "human" && k !== "mode" && k.charAt(0) !== "_") args[k] = p[k]; });
      return { op: op, args: args };
    }
    function call(op, args) { return handle({ to: space, op: op, args: args || {} }, function () {}, "api"); }
    return { listen: listen, fromParams: fromParams, call: call };
  }
  var api = { create: create };
  if (typeof window !== "undefined") window.SysAiMayaComms = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
