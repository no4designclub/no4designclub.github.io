/* Upgrade only the settled frame pair, keeping full-resolution memory bounded. */
window.NO4 = window.NO4 || {};
(function(N){
  let key='', images=null, controller=null, generation=0;
  function clear(){
    generation++;controller?.abort();controller=null;
    images?.forEach(image=>image.close());images=null;key='';
  }
  function get(path,a,b){
    if(!window.createImageBitmap)return null;
    const next=path+':'+a+':'+b;
    if(key===next)return images;
    clear();key=next;controller=new AbortController();
    const gen=generation, signal=controller.signal;
    const frames=a===b?[a]:[a,b];
    Promise.allSettled(frames.map(async f=>{
      const r=await fetch(path+'/f_'+String(f).padStart(4,'0')+'.jpg',{signal});
      if(!r.ok)throw new Error('Detail '+r.status);
      return createImageBitmap(await r.blob());
    })).then(results=>{
      const ready=results.filter(r=>r.status==='fulfilled').map(r=>r.value);
      if(gen!==generation||ready.length!==frames.length){ready.forEach(i=>i.close());return;}
      images=ready;window.dispatchEvent(new Event('filmready'));
    });
    return null;
  }
  N.filmDetail={get,clear};
  window.addEventListener('pagehide',clear);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)clear();});
})(window.NO4);
