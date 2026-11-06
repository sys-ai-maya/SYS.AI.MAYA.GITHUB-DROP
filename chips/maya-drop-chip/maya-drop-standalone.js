(typeof window !== "undefined" ? window : globalThis).MythosDrop = (function () {
"use strict";

var VERSION = "1.0.0";
var DEFAULT_MANIFEST = "https://raw.githubusercontent.com/sys-ai-maya/SYS.AI.MAYA.GITHUB-DROP/main/drop/manifest.json";
var MERGE_FIELDS = ["verified", "verified_summary", "verified_at"];

function fail(msg) { return { ok: false, error: msg }; }
function secs(t0) { return ((Date.now() - t0) / 1000).toFixed(1) + "S"; }
function hex(buf) {
  var b = new Uint8Array(buf), s = "";
  for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
  return s;
}
function copy(o) { return JSON.parse(JSON.stringify(o)); }
function pickFetch(opts) {
  if (opts && typeof opts.fetch === "function") return opts.fetch;
  if (typeof fetch === "function") return fetch.bind(typeof window !== "undefined" ? window : globalThis);
  return null;
}
function pickSubtle(opts) {
  if (opts && opts.subtle && typeof opts.subtle.digest === "function") return opts.subtle;
  var c = typeof crypto !== "undefined" ? crypto : null;
  return c && c.subtle && typeof c.subtle.digest === "function" ? c.subtle : null;
}
function decode(buf) {
  try { return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(buf) }; }
  catch (e) { return fail("NOT UTF-8 :: " + e.message); }
}
function parseAs(file, text) {
  if (/\.json$/i.test(file)) {
    try { return { ok: true, data: JSON.parse(text), as: "json" }; }
    catch (e) { return fail("BAD JSON :: " + e.message); }
  }
  if (/\.jsonl$/i.test(file)) {
    var out = [], lines = text.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      try { out.push(JSON.parse(lines[i])); }
      catch (e) { return fail("BAD JSONL LINE " + (i + 1) + " :: " + e.message); }
    }
    return { ok: true, data: out, as: "jsonl" };
  }
  return { ok: true, data: text, as: "text" };
}
function validEntry(e) {
  return !!e && typeof e.id === "string" && typeof e.file === "string" && typeof e.raw_url === "string" &&
    typeof e.sha256 === "string" && /^[0-9a-f]{64}$/.test(e.sha256) && typeof e.bytes === "number";
}

function merge(shelf, patch) {
  if (!shelf || typeof shelf !== "object") return fail("DENIED - merge(shelf, patch) needs shelf-index.json as an object.");
  var arr = Array.isArray(patch) ? patch : (patch && Array.isArray(patch.data) ? patch.data : null);
  if (!arr) return fail("DENIED - patch must be the verification array or a get() result.");
  var out;
  try { out = copy(shelf); } catch (e) { return fail("SHELF NOT CLONEABLE :: " + e.message); }
  var entries = Array.isArray(out) ? out : out.entries;
  if (!Array.isArray(entries)) return fail("SHELF REFUSED :: no entries[] array :: NOTHING MERGED.");
  var byId = {}, dupes = [];
  entries.forEach(function (en) {
    if (en && typeof en.id === "string") {
      if (Object.prototype.hasOwnProperty.call(byId, en.id)) dupes.push(en.id);
      byId[en.id] = en;
    }
  });
  if (dupes.length) return fail("SHELF AMBIGUOUS :: duplicate ids " + dupes.join(", ") + " :: NOTHING MERGED.");
  var merged = [], unchanged = [], missing = [], skipped = [], review = [];
  arr.forEach(function (p, i) {
    if (!p || typeof p.id !== "string") { skipped.push(i); return; }
    if (!Object.prototype.hasOwnProperty.call(byId, p.id)) { missing.push(p.id); return; }
    var en = byId[p.id], changed = false;
    MERGE_FIELDS.forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(p, k) && en[k] !== p[k]) { en[k] = p[k]; changed = true; }
    });
    (changed ? merged : unchanged).push(p.id);
    if (Array.isArray(p.mismatches) && p.mismatches.length) review.push({ id: p.id, mismatches: p.mismatches.slice() });
  });
  var ran = 0, read = 0;
  entries.forEach(function (en) { if (en && en.verified === "ran") ran++; else read++; });
  return {
    ok: true, shelf: out, fields: MERGE_FIELDS.slice(),
    merged: merged, unchanged: unchanged, missing: missing, skipped: skipped, review: review,
    report: { entries: entries.length, ran: ran, read_only: read },
    note: "Only verified, verified_summary, verified_at were written. mismatches[] are review-only. Nothing was saved: the host saves."
  };
}

function client(opts) {
  opts = opts || {};
  var manifestUrl = typeof opts.manifestUrl === "string" && opts.manifestUrl ? opts.manifestUrl : DEFAULT_MANIFEST;
  var timeoutMs = typeof opts.timeoutMs === "number" && opts.timeoutMs > 0 ? opts.timeoutMs : 15000;
  var cached = null;

  function pull(url) {
    var f = pickFetch(opts), t0 = Date.now();
    if (!f) return Promise.resolve(fail("NO FETCH :: pass opts.fetch :: NOTHING WAS TOUCHED."));
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, timeoutMs) : null;
    return Promise.resolve()
      .then(function () { return ctl ? f(url, { signal: ctl.signal }) : f(url); })
      .then(function (res) {
        if (!res || !res.ok) return fail("FETCH REFUSED (" + (res ? res.status : "no response") + ") :: " + url + " :: NOTHING ELSE WAS TOUCHED.");
        return res.arrayBuffer().then(function (buf) { return { ok: true, buf: buf }; });
      })
      .catch(function (e) {
        var why = e && e.name === "AbortError" ? "TIMED OUT" : (e && e.message) || String(e);
        return fail("FAILED AFTER " + secs(t0) + " :: " + url + " :: " + why + " :: NOTHING ELSE WAS TOUCHED.");
      })
      .then(function (r) { if (timer) clearTimeout(timer); return r; });
  }

  function summary(p) { return { ok: true, manifestUrl: manifestUrl, count: p.length, items: copy(p) }; }

  function list(o) {
    o = o || {};
    if (cached && !o.fresh) return Promise.resolve(summary(cached));
    return pull(manifestUrl).then(function (r) {
      if (!r.ok) return r;
      var d = decode(r.buf);
      if (!d.ok) return fail("MANIFEST " + d.error);
      var p;
      try { p = JSON.parse(d.text); } catch (e) { return fail("MANIFEST BAD JSON :: " + e.message); }
      if (!Array.isArray(p)) return fail("MANIFEST REFUSED :: expected an array of {id,file,raw_url,sha256,bytes,for,created_at}.");
      for (var i = 0; i < p.length; i++) {
        if (!validEntry(p[i])) return fail("MANIFEST REFUSED :: entry " + i + " lacks id/file/raw_url/sha256/bytes.");
      }
      cached = p;
      return summary(p);
    });
  }

  function get(id, o) {
    o = o || {};
    if (typeof id !== "string" || !id) return Promise.resolve(fail("DENIED - get(id) needs a manifest id string."));
    var subtle = pickSubtle(opts);
    if (!subtle) return Promise.resolve(fail("NO crypto.subtle :: CANNOT VERIFY SHA256 :: NOTHING RETURNED. Use an https page or pass opts.subtle."));
    return list(o).then(function (m) {
      if (!m.ok) return m;
      var e = null, ids = [];
      for (var i = 0; i < m.items.length; i++) { ids.push(m.items[i].id); if (m.items[i].id === id) e = m.items[i]; }
      if (!e) return fail("NO SUCH DROP :: " + id + " :: manifest has " + ids.join(", "));
      return pull(e.raw_url).then(function (r) {
        if (!r.ok) return r;
        return Promise.resolve().then(function () { return subtle.digest("SHA-256", r.buf); }).then(function (h) {
          var got = hex(h), n = r.buf.byteLength;
          if (got !== e.sha256) {
            return fail("SHA256 MISMATCH :: " + id + " :: want " + e.sha256.slice(0, 16) + "... got " + got.slice(0, 16) + "... (" + n + "b) :: stale CDN copy or changed bytes, retry in 5 minutes :: NOTHING RETURNED.");
          }
          if (n !== e.bytes) return fail("BYTE COUNT MISMATCH :: " + id + " :: want " + e.bytes + " got " + n + " :: NOTHING RETURNED.");
          var d = decode(r.buf);
          if (!d.ok) return fail(id + " " + d.error);
          var p = parseAs(e.file, d.text);
          if (!p.ok) return fail(id + " " + p.error);
          return { ok: true, id: id, file: e.file, raw_url: e.raw_url, sha256: got, bytes: n, as: p.as, data: p.data, for: e.for, created_at: e.created_at };
        }, function (err) {
          return fail("DIGEST FAILED :: " + ((err && err.message) || String(err)) + " :: NOTHING RETURNED.");
        });
      });
    });
  }

  function mergeFrom(shelf, id, o) {
    return get(id || "mythos-chip-repo.v31.verification-patch", o).then(function (g) {
      if (!g.ok) return g;
      var m = merge(shelf, g.data);
      if (m.ok) { m.source = { id: g.id, raw_url: g.raw_url, sha256: g.sha256, bytes: g.bytes }; }
      return m;
    });
  }

  return { list: list, get: get, merge: merge, mergeFrom: mergeFrom, help: help, describe: describe, manifestUrl: manifestUrl };
}

function help() {
  return [
    "MythosDrop " + VERSION + " :: sha256-pinned drops from SYS.AI.MAYA.GITHUB-DROP",
    "var drop = MythosDrop.client({ manifestUrl, fetch, subtle, timeoutMs })",
    "drop.list({fresh}) -> { ok, manifestUrl, count, items:[{id,file,raw_url,sha256,bytes,for,created_at}] }",
    "drop.get(id) -> { ok, id, file, raw_url, sha256, bytes, as, data } only after sha256 matches",
    "drop.merge(shelf, patch) -> { ok, shelf, merged, unchanged, missing, skipped, review, report } pure, saves nothing",
    "drop.mergeFrom(shelf, id) -> get(id) then merge",
    "refusals come back as { ok:false, error } and never throw"
  ].join("\n");
}

function describe() {
  return { name: "maya-drop-chip", global: "MythosDrop", version: VERSION, spec: "CHIP SPEC v1", manifest: DEFAULT_MANIFEST, mergeFields: MERGE_FIELDS.slice(), functions: ["client", "list", "get", "merge", "mergeFrom", "help", "describe"] };
}

return { client: client, merge: merge, help: help, describe: describe, version: VERSION };
})();
if (typeof module !== "undefined" && module.exports) module.exports = (typeof window !== "undefined" ? window : globalThis).MythosDrop;
