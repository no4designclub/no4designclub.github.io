/* THE LONG TAKE — film.curve.js
   Evaluator for the ACT I choreography (Vault: 2026-09-08_NO4_ACT_I_
   スクロール振付_設計仕様書.md §5.2/§5.3/§6.1). Pure functions only — no DOM,
   no rAF. Only acts that opt in via a `curve` field use this; acts still on
   `segments` (statement/works/process/closing) are untouched, resolved by
   film.js's own findSegment() as before.

   PCHIP (Fritsch-Carlson monotone cubic Hermite): plain cubic splines
   (Catmull-Rom included) overshoot at control points where the slope
   changes sharply — hero's CP1->CP2 slope changes 5.4x, and an overshoot
   there would push f below 1 or momentarily run the clip backwards. PCHIP
   guarantees monotonicity, so that can't happen structurally. */
window.NO4 = window.NO4 || {};
(function(NO4){
  "use strict";

  function clamp(v, lo, hi){ return Math.min(hi, Math.max(lo, v)); }

  // ---------- PCHIP tangents (Fritsch-Carlson), cached per curve array ----------
  // Curve arrays are literals in film.cues.js, stable for the page's life —
  // WeakMap keyed by the array itself means "compute once, ever," matching
  // the design doc's "接線は起動時に一度だけ計算してキャッシュ".
  var tangentCache = new WeakMap();

  function computeTangents(pts){
    var n = pts.length;
    var delta = new Array(n - 1);
    for(var i = 0; i < n - 1; i++){
      var dt = pts[i+1].t - pts[i].t;
      delta[i] = dt > 0 ? (pts[i+1].f - pts[i].f) / dt : 0;
    }
    var m = new Array(n);
    m[0] = delta[0];
    m[n-1] = delta[n-2];
    for(i = 1; i < n - 1; i++){
      var dPrev = delta[i-1], dNext = delta[i];
      if(dPrev === 0 || dNext === 0 || (dPrev > 0) !== (dNext > 0)){
        m[i] = 0; // sign change (or flat run) at this control point: hold it flat, don't overshoot through it
      } else {
        var hPrev = pts[i].t - pts[i-1].t, hNext = pts[i+1].t - pts[i].t;
        var w1 = 2*hNext + hPrev, w2 = hNext + 2*hPrev;
        m[i] = (w1 + w2) / (w1/dPrev + w2/dNext); // weighted harmonic mean
      }
    }
    // Fritsch-Carlson endpoint clamp (|m| <= 3|delta| of the adjacent secant).
    // A no-op for m[0]/m[n-1] as constructed above (they equal their own
    // secant exactly) — kept because it's the documented safety net for the
    // interior tangents too, per the design doc's derivation.
    for(i = 0; i < n; i++){
      var d0 = i > 0 ? delta[i-1] : delta[0];
      var d1 = i < n-1 ? delta[i] : delta[n-2];
      var maxSlope = 3 * Math.max(Math.abs(d0), Math.abs(d1));
      if(Math.abs(m[i]) > maxSlope) m[i] = maxSlope * (m[i] < 0 ? -1 : 1);
    }
    return m;
  }

  function getTangents(curve){
    var cached = tangentCache.get(curve);
    if(cached) return cached;
    var m = computeTangents(curve);
    tangentCache.set(curve, m);
    return m;
  }

  // cubic Hermite basis
  function h00(u){ return (1+2*u)*(1-u)*(1-u); }
  function h10(u){ return u*(1-u)*(1-u); }
  function h01(u){ return u*u*(3-2*u); }
  function h11(u){ return u*u*(u-1); }

  // t -> f. mode 'linear' (debug only, per §5.2) skips the Hermite terms.
  function evalCurve(curve, t, mode){
    var n = curve.length;
    if(n === 0) return 0;
    if(n === 1) return curve[0].f;
    t = clamp(t, curve[0].t, curve[n-1].t);
    var i = 0;
    for(; i < n - 2; i++){ if(t <= curve[i+1].t) break; }
    var p0 = curve[i], p1 = curve[i+1];
    var dt = p1.t - p0.t;
    if(dt <= 0) return p0.f;
    var u = (t - p0.t) / dt;
    if(mode === 'linear') return p0.f + (p1.f - p0.f) * u;
    var m = getTangents(curve);
    return h00(u)*p0.f + h10(u)*dt*m[i] + h01(u)*p1.f + h11(u)*dt*m[i+1];
  }

  // ---------- keyframe resolver (§5.3) — not wired into film.js yet (that's
  // implementation step 3, haze/calm/vignetteAlpha retiming). Exposed now
  // since it's a pure function with no dependency on the curve work above. ----------
  // number -> constant (current behavior) / [a,b] -> linear across the whole
  // act (current behavior) / [{t,v},...] -> piecewise-linear through the
  // points (new — object-vs-number check keeps old callers unaffected).
  function resolveKeyframes(v, localT){
    if(Array.isArray(v)){
      if(v.length === 0) return 0;
      if(typeof v[0] === 'object'){
        var n = v.length;
        if(localT <= v[0].t) return v[0].v;
        if(localT >= v[n-1].t) return v[n-1].v;
        for(var i = 0; i < n - 1; i++){
          if(localT >= v[i].t && localT <= v[i+1].t){
            var span = v[i+1].t - v[i].t;
            var u = span > 0 ? (localT - v[i].t) / span : 0;
            return v[i].v + (v[i+1].v - v[i].v) * u;
          }
        }
        return v[n-1].v;
      }
      return v[0] + (v[1] - v[0]) * clamp(localT, 0, 1);
    }
    return v;
  }

  // ---------- boot-time lint (§6.1-2), same spirit as film.loader.js's
  // manifest checks: warn, don't throw — a malformed curve should degrade
  // visibly (a warning + a clamped/odd frame), not kill the render loop. ----------
  function validateCurve(actName, curve){
    for(var i = 1; i < curve.length; i++){
      if(curve[i].t < curve[i-1].t){
        console.warn('[film.curve] ' + actName + ': curve[].t not ascending at index ' + i);
      }
      if(curve[i].f < curve[i-1].f){
        console.warn('[film.curve] ' + actName + ': curve[].f not monotonic non-decreasing at index ' + i);
      }
    }
  }

  NO4.filmCurve = {
    evalCurve: evalCurve,
    resolveKeyframes: resolveKeyframes,
    validateCurve: validateCurve
  };
})(window.NO4);
