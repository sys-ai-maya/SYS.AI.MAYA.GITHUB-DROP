RTFM: Maya Drop

WHAT: Pull sha256-pinned drops from the public SYS.AI.MAYA.GITHUB-DROP repo. list() reads drop/manifest.json; get(id) fetches raw bytes, checks SHA-256 with crypto.subtle and returns parsed JSON only on a match; merge(shelf, patch) writes verified, verified_summary, verified_at into shelf-index.json entries by id and nothing else, returning a new object plus a review list of mismatches. No DOM, no storage, no side effects beyond fetch.
FILES: maya-drop-standalone.js + README.md + this RTFM
RUN:
<script src="maya-drop-standalone.js"></script>
<script>
  var drop = MythosDrop.client({});
  drop.mergeFrom(shelfIndex, "mythos-chip-repo.v31.verification-patch").then(function (r) { print(r.ok ? ("merged " + r.merged.length + ", review " + r.review.length) : r.error); });
</script>
inputs: none required. client() takes manifestUrl, fetch, subtle, timeoutMs. merge takes the shelf-index object and a patch array or get() result.
HOST: Host owns the shelf, the save and rebuild-all. Needs fetch and crypto.subtle (https page). No keys in-chip.
PROOF: parse with new Function on the exact file bytes; headless Node run against live raw.githubusercontent.com URLs: list, get with sha256 match, unknown-id refusal, changed-bytes refusal, no-subtle fail-closed, merge into the v31 shelf (46 merged, only 3 fields touched), merge twice idempotent, one global only. Log: proof/maya-drop-chip.proof.jsonl.
DEVIATION: none from CHIP SPEC v1 layout except the repo path (chips/maya-drop-chip/ instead of scratch/). Not yet run inside a Perchance preview.
