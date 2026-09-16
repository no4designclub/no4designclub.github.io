/* ONE CUT — page-wide progress clock.
   Converts scroll position into a single p∈[0,1] across the whole hub page
   (hero top -> closing bottom), plus which named act we're in and how far
   through that act (localT). Anchored to section offsetTop, not raw
   scrollY/docHeight, so editing copy length never desyncs the timing. */
window.NO4 = window.NO4 || {};
(function(NO4){
  "use strict";

  // v4 order (2026-09-16, 2-act cut: hero/closing). This array must always
  // match film.cues.js's actOrder AND the physical <section> order in
  // index.html — all three have to move together or localT mapping breaks.
  // (2026-09-16: the 5-act list was left here after works/statement/process
  // were removed from index.html + film.cues.js; their missing sections
  // measured as top=0, so sample() reported act 'process' for the whole
  // hero range — a cue film.js no longer had, so no frame was ever drawn.)
  var ORDER = ['hero','closing'];
  var ids = {hero:'s-hero', closing:'s-closing'};
  var els = {};
  var docTops = {}; // absolute document-relative top, NOT offsetTop (which is relative to
                     // the nearest positioned ancestor — .dark-journey is position:relative
                     // for stacking, which silently breaks plain offsetTop comparisons here)
  var docBottom = 1;

  function measure(){
    for(var i=0;i<ORDER.length;i++){
      els[ORDER[i]] = document.getElementById(ids[ORDER[i]]);
    }
    if(!els.hero || !els.closing) return;
    for(var k in els){
      if(els[k]) docTops[k] = els[k].getBoundingClientRect().top + window.scrollY;
    }
    var closingRect = els.closing.getBoundingClientRect();
    docBottom = closingRect.top + window.scrollY + els.closing.offsetHeight;
  }
  measure();

  function sample(scrollY){
    if(!els.hero || !els.closing) return {p:0, act:'hero', actIndex:0, localT:0};

    var docTop = docTops.hero;
    // p=1 should land at the page's natural max scroll position, not at the
    // closing element's raw document-bottom (which is ~scrollHeight, always
    // innerHeight taller than the furthest the user can actually scroll to).
    var total = Math.max(1, (docBottom - window.innerHeight) - docTop);
    var y = (scrollY === undefined ? window.scrollY : scrollY) - docTop;
    var p = Math.min(1, Math.max(0, y/total));

    var tops = ORDER.map(function(k){ return els[k] ? (docTops[k] - docTop) : 0; });
    var idx = 0;
    // bug fix (2026-08-20): this loop never let idx reach the last act
    // (closing) — the bound was tops.length-1, so i topped out one short of
    // the final index. Never surfaced before because closing used to be
    // short enough that the page's scrollable range ran out first; THE LONG
    // TAKE's much longer acts (760vh total) exposed it — closing was
    // unreachable, sample() stuck reporting 'process' at localT:1 forever.
    for(var i=0;i<tops.length;i++){ if(y>=tops[i]) idx=i; }
    var segStart = tops[idx];
    var segEnd = (idx<tops.length-1) ? tops[idx+1] : total;
    var localT = segEnd>segStart ? Math.min(1,Math.max(0,(y-segStart)/(segEnd-segStart))) : (idx===ORDER.length-1?1:0);

    return {p:p, act:ORDER[idx], actIndex:idx, localT:localT};
  }

  // real p-value at which each named act begins, derived from actual section
  // geometry — lets acts.js key its camera/object keyframes to where the
  // content really is instead of guessed percentages that drift out of sync
  // whenever copy length changes.
  function actBoundaries(){
    if(!els.hero || !els.closing) return {hero:0,closing:1};
    var docTop = docTops.hero;
    var total = Math.max(1, (docBottom - window.innerHeight) - docTop);
    var out = {};
    for(var i=0;i<ORDER.length;i++){
      var k = ORDER[i];
      out[k] = Math.min(1, Math.max(0, (docTops[k]-docTop)/total));
    }
    return out;
  }

  NO4.timeline = {sample:sample, remeasure:measure, actBoundaries:actBoundaries, ACT_ORDER:ORDER};
})(window.NO4);
