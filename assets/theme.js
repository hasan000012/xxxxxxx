/* Magic Moon Shop — theme.js */
(function(){
'use strict';

/* ── HELPERS ── */
function fm(c){return'\u20AC'+(c/100).toFixed(2).replace('.',',');}

/* FIX 7: safe DOM creation instead of innerHTML string concat */
function el(tag,attrs,children){
  var e=document.createElement(tag);
  if(attrs)Object.keys(attrs).forEach(function(k){
    if(k==='className')e.className=attrs[k];
    else if(k==='textContent')e.textContent=attrs[k];
    else e.setAttribute(k,attrs[k]);
  });
  if(children)children.forEach(function(c){if(c)e.appendChild(c);});
  return e;
}

/* ── CART DRAWER ── */
var drawer=document.getElementById('cart-drawer');
var openBtn=document.getElementById('cart-open');
var closeBtn=document.getElementById('cart-close');
var closeBg=document.getElementById('cart-bg');
var continueBtn=document.getElementById('cart-continue');

function openDrawer(){
  if(!drawer)return;
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden','false');
  if(openBtn)openBtn.setAttribute('aria-expanded','true');
  document.body.style.overflow='hidden';
  /* Move focus to close button for accessibility */
  if(closeBtn)closeBtn.focus();
}
function closeDrawer(){
  if(!drawer)return;
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden','true');
  if(openBtn)openBtn.setAttribute('aria-expanded','false');
  document.body.style.overflow='';
  if(openBtn)openBtn.focus();
}

if(openBtn)openBtn.addEventListener('click',openDrawer);
if(closeBtn)closeBtn.addEventListener('click',closeDrawer);
if(closeBg)closeBg.addEventListener('click',closeDrawer);
if(continueBtn)continueBtn.addEventListener('click',closeDrawer);
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&drawer&&drawer.classList.contains('open'))closeDrawer();});

/* ── CART REFRESH ── */
function refreshCart(){
  fetch('/cart.js')
    .then(function(r){if(!r.ok)throw new Error('Cart fetch failed');return r.json();})
    .then(function(cart){
      /* Update count badge */
      var cc=document.getElementById('cart-count');
      if(cc){cc.textContent=cart.item_count;cc.hidden=cart.item_count===0;}
      var dcEl=document.getElementById('dc');
      if(dcEl)dcEl.textContent=cart.item_count+' '+(cart.item_count===1?'item':'items');
      var dtEl=document.getElementById('dt');
      if(dtEl)dtEl.textContent=fm(cart.total_price);

      var body=document.getElementById('di');
      var foot=document.getElementById('df');
      if(!body)return;

      /* Clear body */
      while(body.firstChild)body.removeChild(body.firstChild);

      if(cart.items.length===0){
        var empty=el('p',{className:'drawer__empty',textContent:'Your cart is empty'});
        body.appendChild(empty);
        if(foot)foot.style.display='none';
      } else {
        cart.items.forEach(function(item){
          /* FIX 7: build DOM nodes, never concat HTML strings with user data */
          var imgEl=null;
          if(item.image){
            imgEl=el('img',{src:item.image,alt:item.title,width:'52',height:'52',loading:'lazy'});
          }
          var imgWrap=el('div',{className:'ci__img'},imgEl?[imgEl]:[]);
          var vendor=el('div',{className:'ci__vendor',textContent:item.vendor});
          var name=el('div',{className:'ci__name',textContent:item.product_title});
          var infoChildren=[vendor,name];
          if(item.variant_title&&item.variant_title!=='Default Title'){
            infoChildren.push(el('div',{className:'ci__var',textContent:item.variant_title}));
          }
          var decBtn=el('button',{className:'qb','data-key':item.key,'data-d':'-1','aria-label':'Decrease',textContent:'−'});
          var qtySpan=el('span',{className:'qv',textContent:String(item.quantity)});
          var incBtn=el('button',{className:'qb','data-key':item.key,'data-d':'1','aria-label':'Increase',textContent:'+'});
          var qc=el('div',{className:'qc'},[decBtn,qtySpan,incBtn]);
          var price=el('span',{className:'ci__price',textContent:fm(item.final_line_price)});
          var row=el('div',{className:'ci__row'},[qc,price]);
          infoChildren.push(row);
          var info=el('div',{className:'ci__info'},infoChildren);
          var ci=el('div',{className:'ci','data-key':item.key},[imgWrap,info]);
          body.appendChild(ci);
        });
        if(foot)foot.style.display='block';
        bindQtyBtns();
      }
    })
    .catch(function(e){console.error('Cart refresh error:',e);});
}

function bindQtyBtns(){
  document.querySelectorAll('.qb').forEach(function(btn){
    /* Remove old listener by cloning node */
    var fresh=btn.cloneNode(true);
    btn.parentNode.replaceChild(fresh,btn);
    fresh.addEventListener('click',function(){
      var key=fresh.dataset.key;
      var delta=parseInt(fresh.dataset.d,10);
      var row=fresh.closest('.ci');
      var qv=row&&row.querySelector('.qv');
      var current=qv?parseInt(qv.textContent,10):1;
      var newQ=Math.max(0,current+delta);
      fetch('/cart/change.js',{
        method:'POST',
        headers:{'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest'},
        body:JSON.stringify({id:key,quantity:newQ})
      })
      .then(function(r){if(!r.ok)throw new Error('Cart change failed');return r.json();})
      .then(function(){refreshCart();})
      .catch(function(e){console.error('Qty change error:',e);});
    });
  });
}

/* FIX 4: expose addToCart on a namespaced object, not raw window */
window.MM = window.MM || {};
window.MM.addToCart = function(vid,qty,btn){
  if(!vid){console.error('addToCart: no variant ID');return;}
  qty=parseInt(qty,10)||1;
  var origHTML=btn?btn.innerHTML:'';
  if(btn){btn.classList.add('loading');btn.disabled=true;}
  fetch('/cart/add.js',{
    method:'POST',
    headers:{'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest'},
    body:JSON.stringify({id:vid,quantity:qty})
  })
  .then(function(r){if(!r.ok)throw new Error('Add to cart failed ('+r.status+')');return r.json();})
  .then(function(){
    if(btn){
      btn.classList.remove('loading');
      btn.classList.add('success');
      /* FIX 7: set innerHTML only with safe static SVG, not user data */
      btn.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20,6 9,17 4,12"/></svg>';
      setTimeout(function(){
        btn.classList.remove('success');
        btn.innerHTML=origHTML;
        btn.disabled=false;
      },1600);
    }
    refreshCart();
    openDrawer();
  })
  .catch(function(e){
    console.error('Add to cart error:',e);
    if(btn){btn.classList.remove('loading');btn.disabled=false;}
    /* Show user-facing error without exposing internals */
    var errMsg=document.createElement('p');
    errMsg.style.cssText='color:#ff5060;font-size:12px;margin-top:6px;';
    errMsg.textContent='Could not add to cart. Please try again.';
    if(btn&&btn.parentNode){
      var existing=btn.parentNode.querySelector('.atc-error');
      if(existing)existing.remove();
      errMsg.className='atc-error';
      btn.parentNode.appendChild(errMsg);
      setTimeout(function(){errMsg.remove();},3000);
    }
  });
};

/* Backwards compat: product card snippet uses addToCart() directly */
window.addToCart = function(vid,qty,btn){ window.MM.addToCart(vid,qty,btn); };

/* ── PRODUCT PAGE ── */
function initProduct(){
  /* Gallery thumbnails */
  document.querySelectorAll('.gal__thumb').forEach(function(t){
    t.addEventListener('click',function(){
      document.querySelectorAll('.gal__thumb').forEach(function(x){x.classList.remove('active');});
      t.classList.add('active');
      var mainImg=document.querySelector('.gal__main img');
      if(mainImg&&t.dataset.src)mainImg.src=t.dataset.src;
    });
    t.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' ')t.click();});
  });

  /* Product tabs */
  document.querySelectorAll('.ptab').forEach(function(tab){
    tab.addEventListener('click',function(){
      var pre=tab.dataset.pre;
      document.querySelectorAll('.ptab[data-pre="'+pre+'"]').forEach(function(t){
        t.classList.remove('active');
        t.setAttribute('aria-selected','false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected','true');
      var num=tab.dataset.num;
      document.querySelectorAll('.ptab-body[data-pre="'+pre+'"]').forEach(function(p){
        if(p.dataset.num===num)p.classList.remove('hidden');
        else p.classList.add('hidden');
      });
    });
  });

  /* Variant pills */
  document.querySelectorAll('.vpill:not(.unavail)').forEach(function(pill){
    pill.addEventListener('click',function(){
      pill.closest('.pills').querySelectorAll('.vpill').forEach(function(p){p.classList.remove('active');});
      pill.classList.add('active');
      var ogroup=pill.closest('.ogroup');
      if(ogroup){var sel=ogroup.querySelector('.ogroup__sel');if(sel)sel.textContent=pill.textContent.trim();}
      resolveVariant();
    });
  });

  /* Colour swatches */
  document.querySelectorAll('.sw').forEach(function(sw){
    sw.addEventListener('click',function(){
      sw.closest('.swatches').querySelectorAll('.sw').forEach(function(s){s.classList.remove('active');});
      sw.classList.add('active');
      var ogroup=sw.closest('.ogroup');
      if(ogroup){var sel=ogroup.querySelector('.ogroup__sel');if(sel)sel.textContent=sw.dataset.val||'';}
      resolveVariant();
    });
  });

  /* ATC button */
  var atcBtn=document.querySelector('.atc-btn[data-atc]');
  if(atcBtn){
    atcBtn.addEventListener('click',function(){
      var vidEl=document.getElementById('vid');
      if(vidEl&&vidEl.value)window.MM.addToCart(vidEl.value,1,atcBtn);
    });
  }
}

/* FIX 3: only expose safe fields — strip cost, compare_at_price not needed client-side for variant selection */
function resolveVariant(){
  var pd=window.__pd;
  if(!pd||!pd.variants)return;
  var opts=[];
  document.querySelectorAll('.ogroup').forEach(function(g){
    var ap=g.querySelector('.vpill.active');
    var as=g.querySelector('.sw.active');
    if(ap)opts.push(ap.textContent.trim());
    else if(as)opts.push(as.dataset.val||'');
  });
  var match=null;
  for(var i=0;i<pd.variants.length;i++){
    var v=pd.variants[i];
    if(v.options&&v.options.every(function(o,j){return o===opts[j];})){match=v;break;}
  }
  if(!match)return;
  var vidEl=document.getElementById('vid');
  if(vidEl)vidEl.value=match.id;
  var priceEl=document.getElementById('pi-price');
  if(priceEl)priceEl.textContent=fm(match.price);
  var atcBtn=document.querySelector('.atc-btn[data-atc]');
  if(atcBtn){
    var span=atcBtn.querySelector('span');
    if(match.available){
      atcBtn.disabled=false;
      if(span)span.textContent='Add to Cart';
    } else {
      atcBtn.disabled=true;
      if(span)span.textContent='Unavailable';
    }
  }
}

/* ── CATEGORY STRIP ── */
function initCatStrip(){
  document.querySelectorAll('.csb').forEach(function(b){
    if(b.tagName==='BUTTON'){
      b.addEventListener('click',function(){
        document.querySelectorAll('.csb').forEach(function(x){x.classList.remove('active');});
        b.classList.add('active');
      });
    }
  });
}

/* ── INIT ── */
document.addEventListener('DOMContentLoaded',function(){
  bindQtyBtns();
  initProduct();
  initCatStrip();
});

})(); /* end main IIFE */

/* ─────────────────────────────────────────────
   HERO SLIDER — separate IIFE
   FIX 9: guard with page check so it only runs on homepage
   FIX 15: wrapped in DOMContentLoaded
───────────────────────────────────────────── */
(function(){
  document.addEventListener('DOMContentLoaded',function(){
    var track=document.getElementById('hs-track');
    if(!track)return; /* Not on homepage — do nothing */

    var dots=document.querySelectorAll('.hs-dot');
    var total=track.querySelectorAll('.hs-slide').length;
    var current=0;
    var timer=null;

    function goTo(n){
      current=((n%total)+total)%total;
      track.style.transform='translateX(-'+current+'00%)';
      dots.forEach(function(d,i){d.classList.toggle('active',i===current);});
    }
    function next(){goTo(current+1);}
    function prev(){goTo(current-1);}
    function startAuto(){if(timer)clearInterval(timer);timer=setInterval(next,5000);}
    function stopAuto(){if(timer){clearInterval(timer);timer=null;}}

    var nb=document.getElementById('hs-next');
    var pb=document.getElementById('hs-prev');
    if(nb)nb.addEventListener('click',function(){stopAuto();next();startAuto();});
    if(pb)pb.addEventListener('click',function(){stopAuto();prev();startAuto();});

    dots.forEach(function(dot){
      dot.addEventListener('click',function(){
        var idx=parseInt(dot.dataset.slide,10);
        if(!isNaN(idx)){stopAuto();goTo(idx);startAuto();}
      });
    });

    /* Touch/swipe support */
    var touchStartX=0;
    track.addEventListener('touchstart',function(e){touchStartX=e.touches[0].clientX;},{passive:true});
    track.addEventListener('touchend',function(e){
      var dx=e.changedTouches[0].clientX-touchStartX;
      if(Math.abs(dx)>50){stopAuto();if(dx<0)next();else prev();startAuto();}
    },{passive:true});

    /* Pause on hover/focus */
    track.addEventListener('mouseenter',stopAuto);
    track.addEventListener('mouseleave',startAuto);
    track.addEventListener('focusin',stopAuto);
    track.addEventListener('focusout',startAuto);

    /* Respect prefers-reduced-motion */
    if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches){
      return; /* Show first slide only, no auto-play */
    }

    startAuto();
  });
})();
