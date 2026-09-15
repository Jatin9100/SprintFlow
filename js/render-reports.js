// ─── REPORTS ──────────────────────────────────────────────────────
// ─── REPORTS ANALYTICS v2 ─────────────────────────────────────────
let _rptProdSort = 'completed';
function setSortProd(col){ _rptProdSort=col; document.getElementById('rpt-prod-sort').value=col; renderProductivityTable(); }

// ── Advanced filter state (applied on Apply click) ──
let _rptAdvFilters = {status:'all',priority:'all',assignee:'all',type:'all',epic:'all',release:'all'};
// ── Pending state (in-panel, not yet applied) ──
let _rptAdvPending = {};

function toggleRptFilterPanel(){
  const panel=document.getElementById('rpt-adv-filter-panel');
  if(!panel)return;
  const isOpen=panel.style.display!=='none';
  if(isOpen){
    panel.style.display='none';
  } else {
    _rptPopulateAdvFilterDropdowns();
    // Sync panel selects with currently applied filters
    ['status','priority','assignee','type','epic','release'].forEach(k=>{
      const el=document.getElementById('rpt-adv-'+k);
      if(el) el.value=_rptAdvFilters[k]||'all';
    });
    panel.style.display='block';
  }
}

// Close panel on outside click — delegated once, no duplication
// Listener Protected: guarded by _sfRptPanelClickAttached flag
if(!window._sfRptPanelClickAttached){
  window._sfRptPanelClickAttached = true;
  document.addEventListener('click',function(e){
    const panel=document.getElementById('rpt-adv-filter-panel');
    const btn=document.getElementById('rpt-filter-btn-wrap');
    if(panel&&panel.style.display!=='none'&&btn&&!btn.contains(e.target)){
      panel.style.display='none';
    }
  },true);
}
// NOTE: ESC for this panel is handled by the unified keydown handler below (search for _globalKeydownHandler)

function _rptPopulateAdvFilterDropdowns(){
  // Assignees
  const assigneeSel=document.getElementById('rpt-adv-assignee');
  if(assigneeSel){
    const prev=assigneeSel.value;
    const sortedAssignees=state.users.slice().sort((a,b)=>(a.name||'').localeCompare(b.name||''));
    assigneeSel.innerHTML=`<option value="all">All Assignees</option>`+
      sortedAssignees.map(u=>`<option value="${u.id}"${u.id===prev?' selected':''}>${u.name}</option>`).join('');
  }
  // Epics
  const epicSel=document.getElementById('rpt-adv-epic');
  if(epicSel){
    const prev=epicSel.value;
    epicSel.innerHTML=`<option value="all">All Epics</option>`+
      (state.epics||[]).map(e=>`<option value="${e.id}"${e.id===prev?' selected':''}>${e.title}</option>`).join('');
  }
  // Releases
  const relSel=document.getElementById('rpt-adv-release');
  if(relSel){
    const prev=relSel.value;
    relSel.innerHTML=`<option value="all">All Releases</option>`+
      (state.releases||[]).map(r=>`<option value="${r.id}"${r.id===prev?' selected':''}>${r.name}</option>`).join('');
  }
}

function applyRptAdvFilters(){
  ['status','priority','assignee','type','epic','release'].forEach(k=>{
    const el=document.getElementById('rpt-adv-'+k);
    _rptAdvFilters[k]=el?el.value:'all';
  });
  document.getElementById('rpt-adv-filter-panel').style.display='none';
  _rptUpdateActiveBadge();
  _rptUpdateActiveChips();
  _debouncedRenderReports(); // v27: debounced
}

function resetRptAdvFilters(){
  _rptAdvFilters={status:'all',priority:'all',assignee:'all',type:'all',epic:'all',release:'all'};
  ['status','priority','assignee','type','epic','release'].forEach(k=>{
    const el=document.getElementById('rpt-adv-'+k);
    if(el) el.value='all';
  });
  document.getElementById('rpt-adv-filter-panel').style.display='none';
  _rptUpdateActiveBadge();
  _rptUpdateActiveChips();
  _debouncedRenderReports(); // v27: debounced
}

function removeRptAdvFilter(key){
  _rptAdvFilters[key]='all';
  _rptUpdateActiveBadge();
  _rptUpdateActiveChips();
  _debouncedRenderReports(); // v27: debounced
}

function _rptActiveFilterCount(){
  let count=0;
  if(_rptSelProjs.size)   count++;
  if(_rptSelSprints.size) count++;
  Object.values(_rptAdvFilters).forEach(v=>{ if(v&&v!=='all') count++; });
  return count;
}

function _rptUpdateActiveBadge(){
  const badge=document.getElementById('rpt-active-badge');
  if(!badge)return;
  const count=Object.values(_rptAdvFilters).filter(v=>v&&v!=='all').length;
  if(count>0){
    badge.textContent=count;
    badge.classList.add('visible');
  } else {
    badge.classList.remove('visible');
  }
}

function _rptUpdateActiveChips(){
  const container=document.getElementById('rpt-active-chips');
  if(!container)return;
  const labels={
    status:'Status',priority:'Priority',assignee:'Assignee',
    type:'Type',epic:'Epic',release:'Release'
  };
  const activeEntries=Object.entries(_rptAdvFilters).filter(([k,v])=>v&&v!=='all');
  if(!activeEntries.length){container.style.display='none';return;}
  container.style.display='flex';
  container.innerHTML=activeEntries.map(([k,v])=>{
    // Get human-readable label
    let displayVal=v;
    if(k==='assignee'){const u=state.users.find(u=>u.id===v);displayVal=u?u.name:v;}
    if(k==='epic'){const e=(state.epics||[]).find(e=>e.id===v);displayVal=e?e.title:v;}
    if(k==='release'){const r=(state.releases||[]).find(r=>r.id===v);displayVal=r?r.name:v;}
    return `<span class="rpt-filter-chip" onclick="removeRptAdvFilter('${k}')">
      ${labels[k]}: ${displayVal}<span class="chip-x">×</span>
    </span>`;
  }).join('');
}

// ── CENTRALIZED: filteredReportsData ──
// All reports widgets MUST consume this — never raw state arrays.
function _getFilteredReportsData(){
  const pids=_rptGetProjIds();   // [] = All, else array of selected project IDs
  const sids=_rptGetSprintIds(); // [] = All, else array of selected sprint IDs
  const f=_rptAdvFilters;

  let tasks=RBAC.getVisibleTasks(state.tasks);
  // project filter
  if(pids.length) tasks=tasks.filter(t=>pids.includes(t.project));
  // sprint filter
  if(sids.length) tasks=tasks.filter(t=>sids.includes(t.sprint));
  // status
  if(f.status&&f.status!=='all') tasks=tasks.filter(t=>t.status===f.status);
  // priority
  if(f.priority&&f.priority!=='all') tasks=tasks.filter(t=>t.priority===f.priority);
  // assignee
  if(f.assignee&&f.assignee!=='all') tasks=tasks.filter(t=>t.assignee===f.assignee);
  // type
  if(f.type&&f.type!=='all') tasks=tasks.filter(t=>t.type===f.type);
  // epic
  if(f.epic&&f.epic!=='all') tasks=tasks.filter(t=>t.epicId===f.epic);
  // release
  if(f.release&&f.release!=='all'){
    const rel=(state.releases||[]).find(r=>r.id===f.release);
    const relTaskIds=rel?(rel.taskIds||[]):[];
    tasks=tasks.filter(t=>relTaskIds.includes(t.id));
  }

  let sprints=RBAC.getVisibleSprints();
  if(pids.length) sprints=sprints.filter(s=>pids.includes(s.project));
  if(sids.length) sprints=sprints.filter(s=>sids.includes(s.id));

  let epics=RBAC.getVisibleEpics();
  if(pids.length) epics=epics.filter(e=>{
    const epicProjects=e.projectIds||(e.projectId?[e.projectId]:[]);
    return epicProjects.some(pid=>pids.includes(pid));
  });
  if(f.epic&&f.epic!=='all') epics=epics.filter(e=>e.id===f.epic);

  let projects=RBAC.getVisibleProjects();
  if(pids.length) projects=projects.filter(p=>pids.includes(p.id));

  let releases=RBAC.getVisibleReleases();
  if(pids.length) releases=releases.filter(r=>pids.includes(r.projectId));
  if(f.release&&f.release!=='all') releases=releases.filter(r=>r.id===f.release);
  const filteredTaskIds=new Set(tasks.map(t=>t.id));

  return {tasks,sprints,epics,projects,releases,filteredTaskIds};
}

// Legacy helpers kept for backward compatibility — now delegate to centralized filter
function _rptFilteredTasks(tasks){
  // Not used directly in renderReports anymore, kept for renderProductivityTable compatibility
  const pids=_rptGetProjIds();
  const sids=_rptGetSprintIds();
  const f=_rptAdvFilters;
  let filtered=tasks;
  if(pids.length) filtered=filtered.filter(t=>pids.includes(t.project));
  if(sids.length) filtered=filtered.filter(t=>sids.includes(t.sprint));
  if(f.status&&f.status!=='all') filtered=filtered.filter(t=>t.status===f.status);
  if(f.priority&&f.priority!=='all') filtered=filtered.filter(t=>t.priority===f.priority);
  if(f.assignee&&f.assignee!=='all') filtered=filtered.filter(t=>t.assignee===f.assignee);
  if(f.type&&f.type!=='all') filtered=filtered.filter(t=>t.type===f.type);
  if(f.epic&&f.epic!=='all') filtered=filtered.filter(t=>t.epicId===f.epic);
  if(f.release&&f.release!=='all'){
    const rel=(state.releases||[]).find(r=>r.id===f.release);
    const relTaskIds=rel?(rel.taskIds||[]):[];
    filtered=filtered.filter(t=>relTaskIds.includes(t.id));
  }
  return filtered;
}

function _rptFilteredSprints(sprints){
  const pids=_rptGetProjIds();
  const sids=_rptGetSprintIds();
  let filtered=sprints;
  if(pids.length) filtered=filtered.filter(s=>pids.includes(s.project));
  if(sids.length) filtered=filtered.filter(s=>sids.includes(s.id));
  return filtered;
}

function _rptHealthDot(id,color,label){
  const colors={green:'#10b981',yellow:'#f59e0b',red:'#ef4444'};
  const dot=document.getElementById('hd-'+id);
  const lbl=document.getElementById('hd-'+id+'-lbl');
  if(dot)dot.style.background=colors[color]||'#e2e8f0';
  if(lbl)lbl.textContent=label;
}

// ────────────────────────────────────────────────────────────────────

function renderProductivityTable(){
  try{
  // Read sort value directly from dropdown so onchange works without setSortProd
  const sortSel=document.getElementById('rpt-prod-sort');
  if(sortSel&&sortSel.value) _rptProdSort=sortSel.value;
  const _rt=_rptFilteredTasks(RBAC.getVisibleTasks(state.tasks));
  const tbody=document.getElementById('rpt-prod-tbody');
  if(!tbody)return;
  // ── Derive member list from project membership, NOT from task assignment ──
  // This ensures members with 0 tasks still appear when they belong to the selected project.
  const _pids=_rptGetProjIds();
  const _visibleProjects=RBAC.getVisibleProjects();
  // Determine the scoped project set (selected projects or all visible)
  const _scopedProjects=_pids.length
    ? _visibleProjects.filter(p=>_pids.includes(p.id))
    : _visibleProjects;
  // Collect all unique memberIds from the scoped projects
  const _memberIdSet=new Set();
  _scopedProjects.forEach(p=>{(p.memberIds||[]).forEach(id=>_memberIdSet.add(id));});
  // Map to user objects; fall back to all visible users when no membership data exists.
  // FIX: was referencing an undefined `_prodProjFilter` variable in this branch, throwing a
  // ReferenceError (caught silently by the outer try/catch) and leaving the table stale/blank
  // whenever the scoped project set had no memberIds set.
  const _prodUsers=_memberIdSet.size>0
    ? state.users.filter(u=>_memberIdSet.has(u.id))
    : state.users;
  // Build a lookup: userId → array of project names (from all visible projects, not just scoped)
  const _userProjMap=new Map();
  _visibleProjects.forEach(p=>{(p.memberIds||[]).forEach(uid=>{
    if(!_userProjMap.has(uid)) _userProjMap.set(uid,[]);
    _userProjMap.get(uid).push(p.name);
  });});
  const rows=_prodUsers.map(u=>{
    // Collect all tasks assigned to this member (as assignee OR QA assignee)
    const assignedTasks=_rt.filter(t=>_qaItemBelongsTo(t,u.id));
    // Collect all subtasks assigned to this member (across all tasks)
    const assignedSubs=_rt.flatMap(t=>t.subtasks||[]).filter(s=>_qaItemBelongsTo(s,u.id));
    // Combined assigned items
    const assignedItems=[...assignedTasks,...assignedSubs];
    const completed=assignedItems.filter(i=>DONE_STATUSES.includes(i.status)).length;
    const active=assignedItems.filter(i=>!DONE_STATUSES.includes(i.status)).length;
    // Points: use QA split logic
    const points=assignedItems.filter(i=>DONE_STATUSES.includes(i.status)).reduce((a,i)=>a+_qaPointsFor(i,u.id),0);
    const totalPts=assignedItems.filter(i=>!DONE_STATUSES.includes(i.status)).reduce((a,i)=>a+_qaPointsFor(i,u.id),0);
    const assignedPts=assignedItems.reduce((a,i)=>a+_qaPointsFor(i,u.id),0);
    const reopen=assignedTasks.filter(t=>t.status==='reopen').length;
    const pct=assignedItems.length?Math.round((completed/assignedItems.length)*100):0;
    const memberProjects=_userProjMap.get(u.id)||[];
    return {u,completed,active,points,assignedPts,totalPts,reopen,pct,total:assignedItems.length,memberProjects};
  });
  const sortFn={completed:(a,b)=>b.completed-a.completed,active:(a,b)=>b.active-a.active,points:(a,b)=>b.points-a.points,reopen:(a,b)=>b.reopen-a.reopen,workload:(a,b)=>b.totalPts-a.totalPts,name:(a,b)=>a.u.name.localeCompare(b.u.name)};
  rows.sort(sortFn[_rptProdSort]||sortFn.completed);
  const maxPts=Math.max(1,...rows.map(r=>r.totalPts));
  tbody.innerHTML=rows.map(r=>{
    const projCell=r.memberProjects.length===0
      ? `<span style="color:#94a3b8;font-size:12px">—</span>`
      : r.memberProjects.length===1
        ? `<span style="font-size:12px;color:#475569">${r.memberProjects[0]}</span>`
        : `<span title="${r.memberProjects.join(', ')}" style="display:inline-flex;align-items:center;gap:4px;font-size:12px;color:#475569;cursor:default"><span style="background:rgba(99,102,241,0.1);color:#6366f1;font-weight:600;font-size:11px;padding:1px 6px;border-radius:4px">${r.memberProjects.length}</span><span style="color:#94a3b8">${r.memberProjects.slice(0,2).join(', ')}${r.memberProjects.length>2?'…':''}</span></span>`;
    return `<tr style="border-bottom:1px solid rgba(0,0,0,0.04)">
    <td style="padding:10px 12px"><div style="display:flex;align-items:center;gap:8px">${userAvatar(r.u.id,28)}<span style="font-weight:600;color:#1e293b">${r.u.name}</span></div></td>
    <td style="padding:10px 12px">${projCell}</td>
    <td style="padding:10px 12px;text-align:right;font-weight:700;color:#10b981">${r.completed}</td>
    <td style="padding:10px 12px;text-align:right;font-weight:600;color:#2563eb">${r.active}</td>
    <td style="padding:10px 12px;text-align:right;font-weight:700;color:#6366f1">${_fmtPts(r.points)}<span style="font-size:11px;font-weight:400;color:#94a3b8"> pts</span></td>
    <td style="padding:10px 12px;text-align:right;font-weight:600;color:#475569">${_fmtPts(r.assignedPts)}<span style="font-size:11px;font-weight:400;color:#94a3b8"> pts</span></td>
    <td style="padding:10px 12px;text-align:right;font-weight:${r.reopen>0?'700':'400'};color:${r.reopen>0?'#ef4444':'#64748b'}">${r.reopen}</td>
    <td style="padding:10px 12px;min-width:120px"><div style="display:flex;align-items:center;gap:8px">
      <div style="flex:1;height:6px;background:rgba(0,0,0,0.07);border-radius:3px;overflow:hidden"><div style="height:100%;border-radius:3px;background:${r.u.color};width:${maxPts?Math.round((r.totalPts/maxPts)*100):0}%;transition:width 0.4s"></div></div>
      <span style="font-size:11px;font-weight:600;color:#64748b;white-space:nowrap">${_fmtPts(r.totalPts)}sp</span>
    </div></td>
  </tr>`;}).join('')||`<tr><td colspan="8" style="padding:24px;text-align:center;color:#94a3b8;font-size:13px">No team members</td></tr>`;
  }catch(e){console.warn('[Render] renderProductivityTable error:',e);}
}

function renderReports(){
  if(document.hidden) return; // tab hidden — skip chart/report rendering; visibilitychange will refresh on return
  try{
  // Update scope subtitle based on role
  const subEl = document.getElementById('reports-scope-subtitle');
  if(subEl){
    if(RBAC.isAdmin()||RBAC.isSeniorManager()) subEl.textContent = 'Project health, team productivity & release insights — All Projects';
    else subEl.textContent = 'Project health, team productivity & release insights — Your Projects Only';
  }
  // ── Sync badge & chips with current applied filters ──
  _rptUpdateActiveBadge();
  _rptUpdateActiveChips();

  // ── ALL data flows through centralized filteredReportsData ──
  const fd=_getFilteredReportsData();
  const _rt=fd.tasks;
  const _rs=fd.sprints;
  const _re=fd.epics;
  const _rp=fd.projects;
  const _rl=fd.releases;

  // ── reportItems: parent tasks + subtasks for report calculations ──
  // Subtasks inherit project/sprint/epic from parent so all filter dimensions work correctly.
  const reportSubs=(_rt||[]).flatMap(t=>(t.subtasks||[]).map(st=>({
    ...st,
    parentTaskId:t.id,
    project:st.project||t.project,
    sprint:st.sprint||t.sprint,
    epicId:st.epicId||t.epicId
  })));
  const reportItems=[...(_rt||[]),...reportSubs];

  // ── KPI: row 1 ──
  // FIX: Sprint Completion / Active Sprints / Velocity / Burndown / Sprint Health were all
  // hardcoded to status==='active' sprints only, which ignored an explicit sprint selection —
  // picking any non-active (e.g. completed) sprint in the filter made this whole section show
  // 0/blank even though that sprint has real data (while other cards like Released Tasks, which
  // read straight from _rs, correctly reflected the selection). When the user has explicitly
  // picked sprint(s), honor that selection as-is; only default to active-only when viewing
  // "All Sprints" so the page doesn't clutter with every historical completed sprint.
  const _rsScoped=_rptGetSprintIds().length?_rs:_rs.filter(s=>(s.status||'').toLowerCase()==='active');
  const activeSprints=_rsScoped;
  // ── Spillover-aware sprint work stats ──
  // For a COMPLETED sprint, _executeSprintCompletion() (render-sprint-planning.js) reassigns
  // every unfinished item away to another sprint/backlog, so a live `_rt.filter(t=>t.sprint
  // ===s.id)` query only finds the items that stayed linked — i.e. only the DONE ones. Without
  // adding back the persisted spillover snapshot (spilloverTasks/spilloverSubtasks/
  // spilloverPoints/committedPoints — same snapshot the Spillover chart and Release Reports
  // already reuse), a completed sprint would always read as 100% done with committed===
  // completed, which is wrong whenever it actually had spillover. Legacy completed sprints
  // without the snapshot (predating this feature) fall back to the plain live-query numbers,
  // same as before.
  function _rsSprintWorkStats(s){
    const liveTasks=_rt.filter(t=>t.sprint===s.id);
    const liveSubs=liveTasks.flatMap(t=>t.subtasks||[]);
    const doneCount=liveTasks.filter(t=>DONE_STATUSES.includes(t.status)).length
                    +liveSubs.filter(st=>DONE_STATUSES.includes(st.status)).length;
    const donePts=liveTasks.filter(t=>DONE_STATUSES.includes(t.status)).reduce((a,t)=>a+(t.points||0),0)
                 +liveSubs.filter(st=>DONE_STATUSES.includes(st.status)).reduce((a,st)=>a+(st.points||0),0);
    const hasSnapshot=s.status==='completed'&&(s.spilloverTasks!==undefined||s.spilloverSubtasks!==undefined);
    if(hasSnapshot){
      const spillCount=(s.spilloverTasks||0)+(s.spilloverSubtasks||0);
      const totalCount=doneCount+spillCount;
      const totalPts=(s.committedPoints!=null&&s.committedPoints>0)?s.committedPoints:(donePts+(s.spilloverPoints||0));
      return {totalCount,doneCount,totalPts,donePts};
    }
    const totalCount=liveTasks.length+liveSubs.length;
    const totalPts=liveTasks.reduce((a,t)=>a+(t.points||0),0)+liveSubs.reduce((a,st)=>a+(st.points||0),0);
    return {totalCount,doneCount,totalPts,donePts};
  }
  // Open Tasks: tasks + subtasks where status === 'open'
  const openTasks=reportItems.filter(item=>item.status==='open').length;
  // CHANGE 3 FIX: Released Tasks must count ONLY status==='released' (not ready-for-prod).
  // reportItems includes both parent tasks and subtasks, so both are counted.
  const releasedTasks=reportItems.filter(item=>item.status==='released').length;
  // CHANGE 4 FIX: Open Bugs — include bug-type parent tasks AND bug-type subtasks
  const openBugs=reportItems.filter(item=>item.type==='bug'&&!DONE_STATUSES.includes(item.status)).length;
  // CHANGE 2: Open Subtasks — subtasks where status is not a final/released state
  const openSubtasks=reportSubs.filter(st=>st.status!=='released'&&!DONE_STATUSES.includes(st.status)).length;
  const setEl=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
  setEl('rpt-kpi-projects',_rp.length);
  setEl('rpt-kpi-projects-sub',`${_rp.filter(p=>p.status==='active').length} active`);
  setEl('rpt-kpi-sprints',activeSprints.length);
  setEl('rpt-kpi-sprints-sub',activeSprints.length?`${activeSprints.length} currently running`:'No active sprints');
  (function(){
    const listEl=document.getElementById('rpt-sprints-info-pop-list');
    if(!listEl)return;
    listEl.innerHTML=activeSprints.length
      ?activeSprints.map(s=>`<div class="stat-info-pop-item">${_escHtml(s.name)}</div>`).join('')
      :`<div class="stat-info-pop-item">No active sprints</div>`;
  })();
  setEl('rpt-kpi-open',openTasks);
  setEl('rpt-kpi-open-sub',`${reportItems.filter(item=>item.status==='dev-in-progress').length} in dev`);
  setEl('rpt-kpi-released',releasedTasks);
  setEl('rpt-kpi-released-sub',reportItems.length?`${Math.round((releasedTasks/reportItems.length)*100)}% of total`:'—');
  setEl('rpt-kpi-bugs',openBugs);
  // FIX: "critical" subtitle must be scoped to OPEN bugs only, same as the main count above —
  // it was previously counting critical bugs of any status (including released/done), which
  // could show a higher "N critical" than the "Open Bugs" total itself.
  setEl('rpt-kpi-bugs-sub',`${reportItems.filter(item=>item.type==='bug'&&item.priority==='critical'&&!DONE_STATUSES.includes(item.status)).length} critical`);
  // CHANGE 2: Wire Open Subtasks card
  setEl('rpt-kpi-open-subtasks',openSubtasks);
  setEl('rpt-kpi-open-subtasks-sub','In progress backlog');

  // ── KPI: row 2 ──
  // Sprint completion — spillover-aware via _rsSprintWorkStats (see definition above)
  const _sprintStats=activeSprints.map(_rsSprintWorkStats);
  const sprintTotalWithSubs=_sprintStats.reduce((a,x)=>a+x.totalCount,0);
  const sprintDone=_sprintStats.reduce((a,x)=>a+x.doneCount,0);
  const sprintComp=sprintTotalWithSubs?Math.round((sprintDone/sprintTotalWithSubs)*100):0;
  setEl('rpt-kpi-sprint-comp',sprintComp+'%');
  const scBar=document.getElementById('rpt-kpi-sprint-comp-bar');if(scBar)scBar.style.width=sprintComp+'%';

  const relTasks=_rl.flatMap(r=>r.taskIds||[]).map(id=>_rt.find(t=>t.id===id)).filter(Boolean);
  const relDone=relTasks.filter(t=>t&&DONE_STATUSES.includes(t.status)).length;
  const relReady=relTasks.length?Math.round((relDone/relTasks.length)*100):0;
  // NOTE: Release Readiness card removed (CHANGE 1). Calculation variables retained for downstream use (health dots, etc).

  // ── QA REOPEN RATE ─────────────────────────────────────────────
  // Definition: items that entered QA (in-qa / qa-in-progress) and then
  // came back to a development stage (open / dev-in-progress / dev-completed).
  // qaReopenCount is incremented by _trackQAReopen() each time this happens.
  // Denominator = all items that have ever reached a QA stage or beyond.
  const _QA_AND_BEYOND = new Set(['in-qa','qa-in-progress','reopen','on-hold','pending-with-client','ready-for-prod','released']);
  const qaEverTouched = reportItems.filter(item =>
    _QA_AND_BEYOND.has(item.status) || item._hasEnteredQA || (item.qaReopenCount||0) > 0
  );
  const qaReopenedItems = reportItems.filter(item => (item.qaReopenCount||0) > 0);
  const reopenCount = qaReopenedItems.length;
  const totalReopenEvents = reportItems.reduce((sum, item) => sum + (item.qaReopenCount||0), 0);
  const qaTotal = qaEverTouched.length;
  const reopenRate = qaTotal ? Math.round((reopenCount / qaTotal) * 100) : 0;
  setEl('rpt-kpi-reopen', reopenRate + '%');
  setEl('rpt-kpi-reopen-sub', `${reopenCount} item${reopenCount!==1?'s':''} (${totalReopenEvents} reopen event${totalReopenEvents!==1?'s':''})`);

  const avgPts=reportItems.length?Math.round(reportItems.reduce((a,item)=>a+(item.points||0),0)/reportItems.length*10)/10:0;
  setEl('rpt-kpi-avg-time',avgPts);
  setEl('rpt-kpi-avg-time-sub','avg story points / task');

  // ── HEALTH INDICATORS ──
  _rptHealthDot('sprint', sprintComp>=70?'green':sprintComp>=40?'yellow':'red', sprintComp+'% done');
  _rptHealthDot('qa', reopenRate<=10?'green':reopenRate<=25?'yellow':'red', reopenRate+'% reopen rate');
  const relBlockers=_rl.filter(r=>!r.releaseNotes||!r.taskIds||!r.taskIds.length).length;
  _rptHealthDot('release', relBlockers===0?'green':relBlockers<=2?'yellow':'red', relBlockers+' blocker'+(relBlockers!==1?'s':''));
  const _userLoadArr=(state.users||[]).map(u=>reportItems.filter(item=>_qaItemBelongsTo(item,u.id)).reduce((a,item)=>a+_qaPointsFor(item,u.id),0));
  const maxLoad=_userLoadArr.length?Math.max(1,..._userLoadArr):1;
  const minLoad=_userLoadArr.length?Math.min(..._userLoadArr):0;
  const imbalance=(state.users||[]).length>1?Math.round(((maxLoad-minLoad)/maxLoad)*100):0;
  _rptHealthDot('capacity', imbalance<=30?'green':imbalance<=60?'yellow':'red', imbalance+'% imbalance');

  // ── Destroy existing report charts before recreating (prevents duplicate instances) ──
  // v27-fix: always destroy+recreate — fingerprint+early-return caused blank charts on
  // filter changes and page revisits due to stale/detached canvas contexts.
  ['velocity','burndown','spillover','workload','typeChart','projDist','sprintHealth','themeTask','themeSp','epicCompletion','epicWorkload','epicVelocity','productBifurcation','tagBifurcation','deliveryRisk'].forEach(k=>{
    if(charts[k]){try{charts[k].destroy();}catch(e){}delete charts[k];}
  });

  // ── VELOCITY TREND ──
  // Uses _rsScoped (defined above): the explicitly-selected sprint(s) when the user has picked
  // one, else active-only. _rs (all filtered sprints, unscoped) is preserved unchanged for
  // Spillover which needs it.
  const _rsActive=_rsScoped;
  const sprintLabels=_rsActive.map(s=>(s.name||'').length>14?s.name.slice(0,13)+'…':(s.name||''));
  // Spillover-aware via _rsSprintWorkStats — for a completed sprint, "committed" is the
  // pre-spillover total (done + spilled) and "completed" is just the done points, instead of
  // both collapsing to whatever's still live-linked to the sprint.
  const _velocityStats=_rsActive.map(_rsSprintWorkStats);
  const committed=_velocityStats.map(x=>x.totalPts);
  const completedPts=_velocityStats.map(x=>x.donePts);
  const vCtx=_getCtx('velocityChart');
  if(vCtx){
    const _vOpts=_chartOpts();
    // Datalabels: only on Completed bars — placed above bar, clear of bar top
    _vOpts.plugins.datalabels={
      display:ctx=>ctx.datasetIndex===1&&ctx.dataset.data[ctx.dataIndex]>0,
      anchor:'end',align:'end',offset:3,clamp:true,clip:false,
      color:'#6b7194',font:{size:10,weight:'600'},formatter:v=>v
    };
    // Legend at bottom: frees chart-top space entirely
    _vOpts.plugins.legend={position:'bottom',labels:{font:{family:'DM Sans',size:11},boxWidth:10,boxHeight:10,padding:16,color:'#6b7194'}};
    // Top padding gives bars room to breathe above; grace expands y-max so labels never clip
    _vOpts.layout={padding:{top:28,right:8,bottom:4,left:4}};
    _vOpts.scales.y=Object.assign(_vOpts.scales.y||{},{beginAtZero:true,grace:'12%',ticks:{font:{family:'DM Sans',size:11},color:'#9399b0',padding:8}});
    _vOpts.scales.x=Object.assign(_vOpts.scales.x||{},{ticks:{font:{family:'DM Sans',size:11},color:'#9399b0',padding:6,maxRotation:30,minRotation:0}});
    // UI scroll: expand canvas width with sprint count so x-axis labels never compress
    const _vIn=document.getElementById('velocityChart-inner');
    if(_vIn){const _w=(_vIn.parentElement&&_vIn.parentElement.clientWidth)||600;_vIn.style.width=Math.max(_w,(sprintLabels.length||1)*72)+'px';}
  charts.velocity=new Chart(vCtx,{
    type:'bar',
    data:{
      labels:sprintLabels.length?sprintLabels:['No Sprints'],
      datasets:[
        {label:'Committed',data:committed.length?committed:[0],backgroundColor:'rgba(99,102,241,0.15)',borderColor:'#6366f1',borderWidth:2,borderRadius:4},
        {label:'Completed',data:completedPts.length?completedPts:[0],backgroundColor:'rgba(99,102,241,0.75)',borderRadius:4}
      ]
    },
    options:_vOpts
  });
  }

  // ── BURNDOWN ──
  // Uses the same _rsActive scope and spillover-aware _velocityStats computed above, so a
  // completed sprint's burndown reflects its true committed total (done + spilled), not just
  // whatever's still live-linked.
  const totalPts=_velocityStats.reduce((a,x)=>a+x.totalPts,0);
  const donePts=_velocityStats.reduce((a,x)=>a+x.donePts,0);
  const bCtx=_getCtx('burndownChart');
  if(bCtx){
    const _bOpts=_chartOpts();
    // Datalabels: Actual line only — non-null, non-zero values; offset above point
    _bOpts.plugins.datalabels={
      display:ctx=>{
        if(ctx.datasetIndex!==1) return false; // Ideal line: no labels
        const v=ctx.dataset.data[ctx.dataIndex];
        return v!=null&&v>0;
      },
      align:'top',anchor:'end',offset:8,clamp:true,clip:false,
      color:'#6366f1',font:{size:10,weight:'600'},formatter:v=>v,
      backgroundColor:'rgba(255,255,255,0.82)',borderRadius:4,padding:{top:2,bottom:2,left:4,right:4}
    };
    // Legend at bottom: prevents overlap with high-value data points at chart top
    _bOpts.plugins.legend={position:'bottom',labels:{font:{family:'DM Sans',size:11},boxWidth:10,boxHeight:10,padding:16,color:'#6b7194'}};
    // Top padding ensures labels on high points are never clipped; grace expands y headroom
    _bOpts.layout={padding:{top:28,right:12,bottom:4,left:4}};
    _bOpts.scales.y=Object.assign(_bOpts.scales.y||{},{beginAtZero:true,grace:'10%',ticks:{font:{family:'DM Sans',size:11},color:'#9399b0',padding:8}});
    _bOpts.scales.x=Object.assign(_bOpts.scales.x||{},{ticks:{font:{family:'DM Sans',size:11},color:'#9399b0',padding:6}});
    charts.burndown=new Chart(bCtx,{
    type:'line',
    data:{
      labels:['Day 1','Day 3','Day 5','Day 7','Day 9','Day 11','Day 14'],
      datasets:[
        {label:'Ideal',data:[totalPts,Math.round(totalPts*.77),Math.round(totalPts*.57),Math.round(totalPts*.43),Math.round(totalPts*.29),Math.round(totalPts*.14),0],borderColor:'#cbd5e1',borderDash:[5,5],borderWidth:2,tension:0,pointRadius:0},
        {label:'Actual',data:[totalPts,null,Math.max(0,totalPts-donePts),null,null,null,null],borderColor:'#6366f1',backgroundColor:'rgba(99,102,241,0.06)',fill:true,borderWidth:2.5,tension:0.3,pointRadius:4,pointBackgroundColor:'#6366f1',pointBorderColor:'#fff',pointBorderWidth:1.5,pointHoverRadius:6}
      ]
    },
    options:_bOpts
  });
  }

  // ── SPILLOVER ──
  const soCtx=_getCtx('spilloverChart');
  // Spillover uses ALL filtered sprints (_rs) — no active-only restriction here.
  // ── Targeted add: chart-level Sprint status filter (All / Completed / Active).
  // Scoped to the Spillover chart only — does NOT affect global filters or other charts.
  const _soStatusFilter=(document.getElementById('spillover-status-filter')||{}).value||'all';
  const _rsSpill = _soStatusFilter==='all'
    ? _rs
    : _rs.filter(s=>(s.status||'').toLowerCase()===_soStatusFilter);
  const soData=_rsSpill.map(s=>{
    const sEnd=s.end?new Date(s.end):null;
    if(!sEnd||s.status==='active')return 0;
    // ── FIX(Issue 1): Use stored spillover snapshot for completed sprints ──
    // When a sprint is completed via _executeSprintCompletion(), tasks are
    // reassigned to the next sprint or backlog. Querying live tasks by sprint ID
    // always returns 0 for completed sprints. Use the stored snapshot instead.
    if(s.status==='completed' && (s.spilloverTasks !== undefined || s.spilloverSubtasks !== undefined)){
      return (s.spilloverTasks||0) + (s.spilloverSubtasks||0);
    }
    const sTasks=_rt.filter(t=>t.sprint===s.id);
    const sAllSubs=sTasks.flatMap(t=>t.subtasks||[]);
    return [...sTasks,...sAllSubs].filter(item=>!DONE_STATUSES.includes(item.status)).length;
  });
  if(soCtx){
    // Dynamic width: fixed bar slot per sprint — scrolls horizontally when > 5 entries
    const _soInner=document.getElementById('spillover-chart-inner');
    if(_soInner){
      const _soSlot=68; // px per sprint bar slot
      const _soMinW=_soInner.parentElement?_soInner.parentElement.clientWidth||600:600;
      _soInner.style.width=Math.max(_soMinW,_rsSpill.length*_soSlot)+'px';
    }
    const _soOpts=_chartOpts();
    _soOpts.plugins.datalabels={display:ctx=>ctx.dataset.data[ctx.dataIndex]>0,anchor:'end',align:'top',offset:4,clamp:true,clip:false,color:'#6b7194',font:{size:10,weight:'600'},formatter:v=>v,padding:{top:2,bottom:2,left:3,right:3}};_soOpts.layout={padding:{top:24}};
    charts.spillover=new Chart(soCtx,{
    type:'bar',
    data:{
      labels:_rsSpill.length?_rsSpill.map(s=>(s.name||'').length>14?s.name.slice(0,13)+'…':(s.name||'')):['No Sprints'],
      datasets:[{label:'Spilled Tasks',data:soData.length?soData:[0],backgroundColor:'rgba(239,68,68,0.6)',borderRadius:4}]
    },
    options:_soOpts
  });
  }

  // ── WORKLOAD ──
  // Derive member list from project membership — respect the active project filter.
  // Members with 0 story points in the filtered task set still appear (showing 0 SP).
  const _wPids=_rptGetProjIds();
  const _wVisibleProjects=RBAC.getVisibleProjects();
  const _wScopedProjects=_wPids.length
    ? _wVisibleProjects.filter(p=>_wPids.includes(p.id))
    : _wVisibleProjects;
  const _wMemberIdSet=new Set();
  _wScopedProjects.forEach(p=>{(p.memberIds||[]).forEach(id=>_wMemberIdSet.add(id));});
  const users=_wMemberIdSet.size>0
    ? (state.users||[]).filter(u=>_wMemberIdSet.has(u.id))
    : (state.users||[]);
  // reportItems includes both tasks and subtasks (with inherited assignee/points fields)
  const wLoads=users.map(u=>reportItems.filter(item=>_qaItemBelongsTo(item,u.id)).reduce((a,item)=>a+_qaPointsFor(item,u.id),0));

  // ── WORKLOAD MEMBER FILTER (chart-level only — does NOT affect any other chart/table) ──
  // Apply the chart-level member filter dropdown. This is purely a display filter:
  // no calculations, no metrics, no report-level filters are changed.
  (function _renderWorkloadChart(){
    const _wmfSel=document.getElementById('workload-member-filter');
    const _wmf=_wmfSel?_wmfSel.value:'all';
    let _wUsers=users;
    let _wLoads=wLoads;
    if(_wmf==='assigned'){
      // Assigned Members: Points Assigned > 0 OR at least one assigned task
      const _idx=users.reduce((acc,u,i)=>{
        const pts=wLoads[i];
        const hasTasks=reportItems.some(item=>_qaItemBelongsTo(item,u.id));
        if(pts>0||hasTasks) acc.push(i);
        return acc;
      },[]);
      _wUsers=_idx.map(i=>users[i]);
      _wLoads=_idx.map(i=>wLoads[i]);
    } else if(_wmf==='unassigned'){
      // Unassigned Members: Points Assigned = 0 AND no assigned tasks
      const _idx=users.reduce((acc,u,i)=>{
        const pts=wLoads[i];
        const hasTasks=reportItems.some(item=>_qaItemBelongsTo(item,u.id));
        if(pts===0&&!hasTasks) acc.push(i);
        return acc;
      },[]);
      _wUsers=_idx.map(i=>users[i]);
      _wLoads=_idx.map(i=>wLoads[i]);
    }
    const wCtx=_getCtx('workloadChart');
    if(wCtx){
      // Dynamic width: fixed bar slot per member so labels never overlap
      const _wInner=document.getElementById('workload-chart-inner');
      if(_wInner){
        const _barSlot=52; // px per member bar slot
        const _minW=_wInner.parentElement?_wInner.parentElement.clientWidth||600:600;
        const _dynW=Math.max(_minW,_wUsers.length*_barSlot);
        _wInner.style.width=_dynW+'px';
      }
      const _wOpts=_chartOpts({plugins:{legend:{display:false}}});
      _wOpts.plugins.datalabels={display:ctx=>ctx.dataset.data[ctx.dataIndex]>0,anchor:'end',align:'top',offset:4,clamp:true,clip:false,color:'#6b7194',font:{size:10,weight:'600'},formatter:v=>_fmtPts(v),padding:{top:2,bottom:2,left:3,right:3}};_wOpts.layout={padding:{top:24}};
      // Use full member name for readability now that chart is wider
      charts.workload=new Chart(wCtx,{
        type:'bar',
        data:{
          labels:_wUsers.map(u=>u.name),
          datasets:[{label:'Story Points',data:_wLoads,backgroundColor:_wUsers.map(u=>u.color+'cc'),borderRadius:6}]
        },
        options:_wOpts
      });
    }
  })();

  // ── TYPE CHART ──
  const story=reportItems.filter(t=>t.type==='story').length;
  const task=reportItems.filter(t=>t.type==='task').length;
  const bug=reportItems.filter(t=>t.type==='bug').length;
  const tCtx=_getCtx('typeChart');
  if(tCtx) charts.typeChart=new Chart(tCtx,{
    type:'doughnut',
    data:{labels:['Stories','Tasks','Bugs'],datasets:[{data:[story,task,bug],backgroundColor:['#7c3aed','#0369a1','#dc2626'],borderWidth:0,hoverOffset:4}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'70%',plugins:{legend:{display:false},tooltip:{backgroundColor:'rgba(14,16,26,0.88)',titleFont:{family:'DM Sans',size:12,weight:'600'},bodyFont:{family:'DM Sans',size:11},padding:{top:9,bottom:9,left:12,right:12},cornerRadius:8,borderColor:'rgba(255,255,255,0.08)',borderWidth:1,titleColor:'#e8eaf4',bodyColor:'#a0a8c8'},datalabels:{display:ctx=>{const data=ctx.dataset.data;const total=data.reduce((a,b)=>a+b,0);const val=data[ctx.dataIndex];return total>0&&((val/total)*100)>=5;},color:'#fff',font:{size:11,weight:'700'},formatter:(value,ctx)=>{const total=ctx.dataset.data.reduce((a,b)=>a+b,0);const pct=Math.round((value/total)*100);return pct+'%';}}}}
  });
  const _typeLegendEl=document.getElementById('type-chart-legend');
  if(_typeLegendEl) _typeLegendEl.innerHTML=[['Stories','#7c3aed',story],['Tasks','#0369a1',task],['Bugs','#dc2626',bug]]
    .map(([l,c,v])=>`<div class="flex justify-between items-center" style="font-size:11.5px;color:var(--text-secondary)"><span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:50%;background:${c};display:inline-block"></span>${l}</span><span class="font-semibold">${v}</span></div>`).join('');

  // ── PRODUCTIVITY TABLE ──
  renderProductivityTable();

  // ── DELIVERY RISK MEMBERS CHART ──
  // Uses only existing filtered report data (reportItems, users, wLoads already derived above).
  // No new filtering logic — respects all existing project/sprint/RBAC filters via reportItems.
  // Eligibility: members with Points Assigned > 0 only.
  // Formula: Completion % = (Points Completed ÷ Points Assigned) × 100
  // Risk: High <50%, Medium 50–79%, Low ≥80%. Top 5 by highest risk (lowest completion %).
  (function _renderDeliveryRiskChart(){
    const _drEmptyEl=document.getElementById('delivery-risk-empty');
    const _drListEl=document.getElementById('delivery-risk-list');

    // Build per-member risk data from the same users + reportItems already in scope
    // Risk % = 100 - Completion %   where Completion % = (completed / assigned) * 100
    const _drMembers=users.reduce((acc,u)=>{
      const assigned=reportItems.filter(item=>_qaItemBelongsTo(item,u.id)).reduce((s,item)=>s+_qaPointsFor(item,u.id),0);
      if(assigned<=0) return acc; // exclude members with 0 assigned points
      const completed=reportItems.filter(item=>_qaItemBelongsTo(item,u.id)&&DONE_STATUSES.includes(item.status)).reduce((s,item)=>s+_qaPointsFor(item,u.id),0);
      const completionPct=Math.round((completed/assigned)*100);
      const riskPct=100-completionPct;
      acc.push({name:u.name,assigned,completed,completionPct,riskPct});
      return acc;
    },[]);

    // Sort descending by risk % (highest risk first), take top 8
    _drMembers.sort((a,b)=>b.riskPct-a.riskPct);
    const _drTop=_drMembers.slice(0,8);

    // Show/hide empty state
    if(_drEmptyEl) _drEmptyEl.style.display=_drTop.length===0?'flex':'none';
    if(_drListEl)  _drListEl.style.display =_drTop.length===0?'none':'flex';
    if(_drTop.length===0) return;

    // Risk band colors: High ≥70% → red, Medium 40–69% → amber, Low <40% → green
    const _drBarColor=r=>r>=70?'rgba(239,68,68,0.80)':r>=40?'rgba(245,158,11,0.80)':'rgba(16,185,129,0.80)';
    const _drLabelColor=r=>r>=70?'#dc2626':r>=40?'#d97706':'#059669';
    const _drBadgeBg=r=>r>=70?'rgba(239,68,68,0.10)':r>=40?'rgba(245,158,11,0.10)':'rgba(16,185,129,0.10)';

    if(_drListEl){
      _drListEl.innerHTML=_drTop.map(m=>`
        <div style="display:flex;align-items:center;gap:10px;min-height:28px">
          <div style="flex:0 0 130px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:12px;font-weight:500;color:var(--text-primary)" title="${_escHtml(m.name)}">${_escHtml(m.name)}</div>
          <div style="flex:0 0 42px;text-align:right;font-size:12px;font-weight:700;color:${_drLabelColor(m.riskPct)};background:${_drBadgeBg(m.riskPct)};border-radius:5px;padding:1px 6px">${m.riskPct}%</div>
          <div style="flex:1;background:rgba(0,0,0,0.06);border-radius:999px;height:8px;overflow:hidden">
            <div style="height:100%;width:${m.riskPct}%;background:${_drBarColor(m.riskPct)};border-radius:999px;transition:width 0.4s ease"></div>
          </div>
          <div style="flex:0 0 90px;font-size:11px;color:var(--text-tertiary);white-space:nowrap;text-align:right">${m.completed}/${m.assigned} pts</div>
        </div>`).join('');
    }
  })();

  // ── PROJECT DIST CHART ──
  const pdCtx=_getCtx('projDistChart');
  if(pdCtx){
    const _pdOpts=_chartOpts();
    _pdOpts.plugins.datalabels={display:ctx=>ctx.dataset.data[ctx.dataIndex]>0,anchor:'end',align:'start',offset:4,clamp:true,clip:false,color:'#fff',font:{size:10,weight:'700'},formatter:v=>v};_pdOpts.layout={padding:{top:8}};
    // UI scroll: expand canvas width with project count (3 grouped bars per project)
    const _pdIn=document.getElementById('projDistChart-inner');
    if(_pdIn){const _w=(_pdIn.parentElement&&_pdIn.parentElement.clientWidth)||600;_pdIn.style.width=Math.max(_w,(_rp.length||1)*84)+'px';}
    charts.projDist=new Chart(pdCtx,{
    type:'bar',
    data:{
      labels:_rp.map(p=>(p.name||'').length>12?p.name.slice(0,11)+'…':(p.name||'')),
      datasets:[
        {label:'Open',data:_rp.map(p=>reportItems.filter(item=>item.project===p.id&&item.status==='open').length),backgroundColor:'rgba(245,158,11,0.7)',borderRadius:4},
        {label:'In Progress',data:_rp.map(p=>reportItems.filter(item=>item.project===p.id&&['dev-in-progress','dev-completed','in-qa','qa-in-progress','reopen','on-hold','pending-with-client'].includes(item.status)).length),backgroundColor:'rgba(99,102,241,0.7)',borderRadius:4},
        {label:'Released',data:_rp.map(p=>reportItems.filter(item=>item.project===p.id&&DONE_STATUSES.includes(item.status)).length),backgroundColor:'rgba(16,185,129,0.7)',borderRadius:4}
      ]
    },
    options:_pdOpts
  });
  }

  // ── SPRINT HEALTH per PROJECT ──
  // Same _rsScoped + spillover-aware _rsSprintWorkStats fix as above.
  const shCtx=_getCtx('sprintHealthChart');
  const shData=_rp.map(p=>{
    const pStats=_rsScoped.filter(s=>s.project===p.id).map(_rsSprintWorkStats);
    const pTotalWithSubs=pStats.reduce((a,x)=>a+x.totalCount,0);
    const pDone=pStats.reduce((a,x)=>a+x.doneCount,0);
    return pTotalWithSubs?Math.round((pDone/pTotalWithSubs)*100):0;
  });
  if(shCtx){
    const _shOpts=_chartOpts({plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{font:{family:'DM Sans',size:11}}},y:{max:100,grid:{color:'rgba(0,0,0,0.04)',lineWidth:1},ticks:{font:{family:'DM Sans',size:11},callback:v=>v+'%'}}}});
    _shOpts.plugins.datalabels={display:ctx=>ctx.dataset.data[ctx.dataIndex]>0,anchor:'end',align:'top',offset:4,clamp:true,clip:false,color:'#6b7194',font:{size:10,weight:'600'},formatter:v=>v+'%',padding:{top:2,bottom:2,left:3,right:3}};_shOpts.layout={padding:{top:24}};
    // UI scroll: expand canvas width with project count so labels stay readable
    const _shIn=document.getElementById('sprintHealthChart-inner');
    if(_shIn){const _w=(_shIn.parentElement&&_shIn.parentElement.clientWidth)||600;_shIn.style.width=Math.max(_w,(_rp.length||1)*64)+'px';}
    charts.sprintHealth=new Chart(shCtx,{
    type:'bar',
    data:{
      labels:_rp.map(p=>(p.name||'').length>12?p.name.slice(0,11)+'…':(p.name||'')),
      datasets:[{label:'Sprint Completion %',data:shData,backgroundColor:shData.map(v=>v>=70?'rgba(16,185,129,0.7)':v>=40?'rgba(245,158,11,0.7)':'rgba(239,68,68,0.6)'),borderRadius:6}]
    },
    options:_shOpts
  });
  }

  // ── PROJECT DETAIL TABLE ──
  const projTbody=document.getElementById('rpt-proj-tbody');
  if(projTbody){
    projTbody.innerHTML=_rp.map(p=>{
      const pTasks=_rt.filter(t=>t.project===p.id);
      const pAllSubs=pTasks.flatMap(t=>(t.subtasks||[]).map(st=>({...st,project:st.project||t.project})));
      const pItems=[...pTasks,...pAllSubs];
      const pEpics=(state.epics||[]).filter(e=>{
        const epicProjects=e.projectIds||(e.projectId?[e.projectId]:[]);
        return epicProjects.includes(p.id);
      });
      const pRels=_rl.filter(r=>r.projectId===p.id);
      const overdueCount=pItems.filter(t=>t.dueDate&&new Date(t.dueDate)<new Date()&&!DONE_STATUSES.includes(t.status)).length;
      const blockedReopen=pItems.filter(t=>t.status==='reopen').length;
      const epicDone=pEpics.filter(e=>e.status==='Completed').length;
      const epicComp=pEpics.length?Math.round((epicDone/pEpics.length)*100):0;
      const relDone2=pRels.flatMap(r=>r.taskIds||[]).map(id=>pTasks.find(t=>t.id===id)).filter(t=>t&&DONE_STATUSES.includes(t.status)).length;
      const relTotal2=pRels.flatMap(r=>r.taskIds||[]).length;
      const relPct=relTotal2?Math.round((relDone2/relTotal2)*100):0;
      // Spillover-aware via _rsSprintWorkStats — same fix as the Sprint Health chart above.
      const pSpStats=_rsScoped.filter(s=>s.project===p.id).map(_rsSprintWorkStats);
      const pSpTotalWithSubs=pSpStats.reduce((a,x)=>a+x.totalCount,0);
      const pSpDone=pSpStats.reduce((a,x)=>a+x.doneCount,0);
      const pSpPct=pSpTotalWithSubs?Math.round((pSpDone/pSpTotalWithSubs)*100):0;
      return `<tr style="border-bottom:1px solid rgba(0,0,0,0.04)">
        <td style="padding:10px 12px"><div style="display:flex;align-items:center;gap:8px"><div style="width:10px;height:10px;border-radius:50%;background:${p.color};flex-shrink:0"></div><span style="font-weight:600;color:#1e293b">${_escHtml(p.name)}</span></div></td>
        <td style="padding:10px 12px;text-align:right;color:#64748b;font-size:13px">${pItems.length}</td>
        <td style="padding:10px 12px;text-align:right"><span style="font-weight:${overdueCount>0?'700':'400'};color:${overdueCount>0?'#ef4444':'#64748b'}">${overdueCount}</span></td>
        <td style="padding:10px 12px;text-align:right"><span style="font-weight:${blockedReopen>0?'700':'400'};color:${blockedReopen>0?'#f59e0b':'#64748b'}">${blockedReopen}</span></td>
        <td style="padding:10px 12px;text-align:right"><div style="display:flex;align-items:center;justify-content:flex-end;gap:6px"><span style="font-weight:600;color:#6366f1">${epicComp}%</span><span style="font-size:11px;color:#94a3b8">${epicDone}/${pEpics.length}</span></div></td>
        <td style="padding:10px 12px;text-align:right"><span style="font-weight:600;color:${relPct===100?'#10b981':'#6366f1'}">${relPct}%</span></td>
        <td style="padding:10px 12px;min-width:110px"><div style="display:flex;align-items:center;gap:6px"><div style="flex:1;height:5px;background:rgba(0,0,0,0.07);border-radius:3px;overflow:hidden"><div style="height:100%;background:${pSpPct>=70?'#10b981':pSpPct>=40?'#f59e0b':'#ef4444'};width:${pSpPct}%;transition:width 0.4s;border-radius:3px"></div></div><span style="font-size:11px;font-weight:600;color:#64748b;white-space:nowrap">${pSpPct}%</span></div></td>
      </tr>`;
    }).join('')||`<tr><td colspan="7" style="padding:24px;text-align:center;color:#94a3b8;font-size:13px">No projects</td></tr>`;
  }

  // ── THEME ANALYTICS ──────────────────────────────────────────────
  // Build theme map from filtered tasks (respects all existing filters + RBAC)
  const _visibleThemes = (state.themes || []).filter(th => {
    // RBAC: PM/Member see only themes mapped to their visible projects
    if(RBAC.isAdmin()) return true;
    const vpIds = new Set(RBAC.getVisibleProjects().map(p => p.id));
    return (th.projectIds || []).some(pid => vpIds.has(pid));
  });

  // Build per-theme map from _rt (parent tasks) + their subtasks
  // Subtasks inherit themeId from their parent task
  const _themeTaskMap = {}; // themeId -> { name, color, tasks[], subtasks[], points }
  _visibleThemes.forEach(th => {
    _themeTaskMap[th.id] = { name: th.name||'', color: th.color||'#8b5cf6', tasks: [], subtasks: [], points: 0 };
  });
  let _tasksWithTheme = 0;
  let _subtasksWithTheme = 0;
  (_rt||[]).forEach(t => {
    const tid = t.themeId;
    if(tid && _themeTaskMap[tid]) {
      _themeTaskMap[tid].tasks.push(t);
      _themeTaskMap[tid].points += (t.points || 0);
      _tasksWithTheme++;
      // Collect subtasks that belong to this theme via parent
      (t.subtasks||[]).forEach(st => {
        const resolvedThemeId = st.themeId || tid; // subtask can have own themeId or inherits parent
        if(resolvedThemeId === tid) {
          _themeTaskMap[tid].subtasks.push(st);
          _themeTaskMap[tid].points += (st.points || 0);
          _subtasksWithTheme++;
        }
      });
    }
  });

  // Sort by total work items descending
  const _themeEntries = Object.values(_themeTaskMap).sort((a,b)=>(b.tasks.length+b.subtasks.length)-(a.tasks.length+a.subtasks.length));
  const _totalThemeItems = _themeEntries.reduce((acc,e)=>acc+e.tasks.length+e.subtasks.length, 0);
  const _totalAllItems   = (_rt||[]).length + (_rt||[]).reduce((a,t)=>a+(t.subtasks||[]).length,0);
  const _themeCovPct     = _totalAllItems ? Math.round((_totalThemeItems/_totalAllItems)*100) : 0;

  // KPI cards
  setEl('rpt-theme-tasks',        _tasksWithTheme);
  setEl('rpt-theme-tasks-sub',    `of ${(_rt||[]).length} filtered tasks`);
  setEl('rpt-theme-subtasks',     _subtasksWithTheme);
  setEl('rpt-theme-subtasks-sub', `inherited from parent themes`);
  setEl('rpt-theme-total-items',  _tasksWithTheme + _subtasksWithTheme);
  setEl('rpt-theme-total-items-sub', `across ${_visibleThemes.length} theme${_visibleThemes.length!==1?'s':''}`);
  setEl('rpt-theme-coverage',     _themeCovPct+'%');
  setEl('rpt-theme-coverage-sub', `of ${_totalAllItems} total work items`);
  const _tcBar = document.getElementById('rpt-theme-coverage-bar');
  if(_tcBar) _tcBar.style.width = _themeCovPct+'%';

  // ── THEME WORK ITEMS DISTRIBUTION CHART (stacked horizontal bar: Tasks + Subtasks) ──
  const themeTaskCtx = _getCtx('themeTaskChart');
  if(themeTaskCtx){
    const _ttLabels    = _themeEntries.map(e => e.name.length>18 ? e.name.slice(0,17)+'…' : e.name);
    const _ttTaskData  = _themeEntries.map(e => e.tasks.length);
    const _ttSubData   = _themeEntries.map(e => e.subtasks.length);
    const _ttColors    = _themeEntries.map(e => (e.color||'#8b5cf6')+'BF');
    const _ttSubColors = _themeEntries.map(e => (e.color||'#8b5cf6')+'66');
    const _ttOpts = _chartOpts({indexAxis:'y',plugins:{legend:{display:true,position:'top'}},scales:{
      x:{stacked:true,grid:{color:'rgba(0,0,0,0.04)',lineWidth:1},ticks:{font:{family:'DM Sans',size:11},stepSize:1}},
      y:{stacked:true,grid:{display:false},ticks:{font:{family:'DM Sans',size:11}}}
    }});
    _ttOpts.plugins.datalabels = {display:ctx=>ctx.dataset.data[ctx.dataIndex]>0,anchor:'center',align:'center',clamp:true,color:'#fff',font:{size:9,weight:'700'},formatter:v=>v};
    _ttOpts.layout = {padding:{right:28}};
    charts.themeTask = new Chart(themeTaskCtx,{
      type:'bar',
      data:{
        labels:_ttLabels.length?_ttLabels:['No Themes'],
        datasets:[
          {label:'Tasks',    data:_ttTaskData.length?_ttTaskData:[0], backgroundColor:_ttColors,    borderRadius:0},
          {label:'Subtasks', data:_ttSubData.length?_ttSubData:[0],   backgroundColor:_ttSubColors, borderRadius:[0,5,5,0]}
        ]
      },
      options:_ttOpts
    });
  }

  // ── THEME STORY POINTS CHART (horizontal bar — tasks + subtasks combined) ──
  const themeSpCtx = _getCtx('themeSpChart');
  if(themeSpCtx){
    const _tspLabels = _themeEntries.map(e => e.name.length>18 ? e.name.slice(0,17)+'…' : e.name);
    const _tspData   = _themeEntries.map(e => e.points);
    const _tspColors = _themeEntries.map(e => (e.color||'#6366f1')+'99');
    const _tspOpts = _chartOpts({indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{grid:{color:'rgba(0,0,0,0.04)',lineWidth:1},ticks:{font:{family:'DM Sans',size:11}}},y:{grid:{display:false},ticks:{font:{family:'DM Sans',size:11}}}}});
    _tspOpts.plugins.datalabels = {display:ctx=>ctx.dataset.data[ctx.dataIndex]>0,anchor:'end',align:'right',offset:4,clamp:true,clip:false,color:'#6b7194',font:{size:10,weight:'600'},formatter:v=>v+'sp'};
    _tspOpts.layout = {padding:{right:36}};
    charts.themeSp = new Chart(themeSpCtx,{
      type:'bar',
      data:{labels:_tspLabels.length?_tspLabels:['No Themes'],datasets:[{label:'Story Points (Tasks + Subtasks)',data:_tspData.length?_tspData:[0],backgroundColor:_tspColors,borderRadius:5}]},
      options:_tspOpts
    });
  }

  // ── THEME BREAKDOWN TABLE ──
  const _themeTbody = document.getElementById('rpt-theme-tbody');
  if(_themeTbody){
    const IN_PROGRESS_STATUSES = ['dev-in-progress','in-qa','qa-in-progress','dev-completed','reopen','on-hold','pending-with-client'];
    _themeTbody.innerHTML = _themeEntries.map((th, idx) => {
      const tasks     = th.tasks;
      const subs      = th.subtasks;
      const allItems  = [...tasks, ...subs];
      const c         = th.color || '#8b5cf6';
      const open      = allItems.filter(t=>t.status==='open').length;
      const inProg    = allItems.filter(t=>IN_PROGRESS_STATUSES.includes(t.status)).length;
      const done      = allItems.filter(t=>DONE_STATUSES.includes(t.status)).length;
      // Mapped project names for this theme
      const themeObj  = _visibleThemes.find(x=>x.name===th.name);
      const projNames = themeObj ? (themeObj.projectIds||[]).map(pid=>{const p=getProject(pid);return p?_escHtml(p.name):'';}).filter(Boolean).join(', ') : '—';
      const bg = idx%2!==0?'background:rgba(0,0,0,0.018)':'';
      return `<tr style="${bg};border-bottom:1px solid rgba(0,0,0,0.05)">
        <td style="padding:10px 12px">
          <div style="display:inline-flex;align-items:center;gap:6px;padding:2px 9px 2px 7px;border-radius:999px;background:${c}22;color:${c};border:1px solid ${c}55;font-weight:600;font-size:12.5px">
            <span style="width:7px;height:7px;border-radius:50%;background:${c};flex-shrink:0"></span>${_escHtml(th.name)}
          </div>
        </td>
        <td style="padding:10px 12px;color:var(--text-secondary);font-size:12px;max-width:180px">${projNames||'—'}</td>
        <td style="padding:10px 12px;text-align:right;font-weight:600">${tasks.length}</td>
        <td style="padding:10px 12px;text-align:right;font-weight:600;color:#7c3aed">${subs.length}</td>
        <td style="padding:10px 12px;text-align:right;font-weight:700;color:#0d0f14">${allItems.length}</td>
        <td style="padding:10px 12px;text-align:right;font-weight:600;color:#6366f1">${th.points}<span style="font-size:11px;font-weight:400;color:#94a3b8"> sp</span></td>
        <td style="padding:10px 12px;text-align:right;color:#64748b">${open}</td>
        <td style="padding:10px 12px;text-align:right;color:#2461c8">${inProg}</td>
        <td style="padding:10px 12px;text-align:right;color:#10b981;font-weight:600">${done}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="9" style="padding:20px;text-align:center;color:var(--text-tertiary);font-size:13px">No theme data for current filters</td></tr>`;
  }

  // ── EPIC CHARTS — use _re (already filtered by _getFilteredReportsData) ──
  // For counts/points, scope to filtered tasks only
  const epics=_re||[];
  const epicLabels=epics.map(e=>(e.title||'').length>12?e.title.slice(0,11)+'…':(e.title||''));
  const epicColors=epics.map(e=>e.color);
  // Group filtered tasks by epic ONCE — this block previously re-scanned the
  // full _rt task list with .filter(t=>t.epicId===e.id) five separate times
  // per epic (here, plus ewPts/evDone/evRemaining below), which is O(epics × tasks)
  // done 5x redundantly and gets slow with a large task list.
  const _epicItemsMap=new Map();
  epics.forEach(e=>_epicItemsMap.set(e.id,{tasks:[],subs:[]}));
  _rt.forEach(t=>{
    const grp=t.epicId!=null?_epicItemsMap.get(t.epicId):null;
    if(!grp)return;
    grp.tasks.push(t);
    (t.subtasks||[]).forEach(s=>grp.subs.push(s));
  });
  const ecDone=epics.map(e=>{
    const {tasks:eTasks,subs:eSubs}=_epicItemsMap.get(e.id);
    return [...eTasks,...eSubs].filter(item=>DONE_STATUSES.includes(item.status)).length;
  });
  const ecTotal=epics.map(e=>{
    const {tasks:eTasks,subs:eSubs}=_epicItemsMap.get(e.id);
    return eTasks.length+eSubs.length;
  });
  const ecRemaining=ecTotal.map((t,i)=>t-ecDone[i]);
  const ecCtx=_getCtx('epicCompletionChart');
  if(ecCtx){
    const _ecOpts=_chartOpts({scales:{x:{stacked:true,grid:{display:false},ticks:{font:{family:'DM Sans',size:11}}},y:{stacked:true,grid:{color:'rgba(0,0,0,0.04)',lineWidth:1},ticks:{font:{family:'DM Sans',size:11},stepSize:1}}}});
    _ecOpts.plugins.datalabels={display:ctx=>ctx.dataset.data[ctx.dataIndex]>0,anchor:'center',align:'center',clamp:true,color:ctx=>{const bg=ctx.dataset.backgroundColor;return typeof bg==='string'&&bg.includes('e2e8f0')?'#64748b':'#fff';},font:{size:10,weight:'700'},formatter:v=>v};
    // UI scroll: expand canvas width with epic count so labels never compress
    const _ecIn=document.getElementById('epicCompletionChart-inner');
    if(_ecIn){const _w=(_ecIn.parentElement&&_ecIn.parentElement.clientWidth)||600;_ecIn.style.width=Math.max(_w,(epics.length||1)*64)+'px';}
    charts.epicCompletion=new Chart(ecCtx,{
    type:'bar',
    data:{
      labels:epicLabels.length?epicLabels:['No Epics'],
      datasets:[
        {label:'Done',data:ecDone.length?ecDone:[0],backgroundColor:epicColors.map(c=>c+'cc'),borderRadius:4},
        {label:'Remaining',data:ecRemaining.length?ecRemaining:[0],backgroundColor:'#e2e8f0',borderRadius:4}
      ]
    },
    options:_ecOpts
  });
  }
  const ewPts=epics.map(e=>{
    const {tasks:eTasks,subs:eSubs}=_epicItemsMap.get(e.id);
    return [...eTasks,...eSubs].reduce((a,item)=>a+(item.points||0),0);
  });
  const ewCtx=_getCtx('epicWorkloadChart');
  if(ewCtx){
    const _ewOpts=_chartOpts({plugins:{legend:{display:false}}});
    _ewOpts.plugins.datalabels={display:ctx=>ctx.dataset.data[ctx.dataIndex]>0,anchor:'end',align:'top',offset:4,clamp:true,clip:false,color:'#6b7194',font:{size:10,weight:'600'},formatter:v=>v,padding:{top:2,bottom:2,left:3,right:3}};_ewOpts.layout={padding:{top:24}};
    // UI scroll: expand canvas width with epic count so labels stay readable
    const _ewIn=document.getElementById('epicWorkloadChart-inner');
    if(_ewIn){const _w=(_ewIn.parentElement&&_ewIn.parentElement.clientWidth)||600;_ewIn.style.width=Math.max(_w,(epics.length||1)*64)+'px';}
    charts.epicWorkload=new Chart(ewCtx,{
    type:'bar',
    data:{labels:epicLabels.length?epicLabels:['No Epics'],datasets:[{label:'Story Points',data:ewPts.length?ewPts:[0],backgroundColor:epicColors.length?epicColors.map(c=>c+'bb'):['#e2e8f0'],borderRadius:6}]},
    options:_ewOpts
  });
  }
  const evDone=epics.map(e=>{
    const {tasks:eTasks,subs:eSubs}=_epicItemsMap.get(e.id);
    return [...eTasks,...eSubs].filter(item=>DONE_STATUSES.includes(item.status)).reduce((a,item)=>a+(item.points||0),0);
  });
  const evRemaining=epics.map(e=>{
    const {tasks:eTasks,subs:eSubs}=_epicItemsMap.get(e.id);
    return [...eTasks,...eSubs].filter(item=>!DONE_STATUSES.includes(item.status)).reduce((a,item)=>a+(item.points||0),0);
  });
  const evCtx=_getCtx('epicVelocityChart');
  if(evCtx){
    const _evOpts=_chartOpts({scales:{x:{stacked:true,grid:{display:false},ticks:{font:{family:'DM Sans',size:11}}},y:{stacked:true,grid:{color:'rgba(0,0,0,0.04)',lineWidth:1},ticks:{font:{family:'DM Sans',size:11}}}}});
    _evOpts.plugins.datalabels={display:ctx=>ctx.dataset.data[ctx.dataIndex]>0,anchor:'center',align:'center',clamp:true,color:ctx=>{const bg=ctx.dataset.backgroundColor;return typeof bg==='string'&&bg.includes('f1f5f9')?'#64748b':'#fff';},font:{size:10,weight:'700'},formatter:v=>v};
    // UI scroll: expand canvas width with epic count so labels never compress
    const _evIn=document.getElementById('epicVelocityChart-inner');
    if(_evIn){const _w=(_evIn.parentElement&&_evIn.parentElement.clientWidth)||600;_evIn.style.width=Math.max(_w,(epics.length||1)*64)+'px';}
    charts.epicVelocity=new Chart(evCtx,{
    type:'bar',
    data:{
      labels:epicLabels.length?epicLabels:['No Epics'],
      datasets:[
        {label:'Done',data:evDone.length?evDone:[0],backgroundColor:'rgba(16,185,129,0.75)',borderRadius:4},
        {label:'Remaining',data:evRemaining.length?evRemaining:[0],backgroundColor:'rgba(241,245,249,1)',borderRadius:4}
      ]
    },
    options:_evOpts
  });
  }

  // ── PRODUCT BIFURCATION ──
  // FIX: iterate reportItems (parent tasks + subtasks) instead of _rt (parent tasks only).
  // reportItems is already filtered through the same RBAC + report-filter pipeline.
  const pbCtx=_getCtx('productBifurcationChart');
  if(pbCtx){
    const _prodMap={};
    (reportItems||[]).forEach(t=>{
      const prods=t.products&&t.products.length?t.products
        :(t.productIds&&t.productIds.length?t.productIds.map(pid=>{const p=(state.products||[]).find(x=>x.id===pid);return p?p.name:pid;}):null);
      if(prods&&prods.length){prods.forEach(pn=>{_prodMap[pn]=(_prodMap[pn]||0)+1;});}
      else{_prodMap['(No Product)']=(_prodMap['(No Product)']||0)+1;}
    });
    const _pbLabels=Object.keys(_prodMap);
    const _pbData=_pbLabels.map(k=>_prodMap[k]);
    const _pbPalette=['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#0ea5e9','#ec4899','#14b8a6','#f97316','#84cc16'];
    const _pbColors=_pbLabels.map((_,i)=>_pbPalette[i%_pbPalette.length]);
    const _pbOpts={responsive:true,maintainAspectRatio:false,cutout:'62%',plugins:{legend:{display:true,position:'right',labels:{boxWidth:10,padding:12,font:{size:11,family:'DM Sans'},color:'#4a5066'}},tooltip:{backgroundColor:'rgba(14,16,26,0.88)',titleFont:{family:'DM Sans',size:12,weight:'600'},bodyFont:{family:'DM Sans',size:11},padding:{top:9,bottom:9,left:12,right:12},cornerRadius:8},datalabels:{display:ctx=>{const data=ctx.dataset.data;const total=data.reduce((a,b)=>a+b,0);const val=data[ctx.dataIndex];return total>0&&((val/total)*100)>=4;},color:'#fff',font:{size:10,weight:'700'},formatter:(v,ctx)=>{const total=ctx.dataset.data.reduce((a,b)=>a+b,0);return Math.round((v/total)*100)+'%';}}},animation:{duration:400,easing:'easeInOutQuart'}};
    charts.productBifurcation=new Chart(pbCtx,{
      type:'doughnut',
      data:{labels:_pbLabels.length?_pbLabels:['No Data'],datasets:[{data:_pbData.length?_pbData:[1],backgroundColor:_pbColors,borderWidth:0,hoverOffset:5}]},
      options:_pbOpts
    });
  }

  // ── TAG BIFURCATION ──
  // FIX: iterate reportItems (parent tasks + subtasks) instead of _rt (parent tasks only).
  // reportItems is already filtered through the same RBAC + report-filter pipeline.
  const tbCtx=_getCtx('tagBifurcationChart');
  if(tbCtx){
    const _tagMap={};
    (reportItems||[]).forEach(t=>{
      if(t.tags&&t.tags.length){t.tags.forEach(tg=>{_tagMap[tg]=(_tagMap[tg]||0)+1;});}
      else{_tagMap['(No Tag)']=(_tagMap['(No Tag)']||0)+1;}
    });
    const _tagSorted=Object.entries(_tagMap).sort((a,b)=>b[1]-a[1]).slice(0,15);
    const _tbLabels=_tagSorted.map(([k])=>k);
    const _tbData=_tagSorted.map(([,v])=>v);
    const _tbPalette=['rgba(99,102,241,0.75)','rgba(16,185,129,0.75)','rgba(245,158,11,0.75)','rgba(239,68,68,0.7)','rgba(139,92,246,0.75)','rgba(14,165,233,0.75)','rgba(236,72,153,0.75)','rgba(20,184,166,0.75)','rgba(249,115,22,0.75)','rgba(132,204,22,0.75)'];
    const _tbColors=_tbLabels.map((_,i)=>_tbPalette[i%_tbPalette.length]);
    const _tbOpts=_chartOpts({indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{grid:{color:'rgba(0,0,0,0.04)',lineWidth:1},ticks:{font:{family:'DM Sans',size:11},stepSize:1}},y:{grid:{display:false},ticks:{font:{family:'DM Sans',size:11}}}}});
    _tbOpts.plugins.datalabels={display:ctx=>ctx.dataset.data[ctx.dataIndex]>0,anchor:'end',align:'right',offset:4,clamp:true,clip:false,color:'#6b7194',font:{size:10,weight:'600'},formatter:v=>v};
    _tbOpts.layout={padding:{right:28}};
    // UI scroll: this is a horizontal bar chart (indexAxis:'y'), so its labels stack
    // down the Y-axis — expand canvas HEIGHT with tag count so rows never compress.
    const _tbIn=document.getElementById('tagBifurcationChart-inner');
    if(_tbIn){_tbIn.style.height=Math.max(240,(_tbLabels.length||1)*34)+'px';}
    charts.tagBifurcation=new Chart(tbCtx,{
      type:'bar',
      data:{labels:_tbLabels.length?_tbLabels:['No Data'],datasets:[{label:'Tasks',data:_tbData.length?_tbData:[0],backgroundColor:_tbColors,borderRadius:5}]},
      options:_tbOpts
    });
  }
  }catch(e){console.warn('[Render] renderReports error:',e);}
}

// ── Workload chart-level member filter ────────────────────────────
// Called ONLY by the Workload Distribution chart's own filter dropdown.
// Does NOT touch report-level filters, other charts, or any table.
function _applyWorkloadMemberFilter(){
  // Rebuild just the workload chart using cached state — no full renderReports() call.
  // If charts.workload exists we destroy it first, then re-render with the new filter.
  if(charts.workload){try{charts.workload.destroy();}catch(e){}delete charts.workload;}

  // Re-derive the same user+load arrays that renderReports() built.
  // These are read-only references — no calculations are changed.
  const fd=_getFilteredReportsData();
  const _rt=fd.tasks;
  const reportSubs=(_rt||[]).flatMap(t=>(t.subtasks||[]).map(st=>({
    ...st,parentTaskId:t.id,project:st.project||t.project,sprint:st.sprint||t.sprint,epicId:st.epicId||t.epicId
  })));
  const reportItems=[...(_rt||[]),...reportSubs];

  const _wProjPids=_rptGetProjIds();
  const _wVisibleProjects=RBAC.getVisibleProjects();
  const _wScopedProjects=_wProjPids.length
    ? _wVisibleProjects.filter(p=>_wProjPids.includes(p.id))
    : _wVisibleProjects;
  const _wMemberIdSet=new Set();
  _wScopedProjects.forEach(p=>{(p.memberIds||[]).forEach(id=>_wMemberIdSet.add(id));});
  const allUsers=_wMemberIdSet.size>0
    ? (state.users||[]).filter(u=>_wMemberIdSet.has(u.id))
    : (state.users||[]);
  const allLoads=allUsers.map(u=>reportItems.filter(item=>_qaItemBelongsTo(item,u.id)).reduce((a,item)=>a+_qaPointsFor(item,u.id),0));

  // Apply the filter
  const _wmfSel=document.getElementById('workload-member-filter');
  const _wmf=_wmfSel?_wmfSel.value:'all';
  let _wUsers=allUsers, _wLoads=allLoads;
  if(_wmf==='assigned'){
    const _idx=allUsers.reduce((acc,u,i)=>{
      if(allLoads[i]>0||reportItems.some(item=>_qaItemBelongsTo(item,u.id))) acc.push(i);
      return acc;
    },[]);
    _wUsers=_idx.map(i=>allUsers[i]); _wLoads=_idx.map(i=>allLoads[i]);
  } else if(_wmf==='unassigned'){
    const _idx=allUsers.reduce((acc,u,i)=>{
      if(allLoads[i]===0&&!reportItems.some(item=>_qaItemBelongsTo(item,u.id))) acc.push(i);
      return acc;
    },[]);
    _wUsers=_idx.map(i=>allUsers[i]); _wLoads=_idx.map(i=>allLoads[i]);
  }

  const wCtx=_getCtx('workloadChart');
  if(wCtx){
    // Dynamic width for scrollable chart
    const _wInner2=document.getElementById('workload-chart-inner');
    if(_wInner2){
      const _barSlot2=52;
      const _minW2=_wInner2.parentElement?_wInner2.parentElement.clientWidth||600:600;
      _wInner2.style.width=Math.max(_minW2,_wUsers.length*_barSlot2)+'px';
    }
    const _wOpts=_chartOpts({plugins:{legend:{display:false}}});
    _wOpts.plugins.datalabels={display:ctx=>ctx.dataset.data[ctx.dataIndex]>0,anchor:'end',align:'top',offset:4,clamp:true,clip:false,color:'#6b7194',font:{size:10,weight:'600'},formatter:v=>_fmtPts(v),padding:{top:2,bottom:2,left:3,right:3}};
    _wOpts.layout={padding:{top:24}};
    charts.workload=new Chart(wCtx,{
      type:'bar',
      data:{
        labels:_wUsers.map(u=>u.name),
        datasets:[{label:'Story Points',data:_wLoads,backgroundColor:_wUsers.map(u=>u.color+'cc'),borderRadius:6}]
      },
      options:_wOpts
    });
  }
}

// ══════════════════════════════════════════════════════════════════
//  REPORTS PAGE — multi-select filter state + helpers
// ══════════════════════════════════════════════════════════════════
const _rptSelProjs   = new Set(); // selected project IDs; empty = All
const _rptSelSprints = new Set(); // selected sprint IDs;  empty = All

// Return selected project IDs (empty array = All)
function _rptGetProjIds(){   return [..._rptSelProjs];   }
// Return selected sprint IDs (empty array = All)
function _rptGetSprintIds(){ return [..._rptSelSprints]; }

// Open project dropdown for Reports
function _rptToggleProjDrop(e){
  const p = document.getElementById('sf-msdrop-panel');
  if(p && p.style.display !== 'none' && _rptToggleProjDrop._open){
    _sfMsDrop.apply(); _rptToggleProjDrop._open = false; return;
  }
  const allProj = RBAC.getVisibleProjects();
  const active    = allProj.filter(p => (p.status||'').toLowerCase() === 'active');
  const completed = allProj.filter(p => (p.status||'').toLowerCase() === 'completed');
  const items = [
    ...active.map(p    => ({ id: p.id, name: p.name, group: active.length    ? 'Active'    : '' })),
    ...completed.map(p => ({ id: p.id, name: p.name, group: completed.length ? 'Completed' : '' }))
  ];
  _sfMsDrop.open(
    document.getElementById('rpt-proj-btn'),
    items,
    _rptSelProjs,
    sel => { _rptSelProjs.clear(); sel.forEach(id => _rptSelProjs.add(id)); _rptOnProjApply(); },
    document.getElementById('rpt-proj-label')
  );
  document.getElementById('rpt-proj-label').dataset.allLabel = 'All Projects';
  _rptToggleProjDrop._open = true;
}
_rptToggleProjDrop._open = false;

// Open sprint dropdown for Reports
function _rptToggleSprintDrop(e){
  const p = document.getElementById('sf-msdrop-panel');
  if(p && p.style.display !== 'none' && _rptToggleSprintDrop._open){
    _sfMsDrop.apply(); _rptToggleSprintDrop._open = false; return;
  }
  const selPids = _rptGetProjIds();
  let allSpr = RBAC.getVisibleSprints();
  if(selPids.length) allSpr = allSpr.filter(s => selPids.includes(s.project));
  const active    = allSpr.filter(s => (s.status||'').toLowerCase() === 'active');
  const completed = allSpr.filter(s => (s.status||'').toLowerCase() === 'completed');
  const items = [
    ...active.map(s    => ({ id: s.id, name: s.name, group: active.length    ? 'Active'    : '' })),
    ...completed.map(s => ({ id: s.id, name: s.name, group: completed.length ? 'Completed' : '' }))
  ];
  _sfMsDrop.open(
    document.getElementById('rpt-spr-btn'),
    items,
    _rptSelSprints,
    sel => { _rptSelSprints.clear(); sel.forEach(id => _rptSelSprints.add(id)); _debouncedRenderReports(); },
    document.getElementById('rpt-spr-label')
  );
  document.getElementById('rpt-spr-label').dataset.allLabel = 'All Sprints';
  _rptToggleSprintDrop._open = true;
}
_rptToggleSprintDrop._open = false;

function _rptOnProjApply(){
  // When project filter changes, prune any sprint selections that no longer belong
  const selPids = _rptGetProjIds();
  if(selPids.length){
    [..._rptSelSprints].forEach(sid => {
      const s = RBAC.getVisibleSprints().find(x => x.id === sid);
      if(!s || !selPids.includes(s.project)) _rptSelSprints.delete(sid);
    });
    // Update sprint label if selections were pruned
    const sprLbl = document.getElementById('rpt-spr-label');
    if(sprLbl){
      if(_rptSelSprints.size === 0) sprLbl.textContent = 'All Sprints';
      else if(_rptSelSprints.size === 1){
        const s = RBAC.getVisibleSprints().find(x => x.id === [..._rptSelSprints][0]);
        sprLbl.textContent = s ? s.name : '1 selected';
      } else sprLbl.textContent = _rptSelSprints.size + ' selected';
    }
  }
  _debouncedRenderReports();
}

// ── Active Sprints info popover (Sprint Reports KPI card) ──────────────────
(function(){
  function positionPopover(btn,pop){
    const r=btn.getBoundingClientRect();
    const margin=8;
    pop.style.display='block';pop.style.visibility='hidden';
    const popW=pop.offsetWidth,popH=pop.offsetHeight;
    pop.style.display='';pop.style.visibility='';
    let left=r.left;
    let top=r.bottom+margin;
    if(left+popW>window.innerWidth-margin)left=window.innerWidth-popW-margin;
    if(left<margin)left=margin;
    if(top+popH>window.innerHeight-margin)top=r.top-popH-margin;
    pop.style.left=left+'px';
    pop.style.top=top+'px';
  }
  function openSprintsPopover(){
    const btn=document.getElementById('rpt-sprints-info-btn');
    const pop=document.getElementById('rpt-sprints-info-pop');
    if(!btn||!pop)return;
    positionPopover(btn,pop);
    pop.classList.add('show');
    btn.classList.add('active');
  }
  function closeSprintsPopover(){
    const btn=document.getElementById('rpt-sprints-info-btn');
    const pop=document.getElementById('rpt-sprints-info-pop');
    if(pop)pop.classList.remove('show');
    if(btn)btn.classList.remove('active');
  }
  document.addEventListener('click',function(e){
    const btn=document.getElementById('rpt-sprints-info-btn');
    const pop=document.getElementById('rpt-sprints-info-pop');
    if(!btn||!pop)return;
    if(btn.contains(e.target)){
      const isOpen=pop.classList.contains('show');
      closeSprintsPopover();
      if(!isOpen)openSprintsPopover();
    }else if(!pop.contains(e.target)){
      closeSprintsPopover();
    }
  });
  let _sprintsPopCloseTimer=null;
  function scheduleCloseSprintsPopover(){
    clearTimeout(_sprintsPopCloseTimer);
    _sprintsPopCloseTimer=setTimeout(closeSprintsPopover,150);
  }
  document.addEventListener('mouseover',function(e){
    const btn=document.getElementById('rpt-sprints-info-btn');
    const pop=document.getElementById('rpt-sprints-info-pop');
    if((btn&&btn.contains(e.target))||(pop&&pop.contains(e.target))){
      clearTimeout(_sprintsPopCloseTimer);
      openSprintsPopover();
    }
  });
  document.addEventListener('mouseout',function(e){
    const btn=document.getElementById('rpt-sprints-info-btn');
    const pop=document.getElementById('rpt-sprints-info-pop');
    if(!btn||!pop)return;
    const leavingBtn=btn.contains(e.target);
    const leavingPop=pop.contains(e.target);
    if(!leavingBtn&&!leavingPop)return;
    const enteringBtn=btn.contains(e.relatedTarget);
    const enteringPop=pop.contains(e.relatedTarget);
    if(!enteringBtn&&!enteringPop){
      scheduleCloseSprintsPopover();
    }
  });
  window.addEventListener('scroll',closeSprintsPopover,true);
  window.addEventListener('resize',closeSprintsPopover);
  document.addEventListener('keydown',function(e){
    if(e.key==='Escape')closeSprintsPopover();
  });
})();

