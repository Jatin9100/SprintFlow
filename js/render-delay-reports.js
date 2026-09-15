// ══════════════════════════════════════════════════════════════════
//  DELAY REPORTS — Admin, Senior Manager, Program Manager only
//  Targeted addition: does NOT modify any existing Reports / Release
//  Reports / Epic Reports logic. Reuses existing RBAC scoping
//  (RBAC.getVisibleTasks / getVisibleEpics / getVisibleProjects /
//  getVisibleSprints), existing DONE_STATUSES, existing Start/End/Due
//  Date fields, the shared multi-select dropdown (_sfMsDrop), the shared
//  PDF helpers (_pdfDrawHeader/_pdfDrawFooter/_pdfSectionBand/_pdfKpiCard/
//  _pdfContentArea), and the shared chart registry (`charts{}`) for
//  correctness and consistency with the rest of the app.
//
//  ITEM-TYPE BUCKETING (documented assumption): the data model has no
//  literal 'subtask' or 'epic' value in a `type` field — "Subtask" is
//  structural (nested inside a task's `subtasks[]` array) and "Epic" is
//  a separate `state.epics` array. To match the 4 categories requested
//  (Task / Subtask / Bug / Epic) this page buckets top-level state.tasks
//  items as 'Bug' when type==='bug', else 'Task' (covers 'task' & 'story'),
//  every nested subtask as 'Subtask' regardless of its own type, and every
//  state.epics entry as 'Epic'.
//
//  COMPLETION DATE: see _drStampCompletionDate() (defined near
//  updateTaskStatus) for how `completedDate` is stamped additively at
//  every existing status-mutation site. Items completed BEFORE this
//  feature shipped won't have a completedDate — those are reported as
//  "completion date unknown" (dataState:'unknown') rather than guessed,
//  and are excluded from delayed counts/averages rather than silently
//  assumed on-time or late.
// ══════════════════════════════════════════════════════════════════

const _drSelProjs   = new Set(); // selected project IDs; empty = All
const _drSelSprints = new Set(); // selected sprint IDs;  empty = All
let _drAdvFilters = {epic:'all', assignee:'all', status:'all', priority:'all', type:'all'};

function _drGetProjIds(){   return [..._drSelProjs];   }
function _drGetSprintIds(){ return [..._drSelSprints]; }

// ── Project multi-select dropdown (same shared component/pattern as Reports/Release Reports) ──
function _drToggleProjDrop(e){
  const p = document.getElementById('sf-msdrop-panel');
  if(p && p.style.display !== 'none' && _drToggleProjDrop._open){
    _sfMsDrop.apply(); _drToggleProjDrop._open = false; return;
  }
  const allProj = RBAC.getVisibleProjects();
  const active    = allProj.filter(p => (p.status||'').toLowerCase() === 'active');
  const completed = allProj.filter(p => (p.status||'').toLowerCase() === 'completed');
  const items = [
    ...active.map(p    => ({ id: p.id, name: p.name, group: active.length    ? 'Active'    : '' })),
    ...completed.map(p => ({ id: p.id, name: p.name, group: completed.length ? 'Completed' : '' }))
  ];
  _sfMsDrop.open(
    document.getElementById('dr-proj-btn'),
    items,
    _drSelProjs,
    sel => { _drSelProjs.clear(); sel.forEach(id => _drSelProjs.add(id)); _drOnProjApply(); },
    document.getElementById('dr-proj-label')
  );
  document.getElementById('dr-proj-label').dataset.allLabel = 'All Projects';
  _drToggleProjDrop._open = true;
}
_drToggleProjDrop._open = false;

// ── Sprint multi-select dropdown, scoped by currently-selected projects ──
function _drToggleSprintDrop(e){
  const p = document.getElementById('sf-msdrop-panel');
  if(p && p.style.display !== 'none' && _drToggleSprintDrop._open){
    _sfMsDrop.apply(); _drToggleSprintDrop._open = false; return;
  }
  const selPids = _drGetProjIds();
  let allSpr = RBAC.getVisibleSprints();
  if(selPids.length) allSpr = allSpr.filter(s => selPids.includes(s.project));
  const active    = allSpr.filter(s => (s.status||'').toLowerCase() === 'active');
  const completed = allSpr.filter(s => (s.status||'').toLowerCase() === 'completed');
  const items = [
    ...active.map(s    => ({ id: s.id, name: s.name, group: active.length    ? 'Active'    : '' })),
    ...completed.map(s => ({ id: s.id, name: s.name, group: completed.length ? 'Completed' : '' }))
  ];
  _sfMsDrop.open(
    document.getElementById('dr-spr-btn'),
    items,
    _drSelSprints,
    sel => { _drSelSprints.clear(); sel.forEach(id => _drSelSprints.add(id)); _debouncedRenderDelayReports(); },
    document.getElementById('dr-spr-label')
  );
  document.getElementById('dr-spr-label').dataset.allLabel = 'All Sprints';
  _drToggleSprintDrop._open = true;
}
_drToggleSprintDrop._open = false;

function _drOnProjApply(){
  const selPids = _drGetProjIds();
  if(selPids.length){
    [..._drSelSprints].forEach(sid => {
      const s = RBAC.getVisibleSprints().find(x => x.id === sid);
      if(!s || !selPids.includes(s.project)) _drSelSprints.delete(sid);
    });
    const sprLbl = document.getElementById('dr-spr-label');
    if(sprLbl){
      if(_drSelSprints.size === 0) sprLbl.textContent = 'All Sprints';
      else if(_drSelSprints.size === 1){
        const s = RBAC.getVisibleSprints().find(x => x.id === [..._drSelSprints][0]);
        sprLbl.textContent = s ? s.name : '1 selected';
      } else sprLbl.textContent = _drSelSprints.size + ' selected';
    }
  }
  _debouncedRenderDelayReports();
}

// ── Advanced filters panel (Epic / Assignee / Status / Priority / Item Type) ──
function toggleDrFilterPanel(){
  const p = document.getElementById('dr-adv-filter-panel');
  if(!p) return;
  p.style.display = (p.style.display === 'none' || !p.style.display) ? 'block' : 'none';
}
function _drPopulateAdvFilters(){
  const epicSel = document.getElementById('dr-adv-epic');
  const asgSel  = document.getElementById('dr-adv-assignee');
  if(epicSel){
    const cur = epicSel.value || 'all';
    const epics = RBAC.getVisibleEpics().slice().sort((a,b)=>(a.title||'').localeCompare(b.title||''));
    epicSel.innerHTML = `<option value="all">All Epics</option>` + epics.map(e=>`<option value="${e.id}"${e.id===cur?' selected':''}>${_escHtml(e.title)}</option>`).join('');
    if(cur!=='all' && !epics.some(e=>e.id===cur)) epicSel.value='all';
  }
  if(asgSel){
    const cur = asgSel.value || 'all';
    const users = (state.users||[]).slice().sort((a,b)=>(a.name||'').localeCompare(b.name||''));
    asgSel.innerHTML = `<option value="all">All Assignees</option>` + users.map(u=>`<option value="${u.id}"${u.id===cur?' selected':''}>${_escHtml(u.name||u.email||u.id)}</option>`).join('');
    if(cur!=='all' && !users.some(u=>u.id===cur)) asgSel.value='all';
  }
}
function applyDrAdvFilters(){
  ['status','priority','assignee','type','epic'].forEach(k=>{
    const el = document.getElementById('dr-adv-'+k);
    _drAdvFilters[k] = el ? el.value : 'all';
  });
  toggleDrFilterPanel();
  renderDelayReports();
}
function resetDrAdvFilters(){
  _drAdvFilters = {status:'all',priority:'all',assignee:'all',type:'all',epic:'all'};
  ['status','priority','assignee','type','epic'].forEach(k=>{
    const el = document.getElementById('dr-adv-'+k); if(el) el.value='all';
  });
  renderDelayReports();
}

// ── Date Range filter — applied against each item's resolved Due/End Date ──
let _drDatePreset     = 'all'; // 'all' | '7' | '30' | 'thismonth' | 'lastmonth' | 'custom'
let _drDateRangeStart = null;
let _drDateRangeEnd   = null;
function _drComputeDateRange(){
  const now=new Date(), today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  if(_drDatePreset==='7'){
    _drDateRangeStart=new Date(today); _drDateRangeStart.setDate(today.getDate()-6);
    _drDateRangeEnd=new Date(today); _drDateRangeEnd.setHours(23,59,59,999);
  } else if(_drDatePreset==='30'){
    _drDateRangeStart=new Date(today); _drDateRangeStart.setDate(today.getDate()-29);
    _drDateRangeEnd=new Date(today); _drDateRangeEnd.setHours(23,59,59,999);
  } else if(_drDatePreset==='thismonth'){
    _drDateRangeStart=new Date(now.getFullYear(),now.getMonth(),1);
    _drDateRangeEnd=new Date(now.getFullYear(),now.getMonth()+1,0,23,59,59,999);
  } else if(_drDatePreset==='lastmonth'){
    _drDateRangeStart=new Date(now.getFullYear(),now.getMonth()-1,1);
    _drDateRangeEnd=new Date(now.getFullYear(),now.getMonth(),0,23,59,59,999);
  } else {
    _drDateRangeStart=null; _drDateRangeEnd=null;
  }
}
function _drOnDatePreset(){
  const sel=document.getElementById('dr-date-preset'); if(!sel) return;
  _drDatePreset=sel.value;
  const customRow=document.getElementById('dr-custom-dates');
  if(_drDatePreset==='custom'){
    if(customRow) customRow.style.display='inline-flex';
    _drUpdateDateChip();
    return;
  }
  if(customRow) customRow.style.display='none';
  _drComputeDateRange();
  _drUpdateDateChip();
  _debouncedRenderDelayReports();
}
function _drOnCustomDate(){
  const fromEl=document.getElementById('dr-date-from'), toEl=document.getElementById('dr-date-to');
  if(!fromEl||!toEl) return;
  if(fromEl.value && toEl.value){
    _drDateRangeStart=new Date(fromEl.value+'T00:00:00');
    _drDateRangeEnd=new Date(toEl.value+'T23:59:59');
    _drUpdateDateChip();
    _debouncedRenderDelayReports();
  }
}
function _drUpdateDateChip(){
  const chip=document.getElementById('dr-date-active-chip'), clearBtn=document.getElementById('dr-date-clear-btn');
  if(!chip||!clearBtn) return;
  const labels={'7':'Last 7 Days','30':'Last 30 Days','thismonth':'This Month','lastmonth':'Last Month'};
  if(_drDatePreset==='all'){
    chip.style.display='none'; clearBtn.style.display='none';
  } else if(_drDatePreset==='custom'){
    const fromEl=document.getElementById('dr-date-from'), toEl=document.getElementById('dr-date-to');
    if(fromEl&&toEl&&fromEl.value&&toEl.value){
      chip.innerHTML=`<span class="rr-date-active-chip">📅 ${fromEl.value} → ${toEl.value}</span>`;
      chip.style.display='inline'; clearBtn.style.display='inline';
    } else { chip.style.display='none'; clearBtn.style.display='none'; }
  } else {
    chip.innerHTML=`<span class="rr-date-active-chip">📅 ${labels[_drDatePreset]||''}</span>`;
    chip.style.display='inline'; clearBtn.style.display='inline';
  }
}
function _drClearDateFilter(){
  _drDatePreset='all'; _drDateRangeStart=null; _drDateRangeEnd=null;
  const sel=document.getElementById('dr-date-preset'); if(sel) sel.value='all';
  const customRow=document.getElementById('dr-custom-dates'); if(customRow) customRow.style.display='none';
  const fromEl=document.getElementById('dr-date-from'); if(fromEl) fromEl.value='';
  const toEl=document.getElementById('dr-date-to'); if(toEl) toEl.value='';
  _drUpdateDateChip();
  _debouncedRenderDelayReports();
}

let _drFilterTimer=null;
function _debouncedRenderDelayReports(){
  clearTimeout(_drFilterTimer);
  _drFilterTimer=setTimeout(()=>renderDelayReports(),150);
}

function _drClearAllFilters(){
  _drSelProjs.clear(); _drSelSprints.clear();
  _drAdvFilters={status:'all',priority:'all',assignee:'all',type:'all',epic:'all'};
  const pl=document.getElementById('dr-proj-label'); if(pl) pl.textContent='All Projects';
  const sl=document.getElementById('dr-spr-label'); if(sl) sl.textContent='All Sprints';
  ['status','priority','assignee','type','epic'].forEach(k=>{ const el=document.getElementById('dr-adv-'+k); if(el) el.value='all'; });
  _drClearDateFilter(); // also re-renders
  renderDelayReports();
}

// ── Drill-down: clicking a Project/Epic/Sprint row or chart bar narrows scope ──
function _drDrillProject(projectId){
  _drSelProjs.clear(); _drSelProjs.add(projectId);
  const lbl=document.getElementById('dr-proj-label');
  if(lbl){ const p=getProject(projectId); lbl.textContent = p?p.name:'1 selected'; }
  renderDelayReports();
}
function _drDrillEpic(epicId){
  _drAdvFilters.epic = epicId;
  const el=document.getElementById('dr-adv-epic'); if(el) el.value = epicId;
  renderDelayReports();
}
function _drDrillSprint(sprintId){
  _drSelSprints.clear(); _drSelSprints.add(sprintId);
  const lbl=document.getElementById('dr-spr-label');
  if(lbl){ const s=getSprint(sprintId); lbl.textContent = s?s.name:'1 selected'; }
  renderDelayReports();
}
function _drDrillAssignee(assigneeId){
  _drAdvFilters.assignee = assigneeId;
  const el=document.getElementById('dr-adv-assignee'); if(el) el.value = assigneeId;
  renderDelayReports();
}
// Item-level drill-down: open the existing task/subtask/epic detail modal (full reuse, no new modal built)
function _drOpenItem(kind, id, parentId){
  if(kind==='epic') openEpicDetailModal(id);
  else if(kind==='subtask') openSubtaskModal(parentId, id);
  else openTaskModal(id);
}

// ── Due date resolution per item kind (reuses ONLY existing date fields — no new field introduced for due dates) ──
function _drDueDateStr(item, kind){
  if(kind==='epic') return item.dueDate || null;
  if(kind==='subtask') return item.dueDate || item.endDate || null; // subtasks have their own dueDate; fall back to endDate
  return item.endDate || null; // task/bug — parent tasks only ever carry endDate
}
function _drIsDone(item, kind){
  return kind==='epic' ? item.status === 'Completed' : DONE_STATUSES.includes(item.status);
}

// ── Core delay + TAT calculation for a single item ──────────────────────────
// Returns { isDelayed: true|false|null, delayDays, tatDays, dataState }
//   dataState: 'no-due-date' | 'unknown' (completed but no completedDate on record) | 'done' | 'open'
//   isDelayed is null ONLY for dataState==='unknown' — never guessed.
function _drComputeDelay(item, kind, todayMs){
  const done = _drIsDone(item, kind);

  // ── TARGETED FIX: TAT (Completion Date − Start Date) is independent of Due Date —
  // it must NOT be gated behind a resolvable due date. Compute it up front, once,
  // whenever the item is done and has both a completedDate and a startDate, so the
  // "TAT by Item Type" chart reflects real data even for items that carry no Due/End
  // Date (e.g. parent Tasks/Bugs frequently have no endDate set). ──
  let tatDays = null;
  if(done && item.completedDate && item.startDate){
    const startMs = new Date(item.startDate + 'T00:00:00').getTime();
    if(!isNaN(startMs)) tatDays = Math.max(0, Math.round((item.completedDate - startMs) / 86400000));
  }

  const dueStr = _drDueDateStr(item, kind);
  if(!dueStr) return { isDelayed:false, delayDays:0, tatDays, dataState:'no-due-date' };
  const dueMs = new Date(dueStr+'T23:59:59').getTime();
  if(isNaN(dueMs)) return { isDelayed:false, delayDays:0, tatDays, dataState:'no-due-date' };

  if(done){
    const cd = item.completedDate || null;
    if(!cd) return { isDelayed:null, delayDays:null, tatDays, dataState:'unknown' };
    const isDelayed = cd > dueMs;
    const delayDays = isDelayed ? Math.round((cd - dueMs) / 86400000) : 0;
    return { isDelayed, delayDays, tatDays, dataState:'done' };
  }
  const isDelayed = todayMs > dueMs;
  const delayDays = isDelayed ? Math.round((todayMs - dueMs) / 86400000) : 0;
  return { isDelayed, delayDays, tatDays:null, dataState:'open' };
}

// ── TARGETED UI ENHANCEMENT: reusable "is this item delayed right now?" check ──
// Wraps the SAME _drComputeDelay logic Delay Reports uses, so the definition of
// "delayed" (Due/End Date vs completion / vs today) stays identical everywhere in
// the app. Used by the small blinking red warning dot on Kanban, Sprint Planning
// and Backlog task/subtask cards. Pass the raw task or subtask object directly —
// kind is 'task' for any top-level state.tasks item (task/bug/story — due-date
// resolution is identical for all three) or 'subtask' for a nested subtask.
function _drIsCardDelayed(item, kind){
  if(!item) return false;
  // TARGETED FIX: once a task/subtask is Released, the live "at risk" warning dot
  // must stop showing — even if it was completed after its Due/End Date (that's
  // still correctly reflected as a delay in Delay Reports/TAT, just not as this
  // live on-card warning). Kanban/Backlog/Sprint Planning only want to flag items
  // that are STILL open and overdue, not ones already shipped.
  if(item.status==='released') return false;
  try{ return _drComputeDelay(item, kind, Date.now()).isDelayed === true; }catch(e){ return false; }
}

// ── Central data resolver — single source of truth for render + PDF ─────────
// Flattens Tasks/Bugs (state.tasks), Subtasks (nested), and Epics (state.epics)
// into one uniform "delay item" list, RBAC-scoped via the SAME getters every
// other Reports page uses, then applies the page's own filters on top.
function _getDelayReportsData(){
  const pids = _drGetProjIds();
  const sids = _drGetSprintIds();
  const f = _drAdvFilters;
  const todayMs = Date.now();
  const dateActive = _drDatePreset !== 'all' && _drDateRangeStart && _drDateRangeEnd;

  const visTasks = RBAC.getVisibleTasks(state.tasks);

  const items = [];
  visTasks.forEach(t=>{
    const kind = t.type==='bug' ? 'bug' : 'task';
    items.push({
      kind, id:t.id, parentId:null, title:t.title||'', project:t.project||null, sprint:t.sprint||null,
      epicId:t.epicId||null, assignee:t.assignee||null, priority:t.priority||null, status:t.status||null,
      startDate:t.startDate||null, endDate:t.endDate||null, dueDate:null, completedDate:t.completedDate||null
    });
    (t.subtasks||[]).forEach(st=>{
      items.push({
        kind:'subtask', id:st.id, parentId:t.id, title:st.title||'', project:st.project||t.project||null, sprint:st.sprint||t.sprint||null,
        epicId:t.epicId||null, assignee:st.assignee||null, priority:st.priority||null, status:st.status||null,
        startDate:st.startDate||null, endDate:st.endDate||null, dueDate:st.dueDate||null, completedDate:st.completedDate||null
      });
    });
  });
  RBAC.getVisibleEpics().forEach(e=>{
    const epicProjIds = (e.projectIds && e.projectIds.length) ? e.projectIds : (e.projectId ? [e.projectId] : []);
    items.push({
      kind:'epic', id:e.id, parentId:null, title:e.title||'', project:epicProjIds[0]||null, projectIds:epicProjIds, sprint:null,
      epicId:e.id, assignee:e.ownerId||null, priority:e.priority||null, status:e.status||null,
      startDate:null, endDate:null, dueDate:e.dueDate||null, completedDate:e.completedDate||null
    });
  });

  // Project / Sprint / Epic / Assignee / Priority / Status / Item-Type filters — all layered on top of the RBAC-scoped set above
  let filtered = items.filter(it=>{
    if(pids.length){
      const matchesProj = it.kind==='epic' ? (it.projectIds||[]).some(p=>pids.includes(p)) : pids.includes(it.project);
      if(!matchesProj) return false;
    }
    if(sids.length){
      if(it.kind==='epic') return false; // epics aren't sprint-scoped in this app's data model
      if(!sids.includes(it.sprint)) return false;
    }
    if(f.epic && f.epic!=='all'){
      if(it.kind==='epic'){ if(it.id!==f.epic) return false; }
      else if(it.epicId!==f.epic) return false;
    }
    if(f.assignee && f.assignee!=='all' && it.assignee!==f.assignee) return false;
    if(f.priority && f.priority!=='all' && it.priority!==f.priority) return false;
    if(f.status && f.status!=='all' && it.kind!=='epic' && it.status!==f.status) return false; // epics use a different status vocabulary — not filtered by task status
    if(f.type && f.type!=='all' && it.kind!==f.type) return false;
    return true;
  });

  // Delay/TAT calc, then the Due-Date range filter (resolved per-kind, so it's applied post-calc)
  const computed = filtered.map(it=>{
    const calc = _drComputeDelay(it, it.kind, todayMs);
    const dueDateResolved = _drDueDateStr(it, it.kind);
    return Object.assign({}, it, calc, { dueDateResolved });
  });

  const scoped = dateActive ? computed.filter(it=>{
    if(!it.dueDateResolved) return false;
    const dMs = new Date(it.dueDateResolved + 'T00:00:00').getTime();
    return dMs >= _drDateRangeStart.getTime() && dMs <= _drDateRangeEnd.getTime();
  }) : computed;

  return { items: scoped };
}

// ── KPI computation ──────────────────────────────────────────────────────────
function _drComputeKpis(items){
  const delayed = items.filter(i=>i.isDelayed===true);
  const delayedByKind = k => delayed.filter(i=>i.kind===k).length;
  const totalItems = items.length;
  const pctDelayed = totalItems ? Math.round((delayed.length/totalItems)*1000)/10 : 0;
  const avgDelayDays = delayed.length ? Math.round((delayed.reduce((a,i)=>a+(i.delayDays||0),0)/delayed.length)*10)/10 : 0;
  const tatDelayed = delayed.filter(i=>i.tatDays!=null);
  const avgTatDays = tatDelayed.length ? Math.round((tatDelayed.reduce((a,i)=>a+i.tatDays,0)/tatDelayed.length)*10)/10 : 0;
  return {
    delayedTasks: delayedByKind('task'),
    delayedSubtasks: delayedByKind('subtask'),
    delayedBugs: delayedByKind('bug'),
    delayedEpics: delayedByKind('epic'),
    pctDelayed, avgDelayDays, avgTatDays,
    totalItems, totalDelayed: delayed.length, tatSampleSize: tatDelayed.length
  };
}

const _DR_KIND_LABELS = {task:'Task', subtask:'Subtask', bug:'Bug', epic:'Epic'};
const _DR_KIND_COLORS = {task:'#2563eb', subtask:'#f59e0b', bug:'#dc2626', epic:'#8b5cf6'};

// Destroy-before-recreate helper — same registry/pattern used app-wide via `charts{}` (see _erDestroyChart)
function _drDestroyChart(key){
  if(charts[key]){ try{ charts[key].destroy(); }catch(e){} delete charts[key]; }
}

function _drRenderCharts(items){
  const delayed = items.filter(i=>i.isDelayed===true);

  // 1) Delay trend — monthly buckets (last 6 months incl. current), by resolved Due Date
  _drDestroyChart('drTrendChart');
  const months=[]; const now=new Date();
  for(let i=5;i>=0;i--){
    const d=new Date(now.getFullYear(), now.getMonth()-i, 1);
    months.push({ key: d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'), label: d.toLocaleString('default',{month:'short',year:'2-digit'}) });
  }
  const trendCounts = months.map(m => delayed.filter(i=>i.dueDateResolved && i.dueDateResolved.slice(0,7)===m.key).length);
  const trendCtx=_getCtx('drTrendChart');
  if(trendCtx){
    charts.drTrendChart=new Chart(trendCtx,{
      type:'bar',
      data:{ labels:months.map(m=>m.label), datasets:[{ label:'Delayed Items', data:trendCounts, backgroundColor:'#5b5fc7', borderRadius:4, maxBarThickness:38 }] },
      options:_chartOpts({ plugins:{ legend:{display:false} } })
    });
  }

  // 2) Delay breakdown by item type (doughnut)
  _drDestroyChart('drTypeChart');
  const kinds=['task','subtask','bug','epic'];
  const typeCounts = kinds.map(k=>delayed.filter(i=>i.kind===k).length);
  const typeCtx=_getCtx('drTypeChart');
  if(typeCtx){
    charts.drTypeChart=new Chart(typeCtx,{
      type:'doughnut',
      data:{ labels:kinds.map(k=>_DR_KIND_LABELS[k]), datasets:[{ data:typeCounts, backgroundColor:kinds.map(k=>_DR_KIND_COLORS[k]), borderWidth:0 }] },
      options:{ responsive:true, maintainAspectRatio:false, cutout:'62%',
        plugins:{ legend:{ position:'bottom', labels:{ font:{family:'DM Sans',size:11}, boxWidth:10, boxHeight:10, padding:12, color:'#6b7194' } } } }
    });
  }

  // 3) TAT by item type — average across ALL scoped items with a resolvable TAT (task/subtask/bug only; Epics carry no Start Date in this data model)
  _drDestroyChart('drTatChart');
  const tatKinds=['task','subtask','bug'];
  const tatAvgs = tatKinds.map(k=>{
    const withTat = items.filter(i=>i.kind===k && i.tatDays!=null);
    return withTat.length ? Math.round((withTat.reduce((a,i)=>a+i.tatDays,0)/withTat.length)*10)/10 : 0;
  });
  const tatCtx=_getCtx('drTatChart');
  if(tatCtx){
    charts.drTatChart=new Chart(tatCtx,{
      type:'bar',
      data:{ labels:tatKinds.map(k=>_DR_KIND_LABELS[k]), datasets:[{ label:'Avg TAT (days)', data:tatAvgs, backgroundColor:tatKinds.map(k=>_DR_KIND_COLORS[k]), borderRadius:4, maxBarThickness:44 }] },
      options:_chartOpts({ plugins:{ legend:{display:false} } })
    });
  }

  // 4) Project-wise delay comparison
  _drDestroyChart('drProjectChart');
  const projMap=new Map();
  delayed.forEach(i=>{
    const pidsList = i.kind==='epic' ? (i.projectIds||[]) : [i.project];
    pidsList.filter(Boolean).forEach(pid=>{ projMap.set(pid, (projMap.get(pid)||0)+1); });
  });
  const projRows=[...projMap.entries()].map(([pid,count])=>({ pid, name:(getProject(pid)||{}).name||pid, count })).sort((a,b)=>b.count-a.count);
  const projInner=document.getElementById('drProjectChart-inner');
  if(projInner) projInner.style.height=Math.max(220, projRows.length*36)+'px';
  const projCtx=_getCtx('drProjectChart');
  if(projCtx && projRows.length){
    charts.drProjectChart=new Chart(projCtx,{
      type:'bar',
      data:{ labels:projRows.map(r=>r.name), datasets:[{ label:'Delayed Items', data:projRows.map(r=>r.count), backgroundColor:'#dc2626', borderRadius:4 }] },
      options:_chartOpts({ indexAxis:'y', plugins:{ legend:{display:false} },
        onClick:(evt,els)=>{ if(els && els.length){ _drDrillProject(projRows[els[0].index].pid); } } })
    });
  }

  // 5) Sprint-wise delay comparison
  _drDestroyChart('drSprintChart');
  const sprMap=new Map();
  delayed.filter(i=>i.kind!=='epic' && i.sprint).forEach(i=>{ sprMap.set(i.sprint, (sprMap.get(i.sprint)||0)+1); });
  const sprRows=[...sprMap.entries()].map(([sid,count])=>({ sid, name:(getSprint(sid)||{}).name||sid, count })).sort((a,b)=>b.count-a.count);
  const sprInner=document.getElementById('drSprintChart-inner');
  if(sprInner) sprInner.style.height=Math.max(220, sprRows.length*36)+'px';
  const sprCtx=_getCtx('drSprintChart');
  if(sprCtx && sprRows.length){
    charts.drSprintChart=new Chart(sprCtx,{
      type:'bar',
      data:{ labels:sprRows.map(r=>r.name), datasets:[{ label:'Delayed Items', data:sprRows.map(r=>r.count), backgroundColor:'#f59e0b', borderRadius:4 }] },
      options:_chartOpts({ indexAxis:'y', plugins:{ legend:{display:false} },
        onClick:(evt,els)=>{ if(els && els.length){ _drDrillSprint(sprRows[els[0].index].sid); } } })
    });
  }

  // 6) Epic-wise delay distribution (tasks/subtasks mapped to the epic, plus the epic itself if delayed)
  _drDestroyChart('drEpicChart');
  const epicMap=new Map();
  delayed.forEach(i=>{
    if(i.kind==='epic'){ epicMap.set(i.id, (epicMap.get(i.id)||0)+1); }
    else if(i.epicId){ epicMap.set(i.epicId, (epicMap.get(i.epicId)||0)+1); }
  });
  const epicRows=[...epicMap.entries()].map(([eid,count])=>({ eid, name:(getEpic(eid)||{}).title||eid, count })).sort((a,b)=>b.count-a.count);
  const epicInner=document.getElementById('drEpicChart-inner');
  if(epicInner) epicInner.style.height=Math.max(220, epicRows.length*36)+'px';
  const epicCtx=_getCtx('drEpicChart');
  if(epicCtx && epicRows.length){
    charts.drEpicChart=new Chart(epicCtx,{
      type:'bar',
      data:{ labels:epicRows.map(r=>r.name.length>20?r.name.slice(0,19)+'…':r.name), datasets:[{ label:'Delayed Items', data:epicRows.map(r=>r.count), backgroundColor:'#8b5cf6', borderRadius:4 }] },
      options:_chartOpts({ indexAxis:'y', plugins:{ legend:{display:false} },
        onClick:(evt,els)=>{ if(els && els.length){ _drDrillEpic(epicRows[els[0].index].eid); } } })
    });
  }

  // 7) Assignee-wise delayed Tasks & Subtasks — stacked horizontal bar, one row per assignee
  _drDestroyChart('drAssigneeChart');
  const asgMap=new Map(); // assigneeId -> {task, subtask}
  delayed.filter(i=>i.kind==='task' && i.assignee).forEach(i=>{
    if(!asgMap.has(i.assignee)) asgMap.set(i.assignee,{task:0,subtask:0});
    asgMap.get(i.assignee).task++;
  });
  delayed.filter(i=>i.kind==='subtask' && i.assignee).forEach(i=>{
    if(!asgMap.has(i.assignee)) asgMap.set(i.assignee,{task:0,subtask:0});
    asgMap.get(i.assignee).subtask++;
  });
  const asgRows=[...asgMap.entries()]
    .map(([aid,r])=>({ aid, name:(getUser(aid)||{}).name||aid, task:r.task, subtask:r.subtask, total:r.task+r.subtask }))
    .sort((a,b)=>b.total-a.total);
  const asgInner=document.getElementById('drAssigneeChart-inner');
  if(asgInner) asgInner.style.height=Math.max(220, asgRows.length*36)+'px';
  const asgCtx=_getCtx('drAssigneeChart');
  if(asgCtx && asgRows.length){
    charts.drAssigneeChart=new Chart(asgCtx,{
      type:'bar',
      data:{ labels:asgRows.map(r=>r.name), datasets:[
        { label:'Delayed Tasks', data:asgRows.map(r=>r.task), backgroundColor:_DR_KIND_COLORS.task, borderRadius:4, stack:'dr-asg' },
        { label:'Delayed Subtasks', data:asgRows.map(r=>r.subtask), backgroundColor:_DR_KIND_COLORS.subtask, borderRadius:4, stack:'dr-asg' }
      ] },
      options:_chartOpts({ indexAxis:'y',
        scales:{ x:{ stacked:true, grid:{display:false}, border:{display:false}, ticks:{font:{family:'DM Sans',size:11},color:'#9399b0',padding:6} },
                 y:{ stacked:true, grid:{color:'rgba(0,0,0,0.04)',lineWidth:1}, border:{display:false}, ticks:{font:{family:'DM Sans',size:11},color:'#9399b0',padding:8} } },
        plugins:{ legend:{ position:'top', labels:{ font:{family:'DM Sans',size:11}, boxWidth:10, boxHeight:10, padding:14, color:'#6b7194' } } },
        onClick:(evt,els)=>{ if(els && els.length){ _drDrillAssignee(asgRows[els[0].index].aid); } } })
    });
  }
}

function _drRenderTables(items){
  const delayed = items.filter(i=>i.isDelayed===true);

  // ── By Project ──
  const projMap=new Map();
  items.forEach(i=>{
    const pidsList = i.kind==='epic' ? (i.projectIds||[]) : [i.project];
    pidsList.filter(Boolean).forEach(pid=>{
      if(!projMap.has(pid)) projMap.set(pid,{total:0,delayed:0,delaySum:0});
      const r=projMap.get(pid); r.total++;
      if(i.isDelayed===true){ r.delayed++; r.delaySum+=(i.delayDays||0); }
    });
  });
  const projTbody=document.getElementById('dr-project-tbody');
  if(projTbody){
    const rows=[...projMap.entries()].map(([pid,r])=>({ pid, name:(getProject(pid)||{}).name||pid, ...r })).sort((a,b)=>b.delayed-a.delayed);
    projTbody.innerHTML = rows.length ? rows.map(r=>`
      <tr style="cursor:pointer;border-bottom:1px solid rgba(0,0,0,0.04)" onclick="_drDrillProject('${r.pid}')" title="Drill into ${_escHtml(r.name)}">
        <td style="padding:9px 14px">${_escHtml(r.name)}</td>
        <td style="padding:9px 14px;text-align:right">${r.total}</td>
        <td style="padding:9px 14px;text-align:right;font-weight:700;color:${r.delayed?'#dc2626':'inherit'}">${r.delayed}</td>
        <td style="padding:9px 14px;text-align:right">${r.total?Math.round((r.delayed/r.total)*100):0}%</td>
        <td style="padding:9px 14px;text-align:right">${r.delayed?Math.round((r.delaySum/r.delayed)*10)/10:0}</td>
      </tr>`).join('') : `<tr><td colspan="5" style="padding:14px;text-align:center;color:#94a3b8">No data</td></tr>`;
  }

  // ── By Epic ──
  const epicMap=new Map();
  items.forEach(i=>{
    const eid = i.kind==='epic' ? i.id : i.epicId;
    if(!eid) return;
    if(!epicMap.has(eid)) epicMap.set(eid,{total:0,delayed:0,delaySum:0});
    const r=epicMap.get(eid); r.total++;
    if(i.isDelayed===true){ r.delayed++; r.delaySum+=(i.delayDays||0); }
  });
  const epicTbody=document.getElementById('dr-epic-tbody');
  if(epicTbody){
    const rows=[...epicMap.entries()].map(([eid,r])=>({ eid, name:(getEpic(eid)||{}).title||eid, ...r })).sort((a,b)=>b.delayed-a.delayed);
    epicTbody.innerHTML = rows.length ? rows.map(r=>`
      <tr style="cursor:pointer;border-bottom:1px solid rgba(0,0,0,0.04)" onclick="_drDrillEpic('${r.eid}')" title="Drill into ${_escHtml(r.name)}">
        <td style="padding:9px 14px">${_escHtml(r.name)}</td>
        <td style="padding:9px 14px;text-align:right">${r.total}</td>
        <td style="padding:9px 14px;text-align:right;font-weight:700;color:${r.delayed?'#dc2626':'inherit'}">${r.delayed}</td>
        <td style="padding:9px 14px;text-align:right">${r.delayed?Math.round((r.delaySum/r.delayed)*10)/10:0}</td>
      </tr>`).join('') : `<tr><td colspan="4" style="padding:14px;text-align:center;color:#94a3b8">No data</td></tr>`;
  }

  // ── By Sprint ──
  const sprMap=new Map();
  items.filter(i=>i.kind!=='epic' && i.sprint).forEach(i=>{
    if(!sprMap.has(i.sprint)) sprMap.set(i.sprint,{total:0,delayed:0,delaySum:0});
    const r=sprMap.get(i.sprint); r.total++;
    if(i.isDelayed===true){ r.delayed++; r.delaySum+=(i.delayDays||0); }
  });
  const sprTbody=document.getElementById('dr-sprint-tbody');
  if(sprTbody){
    const rows=[...sprMap.entries()].map(([sid,r])=>({ sid, name:(getSprint(sid)||{}).name||sid, proj:(getProject((getSprint(sid)||{}).project)||{}).name||'—', ...r })).sort((a,b)=>b.delayed-a.delayed);
    sprTbody.innerHTML = rows.length ? rows.map(r=>`
      <tr style="cursor:pointer;border-bottom:1px solid rgba(0,0,0,0.04)" onclick="_drDrillSprint('${r.sid}')" title="Drill into ${_escHtml(r.name)}">
        <td style="padding:9px 14px">${_escHtml(r.name)}</td>
        <td style="padding:9px 14px">${_escHtml(r.proj)}</td>
        <td style="padding:9px 14px;text-align:right">${r.total}</td>
        <td style="padding:9px 14px;text-align:right;font-weight:700;color:${r.delayed?'#dc2626':'inherit'}">${r.delayed}</td>
        <td style="padding:9px 14px;text-align:right">${r.delayed?Math.round((r.delaySum/r.delayed)*10)/10:0}</td>
      </tr>`).join('') : `<tr><td colspan="5" style="padding:14px;text-align:center;color:#94a3b8">No data</td></tr>`;
  }

  // ── By Assignee (Tasks & Subtasks only, per spec) ──
  const asgTblMap=new Map(); // assigneeId -> {task, subtask, delayedTask, delayedSubtask, delaySum, delayedCount}
  items.filter(i=>i.kind==='task' || i.kind==='subtask').forEach(i=>{
    if(!i.assignee) return;
    if(!asgTblMap.has(i.assignee)) asgTblMap.set(i.assignee,{delayedTask:0,delayedSubtask:0,delaySum:0,delayedCount:0});
    const r=asgTblMap.get(i.assignee);
    if(i.isDelayed===true){
      if(i.kind==='task') r.delayedTask++; else r.delayedSubtask++;
      r.delaySum+=(i.delayDays||0); r.delayedCount++;
    }
  });
  const asgTbody=document.getElementById('dr-assignee-tbody');
  if(asgTbody){
    const rows=[...asgTblMap.entries()]
      .map(([aid,r])=>({ aid, name:(getUser(aid)||{}).name||aid, ...r, total:r.delayedTask+r.delayedSubtask }))
      .filter(r=>r.total>0)
      .sort((a,b)=>b.total-a.total);
    asgTbody.innerHTML = rows.length ? rows.map(r=>`
      <tr style="cursor:pointer;border-bottom:1px solid rgba(0,0,0,0.04)" onclick="_drDrillAssignee('${r.aid}')" title="Drill into ${_escHtml(r.name)}">
        <td style="padding:9px 14px">${_escHtml(r.name)}</td>
        <td style="padding:9px 14px;text-align:right;font-weight:700;color:${r.delayedTask?'#2563eb':'inherit'}">${r.delayedTask}</td>
        <td style="padding:9px 14px;text-align:right;font-weight:700;color:${r.delayedSubtask?'#d97706':'inherit'}">${r.delayedSubtask}</td>
        <td style="padding:9px 14px;text-align:right;font-weight:700;color:#dc2626">${r.total}</td>
        <td style="padding:9px 14px;text-align:right">${r.delayedCount?Math.round((r.delaySum/r.delayedCount)*10)/10:0}</td>
      </tr>`).join('') : `<tr><td colspan="5" style="padding:14px;text-align:center;color:#94a3b8">No delayed Tasks/Subtasks for the selected filters</td></tr>`;
  }

  // ── Delayed Items (item level) ──
  const itemTbody=document.getElementById('dr-item-tbody');
  const itemCountEl=document.getElementById('dr-item-count');
  if(itemTbody){
    const rows = delayed.slice().sort((a,b)=>(b.delayDays||0)-(a.delayDays||0));
    const CAP=500;
    const shown = rows.slice(0,CAP);
    if(itemCountEl) itemCountEl.textContent = rows.length>CAP ? `Showing ${CAP} of ${rows.length} delayed items` : `${rows.length} delayed item${rows.length===1?'':'s'}`;
    itemTbody.innerHTML = shown.length ? shown.map(i=>{
      const projName=(getProject(i.kind==='epic'?(i.projectIds||[])[0]:i.project)||{}).name||'—';
      const sprName = i.kind==='epic' ? '—' : ((getSprint(i.sprint)||{}).name||'—');
      const epicName = i.kind==='epic' ? '—' : (i.epicId ? ((getEpic(i.epicId)||{}).title||'—') : '—');
      const asgName = (getUser(i.assignee)||{}).name || '—';
      const statusLbl = i.kind==='epic' ? (i.status||'—') : statusLabel(i.status);
      return `<tr style="cursor:pointer;border-bottom:1px solid rgba(0,0,0,0.04)" onclick="_drOpenItem('${i.kind}','${i.id}'${i.parentId?`,'${i.parentId}'`:''})" title="Open details">
        <td style="padding:8px 12px"><span class="badge" style="background:${_DR_KIND_COLORS[i.kind]}22;color:${_DR_KIND_COLORS[i.kind]};font-weight:700">${_DR_KIND_LABELS[i.kind]}</span></td>
        <td style="padding:8px 12px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_escHtml(i.title||'')}</td>
        <td style="padding:8px 12px">${_escHtml(projName)}</td>
        <td style="padding:8px 12px">${_escHtml(epicName)}</td>
        <td style="padding:8px 12px">${_escHtml(sprName)}</td>
        <td style="padding:8px 12px">${_escHtml(asgName)}</td>
        <td style="padding:8px 12px">${i.dueDateResolved||'—'}</td>
        <td style="padding:8px 12px">${_escHtml(statusLbl||'—')}</td>
        <td style="padding:8px 12px;text-align:right;font-weight:700;color:#dc2626">${i.delayDays==null?'—':i.delayDays}</td>
        <td style="padding:8px 12px;text-align:right">${i.tatDays==null?'—':i.tatDays}</td>
      </tr>`;
    }).join('') : `<tr><td colspan="10" style="padding:14px;text-align:center;color:#94a3b8">No delayed items for the selected filters</td></tr>`;
  }
}

// ── Main render ───────────────────────────────────────────────────────────
function renderDelayReports(){
  _drPopulateAdvFilters();

  const subEl = document.getElementById('dr-scope-subtitle');
  if(subEl){
    subEl.textContent = (RBAC.isAdmin()||RBAC.isSeniorManager())
      ? 'Delay & TAT analysis across Tasks, Subtasks, Bugs and Epics — All Projects'
      : 'Delay & TAT analysis across Tasks, Subtasks, Bugs and Epics — Your Projects Only';
  }

  const { items } = _getDelayReportsData();
  const kpis = _drComputeKpis(items);

  const setText=(id,val)=>{ const el=document.getElementById(id); if(el) el.textContent=val; };
  setText('dr-kpi-tasks', kpis.delayedTasks);
  setText('dr-kpi-subtasks', kpis.delayedSubtasks);
  setText('dr-kpi-bugs', kpis.delayedBugs);
  setText('dr-kpi-epics', kpis.delayedEpics);
  setText('dr-kpi-pct', kpis.pctDelayed + '%');
  setText('dr-kpi-avgdelay', kpis.avgDelayDays + (kpis.avgDelayDays===1?' day':' days'));
  setText('dr-kpi-avgtat', kpis.tatSampleSize ? (kpis.avgTatDays + (kpis.avgTatDays===1?' day':' days')) : '—');

  const emptyEl = document.getElementById('dr-empty-state');
  const contentEl = document.getElementById('dr-content');
  if(!items.length){
    if(emptyEl) emptyEl.style.display='block';
    if(contentEl) contentEl.style.display='none';
    ['drTrendChart','drTypeChart','drTatChart','drProjectChart','drSprintChart','drEpicChart','drAssigneeChart'].forEach(_drDestroyChart);
    return;
  }
  if(emptyEl) emptyEl.style.display='none';
  if(contentEl) contentEl.style.display='block';

  _drRenderCharts(items);
  _drRenderTables(items);
}

// ── Export PDF — reuses the same shared jsPDF + AutoTable helpers as Epic/Release Reports ──
function _drGetFilterSummary(){
  const parts=[];
  const pids=_drGetProjIds(), sids=_drGetSprintIds();
  if(pids.length) parts.push('Projects: '+pids.map(id=>(getProject(id)||{}).name||id).join(', '));
  if(sids.length) parts.push('Sprints: '+sids.map(id=>(getSprint(id)||{}).name||id).join(', '));
  const f=_drAdvFilters;
  if(f.epic && f.epic!=='all') parts.push('Epic: '+((getEpic(f.epic)||{}).title||f.epic));
  if(f.assignee && f.assignee!=='all') parts.push('Assignee: '+((getUser(f.assignee)||{}).name||f.assignee));
  if(f.status && f.status!=='all') parts.push('Status: '+f.status);
  if(f.priority && f.priority!=='all') parts.push('Priority: '+f.priority);
  if(f.type && f.type!=='all') parts.push('Type: '+f.type);
  if(_drDatePreset!=='all') parts.push('Due Date Range: '+(_drDatePreset==='custom'?'Custom':_drDatePreset+' days'));
  return parts.length ? parts.join(' | ') : 'None';
}

function exportDelayReportsPDF(){
  if(typeof window.jspdf === 'undefined'){ showNotif('PDF library not loaded','error'); return; }
  const { jsPDF } = window.jspdf;
  const { items } = _getDelayReportsData();
  if(!items.length){ showNotif('No data to export for the selected filters','error'); return; }
  const delayed = items.filter(i=>i.isDelayed===true);
  const kpis = _drComputeKpis(items);

  const doc = new jsPDF({ orientation:'landscape', unit:'pt', format:'a4' });
  const now = new Date();
  const meta = {
    date: now.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}),
    user: (state.currentUser && (state.currentUser.name||state.currentUser.email)) || '',
    filters: _drGetFilterSummary()
  };
  _pdfDrawHeader(doc, meta, 'Delay Reports');
  const ca=_pdfContentArea(doc);
  let y = ca.y + 8;
  doc.setFontSize(13); doc.setFont('helvetica','bold'); doc.setTextColor(...PDF_TEXT_DARK);
  doc.text('Delay & TAT Summary', ca.x, y); y += 16;

  const kpiDefs=[
    ['Delayed Tasks', String(kpis.delayedTasks), [37,99,235]],
    ['Delayed Subtasks', String(kpis.delayedSubtasks), [245,158,11]],
    ['Delayed Bugs', String(kpis.delayedBugs), [220,38,38]],
    ['Delayed Epics', String(kpis.delayedEpics), [139,92,246]],
    ['% Delayed', kpis.pctDelayed+'%', [91,95,199]],
    ['Avg Delay (days)', String(kpis.avgDelayDays), [220,38,38]],
    ['Avg TAT (days)', kpis.tatSampleSize?String(kpis.avgTatDays):'—', [14,165,233]]
  ];
  const cardW=(ca.w-6*(kpiDefs.length-1))/kpiDefs.length, cardH=54;
  kpiDefs.forEach((k,idx)=>{ _pdfKpiCard(doc, ca.x+idx*(cardW+6), y, cardW, cardH, k[0], k[1], '', k[2]); });
  y += cardH+22;

  y = _pdfSectionBand(doc, 'Delayed Items ('+delayed.length+')', y);
  if(typeof doc.autoTable === 'function'){
    doc.autoTable({
      startY: y,
      margin: { left:PDF_MARGIN, right:PDF_MARGIN },
      head: [['Type','Title','Project','Epic','Sprint','Assignee','Due Date','Status','Delay (d)','TAT (d)']],
      body: delayed.slice(0,1000).map(i=>[
        _DR_KIND_LABELS[i.kind],
        i.title||'',
        (getProject(i.kind==='epic'?(i.projectIds||[])[0]:i.project)||{}).name||'—',
        i.kind==='epic' ? '—' : (i.epicId ? ((getEpic(i.epicId)||{}).title||'—') : '—'),
        i.kind==='epic' ? '—' : ((getSprint(i.sprint)||{}).name||'—'),
        (getUser(i.assignee)||{}).name||'—',
        i.dueDateResolved||'—',
        i.kind==='epic' ? (i.status||'—') : statusLabel(i.status),
        i.delayDays==null?'—':i.delayDays,
        i.tatDays==null?'—':i.tatDays
      ]),
      headStyles:{ fillColor:PDF_ACCENT, textColor:255, fontSize:8, fontStyle:'bold' },
      bodyStyles:{ fontSize:7.5, textColor:PDF_TEXT_MID },
      alternateRowStyles:{ fillColor:[249,250,252] },
      didDrawPage: function(){ _pdfDrawHeader(doc, meta, 'Delay Reports'); }
    });
  }
  const totalPages = doc.internal.getNumberOfPages();
  for(let p=1;p<=totalPages;p++){ doc.setPage(p); _pdfDrawFooter(doc, p, totalPages, delayed.length); }
  const d=new Date(), pad=n=>String(n).padStart(2,'0');
  doc.save(`SprintFlow-DelayReports-${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}.pdf`);
  showNotif('Delay Reports PDF exported ✓');
}

