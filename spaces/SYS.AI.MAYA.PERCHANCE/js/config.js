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
