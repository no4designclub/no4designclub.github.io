/* THE LONG TAKE — film.loader.js
   Frame loader for the 5-clip film (600 frames total, ~39MB hi / ~17MB lo —
   too much for the old "new Image() for every frame, all at once" approach
   from P0). Per Vault design doc (2026-08-20_NO4サイト_参考分析＋設計図.md
   §4.4), itself distilled from builder.io's "3D scroll animation" article
   (Promise.all preload + swallow onerror + filter) plus a priority queue so
   the frames near the visible one arrive first.

   Public API (consumed by film.js):
     NO4.filmLoader.init(cues, res)         — res: 'hi' | 'lo'
     NO4.filmLoader.setResolution(res)      — call on tier downgrade, at an act boundary
     NO4.filmLoader.focus(actIndex, clipId, frame) — call once per act change
     NO4.filmLoader.get(clipId, frame)      — returns a drawable or null (only
                                               null before *anything* in that
                                               clip has loaded — see §4.4
                                               "never draw a blank frame")
     NO4.filmLoader.bootReady()             — true once act I's opening frames
                                               are in, or the 2.5s timeout hit
     NO4.filmLoader.stats()                 — {loadedHi, loadedLo, inflight, queued} for ?film=debug */
window.NO4 = window.NO4 || {};
(function(NO4){
  "use strict";

  var MAX_CONCURRENT = 6;
  var HI_CAP = 260, LO_CAP = 450;
  var BOOT_FRAMES = 12;
  var BOOT_TIMEOUT_MS = 2500;
  var NEXT_ACT_WARM_FRAMES = 24, PREV_ACT_WARM_FRAMES = 12, FAR_ACT_WARM_FRAMES = 8;

  var clips = {};        // clipId -> {path, total, frames:[{status,bitmap}]}
  var actOrder = [];
  var actClips = {};      // actName -> [clipId, ...] (unique, in first-seen order)
  var res = 'hi';
  var inflight = 0;
  var queue = [];         // {clipId, idx, priority}
  var queuedSet = {};
  var loadedHiCount = 0, loadedLoCount = 0;
  var lastFocusActIndex = -1;

  var bootDeadline = 0;
  var bootClipId = null;

  function frameUrl(clip, idx){
    return clip.path + '/' + res + '/f_' + String(idx + 1).padStart(4, '0') + '.jpg';
  }

  function init(cues, initialRes){
    res = initialRes;
    actOrder = cues.actOrder;
    clips = {};
    Object.keys(cues.clips).forEach(function(clipId){
      var c = cues.clips[clipId];
      clips[clipId] = {path: c.path, total: c.frames, frames: new Array(c.frames)};
    });
    actClips = {};
    actOrder.forEach(function(actName){
      var act = cues.acts[actName];
      var seen = {};
      var list = [];
      act.segments.forEach(function(seg){
        if(!seen[seg.clipId]){ seen[seg.clipId] = true; list.push(seg.clipId); }
      });
      actClips[actName] = list;
    });
    bootClipId = actClips[actOrder[0]][0];
    bootDeadline = performance.now() + BOOT_TIMEOUT_MS;

    // bootReady() waits for these frames, but nothing else in this module
    // ever enqueues them before the first focus() call — and focus() itself
    // never runs while draw() is stuck in the bootReady() gate (film.js).
    // Without this, every page load sat at the boot screen for the full
    // BOOT_TIMEOUT_MS with the queue empty. (Codex review, 2026-08-20.)
    enqueueActRange(actOrder[0], 0, BOOT_FRAMES, null);
    pump();

    checkManifest(cues);
  }

  // Cross-checks cues.clips against assets/film/manifest.json — a mismatch
  // (someone edits one file and forgets the other) should be loud in the
  // console, not a silent off-by-one in the frame math.
  function checkManifest(cues){
    fetch('assets/film/manifest.json').then(function(r){ return r.json(); }).then(function(manifest){
      Object.keys(cues.clips).forEach(function(clipId){
        var m = manifest[clipId];
        var c = cues.clips[clipId];
        if(!m) { console.warn('[film.loader] manifest.json is missing clip "' + clipId + '"'); return; }
        if(m.frames !== c.frames){
          console.warn('[film.loader] frame-count mismatch for "' + clipId + '": cues says ' + c.frames + ', manifest says ' + m.frames);
        }
      });
    }).catch(function(){ /* manifest is a lint aid, not a runtime dependency */ });
  }

  function setResolution(newRes){
    if(newRes === res) return;
    res = newRes;
    Object.keys(clips).forEach(function(clipId){
      var clip = clips[clipId];
      for(var i = 0; i < clip.total; i++){
        var f = clip.frames[i];
        if(f && f.bitmap && f.bitmap.close) f.bitmap.close();
      }
      clip.frames = new Array(clip.total);
    });
    loadedHiCount = 0; loadedLoCount = 0;
    queue = []; queuedSet = {};
  }

  function enqueue(clipId, idx, priority){
    var clip = clips[clipId];
    if(!clip || idx < 0 || idx >= clip.total) return;
    var existing = clip.frames[idx];
    if(existing && (existing.status === 'loaded' || existing.status === 'loading')) return;
    var key = clipId + ':' + idx;
    if(queuedSet[key] !== undefined && queuedSet[key] <= priority) return;
    queuedSet[key] = priority;
    queue.push({clipId: clipId, idx: idx, priority: priority});
  }

  function enqueueActRange(actName, priority, headCount, tailCount){
    var clipIds = actClips[actName];
    if(!clipIds) return;
    clipIds.forEach(function(clipId){
      var clip = clips[clipId];
      if(!clip) return;
      var start = 0, end = clip.total - 1;
      if(headCount) end = Math.min(end, headCount - 1);
      if(tailCount) start = Math.max(start, clip.total - tailCount);
      for(var i = start; i <= end; i++) enqueue(clipId, i, priority);
    });
  }

  function loadViaImageTag(url){
    return new Promise(function(resolve, reject){
      var img = new Image();
      img.onload = function(){
        if(img.decode){ img.decode().then(function(){ resolve(img); }).catch(function(){ resolve(img); }); }
        else resolve(img);
      };
      img.onerror = function(){ reject(new Error('img load failed: ' + url)); };
      img.src = url;
    });
  }

  function loadOne(url){
    if(window.createImageBitmap && window.fetch){
      return fetch(url).then(function(r){
        if(!r.ok) throw new Error('http ' + r.status);
        return r.blob();
      }).then(function(blob){
        return createImageBitmap(blob, {imageOrientation: 'none'});
      }).catch(function(){
        return loadViaImageTag(url); // e.g. createImageBitmap unsupported for this blob type
      });
    }
    return loadViaImageTag(url);
  }

  function pump(){
    while(inflight < MAX_CONCURRENT && queue.length){
      queue.sort(function(a, b){ return a.priority - b.priority; });
      var job = queue.shift();
      delete queuedSet[job.clipId + ':' + job.idx];
      var clip = clips[job.clipId];
      if(!clip) continue;
      // §mem bug (2026-08-24, found chasing the 791-frame CAP not holding):
      // focus() runs every rAF and re-enqueues the same (clipId, idx) at a
      // *different* priority whenever its act's priority level changes
      // (e.g. far act -> next act as the scrub crosses a boundary). enqueue()
      // only dedupes against queuedSet, which pump() clears the instant a
      // job is shifted out — so the same frame could already be sitting in
      // `queue` twice (once at the old priority, once at the new one) by the
      // time either copy is processed. Without this check, the first copy's
      // completed 'loaded' record got clobbered back to 'loading' by the
      // second, and finished a second time — double-counting loadedHiCount
      // (measured: 272 counted vs 179 actually resident) without ever
      // freeing the first bitmap (a leak on top of the miscount).
      var existing = clip.frames[job.idx];
      if(existing && (existing.status === 'loaded' || existing.status === 'loading')) continue;
      clip.frames[job.idx] = {status: 'loading', bitmap: null};
      inflight++;
      (function(clip, idx, clipId){
        loadOne(frameUrl(clip, idx)).then(function(bitmap){
          clip.frames[idx] = {status: 'loaded', bitmap: bitmap};
          if(res === 'hi') loadedHiCount++; else loadedLoCount++;
        }).catch(function(){
          // §4.4: a failed fetch/decode must not blank the frame — mark it
          // failed and get() will fall back to the nearest loaded neighbour.
          clip.frames[idx] = {status: 'failed', bitmap: null};
        }).then(function(){
          inflight--;
          pump();
        });
      })(clip, job.idx, job.clipId);
    }
    enforceCaps();
  }

  // Backstop for pathological scroll patterns: releaseFar() (called from
  // focus(), i.e. every draw() frame) already keeps steady-state memory to
  // roughly the current±1 act. This catches the gap where several far-act,
  // priority-4 background frames (§ focus()'s "preload everything eventually"
  // pass) finish loading inside a single pump() burst, faster than the next
  // focus() call's releaseFar() would otherwise trim them.
  // (Was a no-op — HI_CAP was checked but never acted on, and LO_CAP was
  // declared but never read at all, so the 'lo' tier (the mobile/T1 default)
  // had literally no eviction path and would grow unboundedly across a full
  // scroll-through. Codex review, 2026-08-20.)
  function enforceCaps(){
    var cap = res === 'hi' ? HI_CAP : LO_CAP;
    var count = res === 'hi' ? loadedHiCount : loadedLoCount;
    if(count <= cap || lastFocusActIndex < 0) return;
    releaseFar(lastFocusActIndex);
  }

  // §mem (2026-08-24): used to keep act±1 *whole* — fine at the old 600-frame
  // total (worst case hero+works+statement ~470 frames), but the re-encode
  // (works 110->241, closing 60->120, 791 frames total) pushed that same
  // worst case to ~600 frames resident (~3.3GB of decoded 1600x900 bitmaps).
  // Now mirrors the enqueue-side warm windows below: current act stays whole
  // (it's what's on screen), next/prev keep only the head/tail frames a
  // scrub could reach next, everything else keeps a small warm cache instead
  // of being fully evicted (matches focus()'s FAR_ACT_WARM_FRAMES enqueue —
  // evicting past that just gets immediately re-loaded by the next pump()).
  function releaseFar(actIndex){
    actOrder.forEach(function(actName, i){
      if(i === actIndex) return; // current act: keep every frame
      var keepHead = 0, keepTail = 0;
      if(i === actIndex + 1) keepHead = NEXT_ACT_WARM_FRAMES;
      else if(i === actIndex - 1) keepTail = PREV_ACT_WARM_FRAMES;
      else keepHead = FAR_ACT_WARM_FRAMES;
      var clipIds = actClips[actName];
      if(!clipIds) return;
      clipIds.forEach(function(clipId){
        var clip = clips[clipId];
        if(!clip) return;
        for(var f = 0; f < clip.total; f++){
          if(f < keepHead || (keepTail && f >= clip.total - keepTail)) continue;
          var rec = clip.frames[f];
          if(rec && rec.status === 'loaded'){
            if(rec.bitmap && rec.bitmap.close) rec.bitmap.close();
            clip.frames[f] = undefined;
            if(res === 'hi') loadedHiCount--; else loadedLoCount--;
          }
        }
      });
    });
  }

  function focus(actIndex, currentClipId, currentFrame){
    lastFocusActIndex = actIndex;
    var currentAct = actOrder[actIndex];
    var nextAct = actOrder[actIndex + 1];
    var prevAct = actOrder[actIndex - 1];

    var centerIdx = Math.round(currentFrame) - 1;
    for(var d = -6; d <= 24; d++) enqueue(currentClipId, centerIdx + d, 0);

    enqueueActRange(currentAct, 1);
    if(nextAct) enqueueActRange(nextAct, 2, NEXT_ACT_WARM_FRAMES, null);
    if(prevAct) enqueueActRange(prevAct, 3, null, PREV_ACT_WARM_FRAMES);
    // §mem (2026-08-24): used to be enqueueActRange(a, 4) — every far act's
    // *entire* clip, unbounded. With 791 frames total (post re-encode) that
    // fights releaseFar()'s act±1 window forever: release far act -> low-
    // priority queue immediately re-enqueues the whole thing -> next pump()
    // reloads it. Capping the far-act warm cache to a handful of head frames
    // keeps "scroll back up" snappy without re-growing past the CAP.
    actOrder.forEach(function(a){
      if(a !== currentAct && a !== nextAct && a !== prevAct) enqueueActRange(a, 4, FAR_ACT_WARM_FRAMES, null);
    });

    releaseFar(actIndex);
    pump();
  }

  // §4.4: never return null once *something* in the clip has loaded — walk
  // outward from the requested frame to the nearest loaded neighbour.
  function get(clipId, f){
    var clip = clips[clipId];
    if(!clip) return null;
    var idx = Math.max(0, Math.min(clip.total - 1, Math.round(f) - 1));
    var rec = clip.frames[idx];
    if(rec && rec.status === 'loaded') return rec.bitmap;
    if(!rec) enqueue(clipId, idx, -1); // requested but not even queued yet — jump the line
    for(var r = 1; r < clip.total; r++){
      var lo = idx - r, hi = idx + r;
      if(lo >= 0){ var rl = clip.frames[lo]; if(rl && rl.status === 'loaded') return rl.bitmap; }
      if(hi < clip.total){ var rh = clip.frames[hi]; if(rh && rh.status === 'loaded') return rh.bitmap; }
      if(lo < 0 && hi >= clip.total) break;
    }
    return null;
  }

  function bootReady(){
    if(performance.now() >= bootDeadline) return true;
    var clip = clips[bootClipId];
    if(!clip) return true;
    for(var i = 0; i < Math.min(BOOT_FRAMES, clip.total); i++){
      var rec = clip.frames[i];
      if(!rec || rec.status !== 'loaded') return false;
    }
    return true;
  }

  function stats(){
    return {loadedHi: loadedHiCount, loadedLo: loadedLoCount, inflight: inflight, queued: queue.length, res: res};
  }

  function debugByAct(){
    var out = {};
    actOrder.forEach(function(actName){
      var total = 0;
      (actClips[actName] || []).forEach(function(clipId){
        var clip = clips[clipId];
        if(!clip) return;
        for(var i = 0; i < clip.total; i++){
          if(clip.frames[i] && clip.frames[i].status === 'loaded') total++;
        }
      });
      out[actName] = total;
    });
    out.lastFocusActIndex = lastFocusActIndex;
    return out;
  }

  NO4.filmLoader = {
    init: init,
    setResolution: setResolution,
    focus: focus,
    get: get,
    bootReady: bootReady,
    debugByAct: debugByAct,
    stats: stats
  };
})(window.NO4);
