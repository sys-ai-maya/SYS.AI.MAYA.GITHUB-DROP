# SYS.AI.MAYA.PERCHANCE build: pieces -> one bundle + Perchance panels + test page + manifest (sha256-pinned)
import pathlib, hashlib, json, datetime
J=pathlib.Path('js'); D=pathlib.Path('dist'); D.mkdir(exist_ok=True)
order=['config','mode','afa','minilm','minilm-player','lore-pack','lore-chatlog','oracle','comms','space']
origin={'minilm':'Pat: repo-depot js/mythos-minilm-standalone.js (vendored unchanged)','minilm-player':'Pat: repo-depot js/mythos-minilm-player-standalone.js (vendored; SYS.AI.MAYA seams: loadStream, isVec, header)'}
pieces=[]; bundle=['/* SYS.AI.MAYA.PERCHANCE - Maya space (lane 016) :: bundle of js/*.js in order: %s. Edit the pieces, not this. */'%' | '.join(order)]
for n in order:
    src=(J/(n+'.js')).read_text(); assert '</script' not in src.lower(), n
    pieces.append({'piece':n,'file':'js/%s.js'%n,'bytes':len(src.encode()),'sha256':hashlib.sha256(src.encode()).hexdigest(),'origin':origin.get(n,'Maya')})
    bundle.append('/* ---- piece: %s ---- */\n%s'%(n,src))
b='\n'.join(bundle); (D/'maya-space.js').write_text(b)
inline='\n'.join(['<script data-piece="%s">\n%s\n</script>'%(n,(J/(n+'.js')).read_text()) for n in order])
(D/'test.html').write_text('<!doctype html><html><head><meta charset="utf-8"></head><body>\n'+inline+'\n</body></html>')
man={'space':'SYS.AI.MAYA.PERCHANCE','lane':'016','built':datetime.datetime.utcnow().isoformat()+'Z','bundle':{'file':'dist/maya-space.js','bytes':len(b.encode()),'sha256':hashlib.sha256(b.encode()).hexdigest()},'pieces':pieces}
(D/'manifest.json').write_text(json.dumps(man,indent=1)); print(json.dumps(man['bundle']))
