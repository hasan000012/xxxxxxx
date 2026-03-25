/**
 * X Under World — Collection JS  |  assets/xuw-collection.js  |  v9.0
 *
 * V9 CHANGES:
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. FULL EVENT DELEGATION — no inline onclick anywhere.
 *    All interactions handled via document.addEventListener + data-action routing.
 *
 * 2. VALUE-BASED WHOLESALE — no fixed MOQ.
 *    Tiers applied to estimated cart value (qty × unit price):
 *      €300+  = 3%  off
 *      €500+  = 5%  off
 *      €1000+ = 10% off
 *      €2000+ = 20% off
 *    Live discount shown as qty changes in modal.
 *    Customer can buy any quantity — no floor enforced.
 *
 * 3. HERO SLIDER — auto-advance every 6s, keyboard nav, dots + arrows.
 *
 * 4. WHOLESALE MODE OPEN FIX (from v8.1):
 *    xuwOpenModal accepts cardEl + forceMode to avoid null-event race condition.
 *
 * 5. CART TOTAL FETCH — on wholesale mode, fetches /cart.js to show
 *    current cart value + applicable tier discount in real time.
 *
 * 6. SIDEBAR WHOLESALE TIER TABLE — toggled visible when wholesale mode active.
 */

(function () {
  'use strict';

  /* ═══════════════ CONFIG ═══════════════ */
  var CFG = {
    SEARCH_DELAY     : 250,
    SEARCH_MIN_CHARS : 2,
    SEARCH_LIMIT     : 8,
    WS_VARIANT_TITLE : 'wholesale',
    SLIDER_INTERVAL  : 6000,
    /* Value-based wholesale tiers (cart value in euros) */
    WS_TIERS : [
      { min: 2000, pct: 20 },
      { min: 1000, pct: 10 },
      { min: 500,  pct:  5 },
      { min: 300,  pct:  3 }
    ]
  };

  /* ═══════════════ STATE ═══════════════ */
  var state = {
    product         : null,
    retailVariantId : null,
    wsVariantId     : null,
    wsVariantPrice  : null,
    qty             : 1,
    modalMode       : 'retail',
    globalMode      : 'retail',
    activeFilters   : {},
    searchQuery     : '',
    searchTimer     : null,
    predictiveTimer : null,
    dropdownIndex   : -1,
    sliderIndex     : 0,
    sliderTimer     : null,
    cartTotal       : 0     // current cart total in euros (fetched)
  };

  var D = {};

  /* ═══════════════ INIT ═══════════════ */
  document.addEventListener('DOMContentLoaded', function () {
    D.overlay         = id('xuwModalOverlay');
    D.closeBtn        = id('xuwModalClose');
    D.spinner         = id('xuwModalLoading');
    D.qtyVal          = id('xuwQtyVal');
    D.qtyMinus        = id('xuwQtyMinus');
    D.qtyPlus         = id('xuwQtyPlus');
    D.toast           = id('xuwToast');
    D.search          = id('xuwSearch');
    D.searchClear     = id('xuwSearchClear');
    D.modalImg        = id('xuwModalImg');
    D.modalImgPh      = id('xuwModalImgPh');
    D.modalThumbs     = id('xuwModalThumbs');
    D.modeNote        = id('xuwModalModeNote');
    D.modeRetail      = id('xuwModeRetail');
    D.modeWholesale   = id('xuwModeWholesale');
    D.modalPrice      = id('xuwModalPrice');
    D.modalWsBadge    = id('xuwModalWsBadge');
    D.variantsWrap    = id('xuwModalVariantsWrap');
    D.variantPills    = id('xuwModalVariants');
    D.addToCart       = id('xuwAddToCart');
    D.buyNow          = id('xuwBuyNow');
    D.activeChips     = id('xuwActiveChips');
    D.chipList        = id('xuwChipList');
    D.filterBadge     = id('xuwFilterBadge');
    D.wsInfo          = id('xuwModalWsInfo');
    D.wsTiers         = id('xuwModalWsTiers');
    D.wsNote          = id('xuwModalWsNote');
    D.cartNote        = id('xuwModalCartNote');
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

    if (D.sortSelect) {
      D.sortSelect.addEventListener('change', function () {
        var url = new URL(window.location.href);
        url.searchParams.set('sort_by', D.sortSelect.value);
        window.location.href = url.toString();
      });
    }
  });

  /* ═══════════════════════════════════════════════
     EVENT DELEGATION — single listener for all actions
  ═══════════════════════════════════════════════ */
  function _initEventDelegation() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.getAttribute('data-action');

      switch (action) {
        case 'quick-buy':
          e.preventDefault(); e.stopPropagation();
          _openModal(btn.getAttribute('data-handle'), e, btn.closest('.xuw-card'), null);
          break;
        case 'direct-atc':
          e.preventDefault(); e.stopPropagation();
          _directAddToCart(btn);
          break;
        case 'card-mode':
          e.preventDefault(); e.stopPropagation();
          _cardSetMode(btn);
          break;
        case 'modal-mode':
          _modalSetMode(btn.getAttribute('data-mode'));
          break;
        case 'set-ws-mode':
          _sidebarSetMode(btn.getAttribute('data-mode'));
          break;
        case 'toggle-group':
          _toggleGroup(btn);
          break;
        case 'needle-pill':
          _toggleNeedle(btn);
          break;
        case 'toggle-sidebar':
          _toggleMobileSidebar();
          break;
        case 'clear-all':
          _clearAllFilters();
          break;
        case 'clear-search':
          _clearSearch();
          break;
        case 'slider-prev':
          _sliderGo(state.sliderIndex - 1);
          break;
        case 'slider-next':
          _sliderGo(state.sliderIndex + 1);
          break;
        case 'slider-goto':
          _sliderGo(parseInt(btn.getAttribute('data-slide'), 10));
          break;
      }
    });

    /* Qty buttons */
    document.addEventListener('click', function (e) {
      if (e.target.id === 'xuwQtyMinus') {
        state.qty = Math.max(1, state.qty - 1);
        if (D.qtyVal) D.qtyVal.textContent = state.qty;
        _updateWsTierDisplay();
      }
      if (e.target.id === 'xuwQtyPlus') {
        state.qty++;
        if (D.qtyVal) D.qtyVal.textContent = state.qty;
        _updateWsTierDisplay();
      }
      if (e.target.id === 'xuwAddToCart') {
        if (!state.retailVariantId) { _toast('Please select a variant'); return; }
        var wsProps = state.modalMode === 'wholesale' ? { '_xuw_mode': 'wholesale' } : {};
        _cartAdd(_resolveVid(), state.qty, false, wsProps); _closeModal();
      }
      if (e.target.id === 'xuwBuyNow') {
        if (!state.retailVariantId) { _toast('Please select a variant'); return; }
        var wsProps = state.modalMode === 'wholesale' ? { '_xuw_mode': 'wholesale' } : {};
        _cartAdd(_resolveVid(), state.qty, true, wsProps); _closeModal();
      }
    });
  }

  /* ═══════════════════════════════════════════════
     HERO SLIDER
  ═══════════════════════════════════════════════ */
  function _initSlider() {
    var slider = id('xuwHeroSlider');
    if (!slider) return;
    _sliderGo(0);
    _sliderResetTimer();

    /* Pause on hover */
    slider.addEventListener('mouseenter', function () { clearInterval(state.sliderTimer); });
    slider.addEventListener('mouseleave', _sliderResetTimer);
  }

  function _sliderGo(index) {
    var slides = document.querySelectorAll('.xuw-slide');
    var dots   = document.querySelectorAll('.xuw-slider__dot');
    if (!slides.length) return;
    var n = ((index % slides.length) + slides.length) % slides.length;
    slides.forEach(function (s, i) { s.classList.toggle('xuw-slide--active', i === n); });
    dots.forEach(function (d, i) {
      d.classList.toggle('xuw-slider__dot--active', i === n);
      d.setAttribute('aria-selected', (i === n).toString());
    });
    state.sliderIndex = n;
  }

  function _sliderResetTimer() {
    clearInterval(state.sliderTimer);
    state.sliderTimer = setInterval(function () {
      _sliderGo(state.sliderIndex + 1);
    }, CFG.SLIDER_INTERVAL);
  }

  /* ═══════════════════════════════════════════════
     SMART PREDICTIVE SEARCH
  ═══════════════════════════════════════════════ */
  function _initPredictiveSearch() {
    if (!D.heroSearch) return;
    D.heroSearch.addEventListener('input', function () {
      var q = D.heroSearch.value.trim();
      if (D.heroSearchClear) D.heroSearchClear.style.display = q ? '' : 'none';
      clearTimeout(state.predictiveTimer);
      if (q.length < CFG.SEARCH_MIN_CHARS) { _closeDropdown(); return; }
      state.predictiveTimer = setTimeout(function () { _fetchSuggestions(q); }, CFG.SEARCH_DELAY);
    });
    D.heroSearch.addEventListener('keydown', function (e) {
      var items = D.searchDropdown ? D.searchDropdown.querySelectorAll('.xuw-search-result') : [];
      if (e.key === 'ArrowDown')  { e.preventDefault(); state.dropdownIndex = Math.min(state.dropdownIndex + 1, items.length - 1); if (items[state.dropdownIndex]) items[state.dropdownIndex].focus(); }
      else if (e.key === 'ArrowUp')   { e.preventDefault(); state.dropdownIndex = Math.max(state.dropdownIndex - 1, -1); if (state.dropdownIndex === -1) D.heroSearch.focus(); else if (items[state.dropdownIndex]) items[state.dropdownIndex].focus(); }
      else if (e.key === 'Escape')    { _closeDropdown(); D.heroSearch.blur(); }
      else if (e.key === 'Enter')     { e.preventDefault(); var q2 = D.heroSearch.value.trim(); if (q2) window.location.href = '/search?type=product&q=' + encodeURIComponent(q2); }
    });
    document.addEventListener('click', function (e) {
      if (D.heroSearch && !D.heroSearch.contains(e.target) && D.searchDropdown && !D.searchDropdown.contains(e.target)) _closeDropdown();
    });
  }

  function _fetchSuggestions(q) {
    fetch('/search/suggest.json?q=' + encodeURIComponent(q) +
      '&resources[type]=product,collection&resources[limit]=' + CFG.SEARCH_LIMIT +
      '&resources[options][unavailable_products]=last')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var res = data.resources && data.resources.results ? data.resources.results : {};
        _renderDropdown(res.products || [], res.collections || [], q);
      })
      .catch(function () { _closeDropdown(); });
  }

  function _renderDropdown(products, collections, q) {
    if (!D.searchDropdown) return;
    state.dropdownIndex = -1;
    if (!products.length && !collections.length) {
      D.searchDropdown.innerHTML = '';
      var empty = document.createElement('div');
      empty.className = 'xuw-search-empty';
      empty.textContent = 'No results for "' + q + '"';
      D.searchDropdown.appendChild(empty);
      _openDropdown(); return;
    }
    D.searchDropdown.innerHTML = '';
    if (collections.length) {
      var cl = document.createElement('div'); cl.className = 'xuw-search-section-label'; cl.textContent = 'Categories'; D.searchDropdown.appendChild(cl);
      collections.slice(0,3).forEach(function (col) {
        var a = document.createElement('a'); a.className = 'xuw-search-result xuw-search-result--col'; a.href = col.url; a.tabIndex = 0;
        a.innerHTML = '<div class="xuw-search-result__icon">&#128193;</div><div class="xuw-search-result__info"><p class="xuw-search-result__title">' + _highlight(col.title||'', q) + '</p><p class="xuw-search-result__meta">Collection</p></div>';
        D.searchDropdown.appendChild(a);
      });
    }
    if (products.length) {
      var pl = document.createElement('div'); pl.className = 'xuw-search-section-label'; pl.textContent = 'Products'; D.searchDropdown.appendChild(pl);
      products.forEach(function (product) {
        var imgSrc = product.featured_image && product.featured_image.url ? product.featured_image.url : '';
        var price  = product.price ? _money(Math.round(parseFloat(product.price)*100)) : '';
        var a = document.createElement('a'); a.className = 'xuw-search-result'; a.href = product.url; a.tabIndex = 0;
        var img = imgSrc ? '<img src="' + _esc(imgSrc) + '" alt="" loading="lazy">' : '<span>' + _esc((product.title||'').slice(0,2).toUpperCase()) + '</span>';
        a.innerHTML = '<div class="xuw-search-result__img">' + img + '</div><div class="xuw-search-result__info"><p class="xuw-search-result__title">' + _highlight(product.title||'',q) + '</p><p class="xuw-search-result__meta">' + _esc(product.vendor||'') + (price?' · '+price:'') + '</p></div>';
        D.searchDropdown.appendChild(a);
      });
    }
    var va = document.createElement('a'); va.className = 'xuw-search-view-all';
    va.href = '/search?type=product&q=' + encodeURIComponent(q);
    va.textContent = 'View all results for "' + q + '" \u2192';
    D.searchDropdown.appendChild(va);
    _openDropdown();
  }

  function _openDropdown()  { if (D.searchDropdown && D.heroSearch) { D.searchDropdown.style.display = ''; D.heroSearch.setAttribute('aria-expanded','true'); } }
  function _closeDropdown() { if (D.searchDropdown && D.heroSearch) { D.searchDropdown.style.display = 'none'; D.heroSearch.setAttribute('aria-expanded','false'); state.dropdownIndex = -1; } }

  function _clearSearch() {
    if (D.heroSearch)      { D.heroSearch.value = ''; D.heroSearch.focus(); }
    if (D.search)          D.search.value = '';
    if (D.heroSearchClear) D.heroSearchClear.style.display = 'none';
    if (D.searchClear)     D.searchClear.style.display = 'none';
    state.searchQuery = '';
    _closeDropdown();
    _runFilters();
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
    _updateModeNote();
    _showWsInfo(state.modalMode === 'wholesale');

    if (D.overlay) { D.overlay.classList.add('is-open'); D.overlay.setAttribute('aria-hidden','false'); }
    if (D.spinner) D.spinner.style.display = 'flex';

    fetch('/products/' + encodeURIComponent(handle) + '.js')
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (p) { state.product = p; _renderModal(p); })
      .catch(function () { _toast('Could not load product. Please try again.'); _closeModal(); })
      .finally(function () { if (D.spinner) D.spinner.style.display = 'none'; });
  }

  /* Global export for any external calls */
  window.xuwOpenModal = function(handle, event, cardEl, forceMode) {
    _openModal(handle, event, cardEl, forceMode);
  };

  function _clearModalUI() {
    _t('xuwModalVendor',''); _t('xuwModalName','');
    _h('xuwModalPrice','');  _t('xuwModalDesc','');
    if (D.qtyVal)        D.qtyVal.textContent     = '1';
    if (D.variantPills)  D.variantPills.innerHTML  = '';
    if (D.variantsWrap)  D.variantsWrap.style.display = 'none';
    if (D.modalThumbs)   D.modalThumbs.innerHTML   = '';
    if (D.modalImg)      D.modalImg.style.display   = 'none';
    if (D.modalImgPh)    D.modalImgPh.style.display = 'flex';
    if (D.modalWsBadge)  D.modalWsBadge.style.display = 'none';
    if (D.cartNote)      D.cartNote.style.display = 'none';
    var prevContact = document.getElementById('xuwContactBtn');
    if (prevContact) prevContact.parentNode.removeChild(prevContact);
  }

  function _renderModal(product) {
    _t('xuwModalVendor', product.vendor || '');
    _t('xuwModalName',   product.title  || '');
    var desc = _stripHtml(product.description || '');
    _t('xuwModalDesc', desc.length > 200 ? desc.slice(0,200) + '\u2026' : desc);

    var imgs = product.images || [];
    var main = product.featured_image || (imgs.length ? imgs[0] : null);
    if (main && D.modalImg) {
      D.modalImg.src = main; D.modalImg.alt = product.title; D.modalImg.style.display = 'block';
      if (D.modalImgPh) D.modalImgPh.style.display = 'none';
    }
    if (D.modalThumbs && imgs.length > 1) {
      D.modalThumbs.innerHTML = '';
      imgs.slice(0,4).forEach(function (src, i) {
        var btn = document.createElement('button'); btn.type = 'button';
        btn.className = 'xuw-modal__thumb' + (i === 0 ? ' is-active' : '');
        var img = document.createElement('img'); img.src = src; img.alt = 'View ' + (i+1); img.loading = 'lazy';
        btn.appendChild(img);
        btn.addEventListener('click', function () {
          if (D.modalImg) D.modalImg.src = src;
          D.modalThumbs.querySelectorAll('.xuw-modal__thumb').forEach(function (b) { b.classList.remove('is-active'); });
          btn.classList.add('is-active');
        });
        D.modalThumbs.appendChild(btn);
      });
    }

    state.wsVariantId = null; state.wsVariantPrice = null;
    var wsV = product.variants.find(function (v) { return v.title.toLowerCase() === CFG.WS_VARIANT_TITLE; });
    if (wsV) { state.wsVariantId = wsV.id; state.wsVariantPrice = wsV.price; }
    if (D.modalWsBadge) D.modalWsBadge.style.display = state.wsVariantId ? '' : 'none';

    _renderVariants(product);
    _updateModeNote();
    _showWsInfo(state.modalMode === 'wholesale');
    _updateWsTierDisplay();
  }

  function _renderVariants(product) {
    if (!D.variantPills) return;
    D.variantPills.innerHTML = '';
    var selectable = product.variants.filter(function (v) {
      return v.title.toLowerCase() !== CFG.WS_VARIANT_TITLE;
    });
    if (!selectable.length) selectable = product.variants;

    if (selectable.length === 1 && selectable[0].title === 'Default Title') {
      if (D.variantsWrap) D.variantsWrap.style.display = 'none';
      state.retailVariantId = selectable[0].id;
      _updateModalPrice(selectable[0]);
      return;
    }
    if (D.variantsWrap) D.variantsWrap.style.display = 'block';
    var firstAvail = selectable.find(function (v) { return v.available; }) || selectable[0];
    state.retailVariantId = firstAvail.id;
    _updateModalPrice(firstAvail);
    selectable.forEach(function (variant) {
      var pill = document.createElement('button'); pill.type = 'button';
      var isA = variant.id === state.retailVariantId;
      pill.className = 'xuw-variant-pill' + (isA ? ' is-active' : '') + (!variant.available ? ' is-unavailable' : '');
      pill.textContent = variant.title;
      pill.setAttribute('aria-pressed', isA.toString());
      if (!variant.available) pill.disabled = true;
      pill.addEventListener('click', function () {
        D.variantPills.querySelectorAll('.xuw-variant-pill').forEach(function (p) { p.classList.remove('is-active'); p.setAttribute('aria-pressed','false'); });
        pill.classList.add('is-active'); pill.setAttribute('aria-pressed','true');
        state.retailVariantId = variant.id;
        _updateModalPrice(variant);
        _updateWsTierDisplay();
      });
      D.variantPills.appendChild(pill);
    });
  }

  /* ═══════════════════════════════════════════════
     WHOLESALE VALUE-TIER SYSTEM
  ═══════════════════════════════════════════════ */

  function _modalSetMode(mode) {
    state.modalMode = mode;
    _setModalModeBtns(mode);
    _updateModeNote();
    _showWsInfo(mode === 'wholesale');
    if (state.retailVariantId && state.product) {
      var v = state.product.variants.find(function (x) { return x.id === state.retailVariantId; });
      if (v) _updateModalPrice(v);
    }
    _updateWsTierDisplay();
  }

  function _setModalModeBtns(mode) {
    [D.modeRetail, D.modeWholesale].forEach(function (btn) {
      if (!btn) return;
      var on = btn.getAttribute('data-mode') === mode;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on.toString());
    });
  }

  function _updateModeNote() {
    if (!D.modeNote) return;
    var ws = state.modalMode === 'wholesale';
    D.modeNote.textContent = ws ? 'Wholesale mode — bulk discounts apply by cart value' : 'Standard retail pricing';
    D.modeNote.style.color = ws ? 'var(--xuw-green-lt)' : '';
  }

  function _showWsInfo(show) {
    if (D.wsInfo) D.wsInfo.style.display = show ? '' : 'none';
  }

  /*
   * _calcWsTierDiscount(unitPriceCents, qty)
   * Returns { pct, discountedPriceCents, orderValueEur }
   * Tier is based on the ORDER VALUE of this product (qty × unit price)
   * PLUS the existing cart total. Customer doesn't need a fixed minimum qty.
   */
  function _calcWsTierDiscount(unitPriceCents, qty) {
    var unitPriceEur   = (unitPriceCents || 0) / 100;
    var orderValueEur  = unitPriceEur * qty;
    var totalEur       = state.cartTotal + orderValueEur;
    var tier = null;
    for (var i = 0; i < CFG.WS_TIERS.length; i++) {
      if (totalEur >= CFG.WS_TIERS[i].min) { tier = CFG.WS_TIERS[i]; break; }
    }
    var pct = tier ? tier.pct : 0;
    var discounted = Math.round(unitPriceCents * (1 - pct / 100));
    return { pct: pct, discountedPriceCents: discounted, orderValueEur: orderValueEur, totalEur: totalEur };
  }

  function _updateWsTierDisplay() {
    if (state.modalMode !== 'wholesale') return;
    var unitPriceCents = _getWsUnitPrice();
    if (!unitPriceCents) return;
    var result = _calcWsTierDiscount(unitPriceCents, state.qty);

    /* Update tier table highlights */
    if (D.wsTiers) {
      /* Find the lowest tier the customer hasn't reached yet — that's "Next" */
      var nextTierMin = null;
      for (var ti = 0; ti < CFG.WS_TIERS.length; ti++) {
        if (result.totalEur < CFG.WS_TIERS[ti].min) {
          if (nextTierMin === null || CFG.WS_TIERS[ti].min < nextTierMin) {
            nextTierMin = CFG.WS_TIERS[ti].min;
          }
        }
      }
      var rows = D.wsTiers.querySelectorAll('tr[data-tier-min]');
      rows.forEach(function (row) {
        var min = parseInt(row.getAttribute('data-tier-min'), 10);
        var statusCell = row.querySelector('.xuw-tier__status');
        var isActive = result.totalEur >= min;
        var isNext   = !isActive && min === nextTierMin;
        row.classList.toggle('xuw-tier--active', isActive);
        row.classList.toggle('xuw-tier--next',   isNext);
        if (statusCell) statusCell.textContent = isActive ? '\u2714 Active' : (isNext ? '\u2192 Next' : '');
      });
    }

    /* Live note */
    if (D.wsNote) {
      if (result.pct > 0) {
        D.wsNote.textContent = result.pct + '% discount applied. Order total: ' + _moneyEur(result.totalEur) + '.';
        D.wsNote.style.color = 'var(--xuw-green-lt)';
      } else {
        var needed = 300 - result.totalEur;
        D.wsNote.textContent = needed > 0 ? 'Add ' + _moneyEur(needed) + ' more to unlock 3% discount.' : '';
        D.wsNote.style.color = '#888';
      }
    }

    /* Cart note near qty */
    if (D.cartNote) {
      if (result.pct > 0) {
        D.cartNote.textContent = 'Price with ' + result.pct + '% discount: ' + _money(result.discountedPriceCents) + ' / unit';
        D.cartNote.style.display = '';
        D.cartNote.style.color = 'var(--xuw-green-lt)';
      } else {
        D.cartNote.style.display = 'none';
      }
    }
  }

  function _getWsUnitPrice() {
    /* Use wholesale variant price if available, else retail price */
    if (state.wsVariantPrice) return state.wsVariantPrice;
    if (state.retailVariantId && state.product) {
      var v = state.product.variants.find(function (x) { return x.id === state.retailVariantId; });
      if (v) return v.price;
    }
    return null;
  }

  function _getWsPrice() {
    if (state.wsVariantPrice) return state.wsVariantPrice;
    if (state.retailVariantId && state.product) {
      var v = state.product.variants.find(function (x) { return x.id === state.retailVariantId; });
      if (v && v.compare_at_price && v.compare_at_price > v.price) return v.price;
    }
    return null;
  }

  function _updateModalPrice(variant) {
    if (!D.modalPrice) return;
    if (state.modalMode === 'wholesale') {
      var ws = _getWsPrice();
      if (ws !== null) {
        var retail = (variant.compare_at_price > variant.price) ? variant.compare_at_price : variant.price;
        var p = document.createElement('span'); p.className = 'xuw-price--compare'; p.textContent = _money(retail);
        var w = document.createElement('span'); w.className = 'xuw-price--ws-main'; w.textContent = _money(ws);
        D.modalPrice.innerHTML = ''; D.modalPrice.appendChild(p); D.modalPrice.appendChild(w);
        if (D.modalWsBadge) D.modalWsBadge.style.display = '';
      } else {
        D.modalPrice.textContent = _money(variant.price);
        var setup = document.createElement('span'); setup.className = 'xuw-price--ws-setup';
        setup.textContent = 'Add a "Wholesale" variant in Shopify admin';
        D.modalPrice.appendChild(setup);
        if (D.modalWsBadge) D.modalWsBadge.style.display = 'none';
      }
    } else {
      D.modalPrice.innerHTML = '';
      if (variant.compare_at_price && variant.compare_at_price > variant.price) {
        var c = document.createElement('span'); c.className = 'xuw-price--compare'; c.textContent = _money(variant.compare_at_price);
        D.modalPrice.appendChild(c);
      }
      D.modalPrice.appendChild(document.createTextNode(_money(variant.price)));
      if (D.modalWsBadge) D.modalWsBadge.style.display = 'none';
    }
  }

  /* Card wholesale toggle */
  function _cardSetMode(btn) {
    var mode = btn.getAttribute('data-mode');
    /* Support both old (.xuw-card__mode-btn) and new (.xuw-panel__mode-btn) card layouts */
    var card = btn.closest('.xuw-card') || btn.closest('product-card');
    if (!card || !mode) return;
    card.querySelectorAll('.xuw-card__mode-btn, .xuw-panel__mode-btn').forEach(function (b) {
      var on = b.getAttribute('data-mode') === mode;
      b.classList.toggle('is-active', on);
      b.classList.toggle('xuw-panel__mode-btn--active', on);
      b.setAttribute('aria-pressed', on.toString());
    });
    card.dataset.currentMode = mode;

    if (mode === 'wholesale') {
      /* Open modal in wholesale mode so customer can add wholesale variant to cart */
      _openModal(card.getAttribute('data-handle'), null, card, 'wholesale');
    }
  }

  /* Sidebar wholesale mode toggle */
  function _sidebarSetMode(mode) {
    state.globalMode = mode;
    document.querySelectorAll('.xuw-ws-btn[data-action="set-ws-mode"]').forEach(function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-mode') === mode);
    });
    var note = id('xuwSidebarModeNote');
    if (note) note.textContent = mode === 'wholesale' ? '\u2713 Wholesale mode active — bulk discounts by cart value' : 'Standard retail pricing';
    if (D.sidebarTiers) D.sidebarTiers.style.display = mode === 'wholesale' ? '' : 'none';

    /* Apply to all eligible cards */
    document.querySelectorAll('.xuw-card[data-wholesale="true"]').forEach(function (card) {
      var pid  = card.getAttribute('data-product-id');
      var mBtn = card.querySelector('.xuw-card__mode-btn[data-mode="' + mode + '"]');
      if (mBtn && pid) {
        card.querySelectorAll('.xuw-card__mode-btn').forEach(function (b) {
          var on = b.getAttribute('data-mode') === mode;
          b.classList.toggle('is-active', on);
          b.setAttribute('aria-pressed', on.toString());
        });
        card.dataset.currentMode = mode;
        var priceEl  = id('xuwPrice-' + pid);
        var retailEl = priceEl && priceEl.querySelector('.xuw-price--retail');
        var wsEl     = priceEl && priceEl.querySelector('.xuw-price--ws');
        if (mode === 'wholesale') {
          if (retailEl) retailEl.style.opacity = '0.4';
          if (wsEl) { wsEl.textContent = 'See wholesale price'; wsEl.style.display = ''; wsEl.style.fontSize = '11px'; wsEl.style.color = 'var(--xuw-green-lt)'; }
        } else {
          if (retailEl) retailEl.style.opacity = '';
          if (wsEl) { wsEl.style.display = 'none'; wsEl.textContent = ''; }
        }
      }
    });
  }

  /* ═══════════════════════════════════════════════
     CART
  ═══════════════════════════════════════════════ */
  function _fetchCartTotal() {
    fetch('/cart.js')
      .then(function (r) { return r.json(); })
      .then(function (cart) {
        state.cartTotal = (cart.total_price || 0) / 100;
      })
      .catch(function () {});
  }

  function _resolveVid() {
    /* Rule 9: wholesale variant is NEVER added to cart.
       Always return the customer's selected size variant. */
    return state.retailVariantId;
  }

  function _directAddToCart(btn) {
    var card = btn.closest('.xuw-card');
    if (card && card.dataset.currentMode === 'wholesale' && card.dataset.wholesale === 'true') {
      _openModal(card.getAttribute('data-handle'), null, card, 'wholesale'); return;
    }
    if (card && card.querySelector('.xuw-card__variants-hint')) {
      _openModal(card.getAttribute('data-handle'), null, card, 'retail'); return;
    }
    _cartAdd(parseInt(btn.getAttribute('data-variant-id'), 10), 1, false);
  }

  function _cartAdd(variantId, qty, openCart, extraProps) {
    if (!variantId) { _toast('Please select a product option'); return; }
    [D.addToCart, D.buyNow].forEach(function (b) { if (b) { b.disabled = true; b.style.opacity = '.55'; } });
    var payload = { id: parseInt(variantId,10), quantity: qty };
    if (extraProps && Object.keys(extraProps).length) { payload.properties = extraProps; }
    fetch('/cart/add.js', {
      method  : 'POST',
      headers : { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body    : JSON.stringify(payload)
    })
      .then(function (r) {
        if (r.status === 422) return r.json().then(function (e) { throw new Error(e.description || e.message || 'Cannot add'); });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function () {
        _toast('\u2713 Added to cart' + (qty > 1 ? ' (' + qty + ' units)' : '') + '!');
        _refreshCartCount();
        _fetchCartTotal();
        /* Trigger Horizon cart drawer refresh */
        document.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true }));
        document.dispatchEvent(new CustomEvent('theme:cart:refresh', { bubbles: true }));
        if (openCart) { document.dispatchEvent(new CustomEvent('theme:cart:open', { bubbles: true })); setTimeout(function () { var b = document.querySelector('[data-cart-toggle],[data-open-cart],.js-cart-open,.header__cart-btn'); if (b) b.click(); }, 60); }
        else { var b = document.querySelector('[data-cart-toggle],.js-cart-open,.header__cart-btn'); if (b) { b.style.transition='transform .15s'; b.style.transform='scale(1.22)'; setTimeout(function(){b.style.transform='';},280); } }
      })
      .catch(function (err) {
        _toast(err.message || 'Error adding to cart');
        if (state.product) {
          var vTitle = '';
          if (state.retailVariantId && state.product.variants) {
            for (var vi = 0; vi < state.product.variants.length; vi++) {
              if (state.product.variants[vi].id === state.retailVariantId) { vTitle = state.product.variants[vi].title; break; }
            }
          }
          _injectCartContactBtn(state.product.handle, qty, vTitle);
        }
      })
      .finally(function () { [D.addToCart, D.buyNow].forEach(function (b) { if (b) { b.disabled = false; b.style.opacity = ''; } }); });
  }

  function _injectCartContactBtn(handle, qty, variantTitle) {
    var actionsEl = document.getElementById('xuwModalActions') ||
                    (D.addToCart && D.addToCart.parentNode);
    if (!actionsEl) return;
    var prev = document.getElementById('xuwContactBtn');
    if (prev) return; /* already injected */
    var params = 'ref=stock&product=' + encodeURIComponent(handle || '') +
                 '&variant=' + encodeURIComponent(variantTitle || '') +
                 '&qty=' + encodeURIComponent(qty || 1);
    var btn = document.createElement('a');
    btn.id        = 'xuwContactBtn';
    btn.className = 'xuw-btn xuw-btn--contact';
    btn.href      = '/pages/contact?' + params;
    btn.textContent = 'Contact Us to Order';
    btn.setAttribute('target', '_blank');
    btn.setAttribute('rel', 'noopener');
    actionsEl.appendChild(btn);
  }

  function _refreshCartCount() {
    fetch('/cart.js').then(function (r) { return r.json(); }).then(function (cart) {
      var n = cart.item_count;
      ['[data-cart-count]','[data-header-cart-count]','.cart-count','.header__cart-count','.cart-item-count','#CartCount','.js-cart-count'].forEach(function (sel) {
        document.querySelectorAll(sel).forEach(function (el) { el.textContent = n||''; if(n>0) el.removeAttribute('hidden'); });
      });
    }).catch(function(){});
  }

  /* ═══════════════════════════════════════════════
     FILTERS
  ═══════════════════════════════════════════════ */
  function _toggleGroup(headBtn) {
    var body   = headBtn.nextElementSibling;
    var isOpen = headBtn.getAttribute('aria-expanded') === 'true';
    headBtn.setAttribute('aria-expanded', (!isOpen).toString());
    if (body) body.style.display = isOpen ? 'none' : '';
    var chev = headBtn.querySelector('.xuw-chevron');
    if (chev) chev.style.transform = isOpen ? 'rotate(-90deg)' : 'rotate(0deg)';
  }

  function _toggleNeedle(pill) {
    var on = !pill.classList.contains('is-active');
    pill.classList.toggle('is-active', on);
    pill.setAttribute('aria-pressed', on.toString());
    _applyFilter(pill.getAttribute('data-filter-key'), pill.getAttribute('data-filter-val'), on);
  }

  function _initFilterCheckboxes() {
    document.querySelectorAll('.xuw-fc').forEach(function (cb) {
      cb.addEventListener('change', function () {
        if (cb.classList.contains('xuw-fc--dynamic')) {
          var url = cb.checked ? cb.getAttribute('data-add') : cb.getAttribute('data-remove');
          if (url) window.location.href = url;
          return;
        }
        _applyFilter(cb.getAttribute('data-filter-key'), cb.getAttribute('data-filter-val'), cb.checked);
      });
    });
  }

  function _applyFilter(key, val, add) {
    if (!val) return;
    val = val.toLowerCase().trim();
    if (!state.activeFilters[key]) state.activeFilters[key] = [];
    if (add) { if (state.activeFilters[key].indexOf(val) === -1) state.activeFilters[key].push(val); }
    else { state.activeFilters[key] = state.activeFilters[key].filter(function (v) { return v !== val; }); if (!state.activeFilters[key].length) delete state.activeFilters[key]; }
    _runFilters(); _renderChips(); _updateFilterBadge();
  }

  function _runFilters() {
    var cards = document.querySelectorAll('.xuw-card');
    var visible = 0;
    cards.forEach(function (card) {
      var show = _cardMatches(card);
      card.style.display = show ? '' : 'none';
      if (show) visible++;
    });
    var el = id('xuwProductCount'); if (el) el.textContent = visible;
  }

  function _cardMatches(card) {
    if (state.searchQuery) {
      var name   = (card.querySelector('.xuw-card__name')   || {}).textContent || '';
      var vendor = (card.querySelector('.xuw-card__vendor') || {}).textContent || '';
      if (name.toLowerCase().indexOf(state.searchQuery) === -1 && vendor.toLowerCase().indexOf(state.searchQuery) === -1) return false;
    }
    var keys = Object.keys(state.activeFilters);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i]; var vals = state.activeFilters[key];
      if (!vals || !vals.length) continue;
      var matched = false;
      for (var j = 0; j < vals.length; j++) {
        var v = vals[j];
        if (key === 'tags')         { var tags = (card.getAttribute('data-tags')||'').toLowerCase().split(',').map(function(t){return t.trim();}); if (tags.indexOf(v) !== -1) { matched=true; break; } }
        else if (key === 'product-type') { if ((card.getAttribute('data-product-type')||'').toLowerCase().trim() === v) { matched=true; break; } }
        else if (key === 'vendor')  { if ((card.getAttribute('data-vendor')||'').toLowerCase().trim() === v) { matched=true; break; } }
        else if (key === 'available') { if (v === 'true' && card.getAttribute('data-available') === 'true') { matched=true; break; } }
      }
      if (!matched) return false;
    }
    return true;
  }

  function _renderChips() {
    var all = [];
    Object.keys(state.activeFilters).forEach(function (k) { state.activeFilters[k].forEach(function (v) { all.push({key:k,val:v}); }); });
    if (!all.length) { if (D.activeChips) D.activeChips.style.display = 'none'; return; }
    if (D.activeChips) D.activeChips.style.display = '';
    if (!D.chipList) return;
    D.chipList.innerHTML = '';
    all.forEach(function (f) {
      var chip = document.createElement('button'); chip.type = 'button'; chip.className = 'xuw-active-chip';
      chip.textContent = f.val; var x = document.createElement('span'); x.setAttribute('aria-hidden','true'); x.textContent = ' \u2715'; chip.appendChild(x);
      chip.setAttribute('aria-label', 'Remove ' + f.val);
      chip.addEventListener('click', function () {
        _applyFilter(f.key, f.val, false);
        document.querySelectorAll('.xuw-fc--static').forEach(function (cb) { if (cb.getAttribute('data-filter-key')===f.key && (cb.getAttribute('data-filter-val')||'').toLowerCase().trim()===f.val) cb.checked = false; });
        document.querySelectorAll('.xuw-needle-pill').forEach(function (p) { if (p.getAttribute('data-filter-key')===f.key && (p.getAttribute('data-filter-val')||'').toLowerCase().trim()===f.val) { p.classList.remove('is-active'); p.setAttribute('aria-pressed','false'); } });
      });
      D.chipList.appendChild(chip);
    });
  }

  function _clearAllFilters() {
    state.activeFilters = {};
    document.querySelectorAll('.xuw-fc--static').forEach(function (cb) { cb.checked = false; });
    document.querySelectorAll('.xuw-needle-pill').forEach(function (p) { p.classList.remove('is-active'); p.setAttribute('aria-pressed','false'); });
    _runFilters(); _renderChips(); _updateFilterBadge();
  }

  function _updateFilterBadge() {
    var n = 0; Object.keys(state.activeFilters).forEach(function (k) { n += state.activeFilters[k].length; });
    if (D.filterBadge) { D.filterBadge.textContent = n; D.filterBadge.style.display = n ? '' : 'none'; }
  }

  function _toggleMobileSidebar() {
    var sidebar = id('xuwSidebar'); var btn = id('xuwFilterMobileBtn');
    if (!sidebar) return;
    var open = sidebar.classList.toggle('is-open');
    if (btn) btn.setAttribute('aria-expanded', open.toString());
  }

  /* ═══════════════════════════════════════════════
     SIDEBAR SEARCH
  ═══════════════════════════════════════════════ */
  function _initSidebarSearch() {
    if (!D.search) return;
    D.search.addEventListener('input', function () {
      clearTimeout(state.searchTimer);
      var q = D.search.value.trim().toLowerCase();
      if (D.searchClear) D.searchClear.style.display = q ? '' : 'none';
      state.searchTimer = setTimeout(function () { state.searchQuery = q; _runFilters(); }, 200);
    });
  }

  /* ═══════════════════════════════════════════════
     PRICE RANGE SLIDER
  ═══════════════════════════════════════════════ */
  function _initPriceRange() {
    var minIn = id('xuwPriceMin'); var maxIn = id('xuwPriceMax');
    var minLbl = id('xuwPriceMinLbl'); var maxLbl = id('xuwPriceMaxLbl');
    var fill = id('xuwPriceFill');
    if (!minIn || !maxIn) return;
    function update() {
      var lo = Math.min(parseFloat(minIn.value), parseFloat(maxIn.value));
      var hi = Math.max(parseFloat(minIn.value), parseFloat(maxIn.value));
      if (minLbl) minLbl.textContent = '\u20AC' + Math.round(lo);
      if (maxLbl) maxLbl.textContent = '\u20AC' + Math.round(hi);
      var range = parseFloat(minIn.max) - parseFloat(minIn.min);
      if (fill && range > 0) { fill.style.left = ((lo-parseFloat(minIn.min))/range*100)+'%'; fill.style.right = ((parseFloat(minIn.max)-hi)/range*100)+'%'; }
      minIn.style.zIndex = parseFloat(minIn.value) >= parseFloat(maxIn.value) ? '5' : '3'; maxIn.style.zIndex = '4';
    }
    var pt;
    function schedule() { clearTimeout(pt); pt = setTimeout(function () { var lo = Math.min(parseFloat(minIn.value),parseFloat(maxIn.value)); var hi = Math.max(parseFloat(minIn.value),parseFloat(maxIn.value)); var url = new URL(window.location.href); url.searchParams.set(minIn.getAttribute('data-param')||'filter.v.price.gte',lo); url.searchParams.set(maxIn.getAttribute('data-param')||'filter.v.price.lte',hi); window.location.href=url.toString(); }, 900); }
    minIn.addEventListener('input', function () { update(); schedule(); });
    maxIn.addEventListener('input', function () { update(); schedule(); });
    update();
  }

  /* ═══════════════════════════════════════════════
     MODAL CLOSE
  ═══════════════════════════════════════════════ */
  function _initModalClose() {
    if (D.closeBtn) D.closeBtn.addEventListener('click', _closeModal);
    if (D.overlay)  D.overlay.addEventListener('click', function (e) { if (e.target === D.overlay) _closeModal(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && D.overlay && D.overlay.classList.contains('is-open')) _closeModal(); });
  }

  function _closeModal() {
    if (D.overlay) { D.overlay.classList.remove('is-open'); D.overlay.setAttribute('aria-hidden','true'); }
  }

  /* ═══════════════════════════════════════════════
     TOAST
  ═══════════════════════════════════════════════ */
  function _toast(msg) {
    if (!D.toast) return;
    D.toast.textContent = msg; D.toast.classList.add('is-visible');
    clearTimeout(_toast._t);
    _toast._t = setTimeout(function () { D.toast.classList.remove('is-visible'); }, 3200);
  }

  /* ═══════════════════════════════════════════════
     HELPERS
  ═══════════════════════════════════════════════ */
  function _money(cents)    { return '\u20AC' + ((parseInt(cents,10)||0)/100).toFixed(2).replace('.',','); }
  function _moneyEur(eur)   { return '\u20AC' + eur.toFixed(2).replace('.',','); }
  function _stripHtml(html) { var d = document.createElement('div'); d.innerHTML = html; return d.textContent || d.innerText || ''; }
  function _highlight(text, q) {
    if (!q) return _esc(text);
    var re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + ')', 'gi');
    return _esc(text).replace(re, '<mark>$1</mark>');
  }
  function _esc(s)          { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  function _t(elId, text)   { var e = id(elId); if (e) e.textContent = text; }
  function _h(elId, html)   { var e = id(elId); if (e) e.innerHTML = html; }
  function id(elId)         { return document.getElementById(elId); }

})();
