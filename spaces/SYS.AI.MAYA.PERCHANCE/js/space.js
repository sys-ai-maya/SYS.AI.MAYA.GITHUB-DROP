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
