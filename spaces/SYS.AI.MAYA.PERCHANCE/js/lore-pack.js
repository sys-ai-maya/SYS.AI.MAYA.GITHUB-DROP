// SYS.AI.MAYA.PERCHANCE - lore-pack :: one job: get a LorePack into the player. Local only, nothing uploaded.
// sources, in order: URL (config.lore.packUrl or #pack=) -> this browser's cache (IndexedDB) -> human attaches a file.
// in: { player, cacheKey }   out: JSON { ok, source, pack, vectors, edges, ms } or throws E_NO_PACK.
(function () {
  "use strict";
  var DB = "SYS.AI.MAYA.PERCHANCE", STORE = "packs";
  function idb() {
    return new Promise(function (res, rej) {
      if (typeof indexedDB === "undefined") return rej(new Error("E_NO_CACHE - IndexedDB unavailable"));
      var r = indexedDB.open(DB, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(STORE); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error || new Error("E_NO_CACHE")); };
    });
  }
  async function cacheGet(key) {
    var db = await idb();
    return new Promise(function (res, rej) {
      var q = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      q.onsuccess = function () { res(q.result || null); };
      q.onerror = function () { rej(q.error); };
    });
  }
  async function cachePut(key, val) {
    var db = await idb();
    return new Promise(function (res, rej) {
      var tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(val, key);
      tx.oncomplete = function () { res(true); };
      tx.onerror = function () { rej(tx.error); };
    });
  }
  async function cacheDel(key) {
    var db = await idb();
    return new Promise(function (res) { var tx = db.transaction(STORE, "readwrite"); tx.objectStore(STORE).delete(key); tx.oncomplete = function () { res(true); }; tx.onerror = function () { res(false); }; });
  }
  function create(opts) {
    var o = opts || {};
    var player = o.player, key = o.cacheKey || "lorepack", onProgress = o.onProgress || null;
    var loaded = null;
    async function intoPlayer(blobOrStream, source, name) {
      var t0 = Date.now();
      var r = await player.loadStream(blobOrStream, { onProgress: onProgress, ref: name || source });
      loaded = { ok: true, source: source, name: name || "", pack: r.pack, vectors: r.vectors, edges: r.edges, ms: Date.now() - t0, at: new Date().toISOString() };
      return loaded;
    }
    async function fromFile(file, remember) {
      var r = await intoPlayer(file, "file", file && file.name);
      if (remember !== false) {
        try { await cachePut(key, { blob: file, name: file.name, size: file.size, savedAt: new Date().toISOString() }); r.cached = true; }
        catch (e) { r.cached = false; r.cacheError = String(e && e.message || e); }
      }
      return r;
    }
    async function fromUrl(url) {
      var resp;
      try { resp = await fetch(url); } catch (e) { throw new Error("E_PACK_FETCH - " + String(e && e.message || e).slice(0, 120)); }
      if (!resp.ok || !resp.body) throw new Error("E_PACK_FETCH - HTTP " + resp.status);
      return intoPlayer(resp.body, "url", url);
    }
    async function fromCache() {
      var c = null;
      try { c = await cacheGet(key); } catch (e) { c = null; }
      if (!c || !c.blob) return null;
      var r = await intoPlayer(c.blob, "cache", c.name);
      r.cachedAt = c.savedAt; r.size = c.size;
      return r;
    }
    async function ensure(url) {
      if (loaded) return loaded;
      if (url) return fromUrl(url);
      var c = await fromCache();
      if (c) return c;
      throw new Error("E_NO_PACK - no LorePack in this browser yet; a human attaches the .jsonl.gz once in the Lore panel (it stays local), or pass #pack=<url>");
    }
    async function cached() { try { var c = await cacheGet(key); return c ? { name: c.name, size: c.size, savedAt: c.savedAt } : null; } catch (e) { return null; } }
    return { ensure: ensure, fromFile: fromFile, fromUrl: fromUrl, fromCache: fromCache, cached: cached, forget: function () { loaded = null; return cacheDel(key); }, loaded: function () { return loaded; } };
  }
  var api = { create: create };
  if (typeof window !== "undefined") window.SysAiMayaLorePack = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
