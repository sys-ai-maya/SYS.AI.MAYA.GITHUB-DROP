/* SYS.AI.MAYA.PERCHANCE - Maya space (lane 016) :: bundle of js/*.js in order: config | mode | afa | minilm | minilm-player | lore-pack | lore-chatlog | oracle | comms | space. Edit the pieces, not this. */
/* ---- piece: config ---- */
// SYS.AI.MAYA.PERCHANCE - config :: the ONE place for lane, sources and thresholds.
// Every other piece reads from here; nothing else hardcodes a URL, a lane or a number.
// Override any key per run with a URL hash param of the same name (e.g. #agent&op=ask&q=...&min=0.3).
(function () {
  "use strict";
  var CONFIG = {
    space: "SYS.AI.MAYA.PERCHANCE",      // this space's id (Maya's own space)
    lane: "016",                         // roster number
    agent: "MAYA",                       // whose space this is
    version: "0.1.0",

    // LORE SOURCES (read-only)
    lore: {
      packAgent: "ERATO",                // whose LorePack the Oracle reads (MiniLM-384, lorepack v2)
      packUrl: "",                       // optional URL of a .jsonl or .jsonl.gz pack; empty = use the locally cached pack
      packCacheKey: "lorepack:ERATO",     // IndexedDB key for the pack the human attached once (stays in this browser)
      chatlogBase: "https://sysaimuseerato-merkmorassi.aws-us-east-1.turso.io", // Erato's Turso lane (turns / turns_fts)
      chatlogTokenKey: "sysaimaya.lane.ERATO.token" // localStorage key; token is pasted by the human, never put in a URL
    },

    // RETRIEVAL
    retrieval: {
      k: 6,              // passages returned per tier
      min: 0.25,         // MiniLM cosine floor (same default as the Repo Depot oracle MIN SCORE)
      graphHops: 1,      // triplet-graph hops from the top chunks
      graphMax: 20,      // max graph edges returned
      chatCandidates: 24,// chatlog FTS rows fetched before MiniLM re-scoring
      maxChars: 1200     // chars of passage text returned per hit
    },

    // COMMS
    comms: {
      channel: "SYS.AI.MAYA.PERCHANCE.COMMS", // BroadcastChannel name (same-origin tabs)
      accept: ["SYS.AI.MAYA.PERCHANCE", "016", "MAYA"] // postMessage 'to' values this space answers
    },

    // SYNTHESIS (optional; Perchance ai-text-plugin as root.generateText)
    synth: { on: true, maxPassages: 8 }
  };
  if (typeof window !== "undefined") window.SYS_AI_MAYA_CONFIG = CONFIG;
  if (typeof module !== "undefined" && module.exports) module.exports = CONFIG;
})();

/* ---- piece: mode ---- */
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

/* ---- piece: afa ---- */
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

/* ---- piece: minilm ---- */
(function () {
  "use strict";
  var TAG = "MINILM";
  var SPEC = "CHIP SPEC v1";
  var MODEL = "all-MiniLM-L6-v2";
  var SOURCE_ID = "Xenova/all-MiniLM-L6-v2";
  var DIM = 384;
  var LOADER_URL = "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js";
  var CORES = (typeof navigator !== "undefined" && +navigator.hardwareConcurrency) || 4;
  var THREADS = Math.max(1, Math.min(8, CORES));

  function isStr(x) { return typeof x === "string"; }
  function refuse(why) { return new Error(TAG + " REFUSED (" + why + ") :: NOTHING ELSE WAS TOUCHED."); }
  function is384(x) { return Array.isArray(x) && x.length === DIM; }
  function norm1(v) { var s = 0, i; for (i = 0; i < v.length; i++) s += v[i] * v[i]; return Math.sqrt(s); }

  function hexOf(bytes) {
    var s = "", i;
    for (i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
    return s;
  }

  async function sha256hex(text) {
    if (!crypto || !crypto.subtle) throw refuse("E_NO_SHA - WebCrypto unavailable");
    var bytes = new TextEncoder().encode(text);
    var digest = await crypto.subtle.digest("SHA-256", bytes);
    return hexOf(new Uint8Array(digest));
  }

  function defaultLoader(onProgress) {
    var pipeP = null;
    return function () {
      if (pipeP) return pipeP;
      pipeP = (async function () {
        var mod;
        try {
          mod = await import(LOADER_URL);
        } catch (e) {
          throw refuse("E_NO_EMBEDDER - loader fetch failed");
        }
        try {
          var wx = mod && mod.env && mod.env.backends ? mod.env.backends.onnx : null;
          if (wx && wx.wasm) {
            wx.wasm.numThreads = THREADS;
          }
        } catch (e2) {}
        var pipe;
        try {
          pipe = await mod.pipeline("feature-extraction", SOURCE_ID, {
            quantized: true,
            progress_callback: function (p) {
              if (typeof onProgress === "function") {
                try {
                  onProgress(p && p.status ? p.status : "load", (p && typeof p.progress === "number") ? p.progress : -1, p && p.file ? p.file : "");
                } catch (e2) {}
              }
            }
          });
        } catch (e3) {
          throw refuse("E_NO_EMBEDDER - model load failed");
        }
        return pipe;
      })();
      return pipeP;
    };
  }

  function client(opts) {
    var o = opts || {};
    var loadPipe = (typeof o.pipeline === "function") ? o.pipeline : defaultLoader(o.onProgress);
    var warmed = false;

    async function pipe() {
      var p;
      try {
        p = await loadPipe();
      } catch (e) {
        throw refuse("E_NO_EMBEDDER - pipe factory failed");
      }
      if (!p) throw refuse("E_NO_EMBEDDER - pipeline seam returned nothing");
      warmed = true;
      return p;
    }

    function checkWant(want) {
      var w = want || {};
      var m = w.model || MODEL;
      var d = (w.dim == null) ? DIM : w.dim;
      if (m !== MODEL || d !== DIM) throw refuse("model/dim want " + m + "/" + d + ", lane is " + MODEL + "/" + DIM);
    }

    async function embed(text, want) {
      if (!isStr(text) || !text.trim()) throw refuse("empty text");
      checkWant(want);
      var p = await pipe();
      var out;
      try {
        out = await p(text, { pooling: "mean", normalize: true });
      } catch (e) {
        throw refuse("E_NO_EMBEDDER - pipe failed");
      }
      var v = Array.from((out && out.data) ? out.data : []);
      if (v.length !== DIM) throw refuse("dim got " + v.length + ", want " + DIM);
      if (norm1(v) === 0) throw refuse("E_ZERO_VECTOR - model returned all zeros");
      return { model: MODEL, dim: DIM, vector: v };
    }

    async function embedMany(texts, want, onEach) {
      if (!Array.isArray(texts)) throw refuse("texts must be an array");
      checkWant(want);
      var i;
      for (i = 0; i < texts.length; i++) {
        if (!isStr(texts[i]) || !texts[i].trim()) throw refuse("empty text at index " + i);
      }
      if (!texts.length) return [];
      if (texts.length === 1) {
        var solo = await embed(texts[0], want);
        if (typeof onEach === "function") {
          try { onEach(1, 1, solo); } catch (e2) {}
        }
        return [solo];
      }
      var vecs = null;
      try {
        var bp = await pipe();
        var batched = await bp(texts.slice(), { pooling: "mean", normalize: true });
        if (batched && batched.dims && batched.dims.length === 2 && batched.dims[0] === texts.length && batched.dims[1] === DIM && batched.data) {
          vecs = [];
          var k;
          for (k = 0; k < texts.length; k++) vecs.push(Array.from(batched.data.slice(k * DIM, (k + 1) * DIM)));
        }
      } catch (e) { vecs = null; }
      if (!vecs) {
        var out = [];
        for (i = 0; i < texts.length; i++) {
          var r = await embed(texts[i], want);
          out.push(r);
          if (typeof onEach === "function") {
            try { onEach(i + 1, texts.length, r); } catch (e2) {}
          }
        }
        return out;
      }
      var res = [], j;
      for (j = 0; j < vecs.length; j++) {
        if (vecs[j].length !== DIM) throw refuse("dim got " + vecs[j].length + ", want " + DIM);
        if (norm1(vecs[j]) === 0) throw refuse("E_ZERO_VECTOR - model returned all zeros");
        var rec = { model: MODEL, dim: DIM, vector: vecs[j] };
        res.push(rec);
        if (typeof onEach === "function") {
          try { onEach(j + 1, texts.length, rec); } catch (e2) {}
        }
      }
      return res;
    }

    function cosine(a, b) {
      if (!is384(a) || !is384(b)) throw refuse("dim got " + (a ? a.length : "?") + "/" + (b ? b.length : "?") + ", want " + DIM + "/" + DIM);
      var dot = 0, na = 0, nb = 0, i;
      for (i = 0; i < DIM; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
      var mag = Math.sqrt(na) * Math.sqrt(nb);
      if (mag === 0) throw refuse("E_ZERO_VECTOR - zero magnitude input");
      return dot / mag;
    }

    function rank(queryVec, items, n, threshold) {
      if (!is384(queryVec)) throw refuse("dim got " + (queryVec ? queryVec.length : "?") + ", want " + DIM);
      if (!Array.isArray(items)) throw refuse("items must be an array");
      var th = (threshold == null) ? 0 : threshold;
      var hits = [], skipped = 0, i, s;
      for (i = 0; i < items.length; i++) {
        var it = items[i] || {};
        if (!is384(it.vec)) { skipped++; continue; }
        try { s = cosine(queryVec, it.vec); } catch (e) { skipped++; continue; }
        if (s >= th) hits.push({ id: it.id != null ? it.id : i, i: i, score: s });
      }
      hits.sort(function (x, y) { return y.score - x.score; });
      var top = (n == null) ? 5 : n;
      return { ok: true, dim: DIM, hits: hits.slice(0, top), skipped: skipped, total: items.length };
    }

    async function mintVector(spec) {
      var s = spec || {};
      if (!isStr(s.a) || !s.a) throw refuse("missing agent id");
      if (!isStr(s.t) || !s.t) throw refuse("empty text");
      if (!isStr(s.src) || !s.src) throw refuse("missing src");
      if (!is384(s.vec)) throw refuse("dim got " + (s.vec ? s.vec.length : "?") + ", want " + DIM);
      var folded = s.t.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
      var id = "lp_node_" + await sha256hex(s.a + ":" + s.src + ":" + folded);
      var d = { embeddingModel: MODEL, embeddingDimension: DIM };
      if (isStr(s.source) && s.source) d.source = s.source;
      if (isStr(s.locus) && s.locus) d.locus = s.locus;
      d.timestamp = new Date().toISOString();
      return { v: 2, type: "vector", id: id, a: s.a, h: "", m: "", t: s.t, vec: s.vec, src: s.src, d: d };
    }

    async function warmup() {
      await pipe();
      return { ok: true, model: MODEL, dim: DIM, threads: THREADS };
    }

    function status() {
      return { model: MODEL, dim: DIM, loaded: warmed, threads: THREADS, spec: SPEC };
    }

    function describe() {
      return TAG + " - keyless local 384-D embedder lane (" + MODEL + "). embed()/embedMany() mint {model,dim,vector}; cosine()/rank() score same-dim only; mintVector() stamps lorepack v2 records. Threaded wasm x" + THREADS + " via the author bundle, inference off the main thread; embedMany embeds one batch call with sequential fallback. " + (warmed ? "weights loaded." : "weights lazy (first embed downloads ~23MB q8, then cached).");
    }

    return { embed: embed, embedMany: embedMany, cosine: cosine, rank: rank, mintVector: mintVector, warmup: warmup, status: status, describe: describe };
  }

  function describe() {
    return TAG + " - the keyless local embedder lane for LOREPACK (" + MODEL + ", " + DIM + "-D). Same {model,dim,vector} seam as the keyed Gemini embedder; 384-D packs never mix with 768-D.";
  }

  var api = { client: client, MODEL: MODEL, DIM: DIM, SPEC: SPEC, describe: describe };
  if (typeof window !== "undefined") window.MythosMinilm = api;
  if (typeof self !== "undefined" && typeof window === "undefined") self.MythosMinilm = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();

/* ---- piece: minilm-player ---- */
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

/* ---- piece: lore-pack ---- */
// SYS.AI.MAYA.PERCHANCE - lore-pack :: one job: get a LorePack into the player. Local only, nothing uploaded.
// sources, in order: URL (config.lore.packUrl or #pack=) -> this browser's cache (IndexedDB) -> human attaches a file.
// in: { player, cacheKey }   out: JSON { ok, source, pack, vectors, edges, ms } or throws E_NO_PACK.
(function () {
  "use strict";
  var DB = "SYS.AI.MAYA.PERCHANCE", STORE = "packs";
  function idb() {
    return new Promise(function (res, rej) {
      if (typeof indexedDB === "undefined") return rej(new Error("E_NO_CACHE - IndexedDB unavailable"));
      var r = indexedDB.open(DB, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(STORE); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error || new Error("E_NO_CACHE")); };
    });
  }
  async function cacheGet(key) {
    var db = await idb();
    return new Promise(function (res, rej) {
      var q = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      q.onsuccess = function () { res(q.result || null); };
      q.onerror = function () { rej(q.error); };
    });
  }
  async function cachePut(key, val) {
    var db = await idb();
    return new Promise(function (res, rej) {
      var tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(val, key);
      tx.oncomplete = function () { res(true); };
      tx.onerror = function () { rej(tx.error); };
    });
  }
  async function cacheDel(key) {
    var db = await idb();
    return new Promise(function (res) { var tx = db.transaction(STORE, "readwrite"); tx.objectStore(STORE).delete(key); tx.oncomplete = function () { res(true); }; tx.onerror = function () { res(false); }; });
  }
  function create(opts) {
    var o = opts || {};
    var player = o.player, key = o.cacheKey || "lorepack", onProgress = o.onProgress || null;
    var loaded = null;
    async function intoPlayer(blobOrStream, source, name) {
      var t0 = Date.now();
      var r = await player.loadStream(blobOrStream, { onProgress: onProgress, ref: name || source });
      loaded = { ok: true, source: source, name: name || "", pack: r.pack, vectors: r.vectors, edges: r.edges, ms: Date.now() - t0, at: new Date().toISOString() };
      return loaded;
    }
    async function fromFile(file, remember) {
      var r = await intoPlayer(file, "file", file && file.name);
      if (remember !== false) {
        try { await cachePut(key, { blob: file, name: file.name, size: file.size, savedAt: new Date().toISOString() }); r.cached = true; }
        catch (e) { r.cached = false; r.cacheError = String(e && e.message || e); }
      }
      return r;
    }
    async function fromUrl(url) {
      var resp;
      try { resp = await fetch(url); } catch (e) { throw new Error("E_PACK_FETCH - " + String(e && e.message || e).slice(0, 120)); }
      if (!resp.ok || !resp.body) throw new Error("E_PACK_FETCH - HTTP " + resp.status);
      return intoPlayer(resp.body, "url", url);
    }
    async function fromCache() {
      var c = null;
      try { c = await cacheGet(key); } catch (e) { c = null; }
      if (!c || !c.blob) return null;
      var r = await intoPlayer(c.blob, "cache", c.name);
      r.cachedAt = c.savedAt; r.size = c.size;
      return r;
    }
    async function ensure(url) {
      if (loaded) return loaded;
      if (url) return fromUrl(url);
      var c = await fromCache();
      if (c) return c;
      throw new Error("E_NO_PACK - no LorePack in this browser yet; a human attaches the .jsonl.gz once in the Lore panel (it stays local), or pass #pack=<url>");
    }
    async function cached() { try { var c = await cacheGet(key); return c ? { name: c.name, size: c.size, savedAt: c.savedAt } : null; } catch (e) { return null; } }
    return { ensure: ensure, fromFile: fromFile, fromUrl: fromUrl, fromCache: fromCache, cached: cached, forget: function () { loaded = null; return cacheDel(key); }, loaded: function () { return loaded; } };
  }
  var api = { create: create };
  if (typeof window !== "undefined") window.SysAiMayaLorePack = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();

/* ---- piece: lore-chatlog ---- */
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

/* ---- piece: oracle ---- */
// SYS.AI.MAYA.PERCHANCE - oracle :: one job: answer a question from the lore, grounded, with citations.
// in:  ask(q, opts, deps)   deps = { player, embedder, chatlog?, llm?, packHeader? }
// out: JSON { ok, op:"ask", q, grounded, answer, citations[], evidence{pack,chatlog,graph}, gate, verification, timing }
// Retrieval is the LorePack Player's own ops (dense search + textSearch + graphTraverse) plus the live chatlog,
// re-scored with the same MiniLM lane. Nothing passes the gate below min -> grounded:false, no answer, no LLM call.
(function () {
  "use strict";
  var STOP = { the: 1, and: 1, what: 1, who: 1, are: 1, was: 1, were: 1, does: 1, did: 1, how: 1, why: 1, when: 1, where: 1, which: 1, with: 1, from: 1, that: 1, this: 1, about: 1, tell: 1, for: 1, you: 1, your: 1, is: 1, of: 1, a: 1, an: 1, to: 1, in: 1, on: 1, me: 1, do: 1 };
  var PRON = { it: 1, i: 1, he: 1, she: 1, they: 1, we: 1, you: 1, this: 1, that: 1, there: 1, which: 1, who: 1, what: 1, me: 1, him: 1, her: 1, them: 1, us: 1, one: 1, "": 1 };
  function str(v) { return String(v == null ? "" : v); }
  function contentWords(q) { return str(q).toLowerCase().replace(/[^a-z0-9'\- ]/g, " ").split(/\s+/).filter(function (w) { return w.length > 1 && !STOP[w]; }); }
  function cos(a, b) { var d = 0, na = 0, nb = 0, i; for (i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return (na && nb) ? d / Math.sqrt(na * nb) : 0; }
  function r3(x) { return typeof x === "number" ? Math.round(x * 1000) / 1000 : x; }

  var LAW = "You are the Lore Oracle in SYS.AI.MAYA.PERCHANCE. Source of truth: LOREPACK passages [P#] first, CHATLOG turns [C#] second (fresher, may postdate the pack), GRAPH triples [G#] only as support (they restate pack chunks, never new facts). Training data is not a source. Every claim must carry the marker of the passage it comes from, like [P1] or [C2]. Use only the markers given. If the passages do not answer the question, say exactly what is missing instead of guessing. Plain prose, no headings.";

  function prompt(q, P, C, G) {
    var s = LAW + "\n\n<LOREPACK>\n" + P.map(function (p) { return "[" + p.cite + "] " + p.source + " :: " + str(p.text).slice(0, 1200); }).join("\n\n") + "\n</LOREPACK>";
    if (C.length) s += "\n\n<CHATLOG>\n" + C.map(function (c) { return "[" + c.cite + "] " + c.handle + " @ " + c.at + " :: " + str(c.text).slice(0, 700); }).join("\n\n") + "\n</CHATLOG>";
    if (G.length) s += "\n\n<GRAPH>\n" + G.map(function (g) { return "[" + g.cite + "] " + g.s + " | " + g.r + " | " + g.o; }).join("\n") + "\n</GRAPH>";
    return s + "\n\nQUESTION: " + q + "\nAnswer with markers.";
  }

  async function ask(q, opts, deps) {
    var o = opts || {}, d = deps || {};
    var t0 = Date.now(), timing = {}, warnings = [];
    var K = Math.max(1, Math.min(20, Number(o.k) || 6));
    var MIN = (o.min != null && isFinite(Number(o.min))) ? Number(o.min) : 0.25;
    var maxChars = Number(o.maxChars) || 1200;
    if (!str(q).trim()) return { ok: false, op: "ask", error: { code: "E_BAD_REQUEST", message: "empty question (pass q=...)" } };
    if (!d.player || !d.embedder) return { ok: false, op: "ask", error: { code: "E_NOT_READY", message: "player or embedder missing" } };

    // 1. query vector, once (same MiniLM-384 lane as the pack)
    var qv;
    try { qv = (await d.embedder.embed(q)).vector; } catch (e) { return { ok: false, op: "ask", error: { code: "E_NO_EMBEDDER", message: str(e && e.message || e) } }; }
    timing.embed_ms = Date.now() - t0;

    // 2. pack: dense (player.search) + lexical (player.textSearch, all content words)
    var t1 = Date.now();
    var dense = await d.player.search({ vector: qv, model: "all-MiniLM-L6-v2", k: 50, max_chars: maxChars });
    if (!dense.ok) return { ok: false, op: "ask", error: dense.error };
    var words = contentWords(q), lex = { ok: true, result: { hits: [], total_matches: 0 } };
    if (words.length) lex = d.player.textSearch({ query: words.join(" "), mode: "all", k: K, max_chars: maxChars });
    timing.pack_ms = Date.now() - t1;
    var byId = {}, rank = 0;
    (dense.result.hits || []).forEach(function (h, i) { byId[h.id] = { id: h.id, source: h.src, text: h.text, dense: h.score, dense_rank: i + 1, lexical: 0, lexical_rank: null }; });
    (lex.ok ? lex.result.hits : []).forEach(function (h, i) {
      var e = byId[h.id];
      if (!e) { var pv = (lex.provenance || [])[i] || {}; e = byId[h.id] = { id: h.id, source: pv.source || null, text: h.text, dense: null, dense_rank: null, lexical: 0, lexical_rank: null }; }
      e.lexical = h.matches; e.lexical_rank = i + 1;
    });
    var all = Object.keys(byId).map(function (k) { return byId[k]; });
    all.forEach(function (e) {
      e.rrf = (e.dense_rank ? 1 / (60 + e.dense_rank) : 0) + (e.lexical_rank ? 1 / (60 + e.lexical_rank) : 0);
      e.passes = (e.dense != null && e.dense >= MIN) || e.lexical_rank != null;
    });
    var topDense = dense.result.hits.length ? dense.result.hits[0].score : 0;
    var P = all.filter(function (e) { return e.passes; }).sort(function (a, b) { return b.rrf - a.rrf; }).slice(0, K);
    P.forEach(function (p, i) { p.cite = "P" + (i + 1); });

    // 3. graph: triples hanging off the top grounded chunks (heuristic edges included but labelled)
    var t2 = Date.now(), G = [], seenE = {};
    if (d.player.graphTraverse && Number(o.graphHops) !== 0) {
      for (var gi = 0; gi < Math.min(2, P.length) && G.length < (Number(o.graphMax) || 20); gi++) {
        var gr = d.player.graphTraverse({ chunk_id: P[gi].id, hops: Number(o.graphHops) || 1, max_edges: Number(o.graphMax) || 20, include_heuristic: true });
        if (!gr.ok) continue;
        gr.result.edges.forEach(function (e) {
          if (seenE[e.id] || G.length >= (Number(o.graphMax) || 20)) return;
          if (e.origin === "heuristic" && PRON[str(e.s).toLowerCase().trim()]) return; // "it | is | ..." carries no entity
          var tk = (str(e.s) + "|" + str(e.r) + "|" + str(e.o)).toLowerCase();
          if (seenE[tk]) return;
          seenE[e.id] = 1; seenE[tk] = 1;
          G.push({ id: e.id, s: e.s, r: e.r, o: e.o, chunk: e.src, origin: e.origin, hop: e.hop });
        });
      }
    }
    G.forEach(function (g, i) { g.cite = "G" + (i + 1); });
    timing.graph_ms = Date.now() - t2;

    // 4. chatlog (live, read-only): FTS candidates re-scored with MiniLM, same floor
    var t3 = Date.now(), C = [], chat = { used: false, configured: false, candidates: 0 };
    if (d.chatlog && o.chat !== false && o.chat !== "0") {
      chat.configured = !!(d.chatlog.configured && d.chatlog.configured());
      if (chat.configured) {
        try {
          var rows = await d.chatlog.search(q, Number(o.chatCandidates) || 24);
          chat.used = true; chat.candidates = rows.length;
          rows = rows.filter(function (r) { return str(r.text).trim(); });
          if (rows.length) {
            var vecs = await d.embedder.embedMany(rows.map(function (r) { return str(r.text).slice(0, 1500); }));
            var packAt = d.packHeader && Date.parse(d.packHeader.exportedAt);
            rows.forEach(function (r, i) { r.score = cos(qv, vecs[i].vector); r.newer_than_pack = !!(packAt && r.ts > packAt); });
            C = rows.filter(function (r) { return r.score >= MIN; }).sort(function (a, b) { return b.score - a.score; }).slice(0, K);
          }
        } catch (e) { chat.error = str(e && e.message || e); warnings.push({ code: "W_CHATLOG", message: chat.error }); }
      }
    }
    C.forEach(function (c, i) { c.cite = "C" + (i + 1); });
    timing.chatlog_ms = Date.now() - t3;

    var grounded = P.length > 0 || C.length > 0;
    var citations = P.map(function (p) { return { cite: p.cite, tier: "lorepack", pack: d.packTag || null, pack_version: d.packVersion || null, source: p.source, chunk: p.id, score: r3(p.dense), lexical_matches: p.lexical || 0 }; })
      .concat(C.map(function (c) { return { cite: c.cite, tier: "chatlog", lane: d.chatlog && d.chatlog.base, table: "turns", row: c.id, at: c.at, handle: c.handle, session: c.session, score: r3(c.score), newer_than_pack: c.newer_than_pack }; }))
      .concat(G.map(function (g) { return { cite: g.cite, tier: "graph", edge: g.id, chunk: g.chunk, triple: [g.s, g.r, g.o], origin: g.origin, hop: g.hop }; }));

    // 5. answer: only when grounded; LLM optional, extractive fallback otherwise
    var answer = null, answerMode = "none", verification = { markers_used: [], unknown_markers: [], uncited: false };
    var wantSynth = !(o.synth === false || o.synth === "0");
    if (grounded) {
      var t4 = Date.now();
      if (wantSynth && typeof d.llm === "function") {
        try {
          var g2 = await d.llm(prompt(q, P.slice(0, 8), C.slice(0, 6), G.slice(0, 12)));
          answer = str(g2 && g2.text != null ? g2.text : g2).trim();
          answerMode = answer ? "synthesized" : "none";
        } catch (e) { warnings.push({ code: "W_SYNTH", message: str(e && e.message || e).slice(0, 160) }); }
      }
      if (!answer) {
        var top = P[0] || C[0];
        answer = "[" + top.cite + "] " + str(top.text).slice(0, 600);
        answerMode = "extractive";
      }
      timing.answer_ms = Date.now() - t4;
      var known = {}; citations.forEach(function (c) { known[c.cite] = 1; });
      var m = answer.match(/\[(?:[PCG]\d+)(?:\s*,\s*[PCG]\d+)*\]/g) || [];
      var used = {};
      m.forEach(function (x) { x.replace(/[\[\]\s]/g, "").split(",").forEach(function (c) { used[c] = 1; }); });
      verification.markers_used = Object.keys(used);
      verification.unknown_markers = verification.markers_used.filter(function (c) { return !known[c]; });
      verification.uncited = verification.markers_used.length === 0;
      if (verification.unknown_markers.length) warnings.push({ code: "W_UNKNOWN_MARKER", message: "answer cites markers that were not retrieved: " + verification.unknown_markers.join(",") });
      if (verification.uncited) warnings.push({ code: "W_UNCITED", message: "synthesized answer carries no markers; rely on evidence[]" });
    }
    timing.total_ms = Date.now() - t0;
    return {
      ok: true, op: "ask", q: q, grounded: grounded,
      answer: answer, answer_mode: answerMode,
      message: grounded ? null : "Nothing in the lore passed the similarity floor (top pack score " + r3(topDense) + " < min " + MIN + "; no exact keyword match" + (chat.used ? "; no chatlog turn above min" : "") + "). Not answering rather than inventing.",
      gate: { min: MIN, top_pack_dense: r3(topDense), pack_passed: P.length, chatlog_passed: C.length, lexical_words: words },
      citations: citations,
      evidence: {
        pack: P.map(function (p) { return { cite: p.cite, chunk: p.id, source: p.source, dense: r3(p.dense), lexical_matches: p.lexical || 0, text: p.text }; }),
        chatlog: C.map(function (c) { return { cite: c.cite, row: c.id, at: c.at, handle: c.handle, role: c.role, score: r3(c.score), newer_than_pack: c.newer_than_pack, text: str(c.text).slice(0, maxChars) }; }),
        graph: G
      },
      chatlog: chat,
      verification: verification, warnings: warnings, timing: timing
    };
  }
  var api = { ask: ask, prompt: prompt, contentWords: contentWords, LAW: LAW };
  if (typeof window !== "undefined") window.SysAiMayaOracle = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();

/* ---- piece: comms ---- */
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

/* ---- piece: space ---- */
// SYS.AI.MAYA.PERCHANCE - space :: wiring only. Maya's own space (lane 016); the Oracle is one function in it.
// Pieces (each one job, JSON between them): config | mode | afa | lore-pack | lore-chatlog | oracle | comms
// plus Pat's chips, vendored: MINILM (embedder) and MINILM-PLAYER (retrieval).
(function () {
  "use strict";
  var W = window, D = document;
  var CFG = JSON.parse(JSON.stringify(W.SYS_AI_MAYA_CONFIG));
  var who = W.SysAiMayaMode.detect(W.location, W.navigator);
  var P = who.params;
  // per-run overrides from the URL (never secrets)
  if (P.min != null && P.min !== "") CFG.retrieval.min = Number(P.min);
  if (P.k) CFG.retrieval.k = Number(P.k);
  if (P.pack) CFG.lore.packUrl = P.pack;

  var body = D.body;
  var machine = D.createElement("div"); machine.id = "afa";
  var ui = null;
  if (who.mode === "human") { ui = buildUi(); body.appendChild(ui.root); ui.machineBox.appendChild(machine); }
  else { body.innerHTML = ""; body.appendChild(machine); }
  var afa = W.SysAiMayaAfa.create({ root: machine, space: CFG.space });
  afa.log("mode", { mode: who.mode, reason: who.reason });

  var embedder = W.MythosMinilm.client({ onProgress: function (st, pr, file) { if (st === "progress" && pr >= 0) afa.status("loading", "embedder " + Math.round(pr) + "%"); } });
  var player = W.MythosMinilmPlayer.client({ embedder: embedder });
  var lore = W.SysAiMayaLorePack.create({ player: player, cacheKey: CFG.lore.packCacheKey, onProgress: function (p) { afa.status("loading", "pack " + Math.round(p.bytes / 1048576) + " MB, " + p.vectors + " chunks"); } });
  function token() { try { return W.localStorage.getItem(CFG.lore.chatlogTokenKey) || ""; } catch (e) { return ""; } }
  function chatlog() { return W.SysAiMayaChatlog.client({ base: CFG.lore.chatlogBase, token: token() }); }
  function llm() {
    var r = W.root;
    if (!CFG.synth.on || !r || typeof r.generateText !== "function") return null;
    return async function (prompt) { var g = await r.generateText({ instruction: prompt }); return { text: (g && g.text != null) ? g.text : g }; };
  }

  var MANIFEST = {
    afa: "1", space: CFG.space, lane: CFG.lane, agent: CFG.agent, version: CFG.version,
    what: "Maya's own space. Function 1: Lore Oracle - grounded answers from a LorePack (MiniLM-384, lorepack v2) plus a live Turso chatlog, with citations. Read-only on every source.",
    modes: { agent: "data only: the five <pre id=afa-*> elements, no UI", human: "normal UI, same elements under 'machine view'", switch: "#agent or #human (also mode=agent|human); backup sniff: navigator.webdriver, headless/bot user-agent" },
    ops: {
      manifest: "this document",
      status: "pack, embedder, chatlog lane readiness",
      ask: "q (required), k, min, synth=0|1, chat=0|1 -> answer + citations + evidence",
      search: "same as ask with synth=0 (evidence only)",
      verify: "run the LorePack Player's integrity checks on the loaded pack",
      recent: "n -> newest chatlog turns (read-only)"
    },
    call: {
      url: "https://perchance.org/<this-generator>#agent&op=ask&q=Worthy%20Pillars",
      postMessage: { to: CFG.space, id: "any", op: "ask", args: { q: "Worthy Pillars" } },
      broadcastChannel: CFG.comms.channel,
      js: "await SysAiMayaSpace.call('ask', {q:'Worthy Pillars'})"
    },
    sources: { lorepack: { agent: CFG.lore.packAgent, url: CFG.lore.packUrl || null, cache: "IndexedDB (this browser)" }, chatlog: { base: CFG.lore.chatlogBase, tables: ["turns", "turns_fts"], access: "SELECT only" } },
    citation_shape: { lorepack: "{cite:P#, source, chunk, score}", chatlog: "{cite:C#, table:turns, row, at, handle, score}", graph: "{cite:G#, edge, chunk, triple}" },
    defaults: CFG.retrieval,
    elements: W.SysAiMayaAfa.IDS
  };
  afa.manifest(MANIFEST);

  async function ready() {
    var r = await lore.ensure(CFG.lore.packUrl);
    return r;
  }
  function err(op, e) { var m = String(e && e.message || e); var code = (m.match(/\bE_[A-Z_]+/) || ["E_INTERNAL"])[0]; return { ok: false, op: op, error: { code: code, message: m } }; }

  async function dispatch(op, args) {
    var a = args || {};
    afa.status("working", op);
    var res;
    try {
      if (op === "manifest") res = { ok: true, op: op, manifest: MANIFEST };
      else if (op === "status") {
        var cl = chatlog(), cst = null;
        if (cl.configured()) { try { cst = await cl.status(); } catch (e) { cst = { error: String(e.message || e) }; } }
        res = { ok: true, op: op, mode: who, pack: lore.loaded(), pack_cached: await lore.cached(), embedder: embedder.status(), chatlog: { base: CFG.lore.chatlogBase, token_held: !!token(), status: cst }, synth: !!llm() };
      } else if (op === "ask" || op === "search") {
        var pk = await ready();
        res = await W.SysAiMayaOracle.ask(a.q, { k: a.k || CFG.retrieval.k, min: a.min != null && a.min !== "" ? a.min : CFG.retrieval.min, maxChars: CFG.retrieval.maxChars, graphHops: CFG.retrieval.graphHops, graphMax: CFG.retrieval.graphMax, chatCandidates: CFG.retrieval.chatCandidates, chat: a.chat, synth: op === "search" ? false : a.synth },
          { player: player, embedder: embedder, chatlog: chatlog(), llm: llm(), packTag: pk.pack.tag, packVersion: pk.pack.version, packHeader: player.header() });
        res.op = op; res.pack = { tag: pk.pack.tag, version: pk.pack.version, source: pk.source, name: pk.name, exportedAt: (player.header() || {}).exportedAt };
      } else if (op === "verify") {
        await ready();
        var v = await player.verify({});
        res = { ok: v.ok !== false, op: op, pack: v.pack, passed: v.result && v.result.ok, checks: v.result && v.result.checks };
      } else if (op === "recent") {
        res = { ok: true, op: op, rows: await chatlog().recent(Number(a.n) || 5) };
      } else res = { ok: false, op: op, error: { code: "E_BAD_OP", message: "unknown op '" + op + "'; see manifest.ops" } };
    } catch (e) { res = err(op, e); }
    if (!res.ok && res.error) afa.error(res.error.code, res.error.message);
    (res.warnings || []).forEach(function (w) { afa.log("warning", w); });
    afa.result(res);
    afa.status(res.ok ? "done" : "error", op);
    if (ui) ui.show(res);
    return res;
  }


  var comms = W.SysAiMayaComms.create({ space: CFG.space, accept: CFG.comms.accept, channel: CFG.comms.channel, dispatch: dispatch, onEvent: function (ev, d) { afa.log("comms." + ev, d); } });
  comms.listen();
  W.SysAiMayaSpace = { call: comms.call, manifest: MANIFEST, config: CFG, mode: who };

  var job = comms.fromParams(P);
  if (job) dispatch(job.op, job.args);
  else if (who.mode === "agent") dispatch("manifest", {});
  else afa.status("ready", "idle");
  if (ui) ui.refreshLore();

  // ---------- human UI (plain; only built in human mode) ----------
  function el(tag, attrs, kids) { var e = D.createElement(tag); Object.keys(attrs || {}).forEach(function (k) { if (k === "text") e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); }); (kids || []).forEach(function (k) { e.appendChild(k); }); return e; }
  function buildUi() {
    var css = el("style", { text: "body{font:15px/1.45 system-ui,sans-serif;margin:0;background:#111;color:#ddd}main{max-width:860px;margin:auto;padding:16px}h1{font-size:18px;margin:0 0 4px}small,.dim{color:#888}section{border:1px solid #333;border-radius:6px;padding:12px;margin:12px 0}input,button,textarea{font:inherit;background:#1b1b1b;color:#ddd;border:1px solid #444;border-radius:4px;padding:6px 8px}button{cursor:pointer}textarea{width:100%;box-sizing:border-box}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.ans{white-space:pre-wrap;margin:10px 0}.cite{font:12px/1.4 monospace;color:#aaa;border-top:1px solid #2a2a2a;padding:4px 0}pre{white-space:pre-wrap;word-break:break-word;font:12px/1.35 monospace;background:#0b0b0b;border:1px solid #2a2a2a;padding:8px;max-height:320px;overflow:auto}.err{color:#f77}" });
    D.head.appendChild(css);
    var q = el("textarea", { id: "q", rows: "2", placeholder: "Ask the lore (e.g. Worthy Pillars)" });
    var askB = el("button", { id: "ask", text: "Ask" });
    var minI = el("input", { id: "min", type: "number", step: "0.05", min: "0", max: "1", value: String(CFG.retrieval.min), style: "width:5em" });
    var out = el("div", { id: "out" });
    var packS = el("div", { class: "dim", id: "packState", text: "pack: checking..." });
    var file = el("input", { type: "file", id: "packFile", accept: ".gz,.jsonl,.json" });
    var tok = el("input", { type: "password", id: "laneToken", placeholder: "Erato Turso read token (stays in this browser)", style: "flex:1;min-width:240px" });
    var tokB = el("button", { text: "Save token" }), testB = el("button", { text: "Test chatlog" }), verB = el("button", { text: "Verify pack" });
    var chatS = el("div", { class: "dim", id: "chatState" });
    var machineBox = el("details", {}, [el("summary", { text: "machine view (what agents get)" })]);
    var root = el("main", {}, [
      el("h1", { text: CFG.space + " - Maya's space (lane " + CFG.lane + ")" }),
      el("small", { text: "Lore Oracle: answers come only from the attached LorePack and the live chatlog, with citations. Nothing is uploaded; sources are read-only." }),
      el("section", {}, [el("div", { class: "row" }, [el("b", { text: "Oracle" }), el("span", { class: "dim", text: "min score" }), minI]), q, el("div", { class: "row" }, [askB]), out]),
      el("section", {}, [el("b", { text: "Lore sources" }), packS, el("div", { class: "row" }, [el("span", { text: "Attach " + CFG.lore.packAgent + " LorePack:" }), file, verB]),
        el("div", { class: "row" }, [tok, tokB, testB]), chatS]),
      machineBox
    ]);
    function go() { if (!q.value.trim()) return; out.textContent = "working..."; dispatch("ask", { q: q.value.trim(), min: minI.value }); }
    askB.onclick = go;
    q.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); go(); } });
    file.onchange = async function () {
      var f = file.files && file.files[0]; if (!f) return;
      packS.textContent = "loading " + f.name + "...";
      try { var r = await lore.fromFile(f, true); afa.log("pack.attached", r); refreshLore(); }
      catch (e) { afa.error("E_PACK_INVALID", String(e.message || e)); packS.innerHTML = ""; packS.appendChild(el("span", { class: "err", text: String(e.message || e) })); }
    };
    verB.onclick = function () { dispatch("verify", {}); };
    tokB.onclick = function () { try { W.localStorage.setItem(CFG.lore.chatlogTokenKey, tok.value.trim()); tok.value = ""; refreshLore(); } catch (e) { afa.error("E_STORAGE", String(e)); } };
    testB.onclick = function () { dispatch("status", {}); };
    async function refreshLore() {
      var L = lore.loaded(), c = await lore.cached();
      packS.textContent = L ? ("pack: " + L.pack.tag + " " + L.vectors + " chunks, " + L.edges + " edges, from " + L.source + " (" + (L.name || "") + ", " + L.ms + " ms)") : (c ? ("pack: cached in this browser (" + c.name + ", " + Math.round(c.size / 1048576) + " MB) - loads on first question") : "pack: none yet - attach the .jsonl.gz once; it stays in this browser");
      chatS.textContent = "chatlog: " + CFG.lore.chatlogBase.replace(/^https:\/\//, "") + " - " + (token() ? "token held (read-only use)" : "no token yet: pack-only answers");
    }
    function show(res) {
      out.innerHTML = "";
      if (!res) return;
      if (!res.ok) { out.appendChild(el("div", { class: "err", text: (res.error && (res.error.code + ": " + res.error.message)) || "error" })); return; }
      if (res.op === "ask" || res.op === "search") {
        out.appendChild(el("div", { class: "ans", text: res.grounded ? (res.answer || "") : res.message }));
        out.appendChild(el("div", { class: "dim", text: (res.answer_mode || "") + " - " + res.gate.pack_passed + " pack + " + res.gate.chatlog_passed + " chatlog passages over min " + res.gate.min + ", top pack score " + res.gate.top_pack_dense + " - " + res.timing.total_ms + " ms" }));
        res.citations.filter(function (c) { return c.tier !== "graph"; }).forEach(function (c) {
          out.appendChild(el("div", { class: "cite", text: "[" + c.cite + "] " + (c.tier === "lorepack" ? ("pack " + c.source + " :: " + c.chunk + " (" + c.score + ")") : ("chatlog turns#" + c.row + " " + c.handle + " @ " + c.at + " (" + c.score + ")" + (c.newer_than_pack ? " newer than pack" : ""))) }));
        });
        (res.warnings || []).forEach(function (w) { out.appendChild(el("div", { class: "dim", text: w.code + ": " + w.message })); });
      } else if (res.op === "verify") {
        out.appendChild(el("div", { class: "ans", text: "pack verify: " + (res.passed ? "PASS" : "FAIL") + " (" + (res.checks || []).filter(function (c) { return c.ok; }).length + "/" + (res.checks || []).length + " checks)" }));
      } else out.appendChild(el("pre", { text: JSON.stringify(res, null, 1) }));
      refreshLore();
    }
    return { root: root, machineBox: machineBox, show: show, refreshLore: refreshLore };
  }
})();
