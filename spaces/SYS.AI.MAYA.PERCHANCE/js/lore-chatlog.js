// SYS.AI.MAYA.PERCHANCE - lore-chatlog :: one job: READ an agent's live chatlog on Turso. Never writes.
// in:  { base, token, fetchImpl }   out: JSON rows { id, ts, at, handle, role, session, locus, text }
// Same tables as MYTHOS-TURSO (turns + turns_fts). Every statement passes a SELECT-only guard before it leaves.
(function () {
  "use strict";
  var TAG = "LORE-CHATLOG";
  function str(v) { return String(v == null ? "" : v); }
  function T(t, v) { return { type: t, value: v }; }
  function pipeUrl(b) {
    var s = str(b).trim().replace(/\/+$/, "");
    if (/^libsql:\/\//i.test(s)) s = "https://" + s.slice(9);
    if (!/^https?:\/\//i.test(s)) s = "https://" + s;
    if (!/\/v2\/pipeline$/i.test(s)) s += "/v2/pipeline";
    return s;
  }
  function readOnly(sql) {
    var s = str(sql).trim().replace(/;\s*$/, "");
    if (!/^select\b/i.test(s) || s.indexOf(";") >= 0) throw new Error(TAG + " E_READ_ONLY - only single SELECT statements leave this lane");
    if (/\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum)\b/i.test(s.replace(/'[^']*'/g, ""))) throw new Error(TAG + " E_READ_ONLY - write keyword refused");
    return s;
  }
  function ftsQuery(q) {
    var stop = { the: 1, and: 1, what: 1, who: 1, are: 1, was: 1, were: 1, does: 1, did: 1, how: 1, why: 1, when: 1, where: 1, which: 1, with: 1, from: 1, that: 1, this: 1, about: 1, tell: 1, for: 1, you: 1, your: 1, her: 1, his: 1, its: 1, they: 1, them: 1, there: 1 };
    var words = str(q).toLowerCase().replace(/[^a-z0-9' ]/g, " ").split(/\s+/).filter(function (w) { return w.length > 2 && w.length < 24 && !stop[w]; }).slice(0, 8);
    return words.length ? words.map(function (w) { return '"' + w.replace(/'/g, "") + '"'; }).join(" OR ") : "";
  }
  function client(opts) {
    var o = opts || {};
    var base = str(o.base), token = str(o.token);
    var fch = o.fetchImpl || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
    function configured() { return !!(base && token && fch); }
    async function select(sql, args) {
      if (!base) throw new Error(TAG + " E_NO_LANE - no chatlog base URL in config");
      if (!token) throw new Error(TAG + " E_NO_TOKEN - no read token held in this browser (the human pastes it once in the Lore panel)");
      var stmt = { sql: readOnly(sql) };
      if (args && args.length) stmt.args = args;
      var r;
      try {
        r = await fch(pipeUrl(base), { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ requests: [{ type: "execute", stmt: stmt }, { type: "close" }] }) });
      } catch (e) { throw new Error(TAG + " E_UNREACHABLE - " + str(e && e.message || e).slice(0, 120)); }
      var j = null;
      try { j = await r.json(); } catch (e) { throw new Error(TAG + " E_BAD_REPLY - unparsable (" + r.status + ")"); }
      if (!r.ok) throw new Error(TAG + " E_REFUSED - " + r.status + " " + JSON.stringify(j).slice(0, 160));
      var x = (j.results || [])[0];
      if (!x || x.type !== "ok") throw new Error(TAG + " E_REFUSED - " + JSON.stringify(x).slice(0, 160));
      var res = (x.response || {}).result || {};
      var cols = (res.cols || []).map(function (c) { return c.name; });
      return (res.rows || []).map(function (row) {
        var o2 = {};
        cols.forEach(function (c, i) { var cell = row[i]; o2[c] = cell == null ? null : (cell.type === "null" ? null : cell.value); });
        return o2;
      });
    }
    function shape(r) {
      var ts = Number(r.ts) || 0, at = "";
      try { at = ts ? new Date(ts).toISOString() : ""; } catch (e) {}
      return { id: str(r.id), ts: ts, at: at, handle: str(r.handle), role: str(r.role), session: str(r.session), locus: str(r.locus), text: str(r.text) };
    }
    var COLS = "t.id AS id, t.ts AS ts, t.handle AS handle, t.role AS role, t.session AS session, t.locus AS locus, t.text AS text";
    async function search(q, limit) {
      var n = Math.max(1, Math.min(50, Number(limit) || 20));
      var mq = ftsQuery(q);
      if (!mq) return [];
      var rows;
      try {
        rows = await select("SELECT " + COLS + " FROM turns_fts f JOIN turns t ON t.id = f.id WHERE turns_fts MATCH ? ORDER BY rank LIMIT ?", [T("text", mq), T("integer", String(n))]);
      } catch (e) {
        if (!/no such (table|column)|fts5/i.test(str(e.message))) throw e;
        var w = mq.split(" OR ")[0].replace(/"/g, "");
        rows = await select("SELECT " + COLS + " FROM turns t WHERE t.text LIKE ? ORDER BY t.ts DESC LIMIT ?", [T("text", "%" + w + "%"), T("integer", String(n))]);
      }
      return rows.map(shape);
    }
    async function recent(limit) {
      var n = Math.max(1, Math.min(50, Number(limit) || 5));
      return (await select("SELECT " + COLS + " FROM turns t ORDER BY t.ts DESC LIMIT ?", [T("integer", String(n))])).map(shape);
    }
    async function status() {
      var r = await select("SELECT COUNT(*) AS n, MAX(ts) AS last FROM turns");
      var n = Number((r[0] || {}).n) || 0, last = Number((r[0] || {}).last) || 0;
      return { turns: n, last_ts: last, last_at: last ? new Date(last).toISOString() : null, base: base };
    }
    return { configured: configured, select: select, search: search, recent: recent, status: status, base: base };
  }
  var api = { client: client, readOnly: readOnly, ftsQuery: ftsQuery, pipeUrl: pipeUrl };
  if (typeof window !== "undefined") window.SysAiMayaChatlog = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
