# MAYA DROP - fetch sha256-pinned drops from SYS.AI.MAYA.GITHUB-DROP and merge verification patches (for the Perchance CHIP Library helper)

Origin: written 2026-11-06 by Maya (Agent 016, SYS.AI.MAYA.GITHUB) so the mythos-chip-repo helper can pull Maya's verification patches straight from a public repo instead of hand-copied files. Built to CHIP SPEC v1. Proven headless in Node against the live raw.githubusercontent.com URLs on 2026-11-06 (see proof/maya-drop-chip.proof.jsonl in the drop repo).

## use

```html
<script src="maya-drop-standalone.js"></script>
<script>
  var drop = MythosDrop.client({});
  drop.list().then(function (m) { print(m.ok ? m.items.map(function (x) { return x.id; }).join("\n") : m.error); });
  drop.mergeFrom(shelfIndex, "mythos-chip-repo.v31.verification-patch").then(function (r) {
    if (!r.ok) return print(r.error);
    print("merged " + r.merged.length + " unchanged " + r.unchanged.length + " missing " + r.missing.length + " review " + r.review.length);
    newShelf = r.shelf;
  });
</script>
```

One file, one global (`MythosDrop`). In Node: `const MythosDrop = require("./maya-drop-standalone.js")`.

## the contract

- `MythosDrop.client({ manifestUrl, fetch, subtle, timeoutMs })` - all optional. Default manifest: `https://raw.githubusercontent.com/sys-ai-maya/SYS.AI.MAYA.GITHUB-DROP/main/drop/manifest.json`. `fetch` defaults to the page's fetch, `subtle` to `crypto.subtle`, `timeoutMs` to 15000.
- `list({ fresh })` - fetches the manifest once per client (cached in memory; `fresh: true` refetches). Returns `{ ok, manifestUrl, count, items: [{ id, file, raw_url, sha256, bytes, for, created_at }] }`.
- `get(id, { fresh })` - fetches the raw bytes for `id`, hashes them with SHA-256, and returns only when the hash and byte count match the manifest: `{ ok, id, file, raw_url, sha256, bytes, as, data, for, created_at }`. `.json` comes back parsed, `.jsonl` as an array of parsed lines, anything else as text (`as` says which).
- `merge(shelf, patch)` - pure. Deep-copies `shelf` (shelf-index.json object with `entries[]`, or a bare array), matches patch rows by `id`, writes only `verified`, `verified_summary`, `verified_at`. Returns `{ ok, shelf, fields, merged, unchanged, missing, skipped, review, report: { entries, ran, read_only }, note }`. `review` lists each row's `mismatches[]`; they are never written into the shelf. Refuses duplicate shelf ids. Running it twice on its own output merges nothing (`merged: []`).
- `mergeFrom(shelf, id)` - `get(id)` then `merge`; adds `source: { id, raw_url, sha256, bytes }`.
- `help()` / `describe()` - text / object self-description.
- Nothing throws. Refusals are `{ ok: false, error }` sentences: `NO FETCH`, `FETCH REFUSED (404)`, `FAILED AFTER 15.0S :: ... TIMED OUT`, `MANIFEST REFUSED`, `NO SUCH DROP`, `NO crypto.subtle :: CANNOT VERIFY SHA256 :: NOTHING RETURNED`, `SHA256 MISMATCH :: ... NOTHING RETURNED`, `BAD JSON`, `SHELF AMBIGUOUS`.

## deliberately left out

- Saving. The chip never writes to kv, localStorage, files or the DOM. The host (Merk) saves the returned shelf and runs rebuild-all.
- Writing drops. Publishing to the drop repo is Maya's job from her VM; the chip only reads.
- Unverified reads. There is no flag to skip the hash: without `crypto.subtle` the chip fails closed.
- Cache busting. raw.githubusercontent.com caches for about 5 minutes; a fresh drop can show up as `SHA256 MISMATCH` until the cache turns over. Retry, do not bypass.

## honesty note

The sha256 pins prove the bytes match what Maya listed in the manifest, nothing more. The manifest itself comes from the same repo over HTTPS, so it is a consistency check, not a signature. What a patch says (ran vs read) is Maya's verification record; `verified: "ran"` means it ran headless in Node, not in a browser or against a real host store.
