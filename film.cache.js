/* Bounded decoded-frame cache; compressed background prefetch stays separate. */
window.NO4 = window.NO4 || {};
(function(N){
  'use strict';
  let cues, res, active, desired=1, generation=0, busy=0, prefetching=0;
  let frames=new Map(), blobs=new Map(), pending=new Map(), failed=new Map(), loading=new Set(), queue=[];
  let blobBytes=0, prefetchIndex=1, paused=false, direction=1;
  const compact=matchMedia('(max-width:900px)').matches || (navigator.deviceMemory && navigator.deviceMemory<8);
  const cap=compact?32:48, blobCap=(compact?80:128)*1024*1024;
  function url(id,f){return cues.clips[id].path+'/'+res+'/f_'+String(f).padStart(4,'0')+'.jpg';}
  function key(id,f){return id+':'+f;}
  function wake(){window.dispatchEvent(new Event('filmready'));}
  function trim(){
    while(frames.size>cap){
      let victim, score=-1;
      for(const [k,r] of frames){const d=r.id===active?Math.abs(r.f-desired)*(Math.sign(r.f-desired)===direction?0.85:1):10000;
        if(d>score){score=d;victim=k;}}
      const r=frames.get(victim);r.image.close?.();frames.delete(victim);
    }
  }
  async function compressed(id,f){
    const k=key(id,f);
    if(blobs.has(k)) return blobs.get(k);
    if(pending.has(k)) return pending.get(k);
    const gen=generation;
    const task=(async()=>{
      const response=await fetch(url(id,f));if(!response.ok) throw new Error('Frame '+response.status);
      const blob=await response.blob();if(gen!==generation)return blob;
      blobs.set(k,blob);blobBytes+=blob.size;
      while(blobBytes>blobCap){const old=blobs.keys().next().value;blobBytes-=blobs.get(old).size;blobs.delete(old);}
      return blob;
    })();
    pending.set(k,task);
    try{return await task;}finally{pending.delete(k);}
  }
  async function decode(blob){
    if(window.createImageBitmap) return createImageBitmap(blob);
    const src=URL.createObjectURL(blob), img=new Image();img.src=src;
    try{await img.decode();return img;}finally{URL.revokeObjectURL(src);}
  }
  function pump(){
    if(paused)return;
    while(busy<4&&queue.length){
      const job=queue.shift(), k=key(job.id,job.f);
      if(frames.has(k)||loading.has(k)||(failed.get(k)||0)>performance.now())continue;
      loading.add(k);busy++;
      const gen=generation;
      compressed(job.id,job.f).then(decode).then(image=>{
        if(gen!==generation){image.close?.();return;}
        const old=frames.get(k);old?.image.close?.();frames.set(k,{...job,image});trim();wake();
      }).catch(()=>failed.set(k,performance.now()+5000)).finally(()=>{loading.delete(k);busy--;pump();prefetch();});
    }
  }
  function prefetch(){
    if(paused||prefetching||busy||!active||navigator.connection?.saveData)return;
    const id=active, total=cues.clips[id].frames;
    while(prefetchIndex<=total&&blobs.has(key(id,prefetchIndex)))prefetchIndex++;
    if(prefetchIndex>total)return;
    const f=prefetchIndex++;prefetching++;
    compressed(id,f).catch(()=>{}).finally(()=>{prefetching--;setTimeout(prefetch,40);});
  }
  function focus(act,id,f,target=f){
    if(id!==active){active=id;prefetchIndex=1;desired=f;}
    if(Math.abs(f-desired)>0.01)direction=f>desired?1:-1;
    desired=f;
    const center=Math.round(f), total=cues.clips[id].frames;
    queue=[];
    // Exact neighbors first, then bias lookahead without starving reversals.
    const candidates=[Math.floor(f),Math.ceil(f)];
    // Cover the displayed pair first, then the path toward the scroll target.
    const ahead=Math.min(cap-10,Math.max(16,Math.ceil(Math.abs(target-f))+8));
    for(let d=1;d<=ahead;d++){candidates.push(center+direction*d);if(d<=8)candidates.push(center-direction*d);}
    const targetFrame=Math.round(target);
    if(Math.abs(targetFrame-center)>ahead){
      candidates.splice(4,0,targetFrame,targetFrame+direction);
    }
    for(const n of new Set(candidates)){
      if(n>=1&&n<=total&&!frames.has(key(id,n)))queue.push({id,f:n});
    }
    trim();pump();prefetch();
    if(f>total*0.92){
      const next=cues.acts[cues.actOrder[act+1]];
      const nextId=next&&(next.clipId||next.segments?.[0].clipId);
      if(nextId)compressed(nextId,1).catch(()=>{});
    }
  }
  function init(c,r){
    generation++;for(const x of frames.values())x.image.close?.();frames.clear();
    cues=c;res=r;active=c.acts.hero.clipId;desired=1;queue=[];blobs.clear();blobBytes=0;
    focus(0,active,1);
  }
  function get(id,f){
    const exact=frames.get(key(id,Math.round(f)));if(exact)return exact.image;
    let nearest=null,distance=Infinity;
    for(const r of frames.values())if(r.id===id&&Math.abs(r.f-f)<distance){nearest=r.image;distance=Math.abs(r.f-f);}
    return nearest;
  }
  function pair(id,f){
    const a=frames.get(key(id,Math.floor(f))),b=frames.get(key(id,Math.ceil(f)));
    if(a&&b)return {a:a.image,b:b.image,blend:f-Math.floor(f),exact:true};
    return {a:get(id,f),b:null,blend:0,exact:false};
  }
  N.filmLoader={init,focus,get,pair,bootReady:()=>frames.size>0,
    setResolution:r=>{if(r!==res)init(cues,r);},
    stats:()=>({loadedHi:res==='hi'?frames.size:0,loadedLo:res==='lo'?frames.size:0,inflight:busy,queued:queue.length,res,blobBytes,decodedLimit:cap}),
    debugByAct:()=>({active,desired,frames:frames.size}),
    exact:(id,f)=>frames.has(key(id,Math.round(f)))};
  document.addEventListener('visibilitychange',()=>{paused=document.hidden;if(!paused){pump();prefetch();wake();}});
  window.addEventListener('pagehide',()=>{generation++;paused=true;for(const r of frames.values())r.image.close?.();frames.clear();blobs.clear();blobBytes=0;});
  window.addEventListener('pageshow',()=>{paused=false;if(cues)focus(0,active,desired);});
})(window.NO4);
