(function () {
  "use strict";
  var TAG = "MINILM-PLAYER";
  var SPEC = "CHIP SPEC v1";
  var MODEL = "all-MiniLM-L6-v2";
  var DIM = 384;
  var VERSION = "1.0.0";
  var LIMITS = { max_k: 50, max_chars: 4000 };

  function refuse(why) { return new Error(TAG + " REFUSED (" + why + ") :: NOTHING ELSE WAS TOUCHED."); }
  function isStr(x) { return typeof x === "string"; }
  function fail(code, message, detail) { return { ok: false, error: { code: code, message: message, detail: detail || {} } }; }
  function clampInt(v, lo, hi, dflt) {
    v = (v == null) ? dflt : Math.floor(Number(v));
    if (!isFinite(v)) v = dflt;
    return Math.max(lo, Math.min(hi, v));
  }

  function hexOf(bytes) {
    var s = "", i;
    for (i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
    return s;
  }

  var VIS = { self: 1, global: 1, public: 1 };

  // SYS.AI.MAYA.PERCHANCE seam: vectors may be held as Float32Array (lean stream load) as well as plain arrays.
  function isVec(x) { return Array.isArray(x) || (typeof Float32Array !== "undefined" && x instanceof Float32Array); }

  // SYS.AI.MAYA.PERCHANCE seam: incremental SHA-256 over bytes, so a 300 MB pack body can be hashed without holding it as one string.
  function Sha256() {
    var K = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
    var H = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
    var W = new Uint32Array(64), buf = new Uint8Array(64), bl = 0, total = 0;
    function block(b, o) {
      var i, t1, t2, a = H[0], c1 = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 16; i++) W[i] = (b[o + i * 4] << 24) | (b[o + i * 4 + 1] << 16) | (b[o + i * 4 + 2] << 8) | b[o + i * 4 + 3];
      for (i = 16; i < 64; i++) {
        var x = W[i - 15], y = W[i - 2];
        var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
      }
      for (i = 0; i < 64; i++) {
        t1 = (h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
        t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & c1) ^ (a & c) ^ (c1 & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = c1; c1 = a; a = (t1 + t2) | 0;
      }
      H[0] += a; H[1] += c1; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    function update(u8) {
      var i = 0, n = u8.length;
      total += n;
      if (bl) { while (bl < 64 && i < n) buf[bl++] = u8[i++]; if (bl === 64) { block(buf, 0); bl = 0; } }
      while (i + 64 <= n) { block(u8, i); i += 64; }
      while (i < n) buf[bl++] = u8[i++];
    }
    function hex() {
      var bits = total * 8, pad = new Uint8Array(((bl < 56) ? 56 : 120) - bl + 8), i;
      pad[0] = 0x80;
      var hi = Math.floor(bits / 4294967296), lo = bits >>> 0, L = pad.length;
      pad[L - 8] = hi >>> 24; pad[L - 7] = hi >>> 16; pad[L - 6] = hi >>> 8; pad[L - 5] = hi;
      pad[L - 4] = lo >>> 24; pad[L - 3] = lo >>> 16; pad[L - 2] = lo >>> 8; pad[L - 1] = lo;
      update(pad);
      var out = "";
      for (i = 0; i < 8; i++) out += (H[i] >>> 0).toString(16).padStart(8, "0");
      return out;
    }
    return { update: update, hex: hex };
  }

  function normEnt(s) {
    return String(s == null ? "" : s).normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function visOf(rec, dflt) {
    var p = rec && rec.p;
    return (isStr(p) && p) ? p : dflt;
  }

  function checkAllowed(allowed, dflt) {
    if (allowed == null) return null;
    if (!Array.isArray(allowed) || !allowed.length) return { fail: fail("E_BAD_REQUEST", TAG + " REFUSED (allowed must be a non-empty array of self|global|public) :: NOTHING ELSE WAS TOUCHED.", {}) };
    for (var i = 0; i < allowed.length; i++) {
      if (!VIS[allowed[i]]) return { fail: fail("E_BAD_REQUEST", TAG + " REFUSED (bad allowed visibility " + allowed[i] + ") :: NOTHING ELSE WAS TOUCHED.", {}) };
    }
    return { list: allowed, dflt: (isStr(dflt) && dflt && VIS[dflt]) ? dflt : "self" };
  }

  async function sha256hex(text) {
    if (!crypto || !crypto.subtle) throw refuse("E_NO_SHA - WebCrypto unavailable");
    var digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return hexOf(new Uint8Array(digest));
  }

  async function gunzip(bytes) {
    var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (u8.length >= 2 && u8[0] === 0x1f && u8[1] === 0x8b) {
      if (typeof DecompressionStream === "undefined") throw refuse("E_PACK_INVALID - gzip pack but no DecompressionStream");
      var stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream("gzip"));
      var buf = await new Response(stream).arrayBuffer();
      return new TextDecoder("utf-8", { fatal: true }).decode(buf);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(u8);
  }

  function cosineInto(a, na, b, nb) {
    var dot = 0, i;
    for (i = 0; i < DIM; i++) dot += a[i] * b[i];
    var mag = na * nb;
    return mag === 0 ? 0 : dot / mag;
  }

  function client(opts) {
    var o = opts || {};
    var embedder = o.embedder || null;
    var pack = null;

    function packRef() {
      if (!pack) return null;
      return { tag: pack.tag, version: pack.version, agent: pack.agentId, model: pack.model, dim: pack.dim };
    }

    function prov(v, extra) {
      var p = { pack: pack.tag, version: pack.version, agent: pack.agentId, record: v.id, type: "vector", source: v.src, chunk: v.id };
      if (extra) for (var k in extra) p[k] = extra[k];
      return p;
    }

    function meta() {
      return { player: TAG + "/" + VERSION, ts: new Date().toISOString() };
    }

    async function load(bytesOrText, opts2) {
      var ex = (opts2 && opts2.expect) || {};
      var text;
      if (isStr(bytesOrText)) {
        text = bytesOrText;
      } else {
        try {
          text = await gunzip(bytesOrText);
        } catch (e) {
          throw refuse("E_PACK_INVALID - pack could not be decoded: " + (e && e.message ? e.message : e));
        }
      }
      var raw = text.split("\n");
      if (raw.length && raw[raw.length - 1] === "") raw.pop();
      var header = null, vectors = [], edges = [], byId = {}, i, r;
      var parseErrors = 0, unknownTypes = 0, dupes = 0;
      for (i = 0; i < raw.length; i++) {
        if (!raw[i].trim()) continue;
        try {
          r = JSON.parse(raw[i]);
        } catch (e) {
          parseErrors++;
          continue;
        }
        if (r && r.type === "header") { if (!header) { header = r; continue; } }
        if (!r || typeof r !== "object") { parseErrors++; continue; }
        if (r.type === "vector") vectors.push(r);
        else if (r.type === "edge") edges.push(r);
        else { unknownTypes++; continue; }
        if (r.id) {
          if (byId[r.id]) dupes++;
          else byId[r.id] = r;
        }
      }
      if (!header) throw refuse("E_PACK_INVALID - no header line");
      var model = header.embeddingModel || null;
      var dim = header.embeddingDimension || null;
      if (model !== MODEL) throw refuse("E_SPACE_MISMATCH - pack model " + model + " is not the MiniLM lane " + MODEL);
      if (dim !== DIM) throw refuse("E_SPACE_MISMATCH - pack dim " + dim + " is not " + DIM);
      var agentId = String(header.agentId || (vectors[0] && vectors[0].a) || "UNKNOWN").toUpperCase();
      if (ex.agent && String(ex.agent).toUpperCase() !== agentId) throw refuse("E_SPACE_MISMATCH - pack agent " + agentId + " is not expected " + ex.agent);
      var bodyLines = raw.slice(1).filter(function (l) { return l.trim() !== ""; });
      var bodyText = bodyLines.join("\n") + (bodyLines.length ? "\n" : "");
      var ids = Object.keys(byId).sort();
      pack = {
        tag: "SYS.AI." + agentId + ".MINILM",
        ref: (opts2 && opts2.ref) || null,
        header: header, vectors: vectors, edges: edges, byId: byId,
        agentId: agentId, model: model, dim: dim,
        bodyText: bodyText,
        bodySha256: await sha256hex(bodyText),
        version: await sha256hex(ids.join("\n")),
        diagnostics: { parseErrors: parseErrors, unknownTypes: unknownTypes, duplicateIds: dupes, lineCount: raw.length }
      };
      for (i = 0; i < vectors.length; i++) {
        var v = vectors[i].vec, n = 0, k;
        if (isVec(v)) for (k = 0; k < v.length; k++) n += v[k] * v[k];
        vectors[i]._norm = Math.sqrt(n);
      }
      return { ok: true, pack: packRef(), vectors: vectors.length, edges: edges.length };
    }

    // SYS.AI.MAYA.PERCHANCE seam: lean streaming load for big packs (same checks and same pack shape as load(),
    // but lines are parsed one at a time from the byte stream, vec is held as Float32Array, and the body hash is
    // computed incrementally; bodyText is not retained). source = ReadableStream | Blob | ArrayBuffer | Uint8Array.
    async function loadStream(source, opts2) {
      var ex = (opts2 && opts2.expect) || {};
      var onProgress = (opts2 && typeof opts2.onProgress === "function") ? opts2.onProgress : null;
      var stream;
      if (source && typeof source.getReader === "function") stream = source;
      else if (typeof Blob !== "undefined" && source instanceof Blob) stream = source.stream();
      else stream = new Blob([source instanceof Uint8Array ? source : new Uint8Array(source)]).stream();
      // sniff gzip from the first chunk
      var rd0 = stream.getReader(), first = await rd0.read();
      var head = first.value || new Uint8Array(0);
      var rest = new ReadableStream({
        start: function (c) { if (head.length) c.enqueue(head); },
        pull: async function (c) { var r = await rd0.read(); if (r.done) c.close(); else c.enqueue(r.value); }
      });
      if (head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b) {
        if (typeof DecompressionStream === "undefined") throw refuse("E_PACK_INVALID - gzip pack but no DecompressionStream");
        rest = rest.pipeThrough(new DecompressionStream("gzip"));
      }
      var reader = rest.getReader(), dec = new TextDecoder("utf-8", { fatal: true }), sha = Sha256(), NL = new Uint8Array([10]);
      var header = null, vectors = [], edges = [], byId = {}, parseErrors = 0, unknownTypes = 0, dupes = 0, lineCount = 0, bytesIn = 0;
      var carry = null, firstLine = true;
      function onLine(bytes) {
        lineCount++;
        if (firstLine) { firstLine = false; handle(bytes, true); return; }
        var blank = true;
        for (var q = 0; q < bytes.length; q++) { var ch = bytes[q]; if (ch !== 32 && ch !== 9 && ch !== 13) { blank = false; break; } }
        if (blank) return;
        sha.update(bytes); sha.update(NL);
        handle(bytes, false);
      }
      function handle(bytes, isFirst) {
        var line;
        try { line = dec.decode(bytes); } catch (e) { parseErrors++; return; }
        if (!line.trim()) return;
        var r;
        try { r = JSON.parse(line); } catch (e) { parseErrors++; return; }
        if (r && r.type === "header") { if (!header) { header = r; return; } }
        if (!r || typeof r !== "object") { parseErrors++; return; }
        if (r.type === "vector") {
          if (Array.isArray(r.vec)) r.vec = Float32Array.from(r.vec);
          vectors.push(r);
        } else if (r.type === "edge") edges.push(r);
        else { unknownTypes++; return; }
        if (r.id) { if (byId[r.id]) dupes++; else byId[r.id] = r; }
      }
      for (;;) {
        var c = await reader.read();
        if (c.done) break;
        var u = c.value; bytesIn += u.length;
        var start = 0, i;
        for (i = 0; i < u.length; i++) {
          if (u[i] !== 10) continue;
          var seg = u.subarray(start, i);
          if (carry) { var m = new Uint8Array(carry.length + seg.length); m.set(carry); m.set(seg, carry.length); onLine(m); carry = null; }
          else onLine(seg);
          start = i + 1;
        }
        if (start < u.length) {
          var tail = u.slice(start);
          if (carry) { var m2 = new Uint8Array(carry.length + tail.length); m2.set(carry); m2.set(tail, carry.length); carry = m2; } else carry = tail;
        }
        if (onProgress) { try { onProgress({ bytes: bytesIn, vectors: vectors.length, edges: edges.length }); } catch (eP) {} }
      }
      if (carry && carry.length) onLine(carry);
      if (!header) throw refuse("E_PACK_INVALID - no header line");
      var model = header.embeddingModel || null;
      var dim = header.embeddingDimension || null;
      if (model !== MODEL) throw refuse("E_SPACE_MISMATCH - pack model " + model + " is not the MiniLM lane " + MODEL);
      if (dim !== DIM) throw refuse("E_SPACE_MISMATCH - pack dim " + dim + " is not " + DIM);
      var agentId = String(header.agentId || (vectors[0] && vectors[0].a) || "UNKNOWN").toUpperCase();
      if (ex.agent && String(ex.agent).toUpperCase() !== agentId) throw refuse("E_SPACE_MISMATCH - pack agent " + agentId + " is not expected " + ex.agent);
      var ids = Object.keys(byId).sort();
      pack = {
        tag: "SYS.AI." + agentId + ".MINILM",
        ref: (opts2 && opts2.ref) || null,
        header: header, vectors: vectors, edges: edges, byId: byId,
        agentId: agentId, model: model, dim: dim,
        bodyText: null,
        bodySha256: sha.hex(),
        version: await sha256hex(ids.join("\n")),
        diagnostics: { parseErrors: parseErrors, unknownTypes: unknownTypes, duplicateIds: dupes, lineCount: lineCount, bytes: bytesIn, lean: true }
      };
      for (i = 0; i < vectors.length; i++) {
        var v = vectors[i].vec, n = 0, k;
        if (isVec(v)) for (k = 0; k < v.length; k++) n += v[k] * v[k];
        vectors[i]._norm = Math.sqrt(n);
      }
      return { ok: true, pack: packRef(), vectors: vectors.length, edges: edges.length };
    }

    function needPack() {
      if (!pack) throw refuse("E_BAD_REQUEST - no pack loaded");
    }

    async function queryVectorFor(args) {
      if (args.text != null && (args.vector != null || args.like_id != null)) throw refuse("E_BAD_REQUEST - exactly one of text, vector, like_id");
      if (args.text != null) {
        if (!embedder || typeof embedder.embed !== "function") throw refuse("E_NO_EMBEDDER - text search needs the MiniLM lane for " + pack.model + "; pass a vector (+model) or like_id instead");
        var r;
        try {
          r = await embedder.embed(args.text, { model: pack.model, dim: pack.dim });
        } catch (e) {
          throw refuse("E_NO_EMBEDDER - lane failed: " + (e && e.message ? e.message : e));
        }
        return r.vector;
      }
      if (args.vector != null) {
        if (args.model !== pack.model) throw refuse("E_SPACE_MISMATCH - query vector model " + args.model + " is not the pack model " + pack.model);
        if (!isVec(args.vector) || args.vector.length !== pack.dim) throw refuse("E_SPACE_MISMATCH - query dimension " + (args.vector && args.vector.length) + " is not " + pack.dim);
        return args.vector;
      }
      if (args.like_id != null) {
        var v = pack.byId[args.like_id];
        if (!v || v.type !== "vector") throw refuse("E_NOT_FOUND - no vector " + args.like_id);
        return v.vec;
      }
      throw refuse("E_BAD_REQUEST - exactly one of text, vector, like_id");
    }

    async function search(args) {
      needPack();
      var a = args || {};
      var qv;
      try {
        qv = await queryVectorFor(a);
      } catch (e) {
        var m = String(e && e.message ? e.message : e);
        var code = "E_INTERNAL";
        if (m.indexOf("E_NO_EMBEDDER") === 0 || m.indexOf("E_NO_EMBEDDER") > 0) code = "E_NO_EMBEDDER";
        else if (m.indexOf("E_SPACE_MISMATCH") > -1) code = "E_SPACE_MISMATCH";
        else if (m.indexOf("E_BAD_REQUEST") > -1) code = "E_BAD_REQUEST";
        else if (m.indexOf("E_NOT_FOUND") > -1) code = "E_NOT_FOUND";
        return fail(code, m, {});
      }
      var qn = 0, i;
      for (i = 0; i < qv.length; i++) qn += qv[i] * qv[i];
      qn = Math.sqrt(qn);
      var k = clampInt(a.k, 1, LIMITS.max_k, 5);
      var min = (a.min_score == null) ? -2 : a.min_score;
      var srcs = Array.isArray(a.sources) && a.sources.length ? a.sources : null;
      var excl = a.exclude_self !== false && a.like_id != null;
      var maxChars = clampInt(a.max_chars, 0, LIMITS.max_chars, 400);
      var vf = checkAllowed(a.allowed, a.defaultVisibility);
      if (vf && vf.fail) return vf.fail;
      var scored = [];
      for (i = 0; i < pack.vectors.length; i++) {
        var v = pack.vectors[i];
        if (excl && v.id === a.like_id) continue;
        if (srcs && srcs.indexOf(v.src) < 0) continue;
        if (!isVec(v.vec) || v.vec.length !== DIM) continue;
        var s = cosineInto(qv, qn, v.vec, v._norm || 1);
        if (s >= min) scored.push({ v: v, score: s });
      }
      scored.sort(function (x, y) { return (y.score - x.score) || (x.v.id < y.v.id ? -1 : (x.v.id > y.v.id ? 1 : 0)); });
      var hidden = 0;
      if (vf) {
        var kept = [];
        for (i = 0; i < scored.length; i++) {
          if (vf.list.indexOf(visOf(scored[i].v, vf.dflt)) >= 0) kept.push(scored[i]);
          else hidden++;
        }
        scored = kept;
      }
      var hits = [], provenance = [];
      for (i = 0; i < Math.min(k, scored.length); i++) {
        var h = scored[i];
        var text = h.v.t || "";
        if (maxChars && text.length > maxChars) text = text.slice(0, maxChars);
        var hh = { id: h.v.id, score: h.score, src: h.v.src, text: text };
        if (h.v.p) hh.p = h.v.p;
        if (h.v.ps) hh.ps = h.v.ps;
        hits.push(hh);
        provenance.push(prov(h.v, { score: h.score }));
      }
      var res = { hits: hits };
      if (vf) res.hidden_by_policy = hidden;
      return { ok: true, pack: packRef(), result: res, provenance: provenance, meta: meta() };
    }

    function textSearch(args) {
      needPack();
      var a = args || {};
      if (!isStr(a.query) || !a.query) return fail("E_BAD_REQUEST", TAG + " REFUSED (empty query) :: NOTHING ELSE WAS TOUCHED.", {});
      var mode = a.mode || "all";
      var scope = a.scope || ["chunks"];
      var k = clampInt(a.k, 1, LIMITS.max_k, 10);
      var maxChars = clampInt(a.max_chars, 0, LIMITS.max_chars, 400);
      var vf = checkAllowed(a.allowed, a.defaultVisibility);
      if (vf && vf.fail) return vf.fail;
      var words = a.query.toLowerCase().split(/\s+/).filter(function (w) { return w; });
      var rows = [];
      if (scope.indexOf("chunks") >= 0) {
        for (var i = 0; i < pack.vectors.length; i++) rows.push({ id: pack.vectors[i].id, text: pack.vectors[i].t || "", rec: pack.vectors[i] });
      }
      if (scope.indexOf("edges") >= 0) {
        for (var j = 0; j < pack.edges.length; j++) {
          var e = pack.edges[j];
          rows.push({ id: e.id, text: [e.s, e.r, e.o].join(" "), rec: e });
        }
      }
      var scored = [], hits = [], provenance = [], i;
      for (i = 0; i < rows.length; i++) {
        var low = rows[i].text.toLowerCase();
        var keep = mode === "phrase" ? low.indexOf(a.query.toLowerCase()) >= 0 :
          mode === "any" ? words.some(function (w) { return low.indexOf(w) >= 0; }) :
          words.every(function (w) { return low.indexOf(w) >= 0; });
        if (!keep) continue;
        var m = 0, wi;
        if (mode === "phrase") m = low.split(a.query.toLowerCase()).length - 1;
        else for (wi = 0; wi < words.length; wi++) {
          var at = -1, c = 0;
          while ((at = low.indexOf(words[wi], at + 1)) >= 0) c++;
          m += c;
        }
        scored.push({ row: rows[i], matches: m });
      }
      scored.sort(function (x, y) { return (y.matches - x.matches) || (x.row.id < y.row.id ? -1 : (x.row.id > y.row.id ? 1 : 0)); });
      var hidden = 0;
      if (vf) {
        var keptS = [];
        for (i = 0; i < scored.length; i++) {
          if (vf.list.indexOf(visOf(scored[i].row.rec, vf.dflt)) >= 0) keptS.push(scored[i]);
          else hidden++;
        }
        scored = keptS;
      }
      for (i = 0; i < scored.length && hits.length < k; i++) {
        var text = scored[i].row.text;
        if (maxChars && text.length > maxChars) text = text.slice(0, maxChars);
        var th = { id: scored[i].row.id, text: text, matches: scored[i].matches };
        if (scored[i].row.rec.p) th.p = scored[i].row.rec.p;
        hits.push(th);
        var pv = { pack: pack.tag, version: pack.version, agent: pack.agentId, record: scored[i].row.id, type: scored[i].row.rec.type || "vector" };
        if (scored[i].row.rec.src) pv.source = scored[i].row.rec.src;
        if (scored[i].row.rec.type === "edge") pv.chunk = scored[i].row.rec.src;
        else pv.chunk = scored[i].row.id;
        provenance.push(pv);
      }
      var tres = { hits: hits, total_matches: scored.length };
      if (vf) tres.hidden_by_policy = hidden;
      return { ok: true, pack: packRef(), result: tres, provenance: provenance, meta: meta() };
    }

    function edgeOrigin(e) { return e.og ? (e.og === "heuristic" ? "heuristic" : "model:" + e.og) : "unknown"; }

    function graphIndex() {
      var out = {}, inn = {}, bySrc = {}, entities = {}, i, e, s, o;
      function push(m, k, v) { if (!m[k]) m[k] = []; m[k].push(v); }
      for (i = 0; i < pack.edges.length; i++) {
        e = pack.edges[i];
        s = normEnt(e.s); o = normEnt(e.o);
        push(out, s, i); push(inn, o, i); push(bySrc, e.src, i);
        if (!entities[s]) entities[s] = e.s;
        if (!entities[o]) entities[o] = e.o;
      }
      return { out: out, inn: inn, bySrc: bySrc, entities: entities };
    }

    function graphTraverse(args) {
      needPack();
      var a = args || {};
      var vf = checkAllowed(a.allowed, a.defaultVisibility);
      if (vf && vf.fail) return vf.fail;
      var idx = graphIndex();
      var hops = clampInt(a.hops, 1, 3, 1);
      var maxEdges = clampInt(a.max_edges, 1, 500, 100);
      var dir = a.direction || "both";
      if (dir !== "out" && dir !== "in" && dir !== "both") return fail("E_BAD_REQUEST", TAG + " REFUSED (E_BAD_REQUEST - direction must be out|in|both) :: NOTHING ELSE WAS TOUCHED.", {});
      var inclH = !!a.include_heuristic;
      var exclP = {}, onlyP = null, pi;
      (a.exclude_predicates || []).forEach(function (p) { exclP[normEnt(p)] = 1; });
      if (a.predicates) {
        if (!Array.isArray(a.predicates)) return fail("E_BAD_REQUEST", TAG + " REFUSED (E_BAD_REQUEST - predicates must be an array) :: NOTHING ELSE WAS TOUCHED.", {});
        onlyP = {};
        a.predicates.forEach(function (p) { onlyP[normEnt(p)] = 1; });
      }
      var starts = [];
      if (a.chunk_id != null) {
        if (!pack.byId[a.chunk_id] || pack.byId[a.chunk_id].type !== "vector") return fail("E_NOT_FOUND", TAG + " REFUSED (E_NOT_FOUND - chunk not in pack: " + a.chunk_id + ") :: NOTHING ELSE WAS TOUCHED.", { chunk_id: a.chunk_id });
        (idx.bySrc[a.chunk_id] || []).forEach(function (i) { starts.push(normEnt(pack.edges[i].s)); });
      }
      if (a.start != null) {
        if (!Array.isArray(a.start)) return fail("E_BAD_REQUEST", TAG + " REFUSED (E_BAD_REQUEST - start must be an array) :: NOTHING ELSE WAS TOUCHED.", {});
        a.start.forEach(function (s) { starts.push(normEnt(s)); });
      }
      var seenS = {}, uniq = [], si;
      for (si = 0; si < starts.length; si++) {
        if (!seenS[starts[si]]) { seenS[starts[si]] = 1; uniq.push(starts[si]); }
      }
      starts = uniq;
      var missing = starts.filter(function (s) { return !idx.entities[s]; });
      if (!starts.length || missing.length === starts.length) {
        var probe = normEnt((a.start || [])[0] || "");
        var sugg = probe ? Object.keys(idx.entities).filter(function (k) { return k.indexOf(probe) >= 0; }).slice(0, 10) : [];
        return fail("E_NOT_FOUND", TAG + " REFUSED (E_NOT_FOUND - no start entity found in the graph) :: NOTHING ELSE WAS TOUCHED.", { start: a.start || [], suggestions: sugg });
      }
      var depth = {}, frontier = [], fi;
      starts.forEach(function (s) { if (idx.entities[s] && depth[s] == null) { depth[s] = 0; frontier.push(s); } });
      var taken = {}, thop = {}, truncated = false, h, f, c, ci;
      function okE(e) {
        if (!inclH && e.og === "heuristic") return false;
        var r = normEnt(e.r);
        if (exclP[r]) return false;
        if (onlyP && !onlyP[r]) return false;
        return true;
      }
      for (h = 1; h <= hops && frontier.length && !truncated; h++) {
        var next = [];
        for (f = 0; f < frontier.length && !truncated; f++) {
          var ent = frontier[f], cand = [];
          if (dir !== "in") (idx.out[ent] || []).forEach(function (i) { cand.push([i, normEnt(pack.edges[i].o)]); });
          if (dir !== "out") (idx.inn[ent] || []).forEach(function (i) { cand.push([i, normEnt(pack.edges[i].s)]); });
          for (c = 0; c < cand.length; c++) {
            var e = pack.edges[cand[c][0]];
            if (taken[e.id] || !okE(e)) continue;
            if (Object.keys(taken).length >= maxEdges) { truncated = true; break; }
            taken[e.id] = 1; thop[e.id] = h;
            var other = cand[c][1];
            if (depth[other] == null) { depth[other] = h; next.push(other); }
          }
        }
        frontier = next;
      }
      var edges = [], nodes = [], hidden = 0, e2;
      Object.keys(taken).forEach(function (id) {
        var e = pack.byId[id];
        var pe = { id: e.id, s: e.s, r: e.r, o: e.o, src: e.src, origin: edgeOrigin(e), hop: thop[id] };
        if (e.p) pe.p = e.p;
        if (vf && (vf.list.indexOf(visOf(e, vf.dflt)) < 0 || vf.list.indexOf(visOf(pack.byId[e.src], vf.dflt)) < 0)) { hidden++; return; }
        edges.push(pe);
      });
      edges.sort(function (x, y) { return (x.hop - y.hop) || (x.id < y.id ? -1 : (x.id > y.id ? 1 : 0)); });
      Object.keys(depth).forEach(function (k) {
        nodes.push({ entity: idx.entities[k], key: k, hop: depth[k], degree: (idx.out[k] || []).length + (idx.inn[k] || []).length });
      });
      nodes.sort(function (x, y) { return (x.hop - y.hop) || (y.degree - x.degree) || (x.key < y.key ? -1 : 1); });
      var provenance = edges.map(function (e) {
        var src = pack.byId[e.src] || {};
        return { pack: pack.tag, version: pack.version, agent: pack.agentId, record: e.id, type: "edge", source: src.src || null, chunk: e.src, origin: e.origin, hop: e.hop };
      });
      var gres = { start: starts, hops: hops, direction: dir, include_heuristic: inclH, truncated: truncated, nodes: nodes, edges: edges, missing_start: missing };
      if (vf) gres.hidden_by_policy = hidden;
      return { ok: true, pack: packRef(), result: gres, provenance: provenance, meta: meta() };
    }

    function recordGet(args) {
      needPack();
      var a = args || {};
      var r = pack.byId[a.id];
      if (!r) return fail("E_NOT_FOUND", TAG + " REFUSED (E_NOT_FOUND - no record " + a.id + ") :: NOTHING ELSE WAS TOUCHED.", {});
      var vf = checkAllowed(a.allowed, a.defaultVisibility);
      if (vf && vf.fail) return vf.fail;
      if (vf && vf.list.indexOf(visOf(r, vf.dflt)) < 0) return fail("E_DENIED", TAG + " REFUSED (E_DENIED - record not exposed to caller) :: NOTHING ELSE WAS TOUCHED.", {});
      var out = { id: r.id, type: r.type, record: r };
      if (r.p) out.p = r.p;
      var pvs = [{ pack: pack.tag, version: pack.version, agent: pack.agentId, record: r.id, type: r.type, source: r.src || null, chunk: r.type === "edge" ? r.src : r.id }];
      var hidden = 0;
      if (r.type === "vector") {
        var eids = pack.edges.filter(function (e) { return e.src === r.id; }).map(function (e) { return e.id; });
        if (vf) {
          var keptE = [];
          for (var ei = 0; ei < eids.length; ei++) {
            var er = pack.byId[eids[ei]];
            if (vf.list.indexOf(visOf(er, vf.dflt)) >= 0) keptE.push(eids[ei]);
            else hidden++;
          }
          eids = keptE;
        }
        out.edges = eids;
      } else if (r.type === "edge") {
        out.chunk = pack.byId[r.src] || null;
      }
      if (vf && hidden) out.hidden_by_policy = hidden;
      return { ok: true, pack: packRef(), result: out, provenance: pvs, meta: meta() };
    }

    function stats() {
      needPack();
      var bySrc = {}, i;
      for (i = 0; i < pack.vectors.length; i++) bySrc[pack.vectors[i].src] = (bySrc[pack.vectors[i].src] || 0) + 1;
      return {
        ok: true, pack: packRef(),
        result: { vectors: pack.vectors.length, edges: pack.edges.length, sources: Object.keys(bySrc).length, perSource: bySrc, model: pack.model, dim: pack.dim, diagnostics: pack.diagnostics },
        provenance: [{ pack: pack.tag, version: pack.version, agent: pack.agentId, record: null, type: "pack" }],
        meta: meta()
      };
    }

    function sources() {
      needPack();
      var rows = {}, i;
      for (i = 0; i < pack.vectors.length; i++) {
        var v = pack.vectors[i];
        if (!rows[v.src]) rows[v.src] = { source: v.src, chunks: 0, edges: 0 };
        rows[v.src].chunks++;
      }
      for (i = 0; i < pack.edges.length; i++) {
        var s = pack.edges[i].src;
        if (!rows[s]) rows[s] = { source: s, chunks: 0, edges: 0 };
        rows[s].edges++;
      }
      var list = Object.keys(rows).map(function (k) { return rows[k]; });
      return {
        ok: true, pack: packRef(), result: { sources: list },
        provenance: [{ pack: pack.tag, version: pack.version, agent: pack.agentId, record: null, type: "pack" }],
        meta: meta()
      };
    }

    function norm(s) {
      return String(s == null ? "" : s).normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
    }

    async function verify(opts) {
      needPack();
      var strict = !!(opts && opts.strict);
      var checks = [];
      function check(name, st, detail) {
        var ok = st !== "fail";
        checks.push({ name: name, ok: ok, status: st, detail: detail == null ? "" : String(detail) });
      }
      var h = pack.header, i, k;
      function st(b) { return b ? "pass" : "fail"; }
      check("LP-HEADER present", st(!!h), h ? ("v" + h.v + " " + h.agentId) : "missing");
      check("LP-PIN model " + MODEL, st(pack.model === MODEL), pack.model);
      check("LP-PIN dim " + DIM, st(pack.dim === DIM), pack.dim);
      check("LP-COUNTS vectors", st(h.totalVectors === pack.vectors.length), h.totalVectors + " vs " + pack.vectors.length);
      check("LP-COUNTS edges", st(h.totalEdges === pack.edges.length), h.totalEdges + " vs " + pack.edges.length);
      check("LP-BODYSHA recomputed", st((pack.bodyText == null ? pack.bodySha256 : (await sha256hex(pack.bodyText))) === h.bodySha256), pack.bodyText == null ? "match (streamed)" : "match");
      var seenV = {}, vecIds = [];
      for (i = 0; i < pack.vectors.length; i++) {
        var vid = pack.vectors[i].id;
        if (vid && !seenV[vid]) { seenV[vid] = 1; vecIds.push(vid); }
      }
      vecIds.sort();
      check("LP-RECORDSET recomputed", st((await sha256hex(vecIds.join("\n"))) === h.recordSetSha256), "match");
      var badDim = 0, badModel = 0, zeroVec = 0, seen = {}, dupes = 0;
      for (i = 0; i < pack.vectors.length; i++) {
        var v = pack.vectors[i];
        if (!isVec(v.vec) || v.vec.length !== DIM) badDim++;
        if (!v.d || v.d.embeddingModel !== MODEL) badModel++;
        var n = 0;
        if (isVec(v.vec)) for (k = 0; k < v.vec.length; k++) n += v.vec[k] * v.vec[k];
        if (n === 0) zeroVec++;
        if (v.id) {
          if (seen[v.id]) dupes++;
          else seen[v.id] = 1;
        }
      }
      check("LP-DIMS all " + DIM, st(badDim === 0), badDim + " bad");
      check("LP-MODELS all " + MODEL, st(badModel === 0), badModel + " bad");
      check("LP-ZEROVEC none", st(zeroVec === 0), zeroVec + " zero");
      check("LP-DUPES none", st(dupes === 0), dupes + " dupes");
      check("LP-PARSE clean", st(pack.diagnostics.parseErrors === 0), pack.diagnostics.parseErrors + " errors");
      var unk = pack.diagnostics.unknownTypes || 0;
      check("LP-V03b unknown types", unk === 0 ? "pass" : (strict ? "fail" : "warn"), unk + " unknown");
      var orphans = pack.edges.filter(function (e) { var t = pack.byId[e.src]; return !t || t.type !== "vector"; }).length;
      check("LP-V09 no orphans", st(orphans === 0), orphans + " orphan(s)");
      var owner = String((h && h.agentId) || pack.agentId || "UNKNOWN").toUpperCase();
      var foreign = pack.vectors.filter(function (x) { return String(x.a || "").toUpperCase() !== owner; }).length +
        pack.edges.filter(function (e) { return String(e.aid || "").toUpperCase() !== owner; }).length;
      check("LP-V18 single owner", st(foreign === 0), foreign + " foreign record(s)");
      var seenT = {}, dupT = 0;
      for (i = 0; i < pack.edges.length; i++) {
        var e = pack.edges[i];
        var tk = e.src + "|" + norm(e.s) + "|" + norm(e.r) + "|" + norm(e.o);
        if (seenT[tk]) dupT++;
        else seenT[tk] = 1;
      }
      check("LP-V13 no dup triplets", st(dupT === 0), dupT + " duplicate(s)");
      var unstamped = 0, hi = 0;
      for (i = 0; i < pack.edges.length; i++) {
        if (pack.edges[i].og) hi++;
        else unstamped++;
      }
      check("LP-V12 og stamped", unstamped === 0 ? "pass" : (strict ? "fail" : "warn"), unstamped === 0 ? (hi > 0 ? hi + " stamped" : "no edges") : (unstamped + " edge(s) without og (legacy pack: filler cannot be told from model output)"));
      var badP = 0, stampedP = 0, pv3;
      for (pv3 = 0; pv3 < pack.vectors.length; pv3++) {
        if (pack.vectors[pv3].p == null) continue;
        if (VIS[pack.vectors[pv3].p]) stampedP++;
        else badP++;
      }
      for (pv3 = 0; pv3 < pack.edges.length; pv3++) {
        if (pack.edges[pv3].p == null) continue;
        if (VIS[pack.edges[pv3].p]) stampedP++;
        else badP++;
      }
      check("LP-V20 visibility values", badP === 0 ? "pass" : "fail", badP === 0 ? (stampedP ? stampedP + " stamped (self|global|public), rest owner-default" : "no p stamped (owner-default)") : (badP + " bad p value(s)"));
      var ok = checks.every(function (c) { return c.ok; });
      return {
        ok: true, pack: packRef(), result: { ok: ok, checks: checks },
        provenance: [{ pack: pack.tag, version: pack.version, agent: pack.agentId, record: null, type: "pack" }],
        meta: meta()
      };
    }

    function capabilities() {
      return {
        ok: true, pack: packRef(),
        result: {
          player: TAG + "/" + VERSION, lane: { model: MODEL, dim: DIM },
          ops: ["search", "textSearch", "graphTraverse", "recordGet", "stats", "sources", "verify", "capabilities"],
          limits: LIMITS,
          visibility: { values: ["self", "global", "public"], defaultWhenAbsent: "self", filterArgs: ["allowed", "defaultVisibility"] },
          embedder: embedder && typeof embedder.embed === "function" ? { available: true, model: MODEL, dim: DIM } : { available: false }
        },
        provenance: [], meta: meta()
      };
    }

    function describe() {
      return TAG + " - the 384-D MiniLM reader (for LOREPACK). Loads one MiniLM pack (refuses anything else), searches it by text / vector / like_id (self-excluded, score-sorted with id tiebreak, provenance per hit; text without a lane refuses E_NO_EMBEDDER with no keyword fallback, wrong-model/dim vectors refuse E_SPACE_MISMATCH), walks the triplet graph by chunk_id/start entities (graphTraverse, k-hop, heuristic edges excluded unless asked), textSearches chunks+edges sorted by matches, recordGets with attached edges/chunk. Visibility: records carry p (self|global|public, absent = owner default); search/textSearch/recordGet/graphTraverse accept allowed[] + defaultVisibility to enforce a caller view (hidden_by_policy counted, recordGet refuses E_DENIED). Keyless with the MiniLM lane.";
    }

    return { load: load, loadStream: loadStream, header: function () { return pack ? pack.header : null; }, search: search, textSearch: textSearch, graphTraverse: graphTraverse, recordGet: recordGet, stats: stats, sources: sources, verify: verify, capabilities: capabilities, describe: describe };
  }

  function describe() {
    return TAG + " - the lorepack player for the Microsoft MiniLM lane (for READING). One pack, one space: " + MODEL + " / " + DIM + "-D or nothing.";
  }

  var api = { client: client, MODEL: MODEL, DIM: DIM, VERSION: VERSION, SPEC: SPEC, describe: describe };
  if (typeof window !== "undefined") window.MythosMinilmPlayer = api;
  if (typeof self !== "undefined" && typeof window === "undefined") self.MythosMinilmPlayer = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
