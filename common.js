(function(){
  var els = document.querySelectorAll('.reveal');
  if(!('IntersectionObserver' in window)){
    els.forEach(function(e){e.classList.add('in')});
    return;
  }
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(en){
      if(en.isIntersecting){ en.target.classList.add('in'); io.unobserve(en.target); }
    });
  },{threshold:0.12, rootMargin:'0px 0px -8% 0px'});
  els.forEach(function(e){io.observe(e)});
})();

/* ---------- side nav: active section highlight ---------- */
(function(){
  var dots = document.querySelectorAll('.side-nav .dot');
  if(!dots.length || !('IntersectionObserver' in window)) return;
  var map = {};
  dots.forEach(function(d){ map[d.getAttribute('href').slice(1)] = d; });
  var sections = Object.keys(map).map(function(id){ return document.getElementById(id); }).filter(Boolean);
  // ratio-based rather than a fixed 0.5 threshold: #s-hero is now a 300vh
  // scroll spacer (see styles.css .hero-spacer), so it can never fill more
  // than ~33% of its own bounding box even while it fully covers the
  // viewport. Tracking the highest-ratio section instead of "first past 50%"
  // keeps this correct for any section, tall or short.
  var ratios = {};
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(en){ ratios[en.target.id] = en.intersectionRatio; });
    var bestId = null, bestRatio = 0;
    Object.keys(ratios).forEach(function(id){
      if(ratios[id] > bestRatio){ bestRatio = ratios[id]; bestId = id; }
    });
    if(bestId){
      dots.forEach(function(d){ d.classList.remove('active'); });
      map[bestId].classList.add('active');
    }
  },{threshold:[0,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1]});
  sections.forEach(function(s){ io.observe(s); });
})();

/* ---------- PC-only interactive flourishes ---------- */
(function(){
  var isPC = window.matchMedia('(hover:hover) and (pointer:fine) and (min-width:1101px)').matches;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion:reduce)').matches;
  if(!isPC || reduceMotion || document.body.classList.contains('film-page')) return;
  document.documentElement.classList.add('has-fine-cursor');

  /* カーソル追従スポットライト：暗い面（ヒーロー写真・カテゴリカード）にマウスを近づけると光が差し込む */
  document.querySelectorAll('.hero-noir, .cat-card').forEach(function(el){
    var raf = null, lastEvt = null;
    function apply(){
      if(!lastEvt) return;
      var r = el.getBoundingClientRect();
      var x = ((lastEvt.clientX - r.left) / r.width) * 100;
      var y = ((lastEvt.clientY - r.top) / r.height) * 100;
      el.style.setProperty('--sx', x+'%');
      el.style.setProperty('--sy', y+'%');
      raf = null;
    }
    el.addEventListener('pointermove', function(e){
      lastEvt = e;
      if(raf) return;
      raf = requestAnimationFrame(apply);
    });
    el.addEventListener('pointerenter', function(){ el.classList.add('spot-active'); });
    el.addEventListener('pointerleave', function(){ el.classList.remove('spot-active'); });
  });

  /* 3D tilt on frame mockups */
  document.querySelectorAll('.browser,.phone,.film').forEach(function(el){
    el.addEventListener('mousemove', function(e){
      var r = el.getBoundingClientRect();
      var px = (e.clientX - r.left)/r.width - 0.5;
      var py = (e.clientY - r.top)/r.height - 0.5;
      el.style.transform = 'perspective(1200px) rotateY('+(px*5)+'deg) rotateX('+(py*-5)+'deg) translateZ(4px)';
    });
    el.addEventListener('mouseleave', function(){
      el.style.transform = 'perspective(1200px) rotateY(0) rotateX(0) translateZ(0)';
    });
  });

  /* カーソル追従の金パーティクル（きらきらトレイル。スポットライトのグローとは別演出） */
  (function(){
    var rootGold = getComputedStyle(document.documentElement).getPropertyValue('--gold').trim() || '#ad7f39';
    var COLORS = [rootGold, '#d9b878', '#f5f4f1'];
    var MAX = 60;

    var canvas = document.createElement('canvas');
    canvas.className = 'gold-particles';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    var ctx = canvas.getContext('2d');

    var dpr = Math.min(devicePixelRatio || 1, 2);
    function resize(){
      dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = innerWidth * dpr;
      canvas.height = innerHeight * dpr;
      canvas.style.width = innerWidth + 'px';
      canvas.style.height = innerHeight + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    addEventListener('resize', resize, {passive:true});

    var mouseX = 0, mouseY = 0, lastX = 0, lastY = 0, moving = false;
    var particles = [];
    var rafId = null;

    addEventListener('mousemove', function(e){
      mouseX = e.clientX; mouseY = e.clientY; moving = true;
      if(!rafId) rafId = requestAnimationFrame(tick);
    }, {passive:true});

    document.addEventListener('visibilitychange', function(){
      if(document.hidden && rafId){ cancelAnimationFrame(rafId); rafId = null; }
      else if(!document.hidden && (particles.length || moving) && !rafId){ rafId = requestAnimationFrame(tick); }
    });

    function spawn(x, y){
      if(particles.length >= MAX) return;
      var angle = Math.random() * Math.PI * 2;
      var speed = 0.15 + Math.random() * 0.35;
      particles.push({
        x: x, y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.25,
        size: 1.5 + Math.random() * 2.5,
        color: COLORS[(Math.random() * COLORS.length) | 0],
        life: 0,
        maxLife: 45 + Math.random() * 30
      });
    }

    function tick(){
      rafId = null;
      ctx.clearRect(0, 0, innerWidth, innerHeight);

      var dx = mouseX - lastX, dy = mouseY - lastY;
      var dist = Math.hypot(dx, dy);
      if(moving && dist > 2){
        var steps = Math.min(3, Math.max(1, Math.round(dist / 12)));
        for(var i = 0; i < steps; i++){
          spawn(lastX + dx * (i + 1) / steps, lastY + dy * (i + 1) / steps);
        }
      }
      lastX = mouseX; lastY = mouseY; moving = false;

      particles = particles.filter(function(p){
        p.life++;
        if(p.life >= p.maxLife) return false;
        p.x += p.vx; p.y += p.vy;
        p.vx *= 0.985; p.vy *= 0.985;
        var t = 1 - p.life / p.maxLife;
        ctx.globalCompositeOperation = 'screen';
        var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 3);
        g.addColorStop(0, p.color);
        g.addColorStop(1, 'transparent');
        ctx.fillStyle = g;
        ctx.globalAlpha = t;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2);
        ctx.fill();
        return true;
      });
      ctx.globalAlpha = 1;

      if(particles.length) rafId = requestAnimationFrame(tick);
    }
  })();
})();
