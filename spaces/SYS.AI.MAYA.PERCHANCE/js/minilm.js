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
