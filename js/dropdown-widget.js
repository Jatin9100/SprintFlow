// ─── SHARED SPRINT CUSTOM DROPDOWN ENGINE ────────────────────────
// Powers group-level sprint filter dropdowns on Dashboard, Sprint Planning,
// Release Board, and Retrospectives. Kanban is excluded (single-sprint board).
// No Firebase, RBAC, KPI, or chart logic touched.

// Registry: maps prefix → { wrapId, btnId, labelId, hiddenId, onSelect }
const _sfDropRegistry = {};

function _sfDropRegister(prefix, cfg){
  _sfDropRegistry[prefix] = cfg;
}

function _sfDropGetOrCreate(prefix){
  const dropId = prefix+'-sprint-filter-drop';
  let drop = document.getElementById(dropId);
  if(!drop){
    drop = document.createElement('div');
    drop.id = dropId;
    drop.role = 'listbox';
    drop.style.cssText = 'display:none;position:fixed;min-width:240px;max-width:360px;max-height:calc(100vh - 80px);overflow-y:auto;background:rgba(255,255,255,0.99);border:1px solid rgba(0,0,0,0.09);border-radius:var(--r-lg);box-shadow:0 12px 36px rgba(0,0,0,0.13),0 3px 10px rgba(0,0,0,0.07);z-index:99999;padding:5px 0;backdrop-filter:blur(16px);';
    document.body.appendChild(drop);
  }
  return drop;
}

function _sfDropPosition(prefix){
  const cfg = _sfDropRegistry[prefix];
  if(!cfg) return;
  const btn = document.getElementById(cfg.btnId);
  const drop = _sfDropGetOrCreate(prefix);
  if(!btn||!drop) return;
  const r = btn.getBoundingClientRect();
  drop.style.top = (r.bottom + 5) + 'px';
  const dropW = Math.max(240, r.width);
  let left = r.right - dropW;
  if(left < 8) left = 8;
  if(left + dropW > window.innerWidth - 8) left = window.innerWidth - dropW - 8;
  drop.style.left = left + 'px';
  drop.style.minWidth = Math.max(240, r.width) + 'px';
}

function _sfDropToggle(prefix, e){
  e && e.stopPropagation();
  const cfg = _sfDropRegistry[prefix];
  if(!cfg) return;
  const drop = _sfDropGetOrCreate(prefix);
  const btn = document.getElementById(cfg.btnId);
  const isOpen = drop.style.display === 'block';
  if(isOpen){
    drop.style.display = 'none';
    if(btn) btn.setAttribute('aria-expanded','false');
  } else {
    _sfDropPosition(prefix);
    drop.style.display = 'block';
    if(btn) btn.setAttribute('aria-expanded','true');
  }
}

function _sfDropSelect(prefix, value, label){
  const cfg = _sfDropRegistry[prefix];
  if(!cfg) return;
  const hidden = document.getElementById(cfg.hiddenId);
  const lbl = document.getElementById(cfg.labelId);
  const drop = _sfDropGetOrCreate(prefix);
  const btn = document.getElementById(cfg.btnId);
  if(hidden) hidden.value = value;
  if(lbl) lbl.textContent = label;
  if(drop) drop.style.display = 'none';
  if(btn) btn.setAttribute('aria-expanded','false');
  if(cfg.onSelect) cfg.onSelect(value);
}

// Build and inject HTML into the dropdown panel for a given sprint list.
// groups: array of { groupValue, groupLabel, sprints: [{id,name,...}] }
// noneValue / noneLabel: the "All Sprints" reset option
// FIX: JSON.stringify produces double-quoted strings (e.g. "active-group") which break
// onclick HTML attributes that are themselves wrapped in double quotes, causing the browser
// to terminate the attribute early and silently drop the handler. Use single-quoted JS string
// literals instead, escaping any single quotes and backslashes inside the value.
function _sfAttrStr(val){
  return "'" + String(val).replace(/\\/g,'\\\\').replace(/'/g,"\\'") + "'";
}

function _sfDropBuild(prefix, groups, noneValue, noneLabel){
  const hidden = document.getElementById(_sfDropRegistry[prefix]&&_sfDropRegistry[prefix].hiddenId);
  const cur = (hidden ? hidden.value : null) || noneValue;
  const drop = _sfDropGetOrCreate(prefix);
  let html = `<button class="dsf-item${cur===noneValue?' dsf-active':''}" onclick="_sfDropSelect('${prefix}',${_sfAttrStr(noneValue)},${_sfAttrStr(noneLabel)})">${noneLabel}</button>`;
  let first = true;
  groups.forEach(g=>{
    if(!g.sprints.length) return;
    if(first){ html+=`<div class="dsf-divider"></div>`; first=false; }
    else html+=`<div class="dsf-divider"></div>`;
    const ghActive = cur===g.groupValue;
    html+=`<button class="dsf-group-header${ghActive?' dsf-active':''}" onclick="_sfDropSelect('${prefix}',${_sfAttrStr(g.groupValue)},${_sfAttrStr(g.groupLabel)})">${g.groupLabel}<span class="dsf-gh-badge">${g.sprints.length}</span></button>`;
    html+=g.sprints.map(s=>`<button class="dsf-item${cur===s.id?' dsf-active':''}" style="padding-left:24px" onclick="_sfDropSelect('${prefix}',${_sfAttrStr(s.id)},${_sfAttrStr(s.name)})">${_escHtml(s.name)}</button>`).join('');
  });
  drop.innerHTML = html;
}

// Sync button label to current hidden value from a list of sprints
function _sfDropSyncLabel(prefix, allSprints, noneValue, noneLabel){
  const hidden = document.getElementById(_sfDropRegistry[prefix]&&_sfDropRegistry[prefix].hiddenId);
  const lbl = document.getElementById(_sfDropRegistry[prefix]&&_sfDropRegistry[prefix].labelId);
  if(!hidden||!lbl) return;
  const cur = hidden.value || noneValue;
  if(cur===noneValue) lbl.textContent=noneLabel;
  else if(cur.endsWith('-group')){
    // label is already set by _sfDropSelect or set via cfg
    const groupName = allSprints.__groupLabels && allSprints.__groupLabels[cur];
    if(groupName) lbl.textContent=groupName;
  } else {
    const found = allSprints.find(s=>s.id===cur);
    lbl.textContent = found ? found.name : noneLabel;
  }
}

// Close all open sprint dropdowns when clicking outside
document.addEventListener('click', function(e){
  Object.keys(_sfDropRegistry).forEach(prefix=>{
    const drop = document.getElementById(prefix+'-sprint-filter-drop');
    if(!drop || drop.style.display!=='block') return;
    const wrap = document.getElementById(_sfDropRegistry[prefix].wrapId);
    if((!wrap||!wrap.contains(e.target)) && !drop.contains(e.target)){
      drop.style.display='none';
      const btn=document.getElementById(_sfDropRegistry[prefix].btnId);
      if(btn) btn.setAttribute('aria-expanded','false');
    }
  });
}, true);

// Reposition open dropdowns on resize
window.addEventListener('resize', function(){
  Object.keys(_sfDropRegistry).forEach(prefix=>{
    const drop = document.getElementById(prefix+'-sprint-filter-drop');
    if(drop && drop.style.display==='block') _sfDropPosition(prefix);
  });
});

// ── Register all sprint filter dropdowns ──
// Dashboard
_sfDropRegister('dash',{
  wrapId:'dash-sprint-filter-wrap', btnId:'dash-sprint-filter-btn',
  labelId:'dash-sprint-filter-label', hiddenId:'dash-sprint-filter',
  onSelect: ()=>renderDashboard()
});
// Sprint Planning (registered after DOM ready, onSelect set below)
_sfDropRegister('sp',{
  wrapId:'sp-sprint-filter-wrap', btnId:'sp-sprint-filter-btn',
  labelId:'sp-sprint-filter-label', hiddenId:'sp-sprint-filter',
  onSelect: ()=>_debouncedRenderSprintPlanning()
});
// Release Board
_sfDropRegister('rf',{
  wrapId:'rf-sprint-wrap', btnId:'rf-sprint-btn',
  labelId:'rf-sprint-label', hiddenId:'rf-sprint',
  onSelect: ()=>_debouncedRenderReleaseBoard()
});
// Retrospectives
_sfDropRegister('retro',{
  wrapId:'retro-sprint-filter-wrap', btnId:'retro-sprint-filter-btn',
  labelId:'retro-sprint-filter-label', hiddenId:'retro-sprint-filter',
  onSelect: ()=>renderRetrospectives()
});

