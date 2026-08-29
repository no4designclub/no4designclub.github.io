/* THE LONG TAKE — film.overlay.js
   DOM-side reveals, driven directly by localT every frame (called from
   film.js's draw loop) instead of common.js's IntersectionObserver
   (one-shot, irreversible). Design doc §6.1 rule #2: "すべてのリビールは
   localT駆動で可逆" — scrolling back should un-reveal, that's most of what
   makes this read as built-with-intent rather than a scroll-triggered CSS
   fade. common.js's .reveal system stays untouched for the other pages
   (category-*.html, atelier.html); index.html opts out via body.film-live
   (see common.js's own gate).

   v2 additions (2026-08-20_NO4サイト_参考分析＋設計図.md §4.5/§4.6):
   - velocity-linked blur: fast scroll blurs the active text, it resolves
     when the scroll settles — "reads like part of a moving world" (mont-fort)
     rather than text glued flat on top of the film.
   - line-by-line reveal: Statement's two paragraphs reveal one line at a
     time instead of fading in as a block (mont-fort/alethia).
   - chapter rail: replaces the old unnamed dot nav (see film.cues.js's
     header note and styles.css's .chapter-rail block). */
window.NO4 = window.NO4 || {};
(function(NO4){
  "use strict";

  function clamp01(v){ return Math.min(1, Math.max(0, v)); }
  function lerp(a,b,k){ return a + (b-a)*k; }
  function smoothstep(t){ t = clamp01(t); return t*t*(3-2*t); }

  // 0 before t0, ramps 0->1 over [t0,t1], holds at 1 through [t1,t2],
  // ramps 1->0 over [t2,t3], 0 after. Any of t1===t0 / t3===t2 degenerates
  // to a hard step, which is fine (used for single-edge fades) — EXCEPT
  // the t2<=localT check below used to be `<`, so a t3===t2 "never exits"
  // window (e.g. closing's icon/mark/tag/contact/foot, all [1.00,1.00])
  // fell through to the final `return 0` at the exact instant localT===t2,
  // instead of holding at 1. Only reachable at the precise scroll-clamped
  // max (localT===1 exactly) — invisible on ordinary scrolling, but real
  // on "scroll to the very bottom and stop there" (found 2026-08-20 while
  // adding closing's blackout: the wordmark vanished at the true page
  // bottom instead of staying as the final resting image). `<=` fixes it
  // without changing the t3>t2 ramp case (which already evaluates to 1 at
  // localT===t2 via the branch below: 1-(0)/(t3-t2)===1).
  function fadeWindow(localT, t0, t1, t2, t3){
    if(localT < t0) return 0;
    if(localT < t1) return t1 > t0 ? (localT - t0) / (t1 - t0) : 1;
    if(localT <= t2) return 1;
    if(localT < t3) return t3 > t2 ? 1 - (localT - t2) / (t3 - t2) : 0;
    return 0;
  }

  // ---------- §4.5a velocity-linked blur ----------
  // Set once per frame by update(); read by every reveal call this frame.
  var vel = {norm: 0, dir: 1};
  var V0_BLUR = 6, V0_LIFT = 10;

  function setReveal(el, op, liftPx, blurPx, scale, velMul){
    if(!el) return;
    op = clamp01(op);
    if(velMul === undefined) velMul = 1;
    var extraLift = vel.norm * V0_LIFT * velMul * vel.dir;
    var extraBlur = vel.norm * V0_BLUR * velMul;
    var totalLift = (liftPx || 0) + extraLift;
    var totalBlur = (blurPx || 0) + extraBlur;
    var t = 'translateY(' + totalLift.toFixed(1) + 'px)';
    if(scale !== undefined) t += ' scale(' + scale.toFixed(3) + ')';
    el.style.opacity = op;
    el.style.transform = t;
    el.style.filter = totalBlur > 0.05 ? 'blur(' + totalBlur.toFixed(2) + 'px)' : 'none';
    // Found while wiring up plain click-through for the (now plate-less)
    // work stations: .works-index-row/.atl-index-row are real <a> tags
    // riseIn/fadeIn make invisible (opacity:0) until their own tail window,
    // but opacity alone doesn't stop them from receiving clicks — the whole
    // .works-index wrapper is position:absolute;inset:0 sitting on top of
    // .station-layer for the entire works act, so an invisible index row
    // was silently eating every click meant for whichever station happened
    // to be under it. Clearing pointer-events when near-invisible (and
    // handing control back to CSS once visible, rather than forcing 'auto'
    // and risking overriding some other element's own pointer-events:none)
    // fixes this for every riseIn/fadeIn call site on the page, not just
    // this one.
    el.style.pointerEvents = op > 0.05 ? '' : 'none';
  }

  // rises with blur+scale+lift (matches hero-scrub.js's well-received wordmark
  // treatment, "奥からピントが合って浮き出る" — reused everywhere a heading
  // needs weight, not just the hero).
  function riseIn(el, localT, t0, t1, t2, t3, velMul){
    if(!el) return;
    var op = fadeWindow(localT, t0, t1, t2, t3);
    var enterU = t1 > t0 ? clamp01((localT - t0) / (t1 - t0)) : 1;
    var eased = smoothstep(enterU);
    var lift = (1 - eased) * 26;
    var blur = (1 - eased) * 8;
    var scale = 0.92 + eased * 0.08;
    setReveal(el, op, lift, blur, scale, velMul);
  }

  // simpler fade+lift, no blur/scale — for body copy, where the blur pass
  // would be legibility noise rather than weight.
  function fadeIn(el, localT, t0, t1, t2, t3, velMul){
    if(!el) return;
    var op = fadeWindow(localT, t0, t1, t2, t3);
    var enterU = t1 > t0 ? clamp01((localT - t0) / (t1 - t0)) : 1;
    setReveal(el, op, (1 - smoothstep(enterU)) * 18, 0, undefined, velMul);
  }

  // ---------- §4.5b line-by-line reveal ----------
  // Wraps an element's text in one <span class="word"> per unit (idempotent
  // — checks dataset.wordsSplit), then groups those spans into visual lines
  // by comparing offsetTop (units on the same line share the same
  // offsetTop). Recomputed on resize (debounced) since line breaks depend on
  // viewport width. Each line gets its own staggered reveal window instead
  // of the whole paragraph fading in as one block.
  //
  // The unit is a single character, not a whitespace-delimited word: every
  // paragraph this runs on (Statement's two <p>s) is Japanese, which doesn't
  // use spaces between words at all — splitting on /\s+/ found zero
  // boundaries and wrapped the entire paragraph as one "word", collapsing
  // §4.5b to a no-op that just looked like a plain fade (caught during F2
  // QA: the whole paragraph was one <span>, so groupLines() only ever
  // produced a single line). Character-level splitting is language-agnostic
  // and gives real per-line groups for CJK text; it would also work for
  // Latin text if this is ever reused there.
  function splitWords(el){
    if(!el || el.dataset.wordsSplit) return;
    var text = el.textContent;
    el.textContent = '';
    Array.from(text).forEach(function(ch){
      if(/\s/.test(ch)){
        el.appendChild(document.createTextNode(ch));
      } else {
        var span = document.createElement('span');
        span.className = 'word';
        span.style.display = 'inline-block';
        span.textContent = ch;
        el.appendChild(span);
      }
    });
    el.dataset.wordsSplit = '1';
  }

  function groupLines(el){
    if(!el) return [];
    var words = el.querySelectorAll('.word');
    var lines = [];
    var lastTop = null;
    for(var i = 0; i < words.length; i++){
      var w = words[i];
      var top = w.offsetTop;
      if(lastTop === null || Math.abs(top - lastTop) > 2){
        lines.push([]);
        lastTop = top;
      }
      lines[lines.length - 1].push(w);
    }
    return lines;
  }

  // localT window for the whole element is [t0,t1] entering / [t2,t3]
  // leaving; each line gets its own sub-window offset by lineStagger.
  function revealLines(lines, localT, t0, t1, t2, t3, lineStagger, velMul){
    var lineRamp = Math.max(0.03, (t1 - t0));
    for(var i = 0; i < lines.length; i++){
      var lt0 = t0 + i * lineStagger;
      var lt1 = lt0 + lineRamp;
      var op = fadeWindow(localT, lt0, lt1, t2, t3);
      var enterU = lt1 > lt0 ? clamp01((localT - lt0) / (lt1 - lt0)) : 1;
      var lift = (1 - smoothstep(enterU)) * 16;
      var extraLift = vel.norm * V0_LIFT * (velMul === undefined ? 1 : velMul) * vel.dir;
      var extraBlur = vel.norm * V0_BLUR * (velMul === undefined ? 1 : velMul);
      var words = lines[i];
      for(var j = 0; j < words.length; j++){
        words[j].style.opacity = clamp01(op);
        words[j].style.transform = 'translateY(' + (lift + extraLift).toFixed(1) + 'px)';
        words[j].style.filter = extraBlur > 0.05 ? 'blur(' + extraBlur.toFixed(2) + 'px)' : 'none';
      }
    }
  }

  var els = {};
  var lines = {};
  var holds = {}; // actName -> its .hold element (see styles.css "position:fixed, not sticky" note)
  var SECTION_IDS = {hero:'s-hero', statement:'s-statement', works:'s-categories', process:'s-process', closing:'s-closing'};
  var lastCurrentHold = null;
  function q(sel){ return document.querySelector(sel); }
  function remeasureLines(){
    if(els.stP1) lines.stP1 = groupLines(els.stP1);
    if(els.stP2) lines.stP2 = groupLines(els.stP2);
  }
  var resizeTimer = null;
  function cache(){
    els.heroWrap    = q('#s-hero .wrap');
    els.stEyebrow   = q('#s-statement .eyebrow');
    els.stHeadline  = q('#s-statement .k');
    els.stP1        = q('#s-statement p:nth-of-type(1)');
    els.stP2        = q('#s-statement p:nth-of-type(2)');
    els.wkStations    = document.querySelectorAll('.work-station');
    els.clIcon      = q('#s-closing .brand-icon');
    els.clMark      = q('#s-closing .mark');
    els.clTag       = q('#s-closing .tag');
    els.clContact   = q('#s-closing .contact');
    els.clFoot      = q('#s-closing .foot');
    els.clIndexLinks = document.querySelectorAll('.closing-index a');

    splitWords(els.stP1);
    splitWords(els.stP2);
    remeasureLines();

    Object.keys(SECTION_IDS).forEach(function(act){
      var section = document.getElementById(SECTION_IDS[act]);
      holds[act] = section ? section.querySelector('.hold') : null;
    });

    chapterRail = document.getElementById('chapterRail');
    chapterLinks = chapterRail ? chapterRail.querySelectorAll('a') : [];

    window.addEventListener('resize', function(){
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(remeasureLines, 200);
    });
  }

  function updateHero(localT){
    if(!els.heroWrap) return;
    // keiichi (2026-08-20): "最初はもう本当文字とか入れずに...スクロールで
    // バーって映像が出て楽しんで" — 0.14 was barely a quarter of the way
    // into hall_truck's push, nowhere near "a while" of text-free footage.
    // Delayed to 0.58 so the wordmark only starts surfacing once the camera
    // has settled into act I's calm/HOLD window (segments[1] + calm start at
    // 0.62 in film.cues.js) — motion resolves, then the brand appears, not
    // the other way around.
    riseIn(els.heroWrap, localT, 0.58, 0.70, 0.86, 0.94);
  }

  function updateStatement(localT){
    riseIn(els.stEyebrow,  localT, 0.16, 0.24, 0.86, 0.94);
    riseIn(els.stHeadline, localT, 0.18, 0.30, 0.86, 0.94);
    if(lines.stP1 && lines.stP1.length) revealLines(lines.stP1, localT, 0.30, 0.38, 0.86, 0.94, 0.035);
    else fadeIn(els.stP1, localT, 0.30, 0.46, 0.86, 0.94);
    if(lines.stP2 && lines.stP2.length) revealLines(lines.stP2, localT, 0.38, 0.46, 0.86, 0.94, 0.035);
    else fadeIn(els.stP2, localT, 0.38, 0.54, 0.86, 0.94);
  }

  // §2.1/§2.2 SIX WINDOWS (2026-08-20, replaces the old RUN-label +
  // HOLD-card-grid works section — see film.cues.js's works act header
  // comment for why). Text-reveal machinery (word mask slide, num/sub/meta
  // fade) removed 2026-08-20 along with the stations' own text entirely —
  // keiichi wants Works purely visual, footage only, category names living
  // solely in the closing-index now. This still needs to run every frame
  // though: is-active is what routes clicks to whichever station is
  // currently "under" the visible footage (all six are stacked
  // position:absolute;inset:0 — see styles.css's
  // .work-station.is-active{pointer-events:auto}, off otherwise) so
  // clicking mid-scroll actually goes to the right category page.
  function updateWorks(localT, cues){
    // mobile: .work-station reverts to normal-flow stacked links, always
    // clickable via CSS (styles.css's max-width:900px block) — skip the
    // localT-driven is-active gating entirely rather than have two systems
    // arguing over the same pointer-events.
    if(window.innerWidth <= 900) return;
    var stations = cues.acts.works.stations;
    if(els.wkStations && els.wkStations.length && stations){
      els.wkStations.forEach(function(el, i){
        var s = stations[i];
        if(!s) return;
        var active = localT >= s.tIn && localT <= s.t1 + 0.02;
        el.classList.toggle('is-active', active);
      });
    }
  }

  function updateClosing(localT){
    riseIn(els.clIcon,    localT, 0.16, 0.26, 1.00, 1.00);
    riseIn(els.clMark,    localT, 0.20, 0.32, 1.00, 1.00);
    fadeIn(els.clTag,     localT, 0.34, 0.44, 1.00, 1.00);
    fadeIn(els.clContact, localT, 0.46, 0.56, 1.00, 1.00);
    fadeIn(els.clFoot,    localT, 0.80, 0.90, 1.00, 1.00);
    // closing-index (moved here from the old works-index tail): staggered
    // in after the centered brand content has already had its moment,
    // never exits (t2===t3===1.00 — safe now that fadeWindow()'s exact-
    // boundary bug is fixed, see film.js's blackoutAlpha comment).
    if(els.clIndexLinks){
      els.clIndexLinks.forEach(function(a, i){
        var t0 = 0.55 + i * 0.02, t1 = t0 + 0.05;
        fadeIn(a, localT, t0, t1, 1.00, 1.00);
      });
    }
  }

  // ---------- §4.6 chapter rail ----------
  var chapterRail = null, chapterLinks = null;
  function updateChapterRail(tl, cues){
    if(!chapterLinks || !chapterLinks.length) return;
    var order = NO4.timeline.ACT_ORDER;
    var currentIdx = order.indexOf(tl.act);
    var actCue = cues.acts[tl.act];
    var inHold = !!(actCue && actCue.calm && tl.localT >= actCue.calm.t0);
    for(var i = 0; i < chapterLinks.length; i++){
      var a = chapterLinks[i];
      var act = a.dataset.act;
      var idx = order.indexOf(act);
      var isCurrent = act === tl.act;
      a.classList.toggle('active', isCurrent);
      // NB: "is-hold" not "hold" — this file's own act-stage containers use
      // the class name ".hold" (styles.css, position:fixed viewport stage);
      // reusing it here made these <a> tags collide with that selector and
      // inherit position:fixed (found via a broken chapter-rail layout while
      // fixing the sticky bug in the same pass — see styles.css's .hold note).
      a.classList.toggle('is-hold', isCurrent && inHold);
      var prog = isCurrent ? tl.localT : (idx < currentIdx ? 1 : 0);
      a.style.setProperty('--prog', prog.toFixed(3));
      // F8 §5.4: live progress readout, active row only — cheap enough at
      // 5 rows to just re-set textContent each frame rather than cache a
      // second element list alongside chapterLinks.
      var pctEl = a.querySelector('.pct');
      if(pctEl) pctEl.textContent = isCurrent ? (String(Math.round(tl.localT * 100)).padStart(3, '0') + '%') : '';
    }
  }

  function updateHoldVisibility(tl){
    var current = holds[tl.act];
    if(current === lastCurrentHold) return;
    if(lastCurrentHold){
      lastCurrentHold.classList.remove('is-current');
      // Brand Film's station video is play()'d by updateWorks() while its
      // own hold window is active, but that function (and everything else
      // in this file) only runs for the act matching tl.act — leaving the
      // whole works act (not just that one station) skips updateWorks()
      // entirely and never gets a chance to pause it. Catch it here instead,
      // generically, so any future video in any hold gets the same net.
      var vids = lastCurrentHold.querySelectorAll('video');
      for(var i = 0; i < vids.length; i++){ if(!vids[i].paused) vids[i].pause(); }
    }
    if(current) current.classList.add('is-current');
    lastCurrentHold = current;
  }

  var cached = false;
  function update(tl, velocity){
    if(!cached){ cache(); cached = true; }
    if(velocity) vel = velocity;
    updateHoldVisibility(tl);
    switch(tl.act){
      case 'hero':      updateHero(tl.localT); break;
      case 'statement':  updateStatement(tl.localT); break;
      case 'works':      updateWorks(tl.localT, NO4.filmCues); break;
      case 'closing':    updateClosing(tl.localT); break;
    }
    updateChapterRail(tl, NO4.filmCues);
  }

  NO4.filmOverlay = {update: update};
})(window.NO4);
