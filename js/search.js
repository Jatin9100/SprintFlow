// ─── GLOBAL SEARCH MODULE ────────────────────────────────────────

// ── State ──
let _searchDebounce = null;
const SEARCH_RECENT_KEY = 'sprintflow_recent_searches';
const MAX_RECENT = 5;

// ── Search result cache: avoid re-running identical queries ──
let _lastSearchKey = null;
let _lastSearchHTML = null;

function _getSearchCacheKey(rawQ, filters){
  return rawQ+'|'+JSON.stringify(filters);
}
function _invalidateSearchCache(){ _lastSearchKey=null; _lastSearchHTML=null; }

// ── Recent searches ──
function loadRecentSearches(){
  try{ return JSON.parse(localStorage.getItem(SEARCH_RECENT_KEY)||'[]'); }catch(e){ return []; }
}
function saveRecentSearch(q){
  if(!q||q.length<2)return;
  let recent=loadRecentSearches().filter(r=>r!==q);
  recent.unshift(q);
  recent=recent.slice(0,MAX_RECENT);
  try{ localStorage.setItem(SEARCH_RECENT_KEY,JSON.stringify(recent)); }catch(e){}
}
function clearRecentSearches(){
  try{ localStorage.removeItem(SEARCH_RECENT_KEY); }catch(e){}
  renderRecentSearches();
}


// ── clearSearch() ──
function clearSearch(){
  const inp=document.getElementById('global-search');
  if(inp){ inp.value=''; inp.focus(); }
  const clearBtn=document.getElementById('search-clear-btn');
  if(clearBtn)clearBtn.style.display='none';
  closeSearchDropdown();
}

// ── Close dropdown ──
function closeSearchDropdown(){
  const dd=document.getElementById('search-dropdown');
  if(!dd||dd.style.display==='none') return;
  dd.style.display='none';
}

// ── Open dropdown ──
// Dropdown is position:absolute inside #search-container (position:relative),
// so it anchors automatically — no getBoundingClientRect needed.
function openSearchDropdown(){
  const dd=document.getElementById('search-dropdown');
  if(dd) dd.style.display='flex';
}

// ── Render recent searches ──
function renderRecentSearches(){
  const list=document.getElementById('search-recent-list');
  const panel=document.getElementById('search-recent-panel');
  const recent=loadRecentSearches();
  if(!list||!panel)return;
  if(!recent.length){
    panel.style.display='none';
    return;
  }
  panel.style.display='block';
  list.innerHTML=recent.map(r=>`
    <div style="display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:6px;cursor:pointer;transition:background 0.1s"
      onmouseenter="this.style.background='#f8fafc'" onmouseleave="this.style.background=''"
      onclick="applyRecentSearch('${r.replace(/'/g,"\\'")}')">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" style="flex-shrink:0"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <span style="font-size:13px;color:#475569;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r}</span>
      <button onclick="event.stopPropagation();removeRecentSearch('${r.replace(/'/g,"\\'")}');renderRecentSearches()"
        style="background:none;border:none;cursor:pointer;color:#cbd5e1;padding:0;line-height:1" title="Remove">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`).join('')+
    `<div style="text-align:right;margin-top:4px">
      <button onclick="clearRecentSearches()" style="font-size:11px;color:#94a3b8;background:none;border:none;cursor:pointer;font-family:'DM Sans',sans-serif">Clear all</button>
    </div>`;
}

function applyRecentSearch(q){
  const inp=document.getElementById('global-search');
  if(inp){ inp.value=q; }
  performGlobalSearch(q);
}

function removeRecentSearch(q){
  let recent=loadRecentSearches().filter(r=>r!==q);
  try{ localStorage.setItem(SEARCH_RECENT_KEY,JSON.stringify(recent)); }catch(e){}
}

// ── Main search engine ──
// performGlobalSearch(query) — searches across all entity types by query text
function performGlobalSearch(rawQ){
  const q=(rawQ||'').toLowerCase().trim();
  const hasQuery=q.length>0;

  if(!hasQuery){ closeSearchDropdown(); return; }

  // Check cache — skip full search if nothing changed
  const cacheKey=_getSearchCacheKey(rawQ||'',{});
  if(cacheKey===_lastSearchKey&&_lastSearchHTML!==null){
    openSearchDropdown();
    const rp=document.getElementById('search-recent-panel');
    const sp=document.getElementById('search-results-panel');
    const es=document.getElementById('search-empty-state');
    if(rp)rp.style.display='none';
    if(sp)sp.style.display='block';
    if(es)es.style.display='none';
    const inner=document.getElementById('search-results-inner');
    if(inner) inner.innerHTML=_lastSearchHTML;
    return;
  }

  openSearchDropdown();
  const recentPanel=document.getElementById('search-recent-panel');
  const resultsPanel=document.getElementById('search-results-panel');
  const emptyState=document.getElementById('search-empty-state');
  if(recentPanel)recentPanel.style.display='none';
  if(resultsPanel)resultsPanel.style.display='block';
  if(emptyState)emptyState.style.display='none';

  const results=[];

  // Pre-build a quick assignee name lookup for task search
  const assigneeNameCache=new Map();
  state.users.forEach(u=>assigneeNameCache.set(u.id,(u.name||'').toLowerCase()));

  // ── Tasks ──
  state.tasks.forEach(t=>{
    const assigneeName=assigneeNameCache.get(t.assignee)||'';
    // Display key mirrors the format shown in the UI (openTaskModal, kanban/backlog cards):
    // `${proj.key}-${t.id.slice(-3).toUpperCase()}` — this is what users actually see/copy as the "task ID".
    const _tProj=getProject(t.project);
    const displayKey=_tProj?(_tProj.key+'-'+(t.id||'').slice(-3).toUpperCase()).toLowerCase():'';
    const matchQ=
      (t.title||'').toLowerCase().includes(q)||
      (t.id||'').toLowerCase().includes(q)||
      displayKey.includes(q)||
      (t.descriptionPreview||'').toLowerCase().includes(q)||
      (t.status||'').toLowerCase().includes(q)||
      (t.priority||'').toLowerCase().includes(q)||
      assigneeName.includes(q)||
      (t.tags||[]).some(tag=>(tag||'').toLowerCase().includes(q))||
      (t.subtasks||[]).some(s=>(s.title||'').toLowerCase().includes(q)||(s.status||'').toLowerCase().includes(q)||(s.id||'').toLowerCase().includes(q));
    if(!matchQ)return;
    results.push({type:'task',item:t,score:(t.title||'').toLowerCase().startsWith(q)?2:1});
  });

  // ── Epics ──
  (state.epics||[]).forEach(e=>{
    const matchQ=(e.title||'').toLowerCase().includes(q)||(e.description||'').toLowerCase().includes(q);
    if(!matchQ)return;
    results.push({type:'epic',item:e,score:(e.title||'').toLowerCase().startsWith(q)?2:1});
  });

  // ── Sprints ──
  state.sprints.forEach(s=>{
    const matchQ=(s.name||'').toLowerCase().includes(q)||(s.goal||'').toLowerCase().includes(q);
    if(!matchQ)return;
    results.push({type:'sprint',item:s,score:(s.name||'').toLowerCase().startsWith(q)?2:1});
  });

  // ── Releases ──
  (state.releases||[]).forEach(r=>{
    const matchQ=(r.name||'').toLowerCase().includes(q)||(r.version||'').toLowerCase().includes(q)||(r.releaseNotes||'').toLowerCase().includes(q);
    if(!matchQ)return;
    results.push({type:'release',item:r,score:(r.name||'').toLowerCase().startsWith(q)?2:1});
  });

  // ── Projects ──
  state.projects.forEach(p=>{
    const matchQ=(p.name||'').toLowerCase().includes(q)||(p.key||'').toLowerCase().includes(q)||(p.description||'').toLowerCase().includes(q);
    if(!matchQ)return;
    results.push({type:'project',item:p,score:(p.name||'').toLowerCase().startsWith(q)?2:1});
  });

  // ── Subtasks — scoped via RBAC.getVisibleTasks for project-visibility parity ──
  RBAC.getVisibleTasks(state.tasks).forEach(t=>{
    const _stProj=getProject(t.project);
    const parentDisplayKey=_stProj?(_stProj.key+'-'+(t.id||'').slice(-3).toUpperCase()).toLowerCase():'';
    (t.subtasks||[]).forEach(s=>{
      const parentTitleL=(t.title||'').toLowerCase();
      // Subtask's own display key mirrors what's shown in openSubtaskModal:
      // `${idProj.key}-${s.id.slice(-3).toUpperCase()}`, where idProj falls back
      // to the parent task's project when the subtask has no project of its own.
      const _subProj=s.project?getProject(s.project):null;
      const _idProj=_subProj||_stProj;
      const subDisplayKey=_idProj?(_idProj.key+'-'+(s.id||'').slice(-3).toUpperCase()).toLowerCase():'';
      const matchQ=
        (s.title||'').toLowerCase().includes(q)||
        (s.id||'').toLowerCase().includes(q)||
        subDisplayKey.includes(q)||
        parentTitleL.includes(q)||
        (t.id||'').toLowerCase().includes(q)||
        parentDisplayKey.includes(q);
      if(!matchQ)return;
      results.push({type:'subtask',item:{...s,_parentId:t.id,_parentTitle:t.title,_parentProject:t.project},score:(s.title||'').toLowerCase().startsWith(q)?2:1});
    });
  });

  // Sort: higher score first, then by type priority
  const typePriority={task:0,epic:1,sprint:2,release:3,project:4,subtask:5};
  results.sort((a,b)=>b.score-a.score||(typePriority[a.type]||9)-(typePriority[b.type]||9));

  if(!results.length){
    if(resultsPanel)resultsPanel.style.display='none';
    if(emptyState){
      emptyState.style.display='block';
      const emptyText=document.getElementById('search-empty-text');
      if(emptyText)emptyText.textContent=`No results for "${rawQ||q}"`;
    }
    _lastSearchKey=cacheKey; _lastSearchHTML='';
    return;
  }

  if(emptyState)emptyState.style.display='none';
  if(resultsPanel)resultsPanel.style.display='block';

  // Group by type
  const groups={task:[],epic:[],sprint:[],release:[],project:[],subtask:[]};
  results.forEach(r=>{ if(groups[r.type])groups[r.type].push(r); });

  const groupLabels={task:'Tasks',epic:'Epics',sprint:'Sprints',release:'Releases',project:'Projects',subtask:'Subtasks'};
  const groupIcons={
    task:'<path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2"/>',
    epic:'<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14l3 3 3-3m0-3v6"/>',
    sprint:'<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    release:'<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>',
    project:'<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>',
    subtask:'<path d="M9 20H5a2 2 0 01-2-2V6a2 2 0 012-2h4m4-2h4a2 2 0 012 2v12a2 2 0 01-2 2h-4M9 12h6"/>'
  };

  // Build all HTML at once, then one innerHTML write
  const htmlParts=[];
  const displayQ=rawQ||q;
  ['task','epic','sprint','release','project','subtask'].forEach(type=>{
    const group=groups[type];
    if(!group.length)return;
    const limit=type==='task'?8:4;
    const shown=group.slice(0,limit);
    htmlParts.push(`<div style="margin-bottom:4px">
      <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.6px;padding:6px 8px 3px;display:flex;align-items:center;gap:5px">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${groupIcons[type]}</svg>
        ${groupLabels[type]} <span style="background:#f1f5f9;border-radius:10px;padding:0 5px;font-size:9px;color:#64748b">${group.length}</span>
      </div>
      ${shown.map(({item})=>renderSearchResultItem(type,item,displayQ)).join('')}
      ${group.length>limit?`<div style="padding:4px 8px 6px;font-size:11px;color:#94a3b8;font-style:italic">+${group.length-limit} more…</div>`:''}
    </div>`);
  });

  const finalHTML=htmlParts.join('');
  const inner=document.getElementById('search-results-inner');
  if(inner) inner.innerHTML=finalHTML;

  // Cache the result
  _lastSearchKey=cacheKey;
  _lastSearchHTML=finalHTML;
}

// ── Render a single result item ──
function renderSearchResultItem(type,item,q){
  const hl=s=>highlightMatch(s,q);
  if(type==='task'){
    const proj=getProject(item.project);
    const assignee=getUser(item.assignee);
    return `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;cursor:pointer;transition:background 0.1s"
      onmouseenter="this.style.background='#f8fafc'" onmouseleave="this.style.background=''"
      onclick="closeSearchDropdown();openTaskModal('${item.id}')">
      <span style="color:${typeColor(item.type)};font-size:14px;flex-shrink:0">${typeIcon(item.type)}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:500;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${hl(item.title)}</div>
        <div style="font-size:11px;color:#94a3b8;display:flex;align-items:center;gap:6px;margin-top:1px">
          ${proj?`<span>${_escHtml(proj.key)}</span><span>·</span>`:''}
          <span class="badge badge-${statusBadgeClass(item.status)}" style="font-size:9px;padding:1px 5px">${statusLabel(item.status)}</span>
          <span class="badge badge-${item.priority}" style="font-size:9px;padding:1px 5px">${item.priority}</span>
        </div>
      </div>
      ${assignee?userAvatar(item.assignee,20):''}
    </div>`;
  }
  if(type==='epic'){
    const proj=getProject(item.projectId);
    return `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;cursor:pointer;transition:background 0.1s"
      onmouseenter="this.style.background='#f8fafc'" onmouseleave="this.style.background=''"
      onclick="closeSearchDropdown();openEpicDetailModal('${item.id}')">
      <div style="width:10px;height:10px;border-radius:50%;background:${item.color};flex-shrink:0"></div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:500;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${hl(item.title)}</div>
        <div style="font-size:11px;color:#94a3b8">${proj?_escHtml(proj.name):''} · ${item.status}</div>
      </div>
      <span class="badge badge-epic-${epicStatusBadgeClass(item.status)}" style="font-size:9px;padding:1px 6px;flex-shrink:0">${item.status}</span>
    </div>`;
  }
  if(type==='sprint'){
    const proj=getProject(item.project);
    const tasks=state.tasks.filter(t=>t.sprint===item.id).length;
    return `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;cursor:pointer;transition:background 0.1s"
      onmouseenter="this.style.background='#f8fafc'" onmouseleave="this.style.background=''"
      onclick="closeSearchDropdown();navigate('sprint-planning')">
      <div style="width:8px;height:8px;border-radius:50%;background:${item.status==='active'?'#10b981':'#6366f1'};flex-shrink:0"></div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:500;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${hl(item.name)}</div>
        <div style="font-size:11px;color:#94a3b8">${proj?_escHtml(proj.name):''} · ${tasks} tasks · ${formatDate(item.start)}–${formatDate(item.end)}</div>
      </div>
      <span class="badge badge-${item.status}" style="font-size:9px;padding:1px 6px;flex-shrink:0">${item.status}</span>
    </div>`;
  }
  if(type==='release'){
    const statusColors={'Planned':'#64748b','Ready':'#2563eb','Released':'#16a34a','Rolled Back':'#dc2626'};
    return `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;cursor:pointer;transition:background 0.1s"
      onmouseenter="this.style.background='#f8fafc'" onmouseleave="this.style.background=''"
      onclick="closeSearchDropdown();navigate('releases')">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${statusColors[item.status]||'#64748b'}" stroke-width="2" style="flex-shrink:0"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:500;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${hl(item.name)} <span style="font-family:'DM Mono',monospace;font-size:11px;color:#94a3b8">${hl(item.version)}</span></div>
        <div style="font-size:11px;color:#94a3b8">${item.status} · ${item.taskIds?item.taskIds.length:0} tasks${item.releaseDate?' · '+formatDate(item.releaseDate):''}</div>
      </div>
    </div>`;
  }
  if(type==='project'){
    const tasks=state.tasks.filter(t=>t.project===item.id).length;
    return `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;cursor:pointer;transition:background 0.1s"
      onmouseenter="this.style.background='#f8fafc'" onmouseleave="this.style.background=''"
      onclick="closeSearchDropdown();selectProject('${item.id}');navigate('kanban')">
      <div style="width:28px;height:28px;background:${item.color};border-radius:6px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:700;flex-shrink:0">${_escHtml(item.key)}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:500;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${hl(item.name)}</div>
        <div style="font-size:11px;color:#94a3b8">${hl(item.key)} · ${tasks} tasks · ${item.status}</div>
      </div>
      <span class="badge badge-${item.status}" style="font-size:9px;padding:1px 6px;flex-shrink:0">${item.status}</span>
    </div>`;
  }
  if(type==='subtask'){
    const proj=item._parentProject?getProject(item._parentProject):null;
    const assignee=item.assignee?getUser(item.assignee):null;
    return `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;cursor:pointer;transition:background 0.1s"
      onmouseenter="this.style.background='#f8fafc'" onmouseleave="this.style.background=''"
      onclick="closeSearchDropdown();openSubtaskModal('${item._parentId}','${item.id}')">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a5b4fc" stroke-width="2.5" style="flex-shrink:0"><path d="M9 20H5a2 2 0 01-2-2V6a2 2 0 012-2h4m4-2h4a2 2 0 012 2v12a2 2 0 01-2 2h-4M9 12h6"/></svg>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:500;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${hl(item.title||'—')}</div>
        <div style="font-size:11px;color:#94a3b8;display:flex;align-items:center;gap:6px;margin-top:1px">
          ${proj?`<span>${_escHtml(proj.key)}</span><span>·</span>`:''}
          <span>Parent: ${_escHtml(item._parentTitle||'')}</span>
          ${item.status?`<span>·</span><span class="badge badge-${statusBadgeClass(item.status)}" style="font-size:9px;padding:1px 5px">${statusLabel(item.status)}</span>`:''}
        </div>
      </div>
      ${assignee?userAvatar(item.assignee,20):''}
    </div>`;
  }
  return '';
}

// ── Wire up the search input ──
// Listener Protected: guarded by _sfSearchInputAttached flag
(function(){
  if(window._sfSearchInputAttached) return;
  window._sfSearchInputAttached = true;
  const inp=document.getElementById('global-search');
  const clearBtn=document.getElementById('search-clear-btn');
  if(!inp)return;

  // Cache panel elements at init time
  const recentPanel=document.getElementById('search-recent-panel');
  const resultsPanel=document.getElementById('search-results-panel');
  const emptyStateEl=document.getElementById('search-empty-state');

  inp.addEventListener('input',function(){
    const q=this.value;
    if(clearBtn)clearBtn.style.display=q?'block':'none';
    clearTimeout(_searchDebounce);
    _searchDebounce=setTimeout(()=>{
      const trimmed=q.trim();
      if(!trimmed){
        closeSearchDropdown();
        const recent=loadRecentSearches();
        if(recent.length&&q===''){
          openSearchDropdown();
          if(recentPanel)recentPanel.style.display='block';
          if(resultsPanel)resultsPanel.style.display='none';
          if(emptyStateEl)emptyStateEl.style.display='none';
          renderRecentSearches();
        }
        return;
      }
      if(trimmed.length>=2) saveRecentSearch(trimmed);
      performGlobalSearch(trimmed);
    },180); // v27: tightened from 220ms for snappier feel at scale
  });

  inp.addEventListener('focus',function(){
    const q=this.value.trim();
    if(!q){
      const recent=loadRecentSearches();
      if(recent.length){
        openSearchDropdown();
        if(recentPanel)recentPanel.style.display='block';
        if(resultsPanel)resultsPanel.style.display='none';
        if(emptyStateEl)emptyStateEl.style.display='none';
        renderRecentSearches();
      }
    } else {
      performGlobalSearch(q);
    }
  });

  inp.addEventListener('keydown',function(e){
    if(e.key==='Escape'){
      // Unified handler will fire; just blur and clear locally
      this.value='';
      this.blur();
      const cb=document.getElementById('search-clear-btn');
      if(cb)cb.style.display='none';
      closeSearchDropdown();
    }
  });

  // Close on outside click
  document.addEventListener('click',function(e){
    const container=document.getElementById('search-container');
    if(container&&!container.contains(e.target)){
      closeSearchDropdown();
    }
  });
})();

