/* THE LONG TAKE — film.fg.js (§depth, 2026-08-24, Vault: NO4サイト3D化構成案
   "THE LONG TAKE, in three planes")

   FG plate: a second 2D canvas between the BG film (film.js/#filmCanvas) and
   the DOM text (main). Rides film.js's own rAF tick via NO4.filmFg.update()
   — no second render loop, no Three.js (design doc's one-way door).

   Why this exists: film.js's BG plate is a single flat texture no matter how
   good the Kling footage is — nothing in the page ever occludes it, so
   nothing reads as being *in front of* anything else. An FG plate that (a)
   sits visually in front of the DOM headline text at certain acts and
   (b) answers the pointer in the opposite direction from the BG plate
   supplies both missing depth cues at once, without re-rendering the scene.

   Per-act content lives in CUES.layers[actName] (film.cues.js) — an array of
   {src, x, y, w, h, alpha} plate specs in canvas-space fractions. Loaded as
   plain <img> (not filmLoader — these are a handful of static alpha PNGs/
   WebPs per act, not an image-sequence scrub; no priority queue needed).
   No CUES.layers entry for an act = nothing drawn, canvas stays transparent.
   That's the expected state until ACT II/III/V get real plates (工程4/5). */
window.NO4 = window.NO4 || {};
(function(NO4){
  "use strict";
  if(!NO4.filmCues) return;

  var CUES = NO4.filmCues;
  var canvas = document.getElementById('filmFgCanvas');
  if(!canvas) return;
  var ctx = canvas.getContext('2d');
  var cw = 1, ch = 1, dpr = 1;

  function resize(){
    dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    var rect = canvas.getBoundingClientRect();
    cw = Math.max(1, rect.width); ch = Math.max(1, rect.height);
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  var imgCache = {}; // src -> {img, ready}
  function getImg(src){
    var rec = imgCache[src];
    if(rec) return rec.ready ? rec.img : null;
    rec = imgCache[src] = {img: new Image(), ready: false};
    rec.img.onload = function(){ rec.ready = true; };
    rec.img.src = src;
    return null;
  }

  var lastAct = null;

  function update(vtl, ptr){
    if(!vtl){ ctx.clearRect(0, 0, cw, ch); return; }
    ctx.clearRect(0, 0, cw, ch);

    var plates = CUES.layers && CUES.layers[vtl.act];
    if(!plates || !plates.length) return; // no FG content for this act yet (工程2+ fills these in)

    // Opposite sign from film.js's BG shift (±0.6%), larger magnitude
    // (∓2.2%) — the *differential* between BG and FG motion is the depth
    // cue, not either shift in isolation. ptr is undefined pre-boot; treat
    // that as "pointer at rest" rather than skipping the draw (FG plates
    // should still be visible before the first mousemove).
    var px = ptr ? ptr.x : 0, py = ptr ? ptr.y : 0;
    var shiftX = px * cw * -0.022, shiftY = py * ch * -0.022;

    plates.forEach(function(p){
      var img = getImg(p.src);
      if(!img) return;
      var dw = p.w * cw, dh = p.h * ch;
      var dx = p.x * cw + shiftX, dy = p.y * ch + shiftY;
      ctx.globalAlpha = p.alpha !== undefined ? p.alpha : 1;
      ctx.drawImage(img, dx, dy, dw, dh);
    });
    ctx.globalAlpha = 1;
  }

  NO4.filmFg = {update: update};
})(window.NO4);
