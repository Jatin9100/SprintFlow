// ═══════════════════════════════════════════════════════════════════
//  SHARED MULTI-SELECT FILTER DROPDOWN
//  Used by: Reports (rpt-proj/spr) and Release Reports (rr-proj/spr)
//  Single floating panel, repositioned per trigger button.
//  Zero impact on any existing filter logic — additive only.
// ═══════════════════════════════════════════════════════════════════

const _sfMsDrop = (function(){
  // ── Internal state ──
  let _ctx    = null;  // current context: { items, selected Set, onApply, labelEl, btnEl, searchQuery }
  let _allItems = [];  // full list for current context

  const _panel  = ()=> document.getElementById('sf-msdrop-panel');
  const _list   = ()=> document.getElementById('sf-msdrop-list');
  const _search = ()=> document.getElementById('sf-msdrop-search');

  // ── Open panel anchored to triggerBtn ──
  function open(triggerBtn, items, selectedSet, onApply, labelEl){
    // items: [{id, name, group?}], selectedSet: Set of ids, onApply: fn(Set)
    _ctx = { items, selected: new Set(selectedSet), onApply, labelEl, btnEl: triggerBtn };
    _allItems = items;
    const inp = _search(); if(inp) inp.value = '';
    render('');
    const p = _panel(); if(!p) return;
    p.style.display = 'block';
    _reposition(triggerBtn);
  }

  function _reposition(btn){
    const p = _panel(); if(!p || !btn) return;
    const r = btn.getBoundingClientRect();
    const pw = p.offsetWidth || 240;
    let left = r.left;
    if(left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
    p.style.top  = (r.bottom + 4) + 'px';
    p.style.left = left + 'px';
  }

  function close(){
    const p = _panel(); if(p) p.style.display = 'none';
    _ctx = null;
  }

  function render(q){
    if(!_ctx) return;
    const listEl = _list(); if(!listEl) return;
    const lq = q.toLowerCase();
    const filtered = _allItems.filter(x => !lq || (x.name||'').toLowerCase().includes(lq));

    // Group items by group field if present
    const groups = {};
    filtered.forEach(x => {
      const g = x.group || '';
      if(!groups[g]) groups[g] = [];
      groups[g].push(x);
    });

    const checkSVG = `<svg width="9" height="9" viewBox="0 0 12 12" fill="none"><polyline points="1.5,6 5,9.5 10.5,2.5" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

    let html = '';
    // "All" row
    const allOn = _ctx.selected.size === 0;
    html += `<div class="sf-msdrop-item sf-msdrop-all" onclick="_sfMsDrop.selectAll()">
      <div class="sf-msdrop-check ${allOn?'on':''}">${allOn?checkSVG:''}</div>
      <span>All</span>
    </div>`;

    Object.entries(groups).forEach(([grp, items]) => {
      if(grp) html += `<div style="padding:5px 12px 2px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text-tertiary)">${_escHtml(grp)}</div>`;
      items.forEach(x => {
        const on = _ctx.selected.has(x.id);
        html += `<div class="sf-msdrop-item" onclick="_sfMsDrop.toggle('${String(x.id||'').replace(/'/g,"\\'")}')">
          <div class="sf-msdrop-check ${on?'on':''}">${on?checkSVG:''}</div>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_escHtml(x.name)}</span>
        </div>`;
      });
    });
    if(!filtered.length) html = `<div class="sf-msdrop-item" style="color:var(--text-tertiary);font-style:italic;cursor:default">No matches</div>`;
    listEl.innerHTML = html;
  }

  function toggle(id){
    if(!_ctx) return;
    if(_ctx.selected.has(id)) _ctx.selected.delete(id);
    else _ctx.selected.add(id);
    render(_search()?.value || '');
  }

  function selectAll(){
    if(!_ctx) return;
    _ctx.selected.clear();
    render(_search()?.value || '');
  }

  function search(q){ render(q); }

  function clear(){
    if(!_ctx) return;
    _ctx.selected.clear();
    render(_search()?.value || '');
  }

  function apply(){
    if(!_ctx) return;
    const sel = new Set(_ctx.selected);
    const labelEl = _ctx.labelEl;
    const onApply = _ctx.onApply;
    close();
    if(labelEl) _updateLabel(labelEl, sel, _allItems);
    if(onApply) onApply(sel);
  }

  function _updateLabel(labelEl, sel, items){
    if(sel.size === 0){ labelEl.textContent = labelEl.dataset.allLabel || 'All'; return; }
    if(sel.size === 1){
      const found = items.find(x => x.id === [...sel][0]);
      labelEl.textContent = found ? found.name : '1 selected';
    } else {
      labelEl.textContent = sel.size + ' selected';
    }
  }

  // Close on outside click
  document.addEventListener('mousedown', e => {
    const p = _panel();
    if(!p || p.style.display === 'none') return;
    if(p.contains(e.target)) return;
    if(_ctx && _ctx.btnEl && _ctx.btnEl.contains(e.target)) return;
    apply(); // auto-apply on outside click
  }, true);

  // Close on Escape
  document.addEventListener('keydown', e => {
    if(e.key === 'Escape'){ const p = _panel(); if(p && p.style.display !== 'none') apply(); }
  });

  return { open, close, toggle, selectAll, search, clear, apply };
})();

