/* THE LONG TAKE — film.layers.js
   Pure drawing functions for the single-canvas compositing pipeline (Vault
   design doc §4.2). No Three.js, no second GL context — everything here is
   plain 2D canvas ops so the whole stack lives in one rAF loop with no
   renderer-sync problems. film.js calls these in order each frame; nothing
   here reads scroll state directly.

   Sprites (mote glow, haze glow) and the grain tiles are baked once into
   offscreen canvases at load, then just drawImage'd every frame — never
   recompute a createRadialGradient per-mote per-frame. */
window.NO4 = window.NO4 || {};
(function(NO4){
  "use strict";

  function makeRadialSprite(size){
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var ctx = c.getContext('2d');
    var g = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
    g.addColorStop(0, 'rgba(241,239,230,1)');
    g.addColorStop(1, 'rgba(241,239,230,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return c;
  }
  var moteSprite = makeRadialSprite(64);
  var hazeSprite = makeRadialSprite(512);

  function makeGrainTile(size){
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var ctx = c.getContext('2d');
    var id = ctx.createImageData(size, size);
    for(var i = 0; i < id.data.length; i += 4){
      var v = (Math.random() * 255) | 0;
      id.data[i] = id.data[i+1] = id.data[i+2] = v;
      id.data[i+3] = 255;
    }
    ctx.putImageData(id, 0, 0);
    return c;
  }
  var grainTiles = [makeGrainTile(256), makeGrainTile(256), makeGrainTile(256)];

  // ---------- motes (§3.4 C-1) ----------
  function makeMotes(count){
    var arr = new Array(count);
    for(var i = 0; i < count; i++){
      arr[i] = {x: Math.random(), y: Math.random(), d: Math.random()};
    }
    return arr;
  }

  // tSec: seconds since load (time-driven drift, keeps HOLD alive).
  // assistPx: current §3.5 screen-space parallax assist offset, in px.
  // calmMul (§4.7 "叫ぶ/囁く" rhythm, default 1): HOLD windows dim the motes
  // and slow their drift without ever stopping them — dimming to 0 reads as
  // dead, not calm.
  function drawMotes(ctx, cw, ch, motes, tSec, assistPx, calmMul){
    if(calmMul === undefined) calmMul = 1;
    ctx.globalCompositeOperation = 'lighter';
    for(var i = 0; i < motes.length; i++){
      var m = motes[i];
      var driftSpeed = (0.006 + (1 - m.d) * 0.014) * lerp1(1, 0.6, 1 - calmMul);
      var y = ((m.y - tSec * driftSpeed) % 1 + 1) % 1;
      var xParallax = (assistPx * (4.5 * (1 - m.d) + 0.3)) / cw;
      var x = ((m.x + xParallax) % 1 + 1) % 1;
      var radius = 0.6 + (1 - m.d) * 2.6;
      var alpha = (0.05 + (1 - m.d) * 0.17) * lerp1(1, 0.55, 1 - calmMul);
      var size = radius * 8; // moteSprite is 64px pre-baked; scale to target radius
      ctx.globalAlpha = alpha;
      ctx.drawImage(moteSprite, x * cw - size / 2, y * ch - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  function lerp1(a, b, k){ return a + (b - a) * k; }

  // ---------- text well (§4.5c: local readability dimming, alethia ref) ----------
  // Instead of leaning harder on the global vignette (which would crush the
  // whole frame), sink just the area behind the act's text anchor. well:
  // {x,y,rx,ry} fractions of screen. alpha: 0..1, already ramped by the
  // caller for the well's t0/t1 window. Drawn film-immediately-after /
  // haze-before per design §4.5c.
  function drawTextWell(ctx, cw, ch, well, alpha){
    if(!well || alpha <= 0) return;
    var cx = well.x * cw, cy = well.y * ch;
    var rx = well.rx * cw, ry = well.ry * ch;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(rx, ry);
    var g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, 'rgba(5,5,5,' + (0.30 * alpha).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(5,5,5,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  }

  // ---------- haze (§3.4 C-2) ----------
  // anchor: {x,y} fraction of screen (from film.cues.js act.haze, already
  // resolved from its possibly-interpolated form by film.js). filmShiftPx:
  // current §3.5 film transform's x-offset, in px — haze moves opposite at
  // 0.35x. ampMul (§4.7, default 1): HOLD windows breathe less.
  function drawHaze(ctx, cw, ch, anchor, tSec, alpha, filmShiftPx, ampMul){
    if(ampMul === undefined) ampMul = 1;
    var breathe = 1 + Math.sin(tSec * 0.08 * Math.PI * 2) * 0.04 * ampMul;
    var cx = anchor.x * cw - filmShiftPx * 0.35;
    var cy = anchor.y * ch;
    var size = Math.max(cw, ch) * 1.35 * breathe;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    ctx.drawImage(hazeSprite, cx - size / 2, cy - size / 2, size, size);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---------- filaments (§3.4 C-3): stroke the same path 4x at increasing
  // width/decreasing alpha instead of shadowBlur (cheaper, no blur-radius
  // GPU cost). Peak composite alpha stays under .35 per the design doc.
  function strokeGlow(ctx, fadeMul, pathFn){
    var widths = [9, 5, 2.5, 1];
    var alphas = [.05, .09, .16, .38];
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = '#f1efe6';
    ctx.lineCap = 'round';
    for(var i = 0; i < 4; i++){
      ctx.globalAlpha = alphas[i] * fadeMul;
      ctx.lineWidth = widths[i];
      ctx.beginPath();
      pathFn(ctx);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // F1: one strand, bottom-left to upper-mid-left, draw-on via lerping the
  // endpoint toward its target as u goes 0->1 (cheap stand-in for
  // lineDashOffset draw-on, same visual result for a single growing stroke).
  function drawFilamentF1(ctx, cw, ch, u, tSec){
    var p0 = {x: cw * 0.02, y: ch * 0.94};
    var p1 = {x: cw * (0.16 + Math.sin(tSec * 0.6) * 0.015), y: ch * (0.56 + Math.sin(tSec * 0.9 + 1) * 0.02)};
    var p2 = {x: cw * 0.29, y: ch * 0.28};
    var progress = Math.max(0, Math.min(1, u));
    var fade = progress < 0.85 ? 1 : Math.max(0, 1 - (progress - 0.85) / 0.15);
    strokeGlow(ctx, fade, function(c){
      var ex = p0.x + (p2.x - p0.x) * progress, ey = p0.y + (p2.y - p0.y) * progress;
      var cx = p0.x + (p1.x - p0.x) * progress, cy = p0.y + (p1.y - p0.y) * progress;
      c.moveTo(p0.x, p0.y);
      c.quadraticCurveTo(cx, cy, ex, ey);
    });
  }

  // F2: 6 strands from bottom edge to each card's top-left corner.
  // cardPoints: array of {x,y} in canvas px (film.js computes these from the
  // DOM card rects each call — cheap, only evaluated during the F2 window).
  function drawFilamentF2(ctx, cw, ch, u, cardPoints){
    var arriveAt = 0.75;
    var progress = Math.max(0, Math.min(1, u / arriveAt));
    var fade = u <= arriveAt ? 1 : Math.max(0, 1 - (u - arriveAt) / (1 - arriveAt));
    if(fade <= 0) return;
    for(var i = 0; i < cardPoints.length; i++){
      var target = cardPoints[i];
      var startX = cw * (0.08 + i * 0.84 / Math.max(1, cardPoints.length - 1));
      (function(target, startX){
        strokeGlow(ctx, fade, function(c){
          var ex = startX + (target.x - startX) * progress;
          var ey = ch + (target.y - ch) * progress;
          c.moveTo(startX, ch);
          c.lineTo(ex, ey);
        });
      })(target, startX);
    }
  }

  // ---------- transitions (§8) ----------
  function drawDissolveWhiteout(ctx, cw, ch, alpha){
    if(alpha <= 0) return;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cw, ch);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // Approximated motion-smear: caller passes the last-good frame image and
  // draws it offset+faded 6x (design §8 II->III). dir (default 1): offset
  // direction, matched per-transition to the incoming act's camera direction
  // (film.cues.js TRANSITIONS[...].dir) so the blur reads as continuous
  // motion rather than an arbitrary wipe.
  function drawSmear(ctx, cw, ch, img, alpha, dir){
    if(dir === undefined) dir = 1;
    if(alpha <= 0 || !img) return;
    var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    var scale = Math.max(cw / w, ch / h);
    var dw = w * scale, dh = h * scale;
    var baseX = (cw - dw) / 2, baseY = (ch - dh) / 2;
    ctx.globalCompositeOperation = 'lighter';
    for(var i = 1; i <= 6; i++){
      ctx.globalAlpha = alpha * (0.30 - (i - 1) * (0.25 / 5));
      ctx.drawImage(img, baseX + dir * i * (64 / 6), baseY, dw, dh);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // r: 0 (fully closed, hole invisible) .. 1.3 (fully open, mask gone).
  function drawIrisMask(ctx, cw, ch, r){
    if(r >= 1.3) return;
    var diag = Math.sqrt(cw * cw + ch * ch) / 2;
    var radius = Math.max(0, r) * diag;
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.rect(0, 0, cw, ch);
    ctx.moveTo(cw / 2 + radius, ch / 2);
    ctx.arc(cw / 2, ch / 2, radius, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    ctx.restore();
  }

  function drawCut(ctx, cw, ch){
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, ch);
  }

  // ---------- grain + vignette ----------
  function drawGrain(ctx, cw, ch, tileIndex, alpha){
    if(alpha <= 0) return;
    var tile = grainTiles[tileIndex % grainTiles.length];
    var pattern = ctx.createPattern(tile, 'repeat');
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = alpha;
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, cw, ch);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // centerYFrac (default 0.5): shifts the vignette's clear zone vertically.
  // works (act III) passes ~0.58 so the water-mirror reflection in the
  // bottom half isn't crushed as dark as the rest of the frame (design
  // §4.3's "水面鏡像があるのでビネット下辺を弱める").
  var vignetteCache = {}, vignetteCacheKey = {};
  function drawVignette(ctx, cw, ch, centerYFrac, baseAlpha){
    if(centerYFrac === undefined) centerYFrac = 0.5;
    if(baseAlpha === undefined) baseAlpha = 0.55;
    var bucket = Math.round(centerYFrac * 100);
    var key = cw + 'x' + ch;
    if(vignetteCacheKey[bucket] !== key){
      var c = document.createElement('canvas');
      c.width = cw; c.height = ch;
      var vctx = c.getContext('2d');
      var cy = ch * centerYFrac;
      var g = vctx.createRadialGradient(cw / 2, cy, Math.min(cw, ch) * 0.32, cw / 2, cy, Math.max(cw, ch) * 0.72);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, '#3a3833');
      vctx.fillStyle = g;
      vctx.fillRect(0, 0, cw, ch);
      vignetteCache[bucket] = c;
      vignetteCacheKey[bucket] = key;
    }
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = baseAlpha;
    ctx.drawImage(vignetteCache[bucket], 0, 0, cw, ch);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  NO4.filmLayers = {
    makeMotes: makeMotes,
    drawMotes: drawMotes,
    drawHaze: drawHaze,
    drawTextWell: drawTextWell,
    drawFilamentF1: drawFilamentF1,
    drawFilamentF2: drawFilamentF2,
    drawDissolveWhiteout: drawDissolveWhiteout,
    drawSmear: drawSmear,
    drawIrisMask: drawIrisMask,
    drawCut: drawCut,
    drawGrain: drawGrain,
    drawVignette: drawVignette
  };
})(window.NO4);
