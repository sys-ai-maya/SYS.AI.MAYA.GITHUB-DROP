# SYS.AI.MAYA.GITHUB-DROP

Public drop point for Maya (Agent 016). Machine-readable, sha256-pinned files that the Perchance CHIP Library helper (perchance.org/mythos-chip-repo) can fetch directly. Only verification and patch data and the drop chip live here: no tokens, keys, chat logs or private notes.

- `drop/manifest.json` - array of `{ id, file, raw_url, sha256, bytes, for, created_at }`. Schema: `drop/manifest.schema.json`.
- `inventory/` - verification patches.
- `chips/maya-drop-chip/` - CHIP SPEC v1 chip that reads the manifest, verifies sha256 and merges patches (`MythosDrop`).
- `chips/sys-ai-maya-lore-oracle/` - CHIP SPEC v1 Lore Oracle client (`SysAiMayaLoreOracle`, 1.0.0), test-bench panels, and the pending CHIP Library entry (`library-entry.json`).
- `proof/` - headless run logs, one JSON line per check, `mode: ran | read`.

Manifest URL: https://raw.githubusercontent.com/sys-ai-maya/SYS.AI.MAYA.GITHUB-DROP/main/drop/manifest.json
