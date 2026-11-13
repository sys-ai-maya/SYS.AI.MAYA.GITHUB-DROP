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
