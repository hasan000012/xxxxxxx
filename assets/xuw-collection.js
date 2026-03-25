// @ts-nocheck
/**
 * X Under World — Collection JS  |  assets/xuw-collection.js  |  v10.0
 *
 * V10 / V5 SPEC CHANGES:
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. _formatMoney(cents) — DOM-based, reads data-fmt from #xuw-money-fmt span.
 * 2. _atcSetState(btn, state) — 4-state ATC button: default/loading/success/error.
 * 3. Multi-type _toast(type, msg) — lazy-mounted stack, slide animation, dismiss.
 * 4. _handleAtc(btn) — 2-Click Rule: direct add for single-variant retail;
 *    modal fallback for multi-variant or wholesale mode.
 * 5. _cardSetMode V5 — .is-loading lock + _applyCardMode helper.
 * 6. V5 modal IDs (hyphenated): xuw-modal-overlay, xuw-modal-content, etc.
 * 7. _openModal sets state.modalMode synchronously BEFORE fetch (race fix).
 * 8. _cartAdd(variantId, qty, btn, card) — 4-arg signature; 422 → contact btn.
 * 9. Full event delegation: atc, card-mode, close-modal, modal-atc, modal-mode,
 *    pick-variant, qty-inc, qty-dec, close-toast, hero-prev, hero-next, hero-dot.
 * 10. _refreshCartCount dispatches xuw:cart-updated custom event.
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

  /* ═══════════════ MONEY FORMAT ═══════════════ */
  var _moneyFmt = null;

  function _formatMoney(cents) {
    if (_moneyFmt === null) {
      var span = document.getElementById('xuw-money-fmt');
      _moneyFmt = (span && span.getAttribute('data-fmt')) || '{{amount_with_comma_separator}} €';
    }
    var amount = ((parseInt(cents, 10) || 0) / 100).toFixed(2);
    var amountComma = amount.replace('.', ',');
    var amountDot   = amount;
    var amountInt   = String(Math.round(parseInt(cents, 10) / 100));
    return _moneyFmt
      .replace('{{amount_with_comma_separator}}', amountComma)
      .replace('{{amount_no_decimals_with_comma_separator}}', amountInt)
      .replace('{{amount_no_decimals}}', amountInt)
      .replace('{{amount}}', amountDot);
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
    activeFilters   : {},
    searchQuery     : '',
    searchTimer     : null,
    predictiveTimer : null,
    dropdownIndex   : -1,
    sliderIndex     : 0,
    sliderTimer     : null,
    cartTotal       : 0
  };

  var D = {};

  /* ═══════════════ INIT ═══════════════ */
  document.addEventListener('DOMContentLoaded', function () {
    /* V5 modal IDs (hyphenated) */
    D.overlay        = id('xuw-modal-overlay');
    D.modalInner     = id('xuw-modal-inner');
    D.modalContent   = id('xuw-modal-content');
    D.spinner        = id('xuw-modal-loading');
    D.modalVendor    = id('xuw-modal-vendor');
    D.modalTitle     = id('xuw-modal-title');
    D.modeRow        = id('xuw-modal-mode-row');
    D.variantPills   = id('xuw-modal-variants');
    D.modalPrice     = id('xuw-modal-price');
    D.wsTiers        = id('xuw-modal-tiers');
    D.wsNote         = id('xuw-modal-ws-note');
    D.qtyVal         = id('xuw-modal-qty');
    D.addToCart      = id('xuw-modal-atc');

    /* Non-modal UI */
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

        /* ── Card ATC (V5 2-Click Rule) ── */
        case 'atc':
          e.preventDefault(); e.stopPropagation();
          _handleAtc(btn);
          break;

        /* ── Card wholesale toggle ── */
        case 'card-mode':
          e.preventDefault(); e.stopPropagation();
          _cardSetMode(btn);
          break;

        /* ── Modal overlay / close button ── */
        case 'close-modal':
          if (btn === D.overlay && e.target !== D.overlay) break; /* inner click passthrough */
          _closeModal();
          break;

        /* ── Modal ATC ── */
        case 'modal-atc':
          e.preventDefault();
          _handleModalAtc();
          break;

        /* ── Modal mode switch (Retail / Wholesale) ── */
        case 'modal-mode':
          _modalSetMode(btn.getAttribute('data-mode'));
          break;

        /* ── Modal variant pill ── */
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
              p.classList.toggle('is-active', parseInt(p.getAttribute('data-variant-id'), 10) === vid);
              p.setAttribute('aria-pressed', (parseInt(p.getAttribute('data-variant-id'), 10) === vid).toString());
            });
          }
          _updateModalPrice(vv);
          _updateWsTierDisplay();
          break;
        }

        /* ── Modal qty ── */
        case 'qty-dec':
          state.qty = Math.max(1, state.qty - 1);
          if (D.qtyVal) D.qtyVal.textContent = state.qty;
          _updateWsTierDisplay();
          break;

        case 'qty-inc':
          state.qty++;
          if (D.qtyVal) D.qtyVal.textContent = state.qty;
          _updateWsTierDisplay();
          break;

        /* ── Toast dismiss ── */
        case 'close-toast': {
          var toast = btn.closest('.xuw-toast');
          if (toast) _dismissToast(toast);
          break;
        }

        /* ── Hero slider ── */
        case 'hero-prev':
          _sliderGo(state.sliderIndex - 1);
          break;
        case 'hero-next':
          _sliderGo(state.sliderIndex + 1);
          break;
        case 'hero-dot':
          _sliderGo(parseInt(btn.getAttribute('data-slide'), 10));
          break;

        /* ── Legacy slider aliases ── */
        case 'slider-prev':
          _sliderGo(state.sliderIndex - 1);
          break;
        case 'slider-next':
          _sliderGo(state.sliderIndex + 1);
          break;
        case 'slider-goto':
          _sliderGo(parseInt(btn.getAttribute('data-slide'), 10));
          break;

        /* ── Filter / sidebar ── */
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
        case 'set-ws-mode':
          _sidebarSetMode(btn.getAttribute('data-mode'));
          break;
      }
    });
  }

  /* ═══════════════════════════════════════════════
     2-CLICK RULE — _handleAtc
     Single-variant retail → direct add.
     Multi-variant or wholesale mode → open modal.
  ═══════════════════════════════════════════════ */
  function _handleAtc(btn) {
    var card = btn.closest('.xuw-card');
    if (!card) return;
    var isWholesale   = card.dataset.wholesale === 'true';
    var currentMode   = card.dataset.currentMode || 'retail';
    var isSingle      = btn.getAttribute('data-single') === 'true' ||
                        card.dataset.singleVariant === 'true';

    /* Wholesale mode → always open modal */
    if (isWholesale && currentMode === 'wholesale') {
      _openModal(card.getAttribute('data-handle'), null, card, 'wholesale');
      return;
    }

    /* Multi-variant retail → open modal */
    if (!isSingle) {
      _openModal(card.getAttribute('data-handle'), null, card, 'retail');
      return;
    }

    /* Single-variant retail → direct add */
    var variantId = parseInt(btn.getAttribute('data-variant-id') || card.dataset.variantId, 10);
    if (!variantId) {
      _toast('error', 'Could not find product variant');
      return;
    }
    _cartAdd(variantId, 1, btn, card);
  }

  /* ═══════════════════════════════════════════════
     ATC BUTTON STATE — 4 states
  ═══════════════════════════════════════════════ */
  function _atcSetState(btn, btnState) {
    if (!btn) return;
    btn.removeAttribute('data-atc-state');
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
      default: /* 'default' */
        btn.disabled = false;
        btn.innerHTML = '+ Add to Cart';
        break;
    }
  }

  /* ═══════════════════════════════════════════════
     HERO SLIDER
  ═══════════════════════════════════════════════ */
  function _initSlider() {
    var slider = id('xuwHeroSlider');
    if (!slider) return;
    _sliderGo(0);
    _sliderResetTimer();
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
        var price  = product.price ? _formatMoney(Math.round(parseFloat(product.price)*100)) : '';
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
     MODAL — open / close / render
  ═══════════════════════════════════════════════ */
  function _openModal(handle, event, cardEl, forceMode) {
    if (event) { event.preventDefault(); event.stopPropagation(); }
    var card = cardEl || (event && event.target ? event.target.closest('.xuw-card') : null);

    /* V5: set modalMode BEFORE fetch to prevent race condition */
    state.modalMode       = forceMode || (card && card.dataset.currentMode) || state.globalMode || 'retail';
    state.product         = null;
    state.retailVariantId = null;
    state.wsVariantId     = null;
    state.wsVariantPrice  = null;
    state.qty             = 1;

    _clearModalUI();
    _setModalModeBtns(state.modalMode);
    _showWsInfo(state.modalMode === 'wholesale');

    /* Show overlay, show spinner, hide content */
    if (D.overlay)      { D.overlay.classList.remove('xuw-is-hidden'); D.overlay.setAttribute('aria-hidden','false'); }
    if (D.spinner)      D.spinner.style.display = 'flex';
    if (D.modalContent) D.modalContent.classList.add('xuw-is-hidden');
    if (D.qtyVal)       D.qtyVal.textContent = '1';

    fetch('/products/' + encodeURIComponent(handle) + '.js')
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (p) {
        state.product = p;
        _renderModal(p);
        if (D.spinner)      D.spinner.style.display = 'none';
        if (D.modalContent) D.modalContent.classList.remove('xuw-is-hidden');
      })
      .catch(function () {
        _toast('error', 'Could not load product. Please try again.');
        _closeModal();
      });
  }

  /* Global export for external calls */
  window.xuwOpenModal = function(handle, event, cardEl, forceMode) {
    _openModal(handle, event, cardEl, forceMode);
  };

  function _clearModalUI() {
    if (D.modalVendor)  D.modalVendor.textContent  = '';
    if (D.modalTitle)   D.modalTitle.textContent   = '';
    if (D.modalPrice)   D.modalPrice.innerHTML     = '';
    if (D.variantPills) D.variantPills.innerHTML   = '';
    if (D.qtyVal)       D.qtyVal.textContent       = '1';
    if (D.modeRow)      D.modeRow.classList.add('xuw-is-hidden');
    if (D.wsTiers)      D.wsTiers.classList.add('xuw-is-hidden');
    /* Remove any previously injected contact button */
    var prevContact = document.getElementById('xuw-contact-btn');
    if (prevContact) prevContact.parentNode.removeChild(prevContact);
  }

  function _renderModal(product) {
    if (D.modalVendor) D.modalVendor.textContent = product.vendor || '';
    if (D.modalTitle)  D.modalTitle.textContent  = product.title  || '';

    state.wsVariantId    = null;
    state.wsVariantPrice = null;
    var wsV = null;
    for (var i = 0; i < product.variants.length; i++) {
      if (product.variants[i].title.toLowerCase() === CFG.WS_VARIANT_TITLE) {
        wsV = product.variants[i]; break;
      }
    }
    if (wsV) { state.wsVariantId = wsV.id; state.wsVariantPrice = wsV.price; }

    /* Show mode row only for wholesale products */
    if (D.modeRow) {
      if (state.wsVariantId) {
        D.modeRow.classList.remove('xuw-is-hidden');
      } else {
        D.modeRow.classList.add('xuw-is-hidden');
        state.modalMode = 'retail';
        _setModalModeBtns('retail');
      }
    }

    _renderVariants(product);
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
      state.retailVariantId = selectable[0].id;
      _updateModalPrice(selectable[0]);
      return;
    }

    var firstAvail = selectable.find(function (v) { return v.available; }) || selectable[0];
    state.retailVariantId = firstAvail.id;
    _updateModalPrice(firstAvail);

    selectable.forEach(function (variant) {
      var pill = document.createElement('button'); pill.type = 'button';
      var isA = variant.id === state.retailVariantId;
      pill.className = 'xuw-variant-pill' + (isA ? ' is-active' : '') + (!variant.available ? ' is-unavailable' : '');
      pill.textContent = variant.title;
      pill.setAttribute('data-action', 'pick-variant');
      pill.setAttribute('data-variant-id', variant.id);
      pill.setAttribute('aria-pressed', isA.toString());
      if (!variant.available) pill.disabled = true;
      D.variantPills.appendChild(pill);
    });
  }

  /* ═══════════════════════════════════════════════
     WHOLESALE VALUE-TIER SYSTEM
  ═══════════════════════════════════════════════ */
  function _modalSetMode(mode) {
    state.modalMode = mode;
    _setModalModeBtns(mode);
    _showWsInfo(mode === 'wholesale');
    if (state.retailVariantId && state.product) {
      var v = state.product.variants.find(function (x) { return x.id === state.retailVariantId; });
      if (v) _updateModalPrice(v);
    }
    _updateWsTierDisplay();
  }

  function _setModalModeBtns(mode) {
    if (!D.modeRow) return;
    D.modeRow.querySelectorAll('[data-action="modal-mode"]').forEach(function (btn) {
      var on = btn.getAttribute('data-mode') === mode;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on.toString());
    });
  }

  function _showWsInfo(show) {
    if (D.wsTiers) {
      if (show) D.wsTiers.classList.remove('xuw-is-hidden');
      else      D.wsTiers.classList.add('xuw-is-hidden');
    }
  }

  function _calcWsTierDiscount(unitPriceCents, qty) {
    var unitPriceEur  = (unitPriceCents || 0) / 100;
    var orderValueEur = unitPriceEur * qty;
    var totalEur      = state.cartTotal + orderValueEur;
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

    if (D.wsTiers) {
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

    if (D.wsNote) {
      if (result.pct > 0) {
        D.wsNote.textContent = result.pct + '% discount applied. Order total: \u20AC' + result.totalEur.toFixed(2).replace('.',',') + '.';
        D.wsNote.style.color = 'var(--xuw-green-lt)';
      } else {
        var needed = 300 - result.totalEur;
        D.wsNote.textContent = needed > 0 ? 'Add \u20AC' + needed.toFixed(2).replace('.',',') + ' more to unlock 3% discount.' : '';
        D.wsNote.style.color = '#888';
      }
    }
  }

  function _getWsUnitPrice() {
    if (state.wsVariantPrice) return state.wsVariantPrice;
    if (state.retailVariantId && state.product) {
      var v = state.product.variants.find(function (x) { return x.id === state.retailVariantId; });
      if (v) return v.price;
    }
    return null;
  }

  function _updateModalPrice(variant) {
    if (!D.modalPrice) return;
    D.modalPrice.innerHTML = '';
    if (state.modalMode === 'wholesale' && state.wsVariantPrice) {
      var c = document.createElement('span'); c.className = 'xuw-price--compare'; c.textContent = _formatMoney(variant.price);
      var w = document.createElement('span'); w.className = 'xuw-price--ws-main'; w.textContent = _formatMoney(state.wsVariantPrice);
      D.modalPrice.appendChild(c); D.modalPrice.appendChild(w);
    } else {
      if (variant.compare_at_price && variant.compare_at_price > variant.price) {
        var cc = document.createElement('span'); cc.className = 'xuw-price--compare'; cc.textContent = _formatMoney(variant.compare_at_price);
        D.modalPrice.appendChild(cc);
      }
      D.modalPrice.appendChild(document.createTextNode(_formatMoney(variant.price)));
    }
  }

  /* ═══════════════════════════════════════════════
     CARD WHOLESALE TOGGLE — V5
  ═══════════════════════════════════════════════ */
  function _cardSetMode(btn) {
    var cardEl = btn.closest('.xuw-card');
    var handle = btn.getAttribute('data-handle') || (cardEl && cardEl.getAttribute('data-handle'));
    if (!cardEl || !handle) return;

    var isActive = btn.getAttribute('aria-pressed') === 'true';
    var newMode  = isActive ? 'retail' : 'wholesale';

    cardEl.dataset.currentMode = newMode;
    btn.classList.toggle('is-active', newMode === 'wholesale');
    btn.setAttribute('aria-pressed', (newMode === 'wholesale').toString());

    if (newMode === 'retail') {
      _applyCardMode(cardEl, 'retail');
      return;
    }

    /* Wholesale: check cache first */
    var wsValEl = cardEl.querySelector('.xuw-price__ws-val');
    if (wsValEl && wsValEl.getAttribute('data-fetched') === 'true') {
      _applyCardMode(cardEl, 'wholesale');
      return;
    }

    /* Loading state */
    btn.classList.add('is-loading');
    btn.disabled = true;

    fetch('/products/' + encodeURIComponent(handle) + '.js')
      .then(function (r) { return r.json(); })
      .then(function (product) {
        var wsV = null;
        for (var i = 0; i < product.variants.length; i++) {
          if (product.variants[i].title.toLowerCase() === CFG.WS_VARIANT_TITLE) {
            wsV = product.variants[i]; break;
          }
        }
        if (!wsV) {
          /* No wholesale variant — revert */
          cardEl.dataset.currentMode = 'retail';
          btn.classList.remove('is-active');
          btn.setAttribute('aria-pressed', 'false');
          return;
        }
        if (wsValEl) {
          wsValEl.textContent = _formatMoney(wsV.price);
          wsValEl.setAttribute('data-fetched', 'true');
        }
        _applyCardMode(cardEl, 'wholesale');
      })
      .catch(function () {
        cardEl.dataset.currentMode = 'retail';
        btn.classList.remove('is-active');
        btn.setAttribute('aria-pressed', 'false');
      })
      .finally(function () {
        btn.classList.remove('is-loading');
        btn.disabled = false;
      });
  }

  function _applyCardMode(cardEl, mode) {
    var retailZone = cardEl.querySelector('.xuw-price-retail');
    var wsZone     = cardEl.querySelector('.xuw-price-wholesale');
    if (mode === 'wholesale') {
      if (retailZone) retailZone.classList.add('xuw-is-hidden');
      if (wsZone)     wsZone.classList.remove('xuw-is-hidden');
    } else {
      if (retailZone) retailZone.classList.remove('xuw-is-hidden');
      if (wsZone)     wsZone.classList.add('xuw-is-hidden');
    }
  }

  /* ═══════════════════════════════════════════════
     MODAL ATC
  ═══════════════════════════════════════════════ */
  function _handleModalAtc() {
    if (!state.retailVariantId) {
      _toast('info', 'Please select a variant first.');
      return;
    }
    var btn = D.addToCart;
    _cartAdd(state.retailVariantId, state.qty, btn, null);
    _closeModal();
  }

  /* ═══════════════════════════════════════════════
     CART
  ═══════════════════════════════════════════════ */
  function _fetchCartTotal() {
    fetch('/cart.js')
      .then(function (r) { return r.json(); })
      .then(function (cart) { state.cartTotal = (cart.total_price || 0) / 100; })
      .catch(function () {});
  }

  function _cartAdd(variantId, qty, btn, card) {
    if (!variantId) { _toast('error', 'Please select a product option'); return; }
    _atcSetState(btn, 'loading');

    var payload = { id: parseInt(variantId, 10), quantity: qty };
    fetch('/cart/add.js', {
      method  : 'POST',
      headers : { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body    : JSON.stringify(payload)
    })
      .then(function (r) {
        if (r.status === 422) return r.json().then(function (e) { throw { status: 422, msg: e.description || e.message || 'Cannot add' }; });
        if (!r.ok) throw { status: r.status, msg: 'HTTP ' + r.status };
        return r.json();
      })
      .then(function () {
        _atcSetState(btn, 'success');
        _toast('success', '\u2713 Added to cart' + (qty > 1 ? ' (' + qty + ' units)' : '') + '!');
        _refreshCartCount();
        _fetchCartTotal();
        document.dispatchEvent(new CustomEvent('cart:refresh',       { bubbles: true }));
        document.dispatchEvent(new CustomEvent('theme:cart:refresh', { bubbles: true }));
      })
      .catch(function (err) {
        var msg = (err && err.msg) ? err.msg : 'Error adding to cart';
        _atcSetState(btn, 'error');
        _toast('error', msg);
        if (err && err.status === 422 && card) {
          _injectContactBtn(card, variantId, qty);
        }
      });
  }

  function _injectContactBtn(card, variantId, qty) {
    /* Prevent duplicates */
    if (card.querySelector('#xuw-contact-btn')) return;
    var handle = card.getAttribute('data-handle') || '';
    var params = 'ref=stock&product=' + encodeURIComponent(handle) +
                 '&variant=' + encodeURIComponent(variantId || '') +
                 '&qty=' + encodeURIComponent(qty || 1);
    var a = document.createElement('a');
    a.id        = 'xuw-contact-btn';
    a.className = 'xuw-btn--contact';
    a.href      = '/pages/contact?' + params;
    a.textContent = 'Contact Us to Order';
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener');
    var actionsEl = card.querySelector('.xuw-card__body');
    if (actionsEl) actionsEl.appendChild(a);
  }

  function _refreshCartCount() {
    fetch('/cart.js').then(function (r) { return r.json(); }).then(function (cart) {
      var n = cart.item_count;
      ['[data-cart-count]','[data-header-cart-count]','.cart-count','.header__cart-count','.cart-item-count','#CartCount','.js-cart-count'].forEach(function (sel) {
        document.querySelectorAll(sel).forEach(function (el) { el.textContent = n || ''; if (n > 0) el.removeAttribute('hidden'); });
      });
      document.dispatchEvent(new CustomEvent('xuw:cart-updated', { bubbles: true, detail: { item_count: n } }));
    }).catch(function () {});
  }

  /* ═══════════════════════════════════════════════
     MODAL CLOSE
  ═══════════════════════════════════════════════ */
  function _initModalClose() {
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && D.overlay && !D.overlay.classList.contains('xuw-is-hidden')) _closeModal();
    });
  }

  function _closeModal() {
    if (D.overlay) { D.overlay.classList.add('xuw-is-hidden'); D.overlay.setAttribute('aria-hidden', 'true'); }
    if (D.modalContent) D.modalContent.classList.add('xuw-is-hidden');
    if (D.spinner) D.spinner.style.display = 'none';
  }

  /* ═══════════════════════════════════════════════
     SIDEBAR WHOLESALE MODE
  ═══════════════════════════════════════════════ */
  function _sidebarSetMode(mode) {
    state.globalMode = mode;
    document.querySelectorAll('[data-action="set-ws-mode"]').forEach(function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-mode') === mode);
    });
    var note = id('xuwSidebarModeNote');
    if (note) note.textContent = mode === 'wholesale' ? '\u2713 Wholesale mode active — bulk discounts by cart value' : 'Standard retail pricing';
    if (D.sidebarTiers) D.sidebarTiers.style.display = mode === 'wholesale' ? '' : 'none';
  }

  /* ═══════════════════════════════════════════════
     TOAST — V5 multi-type, lazy-mounted stack
  ═══════════════════════════════════════════════ */
  function _getToastRoot() {
    var root = document.getElementById('xuw-toast-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'xuw-toast-root';
      root.setAttribute('aria-live', 'polite');
      root.setAttribute('aria-atomic', 'false');
      document.body.appendChild(root);
    }
    return root;
  }

  function _toast(type, msg) {
    var root = _getToastRoot();
    var t = document.createElement('div');
    t.className = 'xuw-toast xuw-toast--' + (type || 'info');
    t.setAttribute('role', 'status');

    var txt = document.createElement('span');
    txt.textContent = msg;

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'xuw-toast__close';
    closeBtn.setAttribute('data-action', 'close-toast');
    closeBtn.setAttribute('aria-label', 'Dismiss');
    closeBtn.innerHTML = '&times;';

    t.appendChild(txt);
    t.appendChild(closeBtn);
    root.appendChild(t);

    /* Auto-dismiss */
    var delay = type === 'error' ? 5000 : 3200;
    setTimeout(function () { _dismissToast(t); }, delay);
  }

  function _dismissToast(t) {
    if (!t || !t.parentNode) return;
    t.classList.add('xuw-toast--out');
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 350);
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
        if (key === 'tags')          { var tags = (card.getAttribute('data-tags')||'').toLowerCase().split(',').map(function(t){return t.trim();}); if (tags.indexOf(v) !== -1) { matched=true; break; } }
        else if (key === 'product-type') { if ((card.getAttribute('data-product-type')||'').toLowerCase().trim() === v) { matched=true; break; } }
        else if (key === 'vendor')   { if ((card.getAttribute('data-vendor')||'').toLowerCase().trim() === v) { matched=true; break; } }
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
     HELPERS
  ═══════════════════════════════════════════════ */
  function _stripHtml(html) { var d = document.createElement('div'); d.innerHTML = html; return d.textContent || d.innerText || ''; }
  function _highlight(text, q) {
    if (!q) return _esc(text);
    var re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + ')', 'gi');
    return _esc(text).replace(re, '<mark>$1</mark>');
  }
  function _esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  function id(elId) { return document.getElementById(elId); }

})();
