/* THE LONG TAKE — film.cues.js
   Data only. Per Vault design docs (2026-08-20_NO4サイト全体再設計_一発勝負.md
   + 2026-08-20_NO4サイト_参考分析＋設計図.md §4.2/§4.3): "調整は全部ここで
   完結させる" — iterate on this file, not film.js.

   v2 (this file): all 5 clips wired — hall_truck(I)/corridor(II)/
   wall_track(III)/eye(IV)/pull_back(V). P0's two-clip substitution
   (corridor/eye reused across all 5 acts) is retired; every act now plays
   its own dedicated footage.

   Each act has `segments`: an ordered list of {t0, t1, clipId, f0, f1, ease}.
   localT in [t0,t1] maps linearly (or smoothstep if ease:true) to a frame
   between f0 and f1 (1-indexed, inclusive) in that clip. f0 can be > f1
   (reverse playback).

   `haze.x` / `haze.y` / `haze.alpha` are either a plain number (constant for
   the act) or a [start,end] pair interpolated by localT — film.js's drawHaze
   call resolves either shape. `vignetteCenterY` (0..1, default 0.5) shifts
   the vignette's clear zone vertically; works uses a lower value to soften
   the bottom edge so the water reflection isn't crushed. `calm: {t0,t1}` is
   the act's HOLD window — film.js dims motes/grain/haze-breathing inside it
   (§4.7 "叫ぶ/囁く" rhythm) without ever fully stopping them. */
window.NO4 = window.NO4 || {};
(function(NO4){
  "use strict";

  var CLIPS = {
    // THE WHITE ASCENT (2026-09-10) — replaces THE GILDED RIFT as hall_truck's
    // footage. Gilded Rift's frames were deleted from assets/film/gilded
    // (2026-09-10) once White Ascent was confirmed as the replacement —
    // recoverable from commit 37b3a02 if ever needed again. Luma Ray 3.2
    // multi-keyframe, batch A/B/C
    // (241f each) simple-concatenated = 723f. Seam frame duplication checked
    // by hand (pixel diff) and found not to exist, so all 723 frames are used
    // as-is — dedupe would have introduced a jump, not removed one. Extracted
    // from the approved preview mp4 with lanczos scaling only (no hqdn3d/eq
    // grading chain — the approved look is the source look).
    hall_truck: {frames: 723, path: 'assets/film/white-ascent', detailPath: 'assets/film/white-ascent/detail'}
  };

  var ACTS = {
    // ACT I — THE APPROACH. hall_truck 1->150. Camera trucks right across
    // the skyscraper canyon; near-column occluder sweeps the frame (real
    // parallax baked into the source, not a synthetic assist).
    //
    // 2026-09-09 (Vault: 2026-09-08_NO4_ACT_I_スクロール振付_設計仕様書.md):
    // segments -> curve. Measured this clip's per-frame luminance/motion
    // (§3) and found the drama isn't evenly spread — f1-53 carries 10% of
    // the total change, f71-126 carries 70%. The old linear split gave both
    // equal scroll distance, which read as "dead, then too fast" rather than
    // as the run->near-column blackout->emerge->settle the footage actually
    // has. curve replaces that with a PCHIP (monotone cubic) pass through
    // the 9 points below, so the scroll distance follows where the motion
    // actually is instead of the frame index. See film.curve.js for the
    // evaluator. haze/calm/filament/textWell retiming is a later pass
    // (design doc §4.5/§10.1 steps 3-4) — untouched here on purpose so this
    // step's effect (the pacing itself) can be judged on its own.
    hero: {
      clipId: 'hall_truck',
      curveMode: 'linear',
      curve: [
        {t:0.000, f:1}, {t:1.000, f:723}
      ],
      haze: {x:0.68, y:0.22, alpha:0},
      vignetteCenterY: 0.5,
      calm: {t0:0.62, t1:1.00},
      textWell: {x:0.50, y:0.46, rx:0.30, ry:0.26, t0:0.86, t1:1.00}
    },



    // ACT V — THE EXIT. pull_back's own 120 frames (re-sampled 2026-08-24
    // from the original 241-frame Kling source — the deployed clip had been
    // cut down to 60 frames, 3.17vh/frame, effectively a still image over
    // most of the section) — camera retreats from the city, cloud masses
    // close from top+bottom only ("eyelid" reading is structural to this
    // clip, matches design's non-negotiable ending). Segment breakpoints
    // below are the old 1/52/60 breakpoints scaled by 120/60=2x (1/104/120)
    // — pull_back has no per-landmark alignment requirement like works'
    // windows do, so a proportional rescale is exact, not an approximation.
    closing: {
      segments: [
        {t0:0.00, t1:1.00, clipId:'hall_truck', f0:723, f1:723}
      ],
      haze: {x:0.50, y:[0.52, 0.50], alpha:[0.12, 0.06]},
      vignetteCenterY: 0.5,
      calm: {t0:0.62, t1:1.00},
      // keiichi (2026-08-20): pull_back's last frame never actually reaches
      // black — the "eyelid" leaves a thin warm horizon band, so the page's
      // final resting state was footage+logo, not logo-alone. blackout ramps
      // a flat black rect over the canvas across this window so scrolling to
      // the bottom resolves to pure black with only the DOM wordmark left
      // (wordmark itself already never fades — see updateClosing()'s exit
      // windows all sitting at [1.00,1.00], i.e. never triggering).
      blackout: {t0:0.90, t1:1.00},
      textWell: {x:0.50, y:0.35, rx:0.26, ry:0.32, t0:0.10, t1:0.60}
    }
  };

  // ---------- hero curve A/B (2026-09-10) ----------
  // Two independent implementations of THE WHITE ASCENT's hero pacing were
  // built in parallel to compare: this file's shipped `hero.curve` (Codex) is
  // a flat linear map — same scroll distance per frame throughout, chosen
  // after keiichi found an earlier choreographed pass "too fast, with jumps."
  // That earlier pass (Fable5) is kept here as `?curve=pchip` so it can be
  // felt head-to-head against the same 723 frames and the same 2400svh
  // scroll distance (gilded.css) — only the curve shape differs, so any felt
  // difference is the curve, not a confound from clip length or distance.
  // Fable5's key positions (1-indexed): K1=1 K2=37 K3=97 K4=151 K5=199 |
  // K6=241 (A/B seam) K7=284 K8=338 K9=386 K10=434 | K11=482 (B/C seam)
  // K12=579 K13=723. Regex-on-location.search, matching the file's existing
  // ?hero= / film.js's ?film=debug idiom (no URLSearchParams, ES5 posture).
  var curveParam = (location.search.match(/[?&]curve=([\w-]+)/) || [])[1];
  if(curveParam === 'pchip'){
    ACTS.hero.curveMode = 'pchip';
    ACTS.hero.curve = [
      {t:0.000, f:1},   {t:0.070, f:5},   {t:0.145, f:37},
      {t:0.230, f:97},  {t:0.300, f:151}, {t:0.360, f:199},
      {t:0.415, f:241}, {t:0.470, f:284}, {t:0.535, f:338},
      {t:0.595, f:386}, {t:0.655, f:434}, {t:0.715, f:482},
      {t:0.820, f:579}, {t:0.960, f:710}, {t:1.000, f:723}
    ];
  }

  // §8 transitions: which acts they sit between, and how they're drawn.
  // film.layers.js reads these by act name at each act's tail/head window.
  // 'dir' (smear only) is the offset direction multiplier — matched to the
  // incoming act's camera direction so the blur reads as continuous motion
  // rather than an arbitrary wipe.
  // v3 order (2026-08-20 SIX WINDOWS): hero->works->statement->process->closing.
  // process->closing is unchanged (non-negotiable climax + eyelid ending);
  // only works and statement swapped, so only their two transition pairs
  // are new — smear/dissolve reused from the retired pairs they replace,
  // matched to whichever clip pair now sits at that seam (see design doc §1.2).
  var TRANSITIONS = {};

  // §depth (2026-08-24): per-act FG plate specs for film.fg.js. {src, x, y,
  // w, h, alpha} in canvas-space fractions (0..1 of viewport width/height).
  // No entry for an act = film.fg.js draws nothing that act (transparent
  // canvas, zero cost) — the correct state for every act until Blender
  // supplies real plates: hero's window-mullion FG is 工程2, ACT II's
  // buttress/cornice silhouettes are 工程4, ACT III's near-figure is 工程5.
  // Pipeline itself (load -> position -> opposite-direction pointer
  // parallax vs. the BG plate) was proven end-to-end with a throwaway test
  // plate (assets/brand/no4-mark.png on hero) — confirmed working 2026-08-24,
  // then removed so hero's real content isn't sitting behind an unrelated
  // logo mark until 工程2's actual art replaces it.
  var LAYERS = {};

  NO4.filmCues = {clips:CLIPS, acts:ACTS, transitions:TRANSITIONS, layers:LAYERS, actOrder:['hero','closing']};
})(window.NO4);
