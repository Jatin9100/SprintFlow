// ─── MULTI-SELECT WIDGET ──────────────────────────────────────────
// Searchable multi-select with chip display.
// Usage: initMultiSelect(id, [{id,name}], selectedIds, disabled?)
// Read back: _msGetSelected(id)    → [name, ...]   (display / backward-compat)
//            _msGetSelectedIds(id) → [id,   ...]   (persist against task)
const _msState = {};

function initMultiSelect(id, items, selectedIds, disabled){
  const _items = Array.isArray(items) ? items : [];
  // Accept id-arrays or legacy name-arrays for backward compat on load
  const _idSet = new Set();
  if(Array.isArray(selectedIds)){
    selectedIds.forEach(val=>{
      const byId = _items.find(x=>x.id===val);
      if(byId){ _idSet.add(byId.id); return; }
      // Legacy: val is a name — resolve to id
      const byName = _items.find(x=>x.name===val);
      if(byName) _idSet.add(byName.id);
    });
  }
  _msState[id] = {
    items: _items,
    selected: _idSet,   // Set of ids
    disabled: !!disabled
  };
  _msRender(id);
}

function _msRender(id){
  const s = _msState[id];
  if(!s) return;
  const chipsEl = document.getElementById(id+'-chips');
  const dropEl  = document.getElementById(id+'-drop');
  const inputEl = document.getElementById(id+'-input');
  if(!chipsEl) return;

  // Chips — display names, keyed by id
  chipsEl.innerHTML = [...s.selected].map(selId=>{
    const item = s.items.find(x=>x.id===selId);
    if(!item) return '';
    const safeName = item.name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    const safeId   = selId.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    const chipColor = item.color || '';
    const chipStyle = chipColor
      ? `background:${chipColor}22;color:${chipColor};border-color:${chipColor}55`
      : '';
    return `<span class="ms-chip" style="${chipStyle}">${_esc(item.name)}${s.disabled?'':'<button type="button" class="ms-chip-x" tabindex="-1" onmousedown="event.preventDefault();_msRemoveId(\''+id+'\',\''+safeId+'\')">×</button>'}</span>`;
  }).filter(Boolean).join('');

  // Dropdown options — filter by search query
  if(dropEl && inputEl){
    const q = inputEl.value.toLowerCase();
    const filtered = s.items.filter(x => !s.selected.has(x.id) && (!q || x.name.toLowerCase().includes(q)));
    dropEl.innerHTML = filtered.length
      ? filtered.map(x=>{
          const safeId = x.id.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
          return `<div class="ms-opt" onmousedown="event.preventDefault();_msSelectId('${id}','${safeId}')">${_esc(x.name)}</div>`;
        }).join('')
      : `<div class="ms-opt-empty">No matches</div>`;
  }
}

window._msInput   = id => _msRender(id);
window._msFocus   = function(id){
  const dropEl = document.getElementById(id+'-drop');
  if(dropEl) dropEl.style.display='block';
  _msRender(id);
};
window._msBlur    = function(id){
  setTimeout(()=>{
    const dropEl  = document.getElementById(id+'-drop');
    const inputEl = document.getElementById(id+'-input');
    if(dropEl)  dropEl.style.display='none';
    if(inputEl) inputEl.value='';
    _msRender(id);
  }, 180);
};
// Primary: select/remove by id
window._msSelectId = function(id, itemId){
  const s = _msState[id];
  if(!s || s.disabled) return;
  s.selected.add(itemId);
  const inputEl = document.getElementById(id+'-input');
  if(inputEl) inputEl.value='';
  _msRender(id);
};
window._msRemoveId = function(id, itemId){
  const s = _msState[id];
  if(!s || s.disabled) return;
  s.selected.delete(itemId);
  _msRender(id);
};
// Legacy name-based aliases — kept for any external callers
window._msSelectName = function(id, name){
  const s = _msState[id];
  if(!s || s.disabled) return;
  const item = s.items.find(x=>x.name===name);
  if(item) s.selected.add(item.id);
  const inputEl = document.getElementById(id+'-input');
  if(inputEl) inputEl.value='';
  _msRender(id);
};
window._msRemoveName = function(id, name){
  const s = _msState[id];
  if(!s || s.disabled) return;
  const item = s.items.find(x=>x.name===name);
  if(item) s.selected.delete(item.id);
  _msRender(id);
};
// Return selected names — backward-compat display use (kanban, view modal, search, export)
window._msGetSelected = function(id){
  const s = _msState[id];
  if(!s) return [];
  return [...s.selected].map(selId=>{
    const item = s.items.find(x=>x.id===selId);
    return item ? item.name : null;
  }).filter(Boolean);
};
// Return selected ids — use this to persist against task
window._msGetSelectedIds = function(id){
  const s = _msState[id];
  return s ? [...s.selected] : [];
};
// Refresh items when project changes; optionally prune selections no longer valid
window._msRefreshItems = function(id, newItems, pruneInvalid){
  const s = _msState[id];
  if(!s) return;
  s.items = Array.isArray(newItems) ? newItems : [];
  if(pruneInvalid){
    const validIds = new Set(s.items.map(x=>x.id));
    s.selected = new Set([...s.selected].filter(selId=>validIds.has(selId)));
  }
  _msRender(id);
};
// ─────────────────────────────────────────────────────────────────

