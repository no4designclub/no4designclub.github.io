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
    hall_truck: {frames: 150, path: 'assets/film/hall_truck'},
    corridor:   {frames: 210, path: 'assets/film/corridor'},
    wall_track: {frames: 241, path: 'assets/film/wall_track'},
    eye:        {frames: 70,  path: 'assets/film/eye'},
    pull_back:  {frames: 120, path: 'assets/film/pull_back'}
  };

  var ACTS = {
    // ACT I — THE APPROACH. hall_truck 1->150. Camera trucks right across
    // the skyscraper canyon; near-column occluder sweeps the frame (real
    // parallax baked into the source, not a synthetic assist).
    hero: {
      segments: [
        {t0:0.00, t1:0.62, clipId:'hall_truck', f0:1,   f1:138},
        {t0:0.62, t1:1.00, clipId:'hall_truck', f0:138, f1:150}
      ],
      haze: {x:0.68, y:0.22, alpha:0.14},
      vignetteCenterY: 0.5,
      calm: {t0:0.62, t1:1.00},
      filament: {id:'F1', t0:0.30, t1:0.52},
      textWell: {x:0.50, y:0.46, rx:0.30, ry:0.26, t0:0.10, t1:1.00}
    },
    // ACT III (v3, was II) — THE COLUMN. corridor's own full 210 frames (no
    // longer a continuation of act I's clip — hall_truck and corridor are
    // separate shots now). Now sits after works — joined by the works->
    // statement dissolve instead of the old hero->statement one.
    statement: {
      segments: [
        {t0:0.00, t1:0.42, clipId:'corridor', f0:1,   f1:170},
        {t0:0.42, t1:1.00, clipId:'corridor', f0:170, f1:210}
      ],
      haze: {x:0.50, y:0.40, alpha:[0.16, 0.22]},
      vignetteCenterY: 0.5,
      calm: {t0:0.42, t1:1.00},
      textWell: {x:0.60, y:0.30, rx:0.36, ry:0.28, t0:0.12, t1:1.00}
    },
    // ACT II (v3, was III) — THE GALLERY, "SIX WINDOWS" ★. wall_track's 241
    // frames (re-encoded 2026-08-24 from the original full-density Kling
    // source — the deployed clip had been cut down to 110 frames, 3.09vh/
    // frame, effectively a slideshow over most of the section) — camera
    // tracks left past the palace wall's glowing windows, water holding a
    // perfect mirror reflection. Re-sequenced 2026-08-20 (Vault: NO4サイト
    // SIX WINDOWS設計) to sit right after hero — keiichi wants the film
    // experienced first, then "what we do," then the PR pitch (statement).
    // One clip, six stops: run→hold×6→tail, each hold surfacing one
    // category as a giant word + a real work "plate" (§2.2 of the design
    // doc), replacing the old RUN-label + HOLD-card-grid design.
    // Frame numbers below are the original 110-frame breakpoints scaled by
    // 241/110≈2.1909 (rounded) — still a first pass (even spacing) against
    // t0/t1, NOT a re-verification of where windows actually sit in the new
    // footage. §4.8-style hand-tuning against the real footage (does a
    // window actually sit at f44? f110?) is still owed, same as before.
    works: {
      segments: [
        {t0:0.00, t1:0.05, clipId:'wall_track', f0:1,   f1:18},
        {t0:0.05, t1:0.10, clipId:'wall_track', f0:18,  f1:44,  ease:true},
        {t0:0.10, t1:0.19, clipId:'wall_track', f0:44,  f1:50},
        {t0:0.19, t1:0.24, clipId:'wall_track', f0:50,  f1:77,  ease:true},
        {t0:0.24, t1:0.33, clipId:'wall_track', f0:77,  f1:83},
        {t0:0.33, t1:0.38, clipId:'wall_track', f0:83,  f1:110, ease:true},
        {t0:0.38, t1:0.47, clipId:'wall_track', f0:110, f1:116},
        {t0:0.47, t1:0.52, clipId:'wall_track', f0:116, f1:142, ease:true},
        {t0:0.52, t1:0.61, clipId:'wall_track', f0:142, f1:149},
        {t0:0.61, t1:0.66, clipId:'wall_track', f0:149, f1:175, ease:true},
        {t0:0.66, t1:0.75, clipId:'wall_track', f0:175, f1:182},
        {t0:0.75, t1:0.80, clipId:'wall_track', f0:182, f1:208, ease:true},
        {t0:0.80, t1:0.89, clipId:'wall_track', f0:208, f1:215},
        {t0:0.89, t1:1.00, clipId:'wall_track', f0:215, f1:232}
      ],
      haze: {x:0.62, y:0.42, alpha:0.18},
      vignetteCenterY: 0.58, // softens the bottom edge so the water mirror isn't crushed
      calm: {t0:0.89, t1:1.00}, // only the index tail — stations stay "spoken," per §4.7
      textWell: {x:0.24, y:0.70, rx:0.30, ry:0.26, t0:0.08, t1:1.00},
      // plateWell (SAME LIGHT §3.4) removed 2026-08-20 along with the plate
      // images themselves — keiichi wants each station as text-only, footage
      // + word/sub/meta, no photo/video "exhibit." plateWellAlpha() in
      // film.js went with it (recoverable from git history if plates come
      // back).
      //
      // one station per category, generated from the same six names/hrefs/
      // copy the old .cat-card grid used (verbatim — no new copy needed).
      // tIn/t0/t1 line up with the run/hold segments above (tIn = run
      // start, t0 = hold start, t1 = hold end).
      stations: (function(){
        var defs = [
          {name:'LP',          sub:'世界観を、誌面のように組む。ハイブランド誌の文法で作るエディトリアルLP。',                 count:'5 Works', href:'category-lp.html'},
          {name:'Dashboard',   sub:'数字を、リアルタイムで魅せる。売上・KPI・資産を可視化するWebダッシュボード。',           count:'2 Works', href:'category-dashboard.html'},
          {name:'App',         sub:'体験を、プロダクトに落とす。日々使われる、実用アプリケーション設計。',                       count:'2 Works', href:'category-app.html'},
          {name:'Brand Film',  sub:'一枚の写真から、映画を起こす。独自パイプラインによるシネマティック・ブランドフィルム。', count:'1 Work',  href:'category-film.html'},
          {name:'Photography', sub:'レンズが、世界観を焼き付ける。専属カメラマンによる実写エディトリアル撮影。',               count:'1 Work',  href:'category-photography.html'},
          {name:'PULSE',       sub:'数字の裏側を、突き止める。GA4・GBP・口コミを横断して読む、月次診断サービス。',           count:'1 Work',  href:'category-pulse.html'}
        ];
        return defs.map(function(d, i){
          var tIn = 0.05 + i * 0.14, t0 = tIn + 0.05, t1 = tIn + 0.14;
          d.num = String(i + 1).padStart(2, '0');
          d.tIn = tIn; d.t0 = t0; d.t1 = t1;
          return d;
        });
      })()
    },
    // ACT IV — THE EYE ★★. eye 1->70, forward — the payoff shot, unchanged.
    // Climax is pinned here; do not move it (design non-negotiable).
    process: {
      segments: [
        {t0:0.00, t1:0.55, clipId:'eye', f0:1,  f1:62},
        {t0:0.55, t1:1.00, clipId:'eye', f0:62, f1:70}
      ],
      haze: {x:0.50, y:0.50, alpha:0.16},
      vignetteCenterY: 0.5,
      calm: {t0:0.55, t1:1.00},
      textWell: {x:0.50, y:0.22, rx:0.30, ry:0.24, t0:0.12, t1:1.00}
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
        {t0:0.00, t1:0.03, clipId:'pull_back', f0:1,   f1:1},
        {t0:0.03, t1:0.62, clipId:'pull_back', f0:1,   f1:104},
        {t0:0.62, t1:1.00, clipId:'pull_back', f0:104, f1:120}
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
  var TRANSITIONS = {
    'hero->works':         {type:'smear',     window:[0.94, 1.00], inWindow:[0.00, 0.04], dir:-1},
    'works->statement':    {type:'dissolve',  window:[0.94, 1.00], inWindow:[0.00, 0.06]},
    'statement->process':  {type:'iris',      window:[0.92, 1.00], inWindow:[0.00, 0.06]},
    'process->closing':    {type:'cut',       window:[0.97, 1.00], inWindow:[0.00, 0.00]}
  };

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

  NO4.filmCues = {clips:CLIPS, acts:ACTS, transitions:TRANSITIONS, layers:LAYERS, actOrder:['hero','works','statement','process','closing']};
})(window.NO4);
