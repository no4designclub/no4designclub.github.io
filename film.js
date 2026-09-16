/* THE LONG TAKE — film.js
   Single-canvas engine: gating, rAF loop, scroll->frame mapping (§4.3 of the
   original design doc), §3.5 screen-space parallax assist, compositing
   (§4.2). Frame loading itself lives in film.loader.js (v2 split — see
   2026-08-20_NO4サイト_参考分析＋設計図.md §4.1/§4.4): a priority queue +
   ImageBitmap decode + error-tolerant fallback, replacing P0's "new Image()
   for all 280 frames at once" (v2 has 600 frames across 5 clips, ~39MB hi —
   that approach doesn't hold up). No Three.js (design doc §3.4/§13.4: a
   deliberate one-way door, not a temporary simplification).

   Source clips: assets/film/{hall_truck,corridor,wall_track,eye,pull_back}/
   {hi,lo}/f_NNNN.jpg (1-indexed). hall_truck/wall_track/pull_back re-encoded
   2026-08-20 from new Kling footage; corridor/eye re-encoded the same day
   from the original P0 Kling MP4s. Chain for all five (design doc §5.3):
     ffmpeg -i <src>.mp4 -vf "hqdn3d=4:3:6:4.5,
       eq=contrast=1.06:saturation=<0.42|0.62>:brightness=-0.015,
       scale=<1600x900|960x540>:flags=lanczos,fps=<N>" -q:v <4|5> f_%04d.jpg
   (corridor/eye keep saturation=0.42; the three new clips use 0.62 so their
   act-to-act color-temperature story — cool blue-grey / amber / gold — isn't
   crushed toward neutral, per §0.4 of the THE LONG TAKE narrative doc). */
window.NO4 = window.NO4 || {};
(function(NO4){
  "use strict";
  if(!NO4.timeline || !NO4.filmCues || !NO4.filmCurve || !NO4.filmLayers || !NO4.filmLoader) return;

  var timeline = NO4.timeline;
  var CUES = NO4.filmCues;
  var L = NO4.filmLayers;
  var Loader = NO4.filmLoader;

  function clamp01(v){ return Math.min(1, Math.max(0, v)); }
  function lerp(a,b,k){ return a + (b-a)*k; }
  function smoothstep(t){ t = clamp01(t); return t*t*(3-2*t); }

  // resolves a cue field that's either a plain number/pair or an
  // [start,end] range meant to be interpolated across the act by localT.
  function resolveRange(v, localT){
    if(Array.isArray(v)) return lerp(v[0], v[1], clamp01(localT));
    return v;
  }

  // ---------- gating (moved from stage.js — same rules, one fewer file) ----------
  var debug = /[?&]film=debug/.test(location.search);
  var flat = /[?&]flat=1/.test(location.search) || /[?&]film=off/.test(location.search);
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var coarse = window.matchMedia('(pointer: coarse)').matches
    && !window.matchMedia('(any-pointer: fine)').matches;
  var lowCore = !(navigator.hardwareConcurrency >= 4);
  var lowMem = !!(navigator.deviceMemory && navigator.deviceMemory < 8);
  NO4.flags = {flat:flat, reduced:reduced, coarse:coarse, lowCore:lowCore};

  var tier;
  if(flat || reduced) tier = 'T0';
  else if(coarse || lowCore || lowMem || window.innerWidth < 900) tier = 'T1';
  else tier = 'T2';

  var TIER_CFG = {
    T2: {res:'hi', motes:220, filament:true,  grainAlpha:0.055},
    T1: {res:'lo', motes:90,  filament:true,  grainAlpha:0.040},
    T0: {res:'lo', motes:0,   filament:false, grainAlpha:0.030}
  };
  var cfg = TIER_CFG[tier];
  document.documentElement.classList.add('film-live');
  if(tier === 'T0') document.documentElement.classList.add('film-static');

  var canvas = document.getElementById('filmCanvas');
  if(!canvas) return;
  var ctx = canvas.getContext('2d');
  var cw = 1, ch = 1, dpr = 1, pixelsPerFrame = 1;
  function resize(){
    dpr = Math.min(window.devicePixelRatio || 1, tier === 'T2' ? 1.75 : 1.5);
    var rect = canvas.getBoundingClientRect();
    cw = Math.max(1, rect.width); ch = Math.max(1, rect.height);
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // timeline.js anchors act boundaries to section offsetTop, cached once at
    // load. Nothing re-measured it on resize/rotate — stale offsets desync
    // which act localT reports as the viewport reflows. (Codex review, 2026-08-20.)
    timeline.remeasure();
    var hero=document.getElementById('s-hero'), closing=document.getElementById('s-closing');
    if(hero && closing){
      pixelsPerFrame=Math.max(1,(closing.getBoundingClientRect().top-hero.getBoundingClientRect().top)/(CUES.clips.hall_truck.frames-1));
    }
  }
  window.addEventListener('resize', resize);
  resize();
  if(window.document.fonts && document.fonts.ready){
    document.fonts.ready.then(function(){ timeline.remeasure(); });
  }

  if(tier !== 'T0') Loader.init(CUES, cfg.res);

  // §6.1-2 of the ACT I choreography doc: lint the curve-mode acts at boot
  // (t ascending / f monotonic non-decreasing) — a warn, not a throw, same
  // tone as film.loader.js's manifest checks.
  Object.keys(CUES.acts).forEach(function(actName){
    var cue = CUES.acts[actName];
    if(cue.curve) NO4.filmCurve.validateCurve(actName, cue.curve);
  });

  var motes = L.makeMotes(cfg.motes);
  var startTime = performance.now();
  var grainCounter = 0;
  var lastGoodImg = null;
  var lastActIndex = -1;
  var pendingTierDowngrade = null; // set when a downgrade is due but we wait for the act boundary

  // One damped scroll position drives both the film and its text overlays.
  // Keeping it in document pixels preserves continuity across act boundaries.
  var smoothScrollY = window.scrollY;
  var smoothLocalT = 0;
  var raf = 0, drawTime = performance.now(), lastSignature = '', paints = 0;
  function schedule(){if(!document.hidden && !raf && tier !== 'T0') raf=requestAnimationFrame(draw);}
  window.addEventListener('scroll', schedule, {passive:true});
  window.addEventListener('resize', function(){lastSignature='';schedule();});
  window.addEventListener('filmready', function(){lastSignature='';schedule();});
  document.addEventListener('visibilitychange', function(){
    if(document.hidden){cancelAnimationFrame(raf);raf=0;}else{drawTime=performance.now();schedule();}
  });
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', function(){location.reload();});

  // §4.5a velocity-linked text blur: EMA-smoothed scroll speed (px/s),
  // normalized against v0=2200px/s per design doc. Off entirely under
  // reduced-motion; capped at coarse-pointer touch inertia (§4.11) since
  // that can spike far past any real trackpad/wheel speed.
  var prevScrollY = window.scrollY;
  var prevTime = performance.now();
  var velocityEMA = 0;
  function sampleVelocity(now){
    var dt = Math.max(1, now - prevTime);
    var raw = (window.scrollY - prevScrollY) / (dt / 1000);
    velocityEMA += (raw - velocityEMA) * 0.15;
    prevScrollY = window.scrollY;
    prevTime = now;
    if(reduced) return {norm: 0, dir: 1};
    var norm = Math.min(1, Math.abs(velocityEMA) / 2200);
    if(coarse) norm = Math.min(norm, 3 / 6); // §4.11: cap coarse-pointer blur at 3px of the 6px max
    return {norm: norm, dir: velocityEMA >= 0 ? 1 : -1};
  }

  // §depth (2026-08-24, Vault: NO4サイト3D化構成案 §2 "応答性"): pointer
  // parallax on baked video is the cheapest signal that a scene has depth —
  // a plate that answers the cursor reads as "a real space," not a texture.
  // BG shifts ±0.6% of viewport width, FG (film.fg.js, opposite sign) ∓2.2%
  // — the differential between the two IS the depth cue, not either shift
  // alone. Off under reduced-motion/coarse pointers (no cursor to track).
  // EMA-smoothed the same way as sampleVelocity above: raw target set on
  // the event, eased toward once per rAF so motion stays tied to frame
  // rate, not to how often pointermove fires.
  var pointerEnabled = !reduced && !coarse;
  var pointerTargetX = 0, pointerTargetY = 0;
  var pointerX = 0, pointerY = 0;
  if(pointerEnabled){
    window.addEventListener('pointermove', function(e){
      pointerTargetX = (e.clientX / window.innerWidth) * 2 - 1;
      pointerTargetY = (e.clientY / window.innerHeight) * 2 - 1;
    }, {passive:true});
  }
  function samplePointer(){
    if(!pointerEnabled) return {x:0, y:0};
    pointerX += (pointerTargetX - pointerX) * 0.06;
    pointerY += (pointerTargetY - pointerY) * 0.06;
    return {x:pointerX, y:pointerY};
  }

  function frameWidth(img){ return img.naturalWidth || img.width || 1; }
  function frameHeight(img){ return img.naturalHeight || img.height || 1; }
  function frameOK(img){ return !!img; } // ImageBitmap has no .complete/.naturalWidth; loader only ever returns fully-decoded drawables

  function findSegment(actCue, localT){
    var segs = actCue.segments;
    for(var i = 0; i < segs.length; i++){
      var s = segs[i];
      if(localT >= s.t0 && localT <= s.t1) return s;
    }
    return segs[segs.length - 1];
  }

  // §4.7 "叫ぶ/囁く" rhythm: 0 during RUN, ramping to 1 across the act's HOLD
  // window (actCue.calm), never snapping — the transition itself should be
  // felt, not just the two states.
  // §4.5c: ramps the text-well's darkening in/out around its declared
  // [t0,t1] window (0.04 span each edge) instead of a hard on/off.
  function textWellAlpha(well, localT){
    if(!well) return 0;
    var rampIn = 0.04, rampOut = 0.04;
    if(localT < well.t0) return 0;
    if(localT < well.t0 + rampIn) return (localT - well.t0) / rampIn;
    if(well.t1 >= 1.0 || localT < well.t1 - rampOut) return 1;
    if(localT < well.t1) return 1 - (localT - (well.t1 - rampOut)) / rampOut;
    return 0;
  }

  // closing-only: ramps a flat black overlay across actCue.blackout's window
  // so the final scroll position is pure black behind the DOM wordmark,
  // instead of pull_back's last frame (which stays partly lit).
  function blackoutAlpha(cue, localT){
    if(!cue) return 0;
    if(localT <= cue.t0) return 0;
    if(localT >= cue.t1) return 1;
    return smoothstep((localT - cue.t0) / (cue.t1 - cue.t0));
  }

  function calmFactor(actCue, localT){
    if(!actCue.calm) return 0;
    var c = actCue.calm;
    if(localT <= c.t0) return 0;
    if(localT >= c.t1) return 1;
    return smoothstep((localT - c.t0) / (c.t1 - c.t0));
  }

  function getCardPoints(){
    var cards = document.querySelectorAll('.cat-card');
    if(!cards.length) return [];
    var rect = canvas.getBoundingClientRect();
    var pts = [];
    cards.forEach(function(el){
      var r = el.getBoundingClientRect();
      pts.push({x: r.left - rect.left + 24, y: r.top - rect.top + 24});
    });
    return pts;
  }

  // §8: outgoing transition drawn during this act's tail window, incoming
  // during the next act's head window. film.cues.js keys transitions by
  // 'fromAct->toAct'; both halves are looked up from whichever act is active.
  function drawTransitions(tl){
    var order = CUES.actOrder;
    var idx = order.indexOf(tl.act);
    if(idx < order.length - 1){
      var trOut = CUES.transitions[tl.act + '->' + order[idx + 1]];
      if(trOut && tl.localT >= trOut.window[0]){
        var uOut = clamp01((tl.localT - trOut.window[0]) / (trOut.window[1] - trOut.window[0]));
        applyTransition(trOut, uOut, false);
      }
    }
    if(idx > 0){
      var trIn = CUES.transitions[order[idx - 1] + '->' + tl.act];
      if(trIn && trIn.inWindow[1] > 0 && tl.localT <= trIn.inWindow[1]){
        var uIn = clamp01((tl.localT - trIn.inWindow[0]) / (trIn.inWindow[1] - trIn.inWindow[0]));
        applyTransition(trIn, 1 - uIn, true);
      }
    }
  }
  // u: 0 at the transition's start (untouched) -> 1 at its peak/end.
  // incoming=true means u is already inverted (1->0 as the act progresses).
  function applyTransition(tr, u, incoming){
    if(tr.type === 'dissolve'){
      L.drawDissolveWhiteout(ctx, cw, ch, u * 0.85);
    } else if(tr.type === 'smear' && !incoming){
      L.drawSmear(ctx, cw, ch, lastGoodImg, u, tr.dir);
    } else if(tr.type === 'iris'){
      // outgoing: closes (1.3->0) as u:0->1. incoming: opens (0->1.3) as u:1->0.
      L.drawIrisMask(ctx, cw, ch, incoming ? lerp(0, 1.3, 1 - u) : lerp(1.3, 0, u));
    } else if(tr.type === 'cut' && !incoming){
      if(u > 0.5) L.drawCut(ctx, cw, ch);
    }
  }

  // ---------- boot sequence: black + a 1px gold progress line at the bottom
  // edge until act I's opening frames are decoded (or 2.5s elapse) — design
  // doc §4.4. This is the one gold pixel that doesn't compete with the "one
  // gold accent per viewport" rule elsewhere, because it's gone before the
  // hero wordmark forms (§7's HOLD reveal starts at localT 0.14). ----------
  function drawBoot(elapsedMs){
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, ch);
    var u = Math.min(1, elapsedMs / 2500);
    ctx.fillStyle = '#ad7f39';
    ctx.fillRect(0, ch - 1, cw * u, 1);
  }

  function debugOverlay(tl, clipId, f){
    if(!debug) return;
    if(!debugOverlay.el){
      var el = document.createElement('div');
      el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:9999;' +
        'font:11px/1.4 monospace;color:#0f0;background:rgba(0,0,0,.7);' +
        'padding:6px 9px;pointer-events:none;white-space:pre;';
      document.body.appendChild(el);
      debugOverlay.el = el;
    }
    var s = Loader.stats();
    debugOverlay.el.textContent =
      'act=' + tl.act + ' (' + tl.actIndex + ')  localT=' + tl.localT.toFixed(3) + '\n' +
      'clip=' + clipId + '  frame=' + Math.round(f) + '/' + CUES.clips[clipId].frames + '\n' +
      'p=' + tl.p.toFixed(3) + '  tier=' + tier + '\n' +
      'loader: hi=' + s.loadedHi + ' lo=' + s.loadedLo + ' inflight=' + s.inflight + ' queued=' + s.queued;
  }

  function draw(now){
    raf=0;
    if(document.hidden)return;
    var elapsedTick=now-drawTime;
    var dt=elapsedTick>64?16.67:Math.max(1,elapsedTick);drawTime=now;
    var tSec = (now - startTime) / 1000;
    var elapsedMs = now - startTime;

    if(!Loader.bootReady()){
      return;
    }

    var rawY=window.scrollY;
    // Smooth one document position across both acts, including the boundary.
    // Limit the first tick after idle so a wheel notch cannot jump 64ms ahead.
    var scrollStep=(rawY-smoothScrollY)*(1-Math.exp(-dt/220));
    // Bound the film's catch-up speed during wheel bursts and long seeks.
    // Closing text retains ordinary damping once both positions are there.
    if(timeline.sample(smoothScrollY).act==='hero'||timeline.sample(rawY).act==='hero'){
      var maxStep=pixelsPerFrame*72*dt/1000;
      scrollStep=Math.max(-maxStep,Math.min(maxStep,scrollStep));
    }
    smoothScrollY+=scrollStep;
    if(Math.abs(rawY-smoothScrollY)<0.2)smoothScrollY=rawY;
    var tl = timeline.sample();
    var vtl = timeline.sample(smoothScrollY);
    var actCue = CUES.acts[vtl.act];

    if(vtl.actIndex !== lastActIndex){
      lastActIndex = vtl.actIndex;
      // A large scroll jump (e.g. a direct scrollTo, or a very fast flick)
      // can land 2+ acts away in a single frame. Loader.focus() below then
      // releases (ImageBitmap.close()s) whichever clips are no longer within
      // ±1 act — including, potentially, the very clip lastGoodImg was
      // pointing at. A closed/detached bitmap throws InvalidStateError on
      // drawImage, which (uncaught) would stop requestAnimationFrame from
      // ever being rescheduled — one bad frame would end the whole film
      // permanently. lastGoodImg is only ever meant to bridge a gap *within*
      // the current clip anyway, so drop it the moment the act changes.
      lastGoodImg = null;
      if(pendingTierDowngrade && pendingTierDowngrade !== cfg.res){
        cfg = TIER_CFG[tier]; // tier itself doesn't change at runtime; this
        // hook exists for §4.5's "hi->lo downgrade waits for an act boundary"
        // rule if/when P4-style dynamic tiering is added on top of this.
        Loader.setResolution(cfg.res);
        pendingTierDowngrade = null;
      }
    }

    smoothLocalT=vtl.localT;
    // The same visual timeline drives the canvas and DOM reveals.
    var signature=vtl.act+':'+vtl.localT.toFixed(7)+':'+cw+':'+ch;
    if(signature===lastSignature){if(smoothScrollY!==rawY)schedule();return;}
    lastSignature=signature;paints++;

    var filmShiftPx = 0;
    if(actCue){
      // curve acts (hero, per the 2026-09-09 choreography pass) resolve
      // frame directly from a single PCHIP pass over the whole act instead
      // of per-segment linear/eased lerp — see film.curve.js. Acts still on
      // `segments` (statement/works/process/closing) are unchanged below.
      var clipId, f;
      if(actCue.curve){
        clipId = actCue.clipId;
        f = NO4.filmCurve.evalCurve(actCue.curve, vtl.localT, actCue.curveMode);
        f = Math.max(1, Math.min(CUES.clips[clipId].frames, f)); // guard against PCHIP rounding at the curve's own endpoints
      } else {
        var seg = findSegment(actCue, vtl.localT);
        clipId = seg.clipId;
        var span = seg.t1 - seg.t0;
        var segU = span > 0 ? clamp01((vtl.localT - seg.t0) / span) : 1;
        if(seg.ease) segU = smoothstep(segU);
        f = lerp(seg.f0, seg.f1, segU);
      }
      var targetFrame=f;
      if(actCue.curve){
        var targetT=tl.act===vtl.act?tl.localT:(tl.actIndex>vtl.actIndex?1:0);
        targetFrame=NO4.filmCurve.evalCurve(actCue.curve,targetT,actCue.curveMode);
      }
      Loader.focus(vtl.actIndex, clipId, f, targetFrame);

      // §motion smoothing part 2: SMOOTH_RATE (above) glides localT itself,
      // but the source frames are still an integer sequence at ~600 frames /
      // 760vh (~11px/frame) — a single mouse-wheel notch (~100px) crosses
      // ~9 of them, so even a perfectly-smoothed localT was landing on a
      // visibly-stepping sequence of stills (keiichi, 2026-08-21: still
      // wanted it smoother after the localT damping alone). Cross-fading the
      // two frames bracketing the continuous f — like film's own motion
      // blur between adjacent frames — turns that stepping into a
      // continuous blend. frac only ever bridges *adjacent* frames of the
      // same clipId (seg never changes mid-expression here), so this never
      // blends across a cut.
      var fLo = Math.floor(f), fHi = Math.ceil(f), frac = f - fLo;
      var pair = Loader.pair(clipId, f);
      var imgA = pair.a, imgB = pair.b;
      frac = pair.blend;
      var detail = null;
      if(NO4.filmDetail){
        if(vtl.act==='hero' && smoothScrollY===rawY && CUES.clips[clipId].detailPath){
          detail=NO4.filmDetail.get(CUES.clips[clipId].detailPath,fLo,fHi);
          if(detail){imgA=detail[0];imgB=detail[1]||detail[0];frac=f-fLo;}
        }else NO4.filmDetail.clear();
      }
      var drawImg = frameOK(imgA) ? imgA : null;
      var blendImg = (frac > 0.02 && frameOK(imgB) && imgB !== drawImg) ? imgB : null;
      if(!drawImg){return;}

      // §3.5 screen-space parallax assist: film scales/shifts slightly across
      // each act, motes/haze read the same shift at 4.5x / -0.35x respectively.
      var assistFrac = lerp(-0.0035, 0.0035, vtl.localT);
      var scaleAssist = lerp(1.045, 1.075, vtl.localT);
      if(vtl.act==='hero'||vtl.act==='closing'){assistFrac=0;scaleAssist=1;}
      filmShiftPx = assistFrac * cw;

      var ptr = samplePointer();
      if(vtl.act==='hero'||vtl.act==='closing')ptr={x:0,y:0};
      var ptrShiftPxX = ptr.x * cw * 0.006, ptrShiftPxY = ptr.y * ch * 0.006;

      if(drawImg){
        var iw = frameWidth(drawImg), ih = frameHeight(drawImg);
        var baseScale = Math.max(cw / iw, ch / ih) * scaleAssist;
        var dw = iw * baseScale, dh = ih * baseScale;
        var dx = (cw - dw) / 2 + filmShiftPx + ptrShiftPxX;
        var dy = (ch - dh) / 2 + ptrShiftPxY;
        try {
          ctx.drawImage(drawImg, dx, dy, dw, dh);
          if(blendImg){
            ctx.globalAlpha = frac;
            ctx.drawImage(blendImg, dx, dy, dw, dh);
          }
          lastGoodImg = drawImg; // only cache it once we know it actually drew
          document.documentElement.classList.add('gilded-ready');
        } catch(e){
          // A bitmap the loader had already released (ImageBitmap.close())
          // right before this same frame reached it — e.g. a large scroll
          // jump triggering Loader.focus()'s release pass mid-draw. Drop it
          // so we don't keep retrying the same detached bitmap every frame.
          if(drawImg === lastGoodImg) lastGoodImg = null;
        } finally {
          // Codex review (2026-08-21): if blendImg's drawImage above threw
          // (e.g. it was the detached bitmap instead of drawImg), globalAlpha
          // would otherwise stay stuck at `frac` for every draw call after
          // this one this frame — haze/motes/grain/vignette/the closing
          // blackout would all render half-transparent from here on, a
          // silent whole-page wash-out with no error surfaced. Always reset,
          // success or failure.
          ctx.globalAlpha = 1;
        }
      }

      var calm = calmFactor(actCue, vtl.localT);

      if(actCue.textWell){
        L.drawTextWell(ctx, cw, ch, actCue.textWell, textWellAlpha(actCue.textWell, vtl.localT));
      }
      if(actCue.haze){
        var hz = actCue.haze;
        var anchor = {x: resolveRange(hz.x, vtl.localT), y: resolveRange(hz.y, vtl.localT)};
        var hazeAlpha = resolveRange(hz.alpha !== undefined ? hz.alpha : 0.16, vtl.localT);
        var ampMul = lerp(1, 0.5, calm);
        L.drawHaze(ctx, cw, ch, anchor, tSec, hazeAlpha, filmShiftPx, ampMul);
      }
      if(cfg.motes > 0 && vtl.act!=='hero'){
        L.drawMotes(ctx, cw, ch, motes, tSec, filmShiftPx, 1 - calm);
      }
      if(cfg.filament && actCue.filament){
        var fil = actCue.filament;
        if(vtl.localT >= fil.t0 && vtl.localT <= fil.t1){
          var fu = (vtl.localT - fil.t0) / (fil.t1 - fil.t0);
          if(fil.id === 'F1') L.drawFilamentF1(ctx, cw, ch, fu, tSec);
          else if(fil.id === 'F2') L.drawFilamentF2(ctx, cw, ch, fu, getCardPoints());
        }
      }
      drawTransitions(vtl);

      grainCounter++;
      if(vtl.act!=='hero'){
        L.drawGrain(ctx, cw, ch, grainCounter >> 1, cfg.grainAlpha * lerp(1, 0.7, calm));
        L.drawVignette(ctx, cw, ch, actCue.vignetteCenterY, actCue.vignetteAlpha);
      }

      if(vtl.act === 'closing' && actCue.blackout){
        var boAlpha = blackoutAlpha(actCue.blackout, vtl.localT);
        if(boAlpha > 0){
          ctx.fillStyle = 'rgba(0,0,0,' + boAlpha.toFixed(3) + ')';
          ctx.fillRect(0, 0, cw, ch);
        }
      }

      debugOverlay(vtl, clipId, f);
      NO4.filmState={act:vtl.act,target:tl.localT,current:vtl.localT,frame:f,paints:paints,tier:tier,exact:pair.exact,detail:!!detail,cache:Loader.stats()};
    } else {
      grainCounter++;
      L.drawGrain(ctx, cw, ch, grainCounter >> 1, cfg.grainAlpha);
      L.drawVignette(ctx, cw, ch);
    }

    // §depth: FG plate lives on its own canvas (film.fg.js) but rides this
    // same rAF tick — design doc's "one more 2D canvas in the same loop,
    // not a second render loop" (Three.js stays a one-way-door no). ptr is
    // undefined pre-actCue (boot/no-op frame); film.fg.js treats that as
    // "skip this tick" rather than drawing with a stale pointer position.
    if(NO4.filmFg) NO4.filmFg.update(vtl, ptr);
    if(NO4.filmOverlay) NO4.filmOverlay.update(vtl, sampleVelocity(now));
    if(smoothScrollY!==rawY)schedule();
  }

  // ---------- T0 (reduced-motion / flat): one static frame per act, no loop ----------
  function runStatic(){
    var lastAct = null, staticRequest=0;
    function poll(){
      var tl = timeline.sample();
      if(tl.act !== lastAct){
        lastAct = tl.act;
        var actCue = CUES.acts[tl.act];
        if(actCue){
          // closing (T0 only): show the act's resolved end state, not its
          // first instant — every other act's "first segment, first-ish
          // frame" pick is fine since there's no target end-state to match,
          // but closing's whole point (the blackout this session added to
          // the animated path) is a near-black frame + the DOM wordmark,
          // not pull_back's opening wide city shot.
          var isClosing = tl.act === 'closing';
          // curve acts (hero) have no `segments` to pick from — fall back to
          // the curve's own last control point as the "first-ish frame"
          // still. This whole picking scheme is provisional: design doc
          // §7.1 replaces it with a curated, re-graded still per act — this
          // is just enough to not crash until that pass lands.
          var stClipId, stF1;
          if(actCue.curve){
            stClipId = actCue.clipId;
            stF1 = actCue.curve[actCue.curve.length - 1].f;
          } else {
            var seg = isClosing ? actCue.segments[actCue.segments.length - 1] : actCue.segments[0];
            stClipId = seg.clipId;
            stF1 = seg.f1;
          }
          var clip = CUES.clips[stClipId];
          var img = new Image(), request=++staticRequest;
          img.onload = function(){
            if(request!==staticRequest)return;
            resize();
            ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cw, ch);
            var scale = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
            var dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
            ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
            document.documentElement.classList.add('gilded-ready');
            L.drawVignette(ctx, cw, ch, actCue.vignetteCenterY);
            if(isClosing) { ctx.fillStyle = 'rgba(0,0,0,0.85)'; ctx.fillRect(0, 0, cw, ch); }
          };
          img.src = clip.path + '/lo/f_' + String(stF1).padStart(4, '0') + '.jpg';
        }
      }
      if(NO4.filmOverlay) NO4.filmOverlay.update(tl);
    }
    window.addEventListener('scroll', poll, {passive:true});
    window.addEventListener('resize', function(){lastAct=null;poll();});
    poll();
  }

  if(tier === 'T0'){
    runStatic();
  } else {
    schedule();
  }

  canvas.addEventListener('webglcontextlost', function(){ /* no-op: plain 2D context, never fires */ });
})(window.NO4);
