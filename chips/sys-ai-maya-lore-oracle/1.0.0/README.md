# SYS.AI.MAYA LORE ORACLE CHIP - grounded lore answers for any generator or agent

Origin: built by SYS.AI.MAYA.PERCHANCE (Maya, lane 016) 2026-11-13 as the client for her Lore Oracle space at `https://perchance.org/sys-ai-maya-lore-oracle` (Maya's Perchance account). Proven 2026-11-13 by parse + node checks on exact bytes, live from the permanent URL on the test bench `perchance.org/sys-ai-maya-lore-oracle-chip-test` (proof 6/6, ask, refusal floor, bad op), and in-preview inside unsaved copies of mythos-cont, commpack-sia and repo-depot (proof 6/6 + grounded ask in each, residue clean). Built to CHIP SPEC v1 as version 1.0.0. License: house PROPRIETARY (Merk Morassi, LLC - `LICENSE-PROPRIETARY.txt`). Tag: SYS.AI.MAYA.PERCHANCE.

BLUF: One script tag gives any page `SysAiMayaLoreOracle.client()`. The client mounts the Lore Oracle in a hidden 1x1 iframe and talks to it over postMessage (`to: "SYS.AI.MAYA.PERCHANCE"`), so the host never loads the 118 MB pack, the MiniLM embedder or the chatlog token itself: the oracle's own origin holds them (IndexedDB pack cache, token in the oracle's localStorage). Ops: `manifest`, `status`, `ask`, `search`, `verify`, `recent`. Every answer is cited (pack file + chunk id, or chatlog row + time) and anything under the 0.25 similarity floor is refused, not invented. Agents with no DOM use `url(op, args)` for the no-click `#agent&op=...` link instead. Errors are values, never exceptions.

## use

```html
<script src="https://user.uploads.dev/file/276cf65bed25d99b13ec8f4a545edf3e.js"></script>
<script>
var oracle = SysAiMayaLoreOracle.client();
oracle.ask("Worthy Pillars", { synth: 0 }).then(function (r) { console.log(r.grounded, r.answer, r.citations); });
</script>
```

No-click agent link (no script needed): `https://perchance.org/sys-ai-maya-lore-oracle#agent&op=ask&q=Worthy%20Pillars` - read the five `<pre id=afa-*>` blocks (status, manifest, result, errors, log).

Top-level `window.SysAiMayaLoreOracle` (plus `self` / `module.exports` when present): `{client, TAG, VERSION, SPEC, BASE, FRAME, OPS}`.

## the contract

- `client(opts?)`: `opts.base` (agent-link base, default the oracle page), `opts.frameUrl` (iframe src, default the oracle's output origin `e0b48b6eb61490b30908b1534e1fb1a7.perchance.org`), `opts.target` + `opts.targetOrigin` (talk to an oracle window you already hold, no iframe), `opts.timeoutMs` (default 20000), `opts.longTimeoutMs` (ask/search/verify, default 120000), `opts.readyMs` (default 45000).
- `open()` resolves `{ok, op:"open", via, ms, manifest}` once the oracle answers a manifest ping; idempotent. Fails `E_NO_DOM`, `E_NOT_READY`.
- `call(op, args)` and the shorthands `manifest()`, `status()`, `ask(q, args)`, `search(q, args)`, `verify()`, `recent(n)` resolve the oracle's own result object (the same JSON the `#agent` view prints in `afa-result`), with `ok` always present. ask/search args: `q` (required), `k`, `min`, `synth=0|1`, `chat=0|1`.
- `url(op, args)` returns `{ok, op, url}` - the no-click agent link. Pure; touches nothing.
- `proof()` resolves `{ok, checks[]}`: open, manifest (space = SYS.AI.MAYA.PERCHANCE), idempotent manifest, status, remote refusal (`E_BAD_OP` from the oracle), local refusal (`E_BAD_REQUEST`).
- `log()` returns the call log, one record per call `{ts, op, ok, ms, code}`; `close()` resolves pending calls `E_CLOSED`, removes the listener and the iframe, returns `{ok, removed}`.
- Error codes: `E_BAD_OP`, `E_BAD_REQUEST` (refused before sending), `E_NO_DOM`, `E_NOT_READY`, `E_TIMEOUT`, `E_SEND`, `E_CLOSED`, plus whatever the oracle returns (`E_NO_PACK`, `E_NO_TOKEN`, ...). Messages state what was and was not touched.

## deliberately left out

- The pack and the token - the chip never ships lore or keys. Each browser attaches Erato's `.jsonl.gz` once on the oracle page (then it is cached); the chatlog tier needs Erato's token pasted once there. Without a pack, `ask` fails loud.
- Writes - every op is read-only; the oracle blocks anything but SELECT on the chatlog.
- Synthesis in the host - `synth=1` asks the oracle to write prose with Perchance's AI only after the floor passes; the host gets citations either way.

## honesty note

- Pack and token live in the oracle origin's storage, which browsers partition by top-level site: inside any perchance.org generator it is shared; embedded under a non-perchance top-level site, the pack must be attached again there.
- The oracle page is public (Perchance has no unlisted pages); the lore is not in it.
- `status` reports `pack_cached` vs `pack` (loaded in memory); the first `ask` after a cold open loads the cached pack (seconds, not instant).
