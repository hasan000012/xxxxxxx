// @ts-nocheck
/**
 * X Under World — Collection JS  |  assets/xuw-collection.js  |  v11.0 (V6 spec)
 *
 * V6 CHANGES vs V5:
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. WS VARIANT IN CART — In wholesale mode, WS-SKU variant IS added to cart.
 *    _resolveVid() returns wsVariantId when mode='wholesale'.
 *    RISK-1 NOTE: WS unit price is already discounted. Shopify Automatic Discounts
 *    (WS-300/500/1000/2000) provide ADDITIONAL % on top. If stacking is unwanted,
 *    remove Automatic Discounts from Shopify Admin. See BLOCK 3 of system prompt.
 *
 * 2. €2,000 WHOLESALE CAP — _checkWsCap() runs before every wholesale add.
 *    Fetches /cart.js, sums WS- SKU line items only. Over €2,000 → contact
 *    prompt, no /cart/add.js call.
 *
 * 3. DUAL-PRICE MODE SELECTOR — _setCardMode() replaces old _cardSetMode().
 *    data-action="set-mode" (was "card-mode"). No fetch needed — WS price is
 *    already in data-ws-price on the card div.
 *
 * 4. HOMEPAGE INLINE FILTER BAR — _buildFilterBar() auto-generates filter pills
 *    from actual .xuw-card data attributes. Zero hardcoded labels.
 *
 * 5. CART WS TIER DISPLAY — _refreshCartWsDisplay() updates #xuw-cart-ws-tier
 *    on every xuw:cart-updated event. Shows tier %, next-tier progress, and
 *    cap warning at €2,000.
 *
 * 6. COMPLETE EVENT DELEGATION switch: atc, set-mode, filter-toggle,
 *    filter-clear, close-modal, modal-atc, modal-mode, pick-variant,
 *    qty-inc/dec, close-toast, hero-prev/next/dot, sidebar-toggle.
 */

(function () {
  'use strict';

  /* ═══════════════ MONEY FORMAT ═══════════════ */
  var _moneyFmt = null;

  function _formatMoney(cents) {
    if (_moneyFmt === null) {
      var span = document.getElementById('xuw-money-fmt');
      _moneyFmt = (span && span.getAttribute('data-fmt')) || '\u20AC{{amount_with_comma_separator}}';
    }
    var c      = parseInt(cents, 10) || 0;
    var amount = (c / 100).toFixed(2);
    return _moneyFmt
      .replace('{{amount_with_comma_separator}}', amount.replace('.', ','))
      .replace('{{amount_no_decimals_with_comma_separator}}', String(Math.round(c / 100)))
      .replace('{{amount_no_decimals}}', String(Math.round(c / 100)))
      .replace('{{amount}}', amount);
  }

  /* ═══════════════ STATE ═══════════════ */
  var state = {
    product         : null,
    retailVariantId : null,
    wsVariantId     : null,
    wsVariantPrice  : null,
    qty             : 1,
    modalMode       : 'retail',
    globalMode      : 'retail',
    cartTotal       : 0,
    wsCartTotal     : 0,
    WS_TIERS        : [
      { min: 2000, pct: 20 },
      { min: 1000, pct: 10 },
      { min:  500, pct:  5 },
      { min:  300, pct:  3 }
    ],
    WS_CAP_CENTS    : 200000,
    activeFilters   : {},
    searchQuery     : '',
    searchTimer     : null,
    predictiveTimer : null,
    sliderTimer     : null,
    sliderIndex     : 0,
    dropdownIndex   : -1
  };

  var D = {};

  /* ═══════════════ INIT ═══════════════ */
  document.addEventListener('DOMContentLoaded', function () {
    D.overlay      = id('xuw-modal-overlay');
    D.modalContent = id('xuw-modal-content');
    D.spinner      = id('xuw-modal-loading');
    D.modalVendor  = id('xuw-modal-vendor');
    D.modalTitle   = id('xuw-modal-title');
    D.modeRow      = id('xuw-modal-mode-row');
    D.variantPills = id('xuw-modal-variants');
    D.modalPrice   = id('xuw-modal-price');
    D.wsTiers      = id('xuw-modal-tiers');
    D.wsNote       = id('xuw-modal-ws-note');
    D.qtyVal       = id('xuw-modal-qty');
    D.addToCart    = id('xuw-modal-atc');

    D.search          = id('xuwSearch');
    D.searchClear     = id('xuwSearchClear');
    D.activeChips     = id('xuwActiveChips');
    D.chipList        = id('xuwChipList');
    D.filterBadge     = id('xuwFilterBadge');
    D.heroSearch      = id('xuwHeroSearch');
    D.heroSearchClear = id('xuwHeroSearchClear');
    D.searchDropdown  = id('xuwSearchDropdown');
    D.sortSelect      = id('xuwSortSelect');
    D.sidebarTiers    = id('xuwSidebarTiers');

    _initEventDelegation();
    _initModalClose();
    _initSidebarSearch();
    _initPredictiveSearch();
    _initFilterCheckboxes();
    _initPriceRange();
    _initSlider();
    _fetchCartTotal();
    _buildFilterBar();
    _refreshCartWsDisplay();

    if (D.sortSelect) {
      D.sortSelect.addEventListener('change', function () {
        var url = new URL(window.location.href);
        url.searchParams.set('sort_by', D.sortSelect.value);
        window.location.href = url.toString();
      });
    }

    document.addEventListener('xuw:cart-updated', _refreshCartWsDisplay);
  });

  /* ═══════════════════════════════════════════════
     EVENT DELEGATION
  ═══════════════════════════════════════════════ */
  function _initEventDelegation() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.getAttribute('data-action');

      switch (action) {
        case 'atc':
          e.preventDefault(); e.stopPropagation();
          _handleAtc(btn);
          break;

        case 'set-mode':
          e.preventDefault(); e.stopPropagation();
          _setCardMode(btn);
          break;

        case 'filter-toggle':
          _filterToggle(btn);
          break;

        case 'filter-clear':
          _filterClear();
          break;

        case 'close-modal':
          if (btn === D.overlay && e.target !== D.overlay) break;
          _closeModal();
          break;

        case 'modal-atc':
          e.preventDefault();
          _handleModalAtc();
          break;

        case 'modal-mode':
          _modalSetMode(btn.getAttribute('data-mode'));
          break;

        case 'pick-variant': {
          var vid = parseInt(btn.getAttribute('data-variant-id'), 10);
          if (!vid || !state.product) break;
          var vv = null;
          for (var pi = 0; pi < state.product.variants.length; pi++) {
            if (state.product.variants[pi].id === vid) { vv = state.product.variants[pi]; break; }
          }
          if (!vv) break;
          state.retailVariantId = vv.id;
          if (D.variantPills) {
            D.variantPills.querySelectorAll('[data-action="pick-variant"]').forEach(function (p) {
              var on = parseInt(p.getAttribute('data-variant-id'), 10) === vid;
              p.classList.toggle('is-active', on);
              p.setAttribute('aria-pressed', on.toString());
            });
          }
          _updateModalPrice(vv);
          _updateWsTierDisplay();
          break;
        }

        case 'qty-dec':
          state.qty = Math.max(1, state.qty - 1);
          if (D.qtyVal) D.qtyVal.textContent = state.qty;
          _updateWsTierDisplay();
          break;

        case 'qty-inc':
          state.qty = Math.min(state.qty + 1, 999);
          if (D.qtyVal) D.qtyVal.textContent = state.qty;
          _updateWsTierDisplay();
          break;

        case 'close-toast': {
          var toast = btn.closest('.xuw-toast');
          if (toast) _dismissToast(toast);
          break;
        }

        case 'hero-prev':
        case 'slider-prev':
          _sliderGo(state.sliderIndex - 1);
          break;
        case 'hero-next':
        case 'slider-next':
          _sliderGo(state.sliderIndex + 1);
          break;
        case 'hero-dot':
        case 'slider-goto':
          _sliderGo(parseInt(btn.getAttribute('data-slide') || btn.getAttribute('data-idx'), 10));
          break;

        case 'toggle-group':
          _toggleGroup(btn);
          break;
        case 'needle-pill':
          _toggleNeedle(btn);
          break;
        case 'toggle-sidebar':
        case 'sidebar-toggle': {
          var sb = id('xuwSidebar');
          var sbBtn = id('xuwFilterMobileBtn');
          if (sb) {
            var open = sb.classList.toggle('is-open');
            if (sbBtn) sbBtn.setAttribute('aria-expanded', open.toString());
          }
          break;
        }
        case 'clear-all':
          _clearAllFilters();
          break;
        case 'clear-search':
          _clearSearch();
          break;
        case 'set-ws-mode':
          _sidebarSetMode(btn.getAttribute('data-mode'));
          break;
      }
    });
  }

  /* ═══════════════════════════════════════════════
     2-CLICK RULE + €2,000 WHOLESALE CAP (V6 Block 5)
  ═══════════════════════════════════════════════ */
  function _handleAtc(btn) {
    var card = btn.closest('.xuw-card');
    if (!card) return;

    var isSingle = card.dataset.singleVariant === 'true';
    var mode     = card.dataset.currentMode || 'retail';
    var retId    = card.dataset.variantId;
    var wsId     = card.dataset.wsVariantId;
    var wsPrice  = parseInt(card.dataset.wsPrice, 10) || 0;
    var handle   = card.dataset.handle;

    if (isSingle && mode === 'retail') {
      _atcSetState(btn, 'loading');
      _cartAdd(retId, 1, btn, card, 'retail');
      return;
    }

    if (isSingle && mode === 'wholesale') {
      if (!wsId) { _openModal(handle, null, card, 'wholesale'); return; }
      _checkWsCap(wsPrice, 1, function (allowed) {
        if (allowed) {
          _atcSetState(btn, 'loading');
          _cartAdd(wsId, 1, btn, card, 'wholesale');
        } else {
          _showWsCapError(card, handle, 1);
        }
      });
      return;
    }

    _openModal(handle, null, card, mode);
  }

  function _checkWsCap(wsPriceCents, qty, callback) {
    fetch('/cart.js')
      .then(function (r) { return r.json(); })
      .then(function (cart) {
        var wsTotal   = _getCartWsTotal(cart);
        var projected = wsTotal + (wsPriceCents * qty);
        callback(projected <= state.WS_CAP_CENTS);
      })
      .catch(function () { callback(true); });
  }

  function _getCartWsTotal(cart) {
    var total = 0;
    var items = (cart && cart.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].sku && items[i].sku.indexOf('WS-') === 0) {
        total += items[i].line_price;
      }
    }
    return total;
  }

  function _showWsCapError(card, handle, qty) {
    _toast('error',
      'Wholesale orders over \u20AC2,000 require a quote. ' +
      'Please contact us to place this order.');
    _injectContactBtn(card, handle, qty, 'wholesale-cap');
  }

  /* ═══════════════════════════════════════════════
     CARD MODE SELECTOR (V6 — no fetch, WS price in data attr)
  ═══════════════════════════════════════════════ */
  function _setCardMode(btn) {
    var cardEl = btn.closest('.xuw-card');
    if (!cardEl) return;
    var mode = btn.getAttribute('data-mode') || 'retail';

    cardEl.dataset.currentMode = mode;

    var modeRow = cardEl.querySelector('.xuw-price-mode-row');
    if (modeRow) {
      modeRow.querySelectorAll('.xuw-mode-btn').forEach(function (b) {
        var on = b.getAttribute('data-mode') === mode;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', on.toString());
      });
    }

    var retailRow = cardEl.querySelector('.xuw-price__row--retail');
    if (retailRow) retailRow.classList.toggle('is-active', mode === 'retail');

    var atcBtn = cardEl.querySelector('[data-action="atc"]');
    if (atcBtn && !atcBtn.disabled) {
      atcBtn.textContent = mode === 'wholesale' ? '+ Add (Wholesale)' : '+ Add to Cart';
    }
  }

  /* ═══════════════════════════════════════════════
     4-STATE ATC BUTTON
  ═══════════════════════════════════════════════ */
  function _atcSetState(btn, btnState) {
    if (!btn) return;
    btn.setAttribute('data-atc-state', btnState);
    switch (btnState) {
      case 'loading':
        btn.disabled = true;
        btn.innerHTML = '<span class="xuw-spin" aria-hidden="true"></span> Adding\u2026';
        break;
      case 'success':
        btn.disabled = false;
        btn.innerHTML = '\u2713 Added!';
        setTimeout(function () { _atcSetState(btn, 'default'); }, 2000);
        break;
      case 'error':
        btn.disabled = false;
        btn.innerHTML = 'Try Again';
        setTimeout(function () { _atcSetState(btn, 'default'); }, 3000);
        break;
      default:
        btn.disabled = false;
        var card = btn.closest('.xuw-card');
        var mode = card ? (card.dataset.currentMode || 'retail') : 'retail';
        btn.innerHTML = mode === 'wholesale' ? '+ Add (Wholesale)' : '+ Add to Cart';
        break;
    }
  }

  /* ═══════════════════════════════════════════════
     HOMEPAGE INLINE FILTER BAR (V6 Block 8)
     Auto-generates from .xuw-card data attributes.
     No hardcoded labels.
  ═══════════════════════════════════════════════ */
  function _buildFilterBar() {
    var bar = id('xuw-filter-groups');
    if (!bar) return;

    var cards = document.querySelectorAll('.xuw-card');
    if (!cards.length) return;

    var needleTypes  = {};
    var pinCounts    = {};
    var vendors      = {};
    var hasNeedles   = false;
    var vendorCount  = 0;
    var hasWholesale = false;

    var needleTypeMap = {
      'round-liner'      : 'Round Liner',
      'round-shader'     : 'Round Shader',
      'magnum'           : 'Magnum',
      'soft-edge-magnum' : 'Soft Edge',
      'soft-edge'        : 'Soft Edge',
      'diamond'          : 'Diamond',
      'slope-magnum'     : 'Slope Magnum',
      'specialty'        : 'Specialty'
    };
    var pinOrder = ['1-pin','3-pin','5-pin','7-pin','9-pin','11-pin','13-pin','14-pin','15-pin'];

    for (var ci = 0; ci < cards.length; ci++) {
      var c      = cards[ci];
      var tags   = (c.getAttribute('data-tags') || '').toLowerCase().split(',').map(function(t){return t.trim();});
      var vendor = (c.getAttribute('data-vendor') || '').trim();

      if (c.getAttribute('data-wholesale') === 'true') hasWholesale = true;

      for (var k in needleTypeMap) {
        if (needleTypeMap.hasOwnProperty(k) && tags.indexOf(k) !== -1) {
          needleTypes[k] = needleTypeMap[k];
          hasNeedles = true;
        }
      }
      for (var pi2 = 0; pi2 < pinOrder.length; pi2++) {
        if (tags.indexOf(pinOrder[pi2]) !== -1) {
          pinCounts[pinOrder[pi2]] = pinOrder[pi2].replace('-pin', '-Pin');
        }
      }
      if (vendor && !vendors[vendor]) {
        vendors[vendor] = vendor.charAt(0).toUpperCase() + vendor.slice(1);
        vendorCount++;
      }
    }

    bar.innerHTML = '';

    if (hasNeedles && Object.keys(needleTypes).length) {
      for (var ntKey in needleTypes) {
        if (needleTypes.hasOwnProperty(ntKey)) bar.appendChild(_makePill('tags', ntKey, needleTypes[ntKey]));
      }
      bar.appendChild(_makeSeparator());
    }

    if (hasNeedles && Object.keys(pinCounts).length) {
      for (var pcKey in pinCounts) {
        if (pinCounts.hasOwnProperty(pcKey)) bar.appendChild(_makePill('tags', pcKey, pinCounts[pcKey]));
      }
      bar.appendChild(_makeSeparator());
    }

    if (vendorCount > 1) {
      for (var vKey in vendors) {
        if (vendors.hasOwnProperty(vKey)) bar.appendChild(_makePill('vendor', vKey, vendors[vKey]));
      }
      bar.appendChild(_makeSeparator());
    }

    bar.appendChild(_makePill('available', 'true', 'In Stock'));

    if (hasWholesale) {
      bar.appendChild(_makeSeparator());
      var rp = _makePill('_mode', 'retail', 'Retail');
      rp.classList.add('xuw-filter-pill--mode', 'is-active');
      bar.appendChild(rp);
      var wp = _makePill('_mode', 'wholesale', 'Wholesale');
      wp.classList.add('xuw-filter-pill--mode');
      bar.appendChild(wp);
    }

    _updateVisibleCount();
  }

  function _makePill(key, val, label) {
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'xuw-filter-pill';
    btn.setAttribute('data-action', 'filter-toggle');
    btn.setAttribute('data-filter-key', key);
    btn.setAttribute('data-filter-val', val);
    btn.textContent = label;
    return btn;
  }

  function _makeSeparator() {
    var s = document.createElement('span');
    s.className = 'xuw-filter-separator'; s.setAttribute('aria-hidden','true');
    return s;
  }

  function _filterToggle(btn) {
    var key = btn.getAttribute('data-filter-key');
    var val = btn.getAttribute('data-filter-val');

    if (key === '_mode') {
      var bar = id('xuw-filter-groups');
      if (bar) {
        bar.querySelectorAll('[data-filter-key="_mode"]').forEach(function (p) {
          p.classList.toggle('is-active', p.getAttribute('data-filter-val') === val);
        });
      }
      state.globalMode = val;
      document.querySelectorAll('.xuw-card').forEach(function (card) {
        var modeBtn = card.querySelector('[data-action="set-mode"][data-mode="' + val + '"]');
        if (modeBtn) _setCardMode(modeBtn);
      });
      return;
    }

    var isActive = btn.classList.toggle('is-active');
    if (!state.activeFilters[key]) state.activeFilters[key] = [];
    if (isActive) {
      if (state.activeFilters[key].indexOf(val) === -1) state.activeFilters[key].push(val);
    } else {
      state.activeFilters[key] = state.activeFilters[key].filter(function(v){return v!==val;});
      if (!state.activeFilters[key].length) delete state.activeFilters[key];
    }
    _applyFilters();
    _updateClearBtn();
  }

  function _filterClear() {
    state.activeFilters = {};
    var bar = id('xuw-filter-groups');
    if (bar) {
      bar.querySelectorAll('.xuw-filter-pill:not(.xuw-filter-pill--mode)').forEach(function(p){p.classList.remove('is-active');});
    }
    _applyFilters();
    _updateClearBtn();
  }

  function _applyFilters() {
    var cards = document.querySelectorAll('.xuw-card');
    var visible = 0;
    cards.forEach(function (card) {
      var show = _cardMatchesFilter(card);
      card.classList.toggle('xuw-is-hidden', !show);
      if (show) visible++;
    });
    var countEl = id('xuw-visible-count');
    if (countEl) countEl.textContent = visible;
  }

  function _cardMatchesFilter(card) {
    var keys = Object.keys(state.activeFilters);
    if (!keys.length) return true;
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i]; var vals = state.activeFilters[key];
      if (!vals || !vals.length) continue;
      var matched = false;
      for (var j = 0; j < vals.length; j++) {
        var v = vals[j].toLowerCase().trim();
        if (key === 'tags') {
          var tags = (card.getAttribute('data-tags')||'').toLowerCase().split(',').map(function(t){return t.trim();});
          if (tags.indexOf(v) !== -1) { matched = true; break; }
        } else if (key === 'vendor') {
          if ((card.getAttribute('data-vendor')||'').toLowerCase().trim() === v) { matched = true; break; }
        } else if (key === 'available') {
          if (card.getAttribute('data-available') === v) { matched = true; break; }
        }
      }
      if (!matched) return false;
    }
    return true;
  }

  function _updateVisibleCount() {
    var visible = document.querySelectorAll('.xuw-card:not(.xuw-is-hidden)').length;
    var el = id('xuw-visible-count'); if (el) el.textContent = visible;
  }

  function _updateClearBtn() {
    var clearBtn = document.querySelector('[data-action="filter-clear"]');
    if (!clearBtn) return;
    clearBtn.classList.toggle('xuw-is-hidden', !Object.keys(state.activeFilters).length);
  }

  /* ═══════════════════════════════════════════════
     HERO SLIDER
  ═══════════════════════════════════════════════ */
  function _initSlider() {
    var slider = id('xuwHeroSlider');
    if (!slider) return;
    _sliderGo(0); _sliderResetTimer();
    slider.addEventListener('mouseenter', function(){clearInterval(state.sliderTimer);});
    slider.addEventListener('mouseleave', _sliderResetTimer);
  }

  function _sliderGo(index) {
    var slides = document.querySelectorAll('.xuw-slide');
    var dots   = document.querySelectorAll('.xuw-slider__dot');
    if (!slides.length) return;
    var n = ((index % slides.length) + slides.length) % slides.length;
    slides.forEach(function(s,i){s.classList.toggle('xuw-slide--active',i===n);});
    dots.forEach(function(d,i){d.classList.toggle('xuw-slider__dot--active',i===n);d.setAttribute('aria-selected',(i===n).toString());});
    state.sliderIndex = n;
  }

  function _sliderResetTimer() {
    clearInterval(state.sliderTimer);
    state.sliderTimer = setInterval(function(){_sliderGo(state.sliderIndex+1);}, 6000);
  }

  /* ═══════════════════════════════════════════════
     PREDICTIVE SEARCH
  ═══════════════════════════════════════════════ */
  function _initPredictiveSearch() {
    if (!D.heroSearch) return;
    D.heroSearch.addEventListener('input', function () {
      var q = D.heroSearch.value.trim();
      if (D.heroSearchClear) D.heroSearchClear.style.display = q ? '' : 'none';
      clearTimeout(state.predictiveTimer);
      if (q.length < 2) { _closeDropdown(); return; }
      state.predictiveTimer = setTimeout(function(){_fetchSuggestions(q);}, 250);
    });
    D.heroSearch.addEventListener('keydown', function (e) {
      var items = D.searchDropdown ? D.searchDropdown.querySelectorAll('.xuw-search-result') : [];
      if (e.key==='ArrowDown')  { e.preventDefault(); state.dropdownIndex=Math.min(state.dropdownIndex+1,items.length-1); if(items[state.dropdownIndex]) items[state.dropdownIndex].focus(); }
      else if (e.key==='ArrowUp')   { e.preventDefault(); state.dropdownIndex=Math.max(state.dropdownIndex-1,-1); if(state.dropdownIndex===-1) D.heroSearch.focus(); else if(items[state.dropdownIndex]) items[state.dropdownIndex].focus(); }
      else if (e.key==='Escape')    { _closeDropdown(); D.heroSearch.blur(); }
      else if (e.key==='Enter')     { e.preventDefault(); var q2=D.heroSearch.value.trim(); if(q2) window.location.href='/search?type=product&q='+encodeURIComponent(q2); }
    });
    document.addEventListener('click', function(e){
      if(D.heroSearch&&!D.heroSearch.contains(e.target)&&D.searchDropdown&&!D.searchDropdown.contains(e.target)) _closeDropdown();
    });
  }

  function _fetchSuggestions(q) {
    fetch('/search/suggest.json?q='+encodeURIComponent(q)+'&resources[type]=product,collection&resources[limit]=8&resources[options][unavailable_products]=last')
      .then(function(r){return r.json();})
      .then(function(data){
        var res = data.resources&&data.resources.results?data.resources.results:{};
        _renderDropdown(res.products||[],res.collections||[],q);
      }).catch(function(){_closeDropdown();});
  }

  function _renderDropdown(products, collections, q) {
    if (!D.searchDropdown) return;
    state.dropdownIndex = -1; D.searchDropdown.innerHTML = '';
    if (!products.length&&!collections.length) {
      var empty=document.createElement('div');empty.className='xuw-search-empty';empty.textContent='No results for "'+q+'"';
      D.searchDropdown.appendChild(empty);_openDropdown();return;
    }
    if (collections.length) {
      var cl=document.createElement('div');cl.className='xuw-search-section-label';cl.textContent='Categories';D.searchDropdown.appendChild(cl);
      collections.slice(0,3).forEach(function(col){
        var a=document.createElement('a');a.className='xuw-search-result xuw-search-result--col';a.href=col.url;a.tabIndex=0;
        a.innerHTML='<div class="xuw-search-result__icon">&#128193;</div><div class="xuw-search-result__info"><p class="xuw-search-result__title">'+_highlight(col.title||'',q)+'</p><p class="xuw-search-result__meta">Collection</p></div>';
        D.searchDropdown.appendChild(a);
      });
    }
    if (products.length) {
      var pl=document.createElement('div');pl.className='xuw-search-section-label';pl.textContent='Products';D.searchDropdown.appendChild(pl);
      products.forEach(function(product){
        var imgSrc=product.featured_image&&product.featured_image.url?product.featured_image.url:'';
        var price=product.price?_formatMoney(Math.round(parseFloat(product.price)*100)):'';
        var a=document.createElement('a');a.className='xuw-search-result';a.href=product.url;a.tabIndex=0;
        var img=imgSrc?'<img src="'+_esc(imgSrc)+'" alt="" loading="lazy">':'<span>'+_esc((product.title||'').slice(0,2).toUpperCase())+'</span>';
        a.innerHTML='<div class="xuw-search-result__img">'+img+'</div><div class="xuw-search-result__info"><p class="xuw-search-result__title">'+_highlight(product.title||'',q)+'</p><p class="xuw-search-result__meta">'+_esc(product.vendor||'')+(price?' \xb7 '+price:'')+'</p></div>';
        D.searchDropdown.appendChild(a);
      });
    }
    var va=document.createElement('a');va.className='xuw-search-view-all';va.href='/search?type=product&q='+encodeURIComponent(q);va.textContent='View all results for "'+q+'" \u2192';
    D.searchDropdown.appendChild(va);_openDropdown();
  }
  function _openDropdown()  {if(D.searchDropdown&&D.heroSearch){D.searchDropdown.style.display='';D.heroSearch.setAttribute('aria-expanded','true');}}
  function _closeDropdown() {if(D.searchDropdown&&D.heroSearch){D.searchDropdown.style.display='none';D.heroSearch.setAttribute('aria-expanded','false');state.dropdownIndex=-1;}}

  function _clearSearch() {
    if(D.heroSearch){D.heroSearch.value='';D.heroSearch.focus();}
    if(D.search) D.search.value='';
    if(D.heroSearchClear) D.heroSearchClear.style.display='none';
    if(D.searchClear) D.searchClear.style.display='none';
    state.searchQuery=''; _closeDropdown(); _runFilters();
  }

  /* ═══════════════════════════════════════════════
     MODAL
  ═══════════════════════════════════════════════ */
  function _openModal(handle, event, cardEl, forceMode) {
    if (event) { event.preventDefault(); event.stopPropagation(); }
    var card = cardEl || (event && event.target ? event.target.closest('.xuw-card') : null);
    state.modalMode       = forceMode || (card && card.dataset.currentMode) || state.globalMode || 'retail';
    state.product         = null;
    state.retailVariantId = null;
    state.wsVariantId     = null;
    state.wsVariantPrice  = null;
    state.qty             = 1;

    _clearModalUI();
    _setModalModeBtns(state.modalMode);

    if (D.overlay)      { D.overlay.classList.remove('xuw-is-hidden'); D.overlay.setAttribute('aria-hidden','false'); }
    if (D.spinner)      D.spinner.style.display = 'flex';
    if (D.modalContent) D.modalContent.classList.add('xuw-is-hidden');
    if (D.qtyVal)       D.qtyVal.textContent = '1';

    fetch('/products/' + encodeURIComponent(handle) + '.js')
      .then(function(r){if(!r.ok) throw new Error('HTTP '+r.status);return r.json();})
      .then(function(p){
        state.product = p;
        _renderModal(p);
        if(D.spinner) D.spinner.style.display='none';
        if(D.modalContent) D.modalContent.classList.remove('xuw-is-hidden');
      })
      .catch(function(){_toast('error','Could not load product. Please try again.');_closeModal();});
  }

  window.xuwOpenModal = function(h,e,c,m){_openModal(h,e,c,m);};

  function _clearModalUI() {
    if(D.modalVendor) D.modalVendor.textContent='';
    if(D.modalTitle)  D.modalTitle.textContent='';
    if(D.modalPrice)  D.modalPrice.innerHTML='';
    if(D.variantPills) D.variantPills.innerHTML='';
    if(D.qtyVal) D.qtyVal.textContent='1';
    if(D.modeRow) D.modeRow.classList.add('xuw-is-hidden');
    if(D.wsTiers) D.wsTiers.classList.add('xuw-is-hidden');
    var prev=id('xuw-contact-btn'); if(prev) prev.parentNode.removeChild(prev);
  }

  function _renderModal(product) {
    if(D.modalVendor) D.modalVendor.textContent=product.vendor||'';
    if(D.modalTitle)  D.modalTitle.textContent=product.title||'';
    state.wsVariantId=null; state.wsVariantPrice=null;
    for(var i=0;i<product.variants.length;i++){
      if(product.variants[i].title.toLowerCase()==='wholesale'){
        state.wsVariantId=product.variants[i].id;
        state.wsVariantPrice=product.variants[i].price;break;
      }
    }
    if(D.modeRow){
      if(state.wsVariantId) D.modeRow.classList.remove('xuw-is-hidden');
      else                  D.modeRow.classList.add('xuw-is-hidden');
    }
    _renderVariants(product);
    if(state.modalMode==='wholesale'&&state.wsVariantId&&D.wsTiers) D.wsTiers.classList.remove('xuw-is-hidden');
    _updateWsTierDisplay();
  }

  function _renderVariants(product) {
    if(!D.variantPills) return;
    D.variantPills.innerHTML='';
    var selectable=product.variants.filter(function(v){return v.title.toLowerCase()!=='wholesale';});
    if(!selectable.length) selectable=product.variants;
    if(selectable.length===1&&selectable[0].title==='Default Title'){
      state.retailVariantId=selectable[0].id; _updateModalPrice(selectable[0]); return;
    }
    var firstAvail=selectable[0];
    for(var fa=0;fa<selectable.length;fa++){if(selectable[fa].available){firstAvail=selectable[fa];break;}}
    state.retailVariantId=firstAvail.id; _updateModalPrice(firstAvail);
    selectable.forEach(function(variant){
      var pill=document.createElement('button');pill.type='button';
      var isA=variant.id===state.retailVariantId;
      pill.className='xuw-variant-pill'+(isA?' is-active':'')+((!variant.available)?' is-unavailable':'');
      pill.textContent=variant.title;
      pill.setAttribute('data-action','pick-variant');
      pill.setAttribute('data-variant-id',variant.id);
      pill.setAttribute('aria-pressed',isA.toString());
      if(!variant.available) pill.disabled=true;
      D.variantPills.appendChild(pill);
    });
  }

  function _handleModalAtc() {
    if(!state.retailVariantId){_toast('info','Please select a variant first.');return;}
    var btn=D.addToCart;
    if(state.modalMode==='wholesale'&&state.wsVariantId){
      _checkWsCap(state.wsVariantPrice||0, state.qty, function(allowed){
        if(allowed){_cartAdd(state.wsVariantId,state.qty,btn,null,'wholesale');_closeModal();}
        else{_toast('error','Wholesale orders over \u20AC2,000 require a quote.');}
      });
    } else {
      _cartAdd(state.retailVariantId,state.qty,btn,null,'retail');
      _closeModal();
    }
  }

  function _modalSetMode(mode) {
    state.modalMode=mode;
    _setModalModeBtns(mode);
    if(D.wsTiers){
      if(mode==='wholesale'&&state.wsVariantId) D.wsTiers.classList.remove('xuw-is-hidden');
      else D.wsTiers.classList.add('xuw-is-hidden');
    }
    if(state.retailVariantId&&state.product){
      var v=null; for(var mi=0;mi<state.product.variants.length;mi++){if(state.product.variants[mi].id===state.retailVariantId){v=state.product.variants[mi];break;}}
      if(v) _updateModalPrice(v);
    }
    _updateWsTierDisplay();
  }

  function _setModalModeBtns(mode) {
    if(!D.modeRow) return;
    D.modeRow.querySelectorAll('[data-action="modal-mode"]').forEach(function(btn){
      var on=btn.getAttribute('data-mode')===mode;
      btn.classList.toggle('is-active',on);btn.setAttribute('aria-pressed',on.toString());
    });
  }

  function _updateModalPrice(variant) {
    if(!D.modalPrice) return;
    D.modalPrice.innerHTML='';
    if(state.modalMode==='wholesale'&&state.wsVariantPrice){
      var c=document.createElement('span');c.className='xuw-price--compare';c.textContent=_formatMoney(variant.price);
      var w=document.createElement('span');w.className='xuw-price--ws-main';w.textContent=_formatMoney(state.wsVariantPrice);
      D.modalPrice.appendChild(c);D.modalPrice.appendChild(w);
    } else {
      if(variant.compare_at_price&&variant.compare_at_price>variant.price){
        var cc=document.createElement('span');cc.className='xuw-price--compare';cc.textContent=_formatMoney(variant.compare_at_price);
        D.modalPrice.appendChild(cc);
      }
      D.modalPrice.appendChild(document.createTextNode(_formatMoney(variant.price)));
    }
  }

  function _updateWsTierDisplay() {
    if(state.modalMode!=='wholesale'||!state.wsVariantPrice) return;
    var orderEur=(state.wsVariantPrice*state.qty)/100;
    var totalEur=(state.wsCartTotal/100)+orderEur;

    var activeTier=null; var nextTier=null;
    for(var i=0;i<state.WS_TIERS.length;i++){
      if(totalEur>=state.WS_TIERS[i].min&&!activeTier) activeTier=state.WS_TIERS[i];
      if(totalEur<state.WS_TIERS[i].min) nextTier=state.WS_TIERS[i];
    }

    if(D.wsTiers){
      var rows=D.wsTiers.querySelectorAll('tr[data-tier-min]');
      rows.forEach(function(row){
        var min=parseInt(row.getAttribute('data-tier-min'),10);
        var sc=row.querySelector('.xuw-tier__status');
        var isA=totalEur>=min;
        var isN=!isA&&nextTier&&min===nextTier.min;
        row.classList.toggle('xuw-tier--active',isA);row.classList.toggle('xuw-tier--next',isN);
        if(sc) sc.textContent=isA?'\u2714 Active':(isN?'\u2192 Next':'');
      });
    }
    if(D.wsNote){
      if(totalEur>=2000){
        D.wsNote.textContent='Cap reached (\u20AC2,000). Contact us for larger orders.';
        D.wsNote.style.color='var(--xuw-crimson-lt)';
      } else if(activeTier){
        var msg=activeTier.pct+'% discount active at checkout.';
        if(nextTier) msg+=' Add \u20AC'+(nextTier.min-totalEur).toFixed(0)+' more for '+nextTier.pct+'%.';
        D.wsNote.textContent=msg; D.wsNote.style.color='var(--xuw-green)';
      } else {
        D.wsNote.textContent='Add \u20AC'+(300-totalEur).toFixed(0)+' more for 3% off.';
        D.wsNote.style.color='var(--xuw-muted)';
      }
    }
  }

  /* ═══════════════════════════════════════════════
     CART WS TIER DISPLAY (V6 Block 6)
  ═══════════════════════════════════════════════ */
  function _refreshCartWsDisplay() {
    fetch('/cart.js')
      .then(function(r){return r.json();})
      .then(function(cart){
        var n=cart.item_count;
        document.querySelectorAll('[data-cart-count]').forEach(function(el){
          el.textContent=n||''; el.classList.toggle('has-items',n>0); if(n>0) el.removeAttribute('hidden');
        });
        state.cartTotal=cart.total_price||0;
        state.wsCartTotal=_getCartWsTotal(cart);
        var wsEur=state.wsCartTotal/100;

        var tierEl=id('xuw-cart-ws-tier');
        if(!tierEl) return;
        if(wsEur===0){tierEl.style.display='none';return;}
        tierEl.style.display='block';

        var activeTier=null; var nextTier=null;
        for(var j=0;j<state.WS_TIERS.length;j++){
          if(wsEur>=state.WS_TIERS[j].min&&!activeTier) activeTier=state.WS_TIERS[j];
          if(wsEur<state.WS_TIERS[j].min) nextTier=state.WS_TIERS[j];
        }

        var msg='';
        if(wsEur>=2000){
          msg='\u26a0 Wholesale cap reached (\u20AC2,000). <a href="/pages/contact?ref=wholesale-cap">Contact us</a> to order more.';
        } else if(activeTier){
          msg='\u2713 '+activeTier.pct+'% wholesale discount active at checkout.';
          if(nextTier) msg+=' Add \u20AC'+(nextTier.min-wsEur).toFixed(0)+' more for '+nextTier.pct+'%.';
        } else {
          msg='Add \u20AC'+(300-wsEur).toFixed(0)+' more in wholesale items for 3% off at checkout.';
        }
        tierEl.innerHTML=msg;
      }).catch(function(){});
  }

  /* ═══════════════════════════════════════════════
     CART
  ═══════════════════════════════════════════════ */
  function _fetchCartTotal() {
    fetch('/cart.js')
      .then(function(r){return r.json();})
      .then(function(cart){
        state.cartTotal=cart.total_price||0;
        state.wsCartTotal=_getCartWsTotal(cart);
      }).catch(function(){});
  }

  function _cartAdd(variantId, qty, btn, card, mode) {
    if(!variantId){_toast('error','Please select a product option');return;}
    _atcSetState(btn,'loading');
    fetch('/cart/add.js',{
      method:'POST',
      headers:{'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest'},
      body:JSON.stringify({id:parseInt(variantId,10),quantity:qty})
    })
      .then(function(r){
        if(r.status===422) return r.json().then(function(e){throw{status:422,msg:e.description||e.message||'Not enough stock.'};});
        if(!r.ok) throw{status:r.status,msg:'Could not add to cart.'};
        return r.json();
      })
      .then(function(item){
        _atcSetState(btn,'success');
        var label=mode==='wholesale'?'Wholesale \u2014 ':'';
        _toast('success','Added \u2014 '+label+(item.title||''));
        _refreshCartCount();
        _refreshCartWsDisplay();
        document.dispatchEvent(new CustomEvent('xuw:cart-updated',{bubbles:true}));
        document.dispatchEvent(new CustomEvent('cart:refresh',{bubbles:true}));
        document.dispatchEvent(new CustomEvent('theme:cart:refresh',{bubbles:true}));
      })
      .catch(function(err){
        var msg=(err&&err.msg)?err.msg:'Something went wrong.';
        _atcSetState(btn,'error');
        _toast('error',msg);
        if(err&&err.status===422&&card) _injectContactBtn(card,card.dataset.handle,qty,'stock');
      });
  }

  function _injectContactBtn(card, handle, qty, ref) {
    if(card&&card.querySelector('#xuw-contact-btn')) return;
    var params='ref='+(ref||'stock')+'&product='+encodeURIComponent(handle||'')+'&qty='+encodeURIComponent(qty||1);
    var a=document.createElement('a');
    a.id='xuw-contact-btn';a.className='xuw-btn--contact';
    a.href='/pages/contact?'+params;a.textContent='Contact Us to Order';
    a.setAttribute('target','_blank');a.setAttribute('rel','noopener');
    var parent=card?(card.querySelector('.xuw-card__body')||card):(D.addToCart&&D.addToCart.parentNode);
    if(parent) parent.appendChild(a);
  }

  function _refreshCartCount() {
    fetch('/cart.js').then(function(r){return r.json();}).then(function(cart){
      var n=cart.item_count;
      ['[data-cart-count]','[data-header-cart-count]','.cart-count','.header__cart-count','.cart-item-count','#CartCount','.js-cart-count'].forEach(function(sel){
        document.querySelectorAll(sel).forEach(function(el){el.textContent=n||'';if(n>0) el.removeAttribute('hidden');});
      });
    }).catch(function(){});
  }

  /* ═══════════════════════════════════════════════
     MODAL CLOSE
  ═══════════════════════════════════════════════ */
  function _initModalClose() {
    document.addEventListener('keydown', function(e){
      if(e.key==='Escape'&&D.overlay&&!D.overlay.classList.contains('xuw-is-hidden')) _closeModal();
    });
    var inner=id('xuw-modal-inner');
    if(inner) inner.addEventListener('click', function(e){e.stopPropagation();});
  }

  function _closeModal() {
    if(D.overlay)      {D.overlay.classList.add('xuw-is-hidden');D.overlay.setAttribute('aria-hidden','true');}
    if(D.modalContent) D.modalContent.classList.add('xuw-is-hidden');
    if(D.spinner)      D.spinner.style.display='none';
  }

  /* ═══════════════════════════════════════════════
     SIDEBAR WHOLESALE MODE
  ═══════════════════════════════════════════════ */
  function _sidebarSetMode(mode) {
    state.globalMode=mode;
    document.querySelectorAll('[data-action="set-ws-mode"]').forEach(function(b){b.classList.toggle('is-active',b.getAttribute('data-mode')===mode);});
    var note=id('xuwSidebarModeNote');
    if(note) note.textContent=mode==='wholesale'?'\u2713 Wholesale mode active':'Standard retail pricing';
    if(D.sidebarTiers) D.sidebarTiers.style.display=mode==='wholesale'?'':'none';
  }

  /* ═══════════════════════════════════════════════
     TOAST — multi-type, lazy root
  ═══════════════════════════════════════════════ */
  function _getToastRoot() {
    var r=id('xuw-toast-root');
    if(!r){
      r=document.createElement('div');r.id='xuw-toast-root';
      r.style.cssText='position:fixed;top:16px;right:16px;z-index:99999;display:flex;flex-direction:column;align-items:flex-end;gap:8px;pointer-events:none;';
      document.body.appendChild(r);
    }
    return r;
  }

  function _toast(type, msg) {
    var root=_getToastRoot();
    var t=document.createElement('div');
    t.className='xuw-toast xuw-toast--'+(type||'info');
    t.setAttribute('role','status'); t.style.pointerEvents='auto';
    var txt=document.createElement('span');txt.textContent=msg;
    var close=document.createElement('button');
    close.type='button';close.className='xuw-toast__close';
    close.setAttribute('data-action','close-toast');close.setAttribute('aria-label','Dismiss');close.innerHTML='&times;';
    t.appendChild(txt);t.appendChild(close);root.appendChild(t);
    var delay=type==='error'?5000:3200;
    setTimeout(function(){_dismissToast(t);}, delay);
  }

  function _dismissToast(t) {
    if(!t||!t.parentNode) return;
    t.classList.add('xuw-toast--out');
    setTimeout(function(){if(t.parentNode) t.parentNode.removeChild(t);},350);
  }

  /* ═══════════════════════════════════════════════
     FILTERS (collection page sidebar)
  ═══════════════════════════════════════════════ */
  function _toggleGroup(headBtn) {
    var body=headBtn.nextElementSibling;
    var isOpen=headBtn.getAttribute('aria-expanded')==='true';
    headBtn.setAttribute('aria-expanded',(!isOpen).toString());
    if(body) body.style.display=isOpen?'none':'';
    var chev=headBtn.querySelector('.xuw-chevron');
    if(chev) chev.style.transform=isOpen?'rotate(-90deg)':'rotate(0deg)';
  }

  function _toggleNeedle(pill) {
    var on=!pill.classList.contains('is-active');
    pill.classList.toggle('is-active',on);pill.setAttribute('aria-pressed',on.toString());
    _applyFilter(pill.getAttribute('data-filter-key'),pill.getAttribute('data-filter-val'),on);
  }

  function _initFilterCheckboxes() {
    document.querySelectorAll('.xuw-fc').forEach(function(cb){
      cb.addEventListener('change', function(){
        if(cb.classList.contains('xuw-fc--dynamic')){
          var url=cb.checked?cb.getAttribute('data-add'):cb.getAttribute('data-remove');
          if(url) window.location.href=url; return;
        }
        _applyFilter(cb.getAttribute('data-filter-key'),cb.getAttribute('data-filter-val'),cb.checked);
      });
    });
  }

  function _applyFilter(key, val, add) {
    if(!val) return;
    val=val.toLowerCase().trim();
    if(!state.activeFilters[key]) state.activeFilters[key]=[];
    if(add){if(state.activeFilters[key].indexOf(val)===-1) state.activeFilters[key].push(val);}
    else{state.activeFilters[key]=state.activeFilters[key].filter(function(v){return v!==val;});if(!state.activeFilters[key].length) delete state.activeFilters[key];}
    _runFilters();_renderChips();_updateFilterBadge();
  }

  function _runFilters() {
    var cards=document.querySelectorAll('.xuw-card');
    var visible=0;
    cards.forEach(function(card){
      var show=_cardMatches(card); card.style.display=show?'':'none'; if(show) visible++;
    });
    var el=id('xuwProductCount');if(el) el.textContent=visible;
  }

  function _cardMatches(card) {
    if(state.searchQuery){
      var name=(card.querySelector('.xuw-card__name')||{}).textContent||'';
      var vendor=(card.querySelector('.xuw-card__vendor')||{}).textContent||'';
      if(name.toLowerCase().indexOf(state.searchQuery)===-1&&vendor.toLowerCase().indexOf(state.searchQuery)===-1) return false;
    }
    var keys=Object.keys(state.activeFilters);
    for(var i=0;i<keys.length;i++){
      var key=keys[i];var vals=state.activeFilters[key];
      if(!vals||!vals.length) continue;
      var matched=false;
      for(var j=0;j<vals.length;j++){
        var v=vals[j];
        if(key==='tags'){var tags=(card.getAttribute('data-tags')||'').toLowerCase().split(',').map(function(t){return t.trim();});if(tags.indexOf(v)!==-1){matched=true;break;}}
        else if(key==='product-type'){if((card.getAttribute('data-product-type')||'').toLowerCase().trim()===v){matched=true;break;}}
        else if(key==='vendor'){if((card.getAttribute('data-vendor')||'').toLowerCase().trim()===v){matched=true;break;}}
        else if(key==='available'){if(v==='true'&&card.getAttribute('data-available')==='true'){matched=true;break;}}
      }
      if(!matched) return false;
    }
    return true;
  }

  function _renderChips() {
    var all=[];
    Object.keys(state.activeFilters).forEach(function(k){state.activeFilters[k].forEach(function(v){all.push({key:k,val:v});});});
    if(!all.length){if(D.activeChips) D.activeChips.style.display='none';return;}
    if(D.activeChips) D.activeChips.style.display='';
    if(!D.chipList) return;
    D.chipList.innerHTML='';
    all.forEach(function(f){
      var chip=document.createElement('button');chip.type='button';chip.className='xuw-active-chip';
      chip.textContent=f.val;var x=document.createElement('span');x.setAttribute('aria-hidden','true');x.textContent=' \u2715';chip.appendChild(x);
      chip.setAttribute('aria-label','Remove '+f.val);
      chip.addEventListener('click',function(){
        _applyFilter(f.key,f.val,false);
        document.querySelectorAll('.xuw-fc--static').forEach(function(cb){if(cb.getAttribute('data-filter-key')===f.key&&(cb.getAttribute('data-filter-val')||'').toLowerCase().trim()===f.val) cb.checked=false;});
        document.querySelectorAll('.xuw-needle-pill').forEach(function(p){if(p.getAttribute('data-filter-key')===f.key&&(p.getAttribute('data-filter-val')||'').toLowerCase().trim()===f.val){p.classList.remove('is-active');p.setAttribute('aria-pressed','false');}});
      });
      D.chipList.appendChild(chip);
    });
  }

  function _clearAllFilters() {
    state.activeFilters={};
    document.querySelectorAll('.xuw-fc--static').forEach(function(cb){cb.checked=false;});
    document.querySelectorAll('.xuw-needle-pill').forEach(function(p){p.classList.remove('is-active');p.setAttribute('aria-pressed','false');});
    _runFilters();_renderChips();_updateFilterBadge();
  }

  function _updateFilterBadge() {
    var n=0;Object.keys(state.activeFilters).forEach(function(k){n+=state.activeFilters[k].length;});
    if(D.filterBadge){D.filterBadge.textContent=n;D.filterBadge.style.display=n?'':'none';}
  }

  /* ═══════════════════════════════════════════════
     SIDEBAR SEARCH
  ═══════════════════════════════════════════════ */
  function _initSidebarSearch() {
    if(!D.search) return;
    D.search.addEventListener('input',function(){
      clearTimeout(state.searchTimer);
      var q=D.search.value.trim().toLowerCase();
      if(D.searchClear) D.searchClear.style.display=q?'':'none';
      state.searchTimer=setTimeout(function(){state.searchQuery=q;_runFilters();},200);
    });
  }

  /* ═══════════════════════════════════════════════
     PRICE RANGE SLIDER
  ═══════════════════════════════════════════════ */
  function _initPriceRange() {
    var minIn=id('xuwPriceMin');var maxIn=id('xuwPriceMax');
    var minLbl=id('xuwPriceMinLbl');var maxLbl=id('xuwPriceMaxLbl');
    var fill=id('xuwPriceFill');
    if(!minIn||!maxIn) return;
    function update(){
      var lo=Math.min(parseFloat(minIn.value),parseFloat(maxIn.value));
      var hi=Math.max(parseFloat(minIn.value),parseFloat(maxIn.value));
      if(minLbl) minLbl.textContent='\u20AC'+Math.round(lo);
      if(maxLbl) maxLbl.textContent='\u20AC'+Math.round(hi);
      var range=parseFloat(minIn.max)-parseFloat(minIn.min);
      if(fill&&range>0){fill.style.left=((lo-parseFloat(minIn.min))/range*100)+'%';fill.style.right=((parseFloat(minIn.max)-hi)/range*100)+'%';}
      minIn.style.zIndex=parseFloat(minIn.value)>=parseFloat(maxIn.value)?'5':'3';maxIn.style.zIndex='4';
    }
    var pt;
    function schedule(){clearTimeout(pt);pt=setTimeout(function(){var lo=Math.min(parseFloat(minIn.value),parseFloat(maxIn.value));var hi=Math.max(parseFloat(minIn.value),parseFloat(maxIn.value));var url=new URL(window.location.href);url.searchParams.set(minIn.getAttribute('data-param')||'filter.v.price.gte',lo);url.searchParams.set(maxIn.getAttribute('data-param')||'filter.v.price.lte',hi);window.location.href=url.toString();},900);}
    minIn.addEventListener('input',function(){update();schedule();});
    maxIn.addEventListener('input',function(){update();schedule();});
    update();
  }

  /* ═══════════════════════════════════════════════
     HELPERS
  ═══════════════════════════════════════════════ */
  function _highlight(text, q) {
    if(!q) return _esc(text);
    var re=new RegExp('('+q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','gi');
    return _esc(text).replace(re,'<mark>$1</mark>');
  }
  function _esc(s) { var d=document.createElement('div');d.textContent=s;return d.innerHTML; }
  function id(elId) { return document.getElementById(elId); }

})();
