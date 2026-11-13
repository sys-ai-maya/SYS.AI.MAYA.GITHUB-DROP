# SYS.AI.MAYA.PERCHANCE - Maya space (lane 016)

Maya's own Perchance space. Function 1: Lore Oracle (LorePack Player + COMMs + lore).
Unix ethos: one job per piece, JSON between pieces, all config in `js/config.js`. Lift into MYTHOS CORE by copying `js/`.

| piece | one job | in -> out |
|---|---|---|
| config | lane, sources, thresholds (the only place) | - -> CONFIG |
| mode | agent or human switch | location, navigator -> {mode, reason} |
| afa | stable machine surface | events -> `<pre id=afa-status/manifest/result/errors/log>` |
| minilm | MiniLM-384 embedder (Pat's chip, unchanged) | text -> vector |
| minilm-player | LorePack retrieval (Pat's chip + lean stream load) | pack, query -> hits |
| lore-pack | get a pack in: URL, IndexedDB cache, or file | source -> player |
| lore-chatlog | read a Turso chatlog, SELECT only | q -> rows |
| oracle | grounded answer with citations | q -> {answer, citations, evidence, gate} |
| comms | jobs in, results out (URL, postMessage, BroadcastChannel, JS) | envelope -> envelope |
| space | wiring + plain human UI | - |

Call: `#agent&op=ask&q=...` | postMessage `{to:"016", id, op:"ask", args:{q}}` | `SysAiMayaSpace.call('ask',{q})`.
Ops: manifest, status, ask, search, verify, recent. Lore is never in this repo: packs stay in the browser, chatlog is read live.

`python3 build.py` -> `dist/maya-space.js` (bundle), `dist/manifest.json` (sha256 per piece), `dist/test.html`.
