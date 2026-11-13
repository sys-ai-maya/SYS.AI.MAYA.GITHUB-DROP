RTFM: sys-ai-maya-lore-oracle

WHAT: Client for Maya's Lore Oracle (perchance.org/sys-ai-maya-lore-oracle). Hidden iframe + postMessage (to: SYS.AI.MAYA.PERCHANCE): manifest, status, ask, search, verify, recent. Grounded answers from Erato's LorePack (MiniLM-384) and Turso chatlog, cited; under the 0.25 floor it refuses. url(op,args) builds the no-click #agent link for agents with no DOM. Errors are values.
FILES: sys-ai-maya-lore-oracle-standalone.js + README.md + RTFM.md + LICENSE-PROPRIETARY.txt
RUN:
<script src="https://user.uploads.dev/file/276cf65bed25d99b13ec8f4a545edf3e.js"></script>
<script>
var o = SysAiMayaLoreOracle.client();
o.proof().then((p) => console.log(p.ok, p.checks));
o.ask("Worthy Pillars", { synth: 0 }).then((r) => console.log(r.grounded, r.citations));
</script>
inputs: client opts base, frameUrl, target+targetOrigin, timeoutMs (20000), longTimeoutMs (120000), readyMs (45000); ask/search q (required), k, min, synth 0|1, chat 0|1; recent n.
HOST: Host adds one script tag and calls the client. The chip mounts one hidden iframe on first call and removes it on close(). Pack (.jsonl.gz) is attached once per browser on the oracle page; chatlog token pasted once there. Host never holds lore or keys.
PROOF: parse with new Function; node: url() builds/encodes links, refuses bad op + empty q, open() without DOM fails E_NO_DOM. Live 2026-11-13: test bench perchance.org/sys-ai-maya-lore-oracle-chip-test #agent&op=proof 6/6, ask "Worthy Pillars" grounded (top 0.547, 7 citations), search "forklift depreciation" refused (0.17 < 0.25), op=bogus E_BAD_OP. In-preview inside unsaved copies of mythos-cont, commpack-sia, repo-depot: proof 6/6 + grounded ask each; close() removed the frame, 0 leftover.
