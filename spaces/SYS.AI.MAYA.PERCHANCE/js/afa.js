// SYS.AI.MAYA.PERCHANCE - afa :: one job: the stable machine surface (AFA).
// Fixed elements, always present, always JSON:
//   <pre id="afa-status">   {state, step, ts}                 state: booting|loading|ready|working|done|error
//   <pre id="afa-manifest"> what this space does and how to call it
//   <pre id="afa-result">   the last job's JSON result
//   <pre id="afa-errors">   [] of {code, message, ts}  (visible, never swallowed)
//   <pre id="afa-log">      JSONL, one event per line
// Also mirrored on <html data-afa-state="..."> and document.title, so a reader that only sees the title still knows.
(function () {
  "use strict";
  var IDS = ["afa-status", "afa-manifest", "afa-result", "afa-errors", "afa-log"];
  function create(opts) {
    var o = opts || {};
    var doc = o.document || (typeof document !== "undefined" ? document : null);
    var root = o.root || (doc && doc.body);
    var space = o.space || "SPACE";
    var els = {}, errors = [], state = { state: "booting", step: "", ts: new Date().toISOString() };
    if (doc && root) {
      IDS.forEach(function (id) {
        var e = doc.getElementById(id);
        if (!e) { e = doc.createElement("pre"); e.id = id; root.appendChild(e); }
        e.setAttribute("data-afa", id.slice(4));
        els[id] = e;
      });
    }
    function put(id, obj) { if (els[id]) els[id].textContent = JSON.stringify(obj, null, 1); }
    function log(ev, data) {
      var line = JSON.stringify({ ts: new Date().toISOString(), ev: ev, data: data == null ? null : data });
      if (els["afa-log"]) els["afa-log"].textContent += line + "\n";
      return line;
    }
    function status(st, step) {
      state = { state: st, step: step || "", ts: new Date().toISOString() };
      put("afa-status", state);
      if (doc) {
        try { doc.documentElement.setAttribute("data-afa-state", st); } catch (e) {}
        try { doc.title = space + " :: " + st.toUpperCase() + (step ? " :: " + step : ""); } catch (e) {}
      }
      log("status", state);
      return state;
    }
    function error(code, message) {
      var e = { code: String(code || "E_INTERNAL"), message: String(message || ""), ts: new Date().toISOString() };
      errors.push(e);
      put("afa-errors", errors);
      log("error", e);
      return e;
    }
    function result(obj) { put("afa-result", obj); log("result", { op: obj && obj.op, ok: obj && obj.ok }); return obj; }
    function manifest(obj) { put("afa-manifest", obj); return obj; }
    put("afa-errors", errors);
    put("afa-result", null);
    status("booting");
    return { status: status, error: error, result: result, manifest: manifest, log: log, errors: function () { return errors.slice(); }, state: function () { return state; }, els: els };
  }
  var api = { create: create, IDS: IDS };
  if (typeof window !== "undefined") window.SysAiMayaAfa = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
