// Sprint Planning — project filter change: cascade sprint dropdown, then re-render
function _spOnProjectFilterChange(){
  const projSel  = document.getElementById('sp-project-filter');
  const sprintSel= document.getElementById('sp-sprint-filter');
  if(!projSel||!sprintSel) return;
  const projId = projSel.value;
  // Repopulate sprint filter scoped to chosen project, RBAC-gated
  const allSpr = RBAC.getVisibleSprints().filter(s=>projId==='all'||s.project===projId);
  const activeSpr    = allSpr.filter(s=>(s.status||'').toLowerCase()==='active');
  const plannedSpr   = allSpr.filter(s=>(s.status||'').toLowerCase()==='planned');
  const completedSpr = allSpr.filter(s=>(s.status||'').toLowerCase()==='completed');
  // Reset to 'all' if current value is stale
  const cur = sprintSel.value||'all';
  const validIds = allSpr.map(s=>s.id);
  const validGroups = ['all','active-group','planned-group','completed-group'];
  if(!validGroups.includes(cur)&&!validIds.includes(cur)) sprintSel.value='all';
  _sfDropBuild('sp',[
    {groupValue:'active-group',   groupLabel:'Active Sprints',    sprints:activeSpr},
    {groupValue:'planned-group',  groupLabel:'Planned Sprints',   sprints:plannedSpr},
    {groupValue:'completed-group',groupLabel:'Completed Sprints', sprints:completedSpr}
  ],'all','All Sprints');
  _spSyncLabel(allSpr);
  _debouncedRenderSprintPlanning();
}

function _spSyncLabel(allSpr){
  const hidden=document.getElementById('sp-sprint-filter');
  const lbl=document.getElementById('sp-sprint-filter-label');
  if(!hidden||!lbl) return;
  const cur=hidden.value||'all';
  if(cur==='all') lbl.textContent='All Sprints';
  else if(cur==='active-group') lbl.textContent='Active Sprints';
  else if(cur==='planned-group') lbl.textContent='Planned Sprints';
  else if(cur==='completed-group') lbl.textContent='Completed Sprints';
  else{ const f=(allSpr||[]).find(s=>s.id===cur); lbl.textContent=f?f.name:'All Sprints'; }
}

// ─── SPRINT PLANNING ──────────────────────────────────────────────
function renderSprintPlanning(){
  // ── Populate project filter (RBAC-scoped, same pattern as dashboard) ──
  const projSel   = document.getElementById('sp-project-filter');
  const sprintSel = document.getElementById('sp-sprint-filter');
  if(projSel){
    const prevProj = projSel.value || 'all';
    const _allProj = RBAC.getVisibleProjects();
    const _activeProj    = _allProj.filter(p=>(p.status||'').toLowerCase()==='active');
    const _completedProj = _allProj.filter(p=>(p.status||'').toLowerCase()==='completed');
    let projHTML = `<option value="all">All Projects</option>`;
    if(_activeProj.length){
      projHTML += `<optgroup label="── Active Projects ──">`;
      projHTML += _activeProj.map(p=>`<option value="${p.id}"${p.id===prevProj?' selected':''}>${p.name}</option>`).join('');
      projHTML += `</optgroup>`;
    }
    if(_completedProj.length){
      projHTML += `<optgroup label="── Completed Projects ──">`;
      projHTML += _completedProj.map(p=>`<option value="${p.id}"${p.id===prevProj?' selected':''}>${p.name}</option>`).join('');
      projHTML += `</optgroup>`;
    }
    projSel.innerHTML = projHTML;
    // If previous selection no longer visible, reset to all
    if(prevProj!=='all' && !_allProj.find(p=>p.id===prevProj)) projSel.value='all';
  }

  // ── Populate sprint filter scoped to chosen project ──
  const projFilterVal = projSel ? projSel.value : 'all';
  if(sprintSel){
    const prevSpr = sprintSel.value || 'all';
    const _allSpr = RBAC.getVisibleSprints().filter(s=>projFilterVal==='all'||s.project===projFilterVal);
    const _activeSpr    = _allSpr.filter(s=>(s.status||'').toLowerCase()==='active');
    const _plannedSpr   = _allSpr.filter(s=>(s.status||'').toLowerCase()==='planned');
    const _completedSpr = _allSpr.filter(s=>(s.status||'').toLowerCase()==='completed');
    // Reset stale value
    const _validIds=[..._activeSpr,..._plannedSpr,..._completedSpr].map(s=>s.id);
    const _validGroups=['all','active-group','planned-group','completed-group'];
    if(!_validGroups.includes(prevSpr)&&!_validIds.includes(prevSpr)) sprintSel.value='all';
    _sfDropBuild('sp',[
      {groupValue:'active-group',   groupLabel:'Active Sprints',    sprints:_activeSpr},
      {groupValue:'planned-group',  groupLabel:'Planned Sprints',   sprints:_plannedSpr},
      {groupValue:'completed-group',groupLabel:'Completed Sprints', sprints:_completedSpr}
    ],'all','All Sprints');
    _spSyncLabel(_allSpr);
  }
  const sprintFilterVal = sprintSel ? sprintSel.value : 'all';

  // ── Populate Epic filter. Scoped to the chosen Project if set; otherwise,
  // if a single specific Sprint is chosen (not a status-group / "All"),
  // scope to that Sprint's own project — so picking a Sprint narrows the
  // Epic list even when the Project filter is left on "All Projects". ──
  const epicFilterEl = document.getElementById('sp-epic-filter');
  let currentEpic = epicFilterEl ? (epicFilterEl.value || 'all') : 'all';
  const _spSprintGroupValues = ['all','active-group','planned-group','completed-group'];
  let _spEpicScopeProjectId = null;
  if(projFilterVal !== 'all'){
    _spEpicScopeProjectId = projFilterVal;
  } else if(!_spSprintGroupValues.includes(sprintFilterVal)){
    const _selSprint = getSprint(sprintFilterVal);
    if(_selSprint) _spEpicScopeProjectId = _selSprint.project;
  }
  if(epicFilterEl){
    const _epicPool = state.epics || [];
    const relevantEpics = _epicPool.filter(e=>{
      if(!_spEpicScopeProjectId) return true;
      const epicProjects = e.projectIds || (e.projectId ? [e.projectId] : []);
      return epicProjects.includes(_spEpicScopeProjectId);
    });
    if(currentEpic!=='all' && !relevantEpics.find(e=>e.id===currentEpic)) currentEpic='all';
    epicFilterEl.innerHTML = `<option value="all">All Epics</option>` + relevantEpics.map(e=>`<option value="${e.id}"${e.id===currentEpic?' selected':''}>${e.title}</option>`).join('');
  }

  // ── Bulk multi-select — same shared _bulkSelect state, .bl-checkbox and
  // _blToggleTask/_blToggleGroupAll used by the Backlog Planner. Only Admin
  // / Program Manager / Senior Manager ever reach this page, so no extra
  // role gate is needed here (RBAC already blocks Team Member/Viewer access
  // to Sprint Planning). ──
  const _spCanSelect = (RBAC.isAdmin() || RBAC.isProgramManager() || RBAC.isSeniorManager());

  // Filter a sprint's tasks down to the selected Epic's tasks; unfiltered
  // when "All Epics" is selected. This actually filters what's shown (not
  // just a visual grouping) — each Epic's tasks surface under their own
  // Sprint, so picking an Epic tells you exactly which Sprint(s) it's in.
  function _spVisibleSprintTasks(tasks){
    return currentEpic==='all' ? tasks : tasks.filter(t=>t.epicId===currentEpic);
  }
  function _spRenderSprintTaskList(tasks){
    const visible = _spVisibleSprintTasks(tasks);
    if(!visible.length){
      return currentEpic==='all' ? '' : `<div class="text-xs text-slate-400 pl-1 pb-2">No tasks from this Epic in this sprint</div>`;
    }
    return visible.map(t=>sprintTaskChip(t,_spCanSelect)).join('');
  }

  // RBAC FIX: scope sprints and tasks to the current user's visible projects
  // Then apply project + sprint filter on top
  let sprints = RBAC.getVisibleSprints();
  if(projFilterVal !== 'all') sprints = sprints.filter(s=>s.project===projFilterVal);
  // Resolve group values into sprint ID sets
  if(sprintFilterVal==='active-group'){
    sprints = sprints.filter(s=>(s.status||'').toLowerCase()==='active');
  } else if(sprintFilterVal==='planned-group'){
    sprints = sprints.filter(s=>(s.status||'').toLowerCase()==='planned');
  } else if(sprintFilterVal==='completed-group'){
    sprints = sprints.filter(s=>(s.status||'').toLowerCase()==='completed');
  } else if(sprintFilterVal !== 'all'){
    sprints = sprints.filter(s=>s.id===sprintFilterVal);
  }

  const _visibleSprintIds=new Set(sprints.map(s=>s.id));
  const _visibleTasks=RBAC.getVisibleTasks(state.tasks);

  // Unassigned = no sprint; scoped to project + epic filters if set
  const unassigned=_visibleTasks.filter(t=>{
    if(t.sprint) return false;
    if(projFilterVal!=='all' && t.project!==projFilterVal) return false;
    if(currentEpic!=='all' && t.epicId!==currentEpic) return false;
    return true;
  });

  // v27: Pre-index tasks by sprint to avoid O(n*m) filter-per-sprint
  const tasksBySprintId = new Map();
  _visibleTasks.forEach(t=>{
    if(!t.sprint) return;
    if(!_visibleSprintIds.has(t.sprint)) return; // skip tasks from out-of-scope sprints
    if(!tasksBySprintId.has(t.sprint)) tasksBySprintId.set(t.sprint,[]);
    tasksBySprintId.get(t.sprint).push(t);
  });

  // Epic filter: only show sprints that actually contain a task from the
  // selected Epic (this also naturally scopes sprints to the Epic's project,
  // since a task can only carry that epicId within its own project's sprints)
  if(currentEpic!=='all'){
    sprints = sprints.filter(s=>(tasksBySprintId.get(s.id)||[]).some(t=>t.epicId===currentEpic));
  }

  // ISSUE 4: Group sprints by status, render in strict order: active → planned → completed
  const activeSprints_plan    = sprints.filter(s=>(s.status||'').toLowerCase()==='active');
  const plannedSprints_plan   = sprints.filter(s=>(s.status||'').toLowerCase()==='planned');
  const completedSprints_plan = sprints.filter(s=>(s.status||'').toLowerCase()==='completed');
  const orderedSprints = [...activeSprints_plan, ...plannedSprints_plan, ...completedSprints_plan];

  function sprintCardHtml(s){
    const proj=getProject(s.project);
    const tasks=tasksBySprintId.get(s.id)||[];
    const pts=tasks.reduce((a,t)=>a+(t.points||0),0);
    const done=tasks.filter(t=>DONE_STATUSES.includes(t.status)).length;
    const pct=tasks.length?Math.round((done/tasks.length)*100):0;
    // ── Sprint Due Alert (visual only — no workflow changes) ──────────
    const _today = new Date(); _today.setHours(0,0,0,0);
    // FIX: Parse YYYY-MM-DD by parts to avoid UTC-to-local shift.
    // new Date('2026-06-07') = UTC midnight → local June 6 in UTC+ zones.
    // new Date(2026, 5, 7) = local midnight June 7 in all zones.
    let _endRaw = null;
    if(s.end){
      const _ep = s.end.split('-');
      _endRaw = new Date(+_ep[0], +_ep[1]-1, +_ep[2]);
    }
    const _daysLeft = _endRaw ? Math.round((_endRaw - _today) / 86400000) : null;
    const _isComplete = (s.status||'').toLowerCase() === 'completed';
    let _dueBadge = '';
    if(!_isComplete && _daysLeft !== null){
      if(_daysLeft < 0){
        _dueBadge = `<span class="badge" style="background:#fef2f2;color:#dc2626;border:1px solid #fecaca;font-size:10px;padding:2px 7px;border-radius:999px;font-weight:600;white-space:nowrap" title="Sprint end date has passed. Complete or close this sprint.">🚨 Sprint Completion Due</span>`;
      } else if(_daysLeft <= 3){
        const _tip = _daysLeft === 0 ? 'Sprint ends today.' : `Sprint ends in ${_daysLeft} day${_daysLeft===1?'':'s'}.`;
        _dueBadge = `<span class="badge" style="background:#fffbeb;color:#d97706;border:1px solid #fde68a;font-size:10px;padding:2px 7px;border-radius:999px;font-weight:600;white-space:nowrap" title="${_tip}">⚠ Due Soon</span>`;
      }
    }
    // ── Active Sprint capacity utilization badge (targeted add) ──────
    const _utilBadge = s.status==='active' ? _sprintUtilizationBadgeHtml(s, pts) : '';
    // ─────────────────────────────────────────────────────────────────
    const _spVisibleTasks = _spVisibleSprintTasks(tasks);
    return `<div class="sprint-card mb-4 ${s.status==='active'?'active-sprint':''}"
      ondragover="sprintDragOver(event,'${s.id}')"
      ondrop="sprintDrop(event,'${s.id}')"
      ondragleave="sprintDragLeave(event)">
      <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <div class="flex items-center gap-2 flex-wrap">
            ${_spCanSelect && _spVisibleTasks.length ? `<input type="checkbox" class="bl-checkbox bl-group-select-all" data-ids='${JSON.stringify(_spVisibleTasks.map(t=>t.id))}' onchange="_blToggleGroupAll(this)" title="Select all tasks in this sprint" style="cursor:pointer">` : ''}
            <span class="font-semibold text-slate-900">${_escHtml(s.name)}</span>
            <span class="badge badge-${s.status}">${s.status}</span>
            ${_dueBadge}
            ${_utilBadge}
          </div>
          <div class="text-xs text-slate-500 mt-0.5">${proj?proj.name:''} · ${formatDate(s.start)} – ${formatDate(s.end)}</div>
        </div>
        <div class="flex items-center gap-3">
          <div class="text-right">
            <div class="text-sm font-bold text-slate-900">${pts} <span class="font-normal text-slate-500">pts</span></div>
            <div class="text-xs text-slate-500">${tasks.length} tasks</div>
          </div>
          ${RBAC.isAdmin()||RBAC.isProgramManager()||RBAC.isSeniorManager()?`<button class="btn btn-secondary" style="padding:4px 9px;font-size:11px" onclick="openEditSprintModal('${s.id}')">Edit</button>`:''}
          ${RBAC.isAdmin()?`<button class="btn btn-danger" style="padding:4px 9px;font-size:11px" onclick="confirmDeleteSprint('${s.id}')">×</button>`:''}
        </div>
      </div>
      ${s.goal?`<div class="bg-indigo-50 rounded-lg px-3 py-2 mb-3 text-xs text-indigo-700"><span class="font-semibold">Goal: </span>${s.goal}</div>`:''}
      <div class="progress-bar mb-3">
        <div class="progress-fill" style="width:${pct}%;background:${proj?proj.color:'#6366f1'}"></div>
      </div>
      <div class="space-y-1" id="sprint-tasks-${s.id}">
        ${_spRenderSprintTaskList(tasks)}
      </div>
      <div class="drop-zone mt-2 ${tasks.length===0?'active':''}" id="dropzone-${s.id}">↓ Drop tasks here</div>
    </div>`;
  }

  let sprintHtml = '';
  if(orderedSprints.length){
    // Render section headers per group
    if(activeSprints_plan.length){
      sprintHtml += `<div class="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2 mt-1" style="letter-spacing:.08em">Active Sprints</div>`;
      sprintHtml += activeSprints_plan.map(sprintCardHtml).join('');
    }
    if(plannedSprints_plan.length){
      sprintHtml += `<div class="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2 mt-4" style="letter-spacing:.08em">Planned Sprints</div>`;
      sprintHtml += plannedSprints_plan.map(sprintCardHtml).join('');
    }
    if(completedSprints_plan.length){
      sprintHtml += `<div class="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2 mt-4" style="letter-spacing:.08em">Completed Sprints</div>`;
      sprintHtml += completedSprints_plan.map(sprintCardHtml).join('');
    }
  } else {
    sprintHtml = `<div class="empty-state">
    <div class="empty-state-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
    <div class="text-sm">No sprints yet</div>
    ${RBAC.isAdmin()||RBAC.isProgramManager()||RBAC.isSeniorManager()?`<button class="btn btn-primary text-xs mt-3" onclick="openCreateSprintModal()">Create first sprint</button>`:''}
  </div>`;
  }

  document.getElementById('sprint-planning-list').innerHTML=sprintHtml;

  // ── Group unassigned tasks by project ────────────────────────────────────
  function _unassignedTaskCard(t){
    const _epic=t.epicId?getEpic(t.epicId):null;
    const _epicBadge=_epic?`<span class="epic-badge flex-shrink-0" style="background:${_epic.color}22;color:${_epic.color};border:1px solid ${_epic.color}55;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${_escHtml(_epic.title)}">◈ ${_escHtml(_epic.title)}</span>`:'';
    return `<div class="task-card mb-2" draggable="true"
      ondragstart="taskDragStart(event,'${t.id}')"
      ondragend="taskDragEnd(event)"
      onclick="openTaskModal('${t.id}')">
      <div class="flex items-center gap-2 mb-1">
        <span style="color:${typeColor(t.type)};font-size:13px">${typeIcon(t.type)}</span>
        <span class="badge badge-${t.priority}">${t.priority}</span>
        ${_epicBadge}
        ${_drIsCardDelayed(t,'task')?'<span class="delay-warning-dot" title="Delayed — past Due/End Date"></span>':''}
        <span class="ml-auto text-xs font-semibold text-slate-500">${t.points}sp</span>
      </div>
      <div class="text-sm font-medium text-slate-800 mb-1">${_escHtml(t.title)}</div>
      <div class="flex items-center justify-between">
        <span class="text-xs text-slate-500">${getProject(t.project)?getProject(t.project).key:'?'}</span>
        ${t.assignee?userAvatar(t.assignee,20):''}
      </div>
    </div>`;
  }

  let unassignedHtml = '';
  if(!unassigned.length){
    unassignedHtml = `<div class="text-center text-slate-400 text-sm py-6">All tasks assigned 🎉</div>`;
  } else {
    // Build ordered project groups (preserve visible project order)
    const visibleProjects = RBAC.getVisibleProjects();
    const projectOrder = visibleProjects.map(p=>p.id);
    const byProject = new Map();
    unassigned.forEach(t=>{
      const pid = t.project||'__none__';
      if(!byProject.has(pid)) byProject.set(pid,[]);
      byProject.get(pid).push(t);
    });
    // Sort project ids by visible project order; unknowns go last
    const sortedPids = [...byProject.keys()].sort((a,b)=>{
      const ai=projectOrder.indexOf(a); const bi=projectOrder.indexOf(b);
      return (ai===-1?9999:ai)-(bi===-1?9999:bi);
    });
    const multiProject = sortedPids.length > 1;
    sortedPids.forEach(pid=>{
      const proj = getProject(pid);
      const tasks = byProject.get(pid);
      if(multiProject){
        const color = proj?proj.color:'#94a3b8';
        const name  = proj?_escHtml(proj.name):'Unknown Project';
        unassignedHtml += `<div style="margin-bottom:4px;margin-top:8px;display:flex;align-items:center;gap:6px;">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></span>
          <span style="font-size:11px;font-weight:700;color:var(--text-secondary);letter-spacing:.04em;text-transform:uppercase;">${name}</span>
          <span style="font-size:10px;font-weight:600;color:var(--text-muted);margin-left:2px">${tasks.length}</span>
        </div>`;
      }
      unassignedHtml += tasks.map(_unassignedTaskCard).join('');
    });
  }
  document.getElementById('unassigned-tasks').innerHTML=unassignedHtml;

  // Keep the bulk toolbar in sync with the current selection (mirrors
  // renderBacklogPlanner's same call for the shared bulk-select feature)
  if(typeof _blUpdateBar==='function') _blUpdateBar();
}

function sprintTaskChip(t,canSelect){
  const sp=subtaskProgress(t.id);
  const _spChecked = canSelect && _blIsSelected('task:'+t.id);
  const _spChkHtml = canSelect
    ? `<input type="checkbox" class="bl-checkbox" ${_spChecked?'checked':''} onchange="_blToggleTask('${t.id}',this)" onclick="event.stopPropagation()" title="Select task" style="cursor:pointer;flex-shrink:0">`
    : '';
  return `<div class="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer group sprint-task-chip${_spChecked?' bl-selected':''}" data-task-id="${t.id}" onclick="if(event.target.type==='checkbox')return;openTaskModal('${t.id}')">
    ${_spChkHtml}
    <span style="color:${typeColor(t.type)};font-size:12px">${typeIcon(t.type)}</span>
    <span class="flex-1 text-sm text-slate-700 truncate">${_escHtml(t.title)}</span>
    ${sp.total?`<span class="text-xs text-indigo-500 font-semibold">${sp.done}/${sp.total}</span>`:''}
    ${_drIsCardDelayed(t,'task')?'<span class="delay-warning-dot" title="Delayed — past Due/End Date"></span>':''}
    <span class="badge badge-${statusBadgeClass(t.status)}" style="opacity:0.8">${statusLabel(t.status)}</span>
    <span class="text-xs text-slate-400">${t.points}sp</span>
    ${t.assignee?userAvatar(t.assignee,20):''}
    <button class="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-all text-xs ml-1" onclick="event.stopPropagation();removeTaskFromSprint('${t.id}')">✕</button>
  </div>`;
}

function taskDragStart(e,taskId){
  draggedTaskId=taskId;
  e.dataTransfer.effectAllowed='move';
  setTimeout(()=>e.target.classList.add('dragging'),0);
}
function taskDragEnd(e){
  e.target.classList.remove('dragging');
  draggedTaskId=null;
}
function sprintDragOver(e,sprintId){
  e.preventDefault();
  e.currentTarget.classList.add('drag-over');
  const dz=document.getElementById('dropzone-'+sprintId);
  if(dz){dz.classList.add('active');dz.classList.add('drag-over');}
}
function sprintDragLeave(e){
  if(!e.currentTarget.contains(e.relatedTarget)){
    e.currentTarget.classList.remove('drag-over');
    const dz=e.currentTarget.querySelector('[id^=dropzone]');
    if(dz)dz.classList.remove('drag-over');
  }
}
function sprintDrop(e,sprintId){
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const dz=document.getElementById('dropzone-'+sprintId);
  if(dz)dz.classList.remove('drag-over');
  if(!draggedTaskId)return;
  // ISSUE 1: Block drop onto completed sprints
  const targetSprint=getSprint(sprintId);
  if(targetSprint&&targetSprint.status==='completed'){
    showNotif('Cannot map tasks to completed sprint','error');
    return;
  }
  const task=getTask(draggedTaskId);
  if(task){
    // Cross-project guard: task and sprint must belong to the same project
    if(task.project && targetSprint && targetSprint.project && task.project !== targetSprint.project){
      showNotif('This task belongs to a different project and cannot be assigned to this sprint.','error');
      return;
    }
    // ISSUE 2: Block move if task's source sprint is completed — only once the
    // task itself is Released; anything else (still in progress, in QA, etc.)
    // sitting in a completed sprint is spillover that should still be movable.
    const sourceSprint=task.sprint?getSprint(task.sprint):null;
    if(sourceSprint&&sourceSprint.status==='completed'&&task.status==='released'){
      showNotif('Tasks from completed sprints are locked','error');
      return;
    }
    const _ntPrevSprintAssignee = task.assignee || null;
    const _ntPrevSprintStatus   = task.status   || null;
    task.sprint=sprintId;
    // ── Firebase: persist task sprint assignment ──
    FirebaseDB.saveEntity('tasks', task).catch(e=>console.warn('[sprintDrop] Firebase error:',e));
    SaveManager.save();
    // ── Notification: task moved into sprint ──
    console.log('[NotificationTriggers] task trigger fired — sprintDrop', task.id);
    try{ NotificationTriggers._onTaskSaved(task, { prevAssignee: _ntPrevSprintAssignee, prevStatus: _ntPrevSprintStatus }); }
    catch(e){ console.error('Notification pipeline error', e); }
    renderSprintPlanning();
    showNotif(`Task moved to ${getSprint(sprintId)?.name||'sprint'} ✓`);
  }
}

// ─── CREATE SPRINT ────────────────────────────────────────────────
function openCreateSprintModal(){
  if(RBAC.isMember()||RBAC.isViewer()){ showNotif('⚠ Only admins, senior managers, and program managers can create sprints','error'); return; }
  const sprintProjects=RBAC.getVisibleProjects().filter(p=>(p.status||'').toLowerCase()==='active');
  openModal(`
    <div class="p-6">
      <div class="flex items-center justify-between mb-5">
        <h2 class="text-lg font-bold text-slate-900">Create New Sprint</h2>
        <button onclick="closeModal()" style="color:var(--text-muted);cursor:pointer;transition:color 0.14s" onmouseenter="this.style.color='var(--text-primary)'" onmouseleave="this.style.color='var(--text-muted)'"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
      <div class="space-y-4">
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label>Sprint Name *</label>
            <input type="text" id="cs-name" placeholder="e.g. Sprint 2"/>
          </div>
          <div>
            <label>Project</label>
            <select id="cs-project">
              ${sprintProjects.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label>Start Date</label>
            <input type="date" id="cs-start" value="${new Date().toISOString().split('T')[0]}" onchange="csOnStartDateChange(this.value)"/>
          </div>
          <div>
            <label>End Date</label>
            <input type="date" id="cs-end"/>
          </div>
        </div>
        <div>
          <label>Sprint Goal</label>
          <textarea id="cs-goal" rows="2" placeholder="What is the primary goal for this sprint?"></textarea>
        </div>
      </div>
      <div class="flex justify-end gap-3 mt-6 pt-4" style="border-top:1px solid rgba(0,0,0,0.05)">
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="createSprint()">Create Sprint</button>
      </div>
    </div>
  `);
  const end=new Date();end.setDate(end.getDate()+14);
  document.getElementById('cs-end').value=end.toISOString().split('T')[0];
}

function csOnStartDateChange(startVal){
  const endEl = document.getElementById('cs-end');
  if(!endEl) return;
  endEl.min = startVal || '';
  if(startVal && endEl.value && endEl.value < startVal){
    endEl.value = '';
  }
}

function createSprint(){
  if(RBAC.isMember()||RBAC.isViewer()){ showNotif('⚠ Only admins, senior managers, and program managers can create sprints','error'); return; }
  const name=document.getElementById('cs-name').value.trim();
  if(!name){showNotif('⚠ Sprint name required','error');return;}
  const startDate=document.getElementById('cs-start').value;
  const endDate=document.getElementById('cs-end').value;
  if(startDate && endDate && endDate < startDate){
    showNotif('⚠ End date cannot be earlier than start date','error');
    return;
  }
  const now=_now();
  const sprint={
    id:spid(),
    name,
    project:document.getElementById('cs-project').value,
    start:document.getElementById('cs-start').value,
    end:document.getElementById('cs-end').value,
    status:'planned',
    goal:document.getElementById('cs-goal').value.trim(),
    createdAt:now,
    updatedAt:now
  };
  state.sprints.push(sprint);
  invalidateStateMaps();
  _invalidateSearchCache();
  // ── Firebase: persist new sprint; queue if unavailable ──
  SyncState.markPending(sprint.id);
  if(FirebaseDB.isReady()){
    FirebaseDB.saveEntity('sprints', sprint).then(ok=>{
      if(ok){ SyncState.markSynced(sprint.id); }
      else   { SyncState.markFailed(sprint.id); PendingSyncQueue.saveEntity('sprints', sprint); }
    }).catch(()=>{ SyncState.markFailed(sprint.id); PendingSyncQueue.saveEntity('sprints', sprint); });
  } else {
    PendingSyncQueue.saveEntity('sprints', sprint);
  }
  SaveManager.save();
  closeModal();
  // ── Notification: sprint created ──
  console.log('[NotificationTriggers] sprint trigger fired — createSprint', sprint.id);
  try{ NotificationTriggers._onSprintSaved(sprint, { isNew: true, prevStatus: null }); }
  catch(e){ console.error('Notification pipeline error', e); }
  refreshAll();
  showNotif(`${name} created ✓`);
}

// ─── EDIT / DELETE SPRINT ─────────────────────────────────────────
function openEditSprintModal(sprintId){
  const s=getSprint(sprintId);
  if(!s)return;
  // ── Field-freeze flags ──
  const isCompleted = isSprintCompleted(s);
  const _sdis = (cond) => cond ? 'disabled' : '';
  const sprintProjects=RBAC.getVisibleProjects().filter(p=>(p.status||'').toLowerCase()==='active');
  openModal(`
    <div class="p-6">
      <div class="flex items-center justify-between mb-5">
        <h2 class="text-lg font-bold text-slate-900">Edit Sprint${isCompleted?' <span style="font-size:11px;font-weight:500;color:#dc2626;background:#fef2f2;border:1px solid #fecaca;padding:2px 7px;border-radius:4px;vertical-align:middle">Completed — Locked</span>':''}</h2>
        <button onclick="closeModal()" style="color:var(--text-muted);cursor:pointer;transition:color 0.14s" onmouseenter="this.style.color='var(--text-primary)'" onmouseleave="this.style.color='var(--text-muted)'"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
      <div class="space-y-4">
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label>Sprint Name *</label>
            <input type="text" id="es-name" value="${_escHtml(s.name)}" ${_sdis(isCompleted)}/>
          </div>
          <div>
            <label>Project</label>
            <select id="es-project" disabled title="Project cannot be changed after sprint creation">
              ${sprintProjects.map(p=>`<option value="${p.id}"${p.id===s.project?' selected':''}>${p.name}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label>Start Date</label>
            <input type="date" id="es-start" value="${s.start||''}" disabled title="Sprint dates cannot be changed after creation"/>
          </div>
          <div>
            <label>End Date</label>
            <input type="date" id="es-end" value="${s.end||''}" disabled title="Sprint dates cannot be changed after creation"/>
          </div>
        </div>
        <div>
          <label>Status</label>
          <select id="es-status" ${_sdis(isCompleted)}>
            ${(()=>{
              const _ss=s.status;
              const _allSprint=[
                {v:'planned',l:'Planned'},
                {v:'active', l:'Active'},
                {v:'completed',l:'Completed'}
              ];
              // Forward-only: only show current status and statuses ahead of it
              const _sprintOrder={planned:0,active:1,completed:2};
              const _curOrd=_sprintOrder[_ss]??0;
              return _allSprint
                .filter(x=>(_sprintOrder[x.v]??0)>=_curOrd)
                .map(x=>`<option value="${x.v}"${_ss===x.v?' selected':''}>${x.l}</option>`)
                .join('');
            })()}
          </select>
        </div>
        <div>
          <label>Sprint Goal</label>
          <textarea id="es-goal" rows="2" ${_sdis(isCompleted)}>${s.goal||''}</textarea>
        </div>
      </div>
      <div class="flex justify-end gap-3 mt-6 pt-4" style="border-top:1px solid rgba(0,0,0,0.05)">
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        ${isCompleted?'':`<button class="btn btn-primary" onclick="saveSprint('${s.id}')">Save Changes</button>`}
      </div>
    </div>
  `);
}

function saveSprint(sprintId){
  const s=getSprint(sprintId);
  if(!s)return;
  // ── Completed sprint is fully locked ──
  if(isSprintCompleted(s)){
    showNotif('⚠ Completed sprints are locked and cannot be edited.','error');
    return;
  }
  const name=document.getElementById('es-name').value.trim();
  if(!name){showNotif('⚠ Sprint name required','error');return;}
  const newStatus=document.getElementById('es-status').value;

  // ── SPRINT COMPLETION INTERCEPT ────────────────────────────────────
  // Only fires when transitioning INTO 'completed' (not already completed).
  if(newStatus==='completed' && s.status!=='completed'){
    const sprintTasks=state.tasks.filter(t=>t.sprint===sprintId);
    const sprintSubs=sprintTasks.flatMap(t=>t.subtasks||[]);
    const unfinished=[...sprintTasks,...sprintSubs]
      .filter(i=>!SPILLOVER_DONE_STATUSES.includes(i.status));
    if(unfinished.length>0){
      // Stash form values — modal replaces this one, form DOM is gone after.
      window._scPending={
        sprintId,
        fields:{
          name,
          project:document.getElementById('es-project').value,
          start:document.getElementById('es-start').value,
          end:document.getElementById('es-end').value,
          goal:document.getElementById('es-goal').value.trim()
        },
        unfinishedCount:unfinished.length
      };
      _openSprintCompletionModal();
      return; // halt normal save — completion modal takes over
    }
  }
  // ── Normal save path (no completion intercept needed) ─────────────
  const _ntSprintPrevStatus = s.status; // capture BEFORE mutation
  s.name=name;
  s.project=document.getElementById('es-project').value;
  // Dates are frozen after creation — never overwrite from disabled fields
  // s.start and s.end remain unchanged
  s.status=newStatus;
  s.goal=document.getElementById('es-goal').value.trim();
  s.updatedAt=_now();
  invalidateStateMaps();
  // ── Firebase: persist updated sprint; queue if unavailable ──
  SyncState.markPending(s.id);
  if(FirebaseDB.isReady()){
    FirebaseDB.saveEntity('sprints', s).then(ok=>{
      if(ok){ SyncState.markSynced(s.id); }
      else   { SyncState.markFailed(s.id); PendingSyncQueue.saveEntity('sprints', s); }
    }).catch(()=>{ SyncState.markFailed(s.id); PendingSyncQueue.saveEntity('sprints', s); });
  } else {
    PendingSyncQueue.saveEntity('sprints', s);
  }
  SaveManager.save();
  closeModal();
  // ── Retrospective: auto-create board when sprint first enters 'completed' ──
  if(_ntSprintPrevStatus !== 'completed' && s.status === 'completed'){
    console.log('[Retro] Sprint completed:', s.id);
    const _retroAlready = (state.retrospectives||[]).find(r=>r.sprintId===s.id);
    if(_retroAlready){
      console.log('[Retro] Retrospective already exists:', s.id);
    } else {
      console.log('[Retro] Creating retrospective board:', s.id);
      try{ RetroManager.createForSprint(s); } catch(e){ console.warn('[Retro] creation error:',e); }
    }
    // ── Release auto-creation: auto-create a release when sprint first enters 'completed' ──
    _autoCreateReleaseForSprint(s);
  }
  // ── Notification: sprint updated / completed ──
  console.log('[NotificationTriggers] sprint trigger fired — saveSprint', s.id);
  try{ NotificationTriggers._onSprintSaved(s, { isNew: false, prevStatus: _ntSprintPrevStatus }); }
  catch(e){ console.error('Notification pipeline error', e); }
  refreshAll();
  showNotif('Sprint updated ✓');
}

// ── SPRINT COMPLETION MODAL ────────────────────────────────────────────────
// Replaces the edit sprint modal in-place (openModal with _modalOpen=true).
// All data flows through window._scPending set by saveSprint() above.
function _openSprintCompletionModal(){
  const p=window._scPending;
  if(!p)return;
  const s=getSprint(p.sprintId);
  if(!s)return;
  const availableSprints=state.sprints.filter(
    sp=>sp.id!==p.sprintId&&sp.project===s.project&&sp.status!=='completed'
  );
  const hasTargets=availableSprints.length>0;
  const sprintOpts=availableSprints.map(sp=>
    `<option value="${sp.id}">${sp.name}</option>`
  ).join('');
  openModal(`
    <div style="width:460px;max-width:92vw">

      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;padding:20px 22px 0">
        <h2 style="font-size:16px;font-weight:700;color:var(--text-primary);margin:0">Complete Sprint</h2>
        <button onclick="closeModal()"
          style="display:flex;align-items:center;justify-content:center;
                 width:28px;height:28px;border-radius:6px;border:none;
                 background:transparent;color:var(--text-muted);cursor:pointer;
                 transition:background .14s,color .14s;flex-shrink:0"
          onmouseenter="this.style.background='var(--control-bg)';this.style.color='var(--text-primary)'"
          onmouseleave="this.style.background='transparent';this.style.color='var(--text-muted)'">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="spillover-ui">

        <!-- Alert banner -->
        <div class="spillover-alert">
          <svg class="spillover-alert-icon" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <div class="spillover-alert-body">
            <span><b>${p.unfinishedCount} unfinished item${p.unfinishedCount!==1?'s':''}</b> found in <b>${_escHtml(s.name)}</b></span>
            <div class="spillover-sub">Choose where unfinished work should move.</div>
          </div>
        </div>

        <!-- Section label -->
        <div class="spillover-title">Move unfinished items to</div>

        <!-- Option: Backlog -->
        <label id="_sc-lbl-backlog" class="spillover-option is-selected">
          <input type="radio" name="_sc-dest" value="backlog" id="_sc-radio-backlog"
                 checked onchange="_scUpdateUI()"/>
          <div class="spillover-radio-dot"></div>
          <div class="spillover-option-body">
            <div class="spillover-option-title">Move to Backlog</div>
            <div class="spillover-option-desc">Remove sprint assignment. Tasks will appear in the project backlog.</div>
          </div>
        </label>

        <!-- Option: Another Sprint -->
        <label id="_sc-lbl-sprint" class="spillover-option"
               style="cursor:${hasTargets?'pointer':'default'};opacity:${hasTargets?'1':'0.45'}">
          <input type="radio" name="_sc-dest" value="sprint" id="_sc-radio-sprint"
                 ${hasTargets?'':'disabled'} onchange="_scUpdateUI()"/>
          <div class="spillover-radio-dot"></div>
          <div class="spillover-option-body">
            <div class="spillover-option-title">Move to another Sprint</div>
            <div class="spillover-option-desc">${hasTargets?'Transfer unfinished work to an active sprint.':'No other active sprints available in this project.'}</div>
            ${hasTargets?`
              <select id="_sc-target-sprint" disabled>
                <option value="" disabled selected>Select a sprint…</option>
                ${sprintOpts}
              </select>
            `:''}
          </div>
        </label>

        <!-- Footer -->
        <div class="spillover-footer">
          <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" onclick="_executeSprintCompletion()">Complete Sprint</button>
        </div>

      </div>
    </div>
  `);
  requestAnimationFrame(()=>_scUpdateUI());
}

// Toggle active label highlight + enable/disable sprint dropdown on radio change
function _scUpdateUI(){
  const isSprint=document.getElementById('_sc-radio-sprint')?.checked;
  const sel=document.getElementById('_sc-target-sprint');
  // Enable/disable dropdown — stays in DOM for stable layout
  if(sel){
    sel.disabled=!isSprint;
    sel.style.opacity=isSprint?'1':'0.4';
    sel.style.pointerEvents=isSprint?'auto':'none';
    sel.style.cursor=isSprint?'pointer':'not-allowed';
  }
  // Toggle is-selected class on option cards (drives CSS custom radio + border)
  const bl=document.getElementById('_sc-lbl-backlog');
  const sl=document.getElementById('_sc-lbl-sprint');
  if(bl) bl.classList.toggle('is-selected',!isSprint);
  if(sl) sl.classList.toggle('is-selected',!!isSprint);
}

// Executes the transfer + marks sprint completed.
// Reads sprint id & pending fields from window._scPending (set by saveSprint).
function _executeSprintCompletion(){
  const p=window._scPending;
  if(!p){closeModal();return;}
  const s=getSprint(p.sprintId);
  if(!s){closeModal();return;}

  const destRadio=document.querySelector('input[name="_sc-dest"]:checked');
  const dest=destRadio?destRadio.value:'backlog';
  const targetSprintId=dest==='sprint'
    ?(document.getElementById('_sc-target-sprint')?.value||null)
    :null;

  if(dest==='sprint'&&!targetSprintId){
    showNotif('⚠ Please select a target sprint','error');
    return;
  }

  // ── Find all parent tasks that need to move ──────────────────────
  // A parent task must move if:
  //   (a) it is itself unfinished, OR
  //   (b) it is done but has at least one unfinished subtask
  // Sprint membership is tracked on the parent task only.
  const sprintTasks=state.tasks.filter(t=>t.sprint===p.sprintId);
  const toMove=sprintTasks.filter(t=>
    !SPILLOVER_DONE_STATUSES.includes(t.status)||
    (t.subtasks||[]).some(sub=>!SPILLOVER_DONE_STATUSES.includes(sub.status))
  );

  // ── FIX(Issue 1): Snapshot spillover counts BEFORE tasks are reassigned ──
  // After toMove reassigns t.sprint, the completed sprint has zero tasks pointing
  // to it, so the spillover chart reads 0. We capture counts here and store them
  // on the sprint object so the chart can read stored values for completed sprints.
  const _spilloverParentCount = toMove.filter(t => !SPILLOVER_DONE_STATUSES.includes(t.status)).length;
  const _spilloverSubCount    = toMove.reduce((acc, t) => {
    return acc + (t.subtasks||[]).filter(sub => !SPILLOVER_DONE_STATUSES.includes(sub.status)).length;
  }, 0);

  // ── Release Reports enhancement: snapshot POINTS alongside existing count snapshot ──
  // Reuses the SAME sprintTasks / toMove sets already computed above — no new spillover
  // model is introduced. Captured BEFORE reassignment so committed (full sprint scope)
  // is preserved even after spilled tasks lose their sprint link.
  // Committed = points of every task+subtask in the sprint at completion.
  const _committedPts = sprintTasks.reduce((acc, t) =>
    acc + (t.points||0) + (t.subtasks||[]).reduce((a,sub)=>a+(sub.points||0),0), 0);
  // Spillover = points of the unfinished parents + unfinished subtasks being moved out.
  const _spilloverPts = toMove.reduce((acc, t) => {
    const parentPts = !SPILLOVER_DONE_STATUSES.includes(t.status) ? (t.points||0) : 0;
    const subPts = (t.subtasks||[]).filter(sub => !SPILLOVER_DONE_STATUSES.includes(sub.status))
                                   .reduce((a,sub)=>a+(sub.points||0),0);
    return acc + parentPts + subPts;
  }, 0);

  toMove.forEach(t=>{
    t.sprint=dest==='sprint'?targetSprintId:null;
    t.updatedAt=_now();
    if(FirebaseDB.isReady()){
      FirebaseDB.saveEntity('tasks',t).catch(e=>
        console.warn('[_executeSprintCompletion] Firebase task error:',t.id,e)
      );
    } else {
      PendingSyncQueue.saveEntity('tasks',t);
    }
  });

  // ── Apply pending sprint fields + mark completed ─────────────────
  s.name    =p.fields.name;
  s.project =p.fields.project;
  s.start   =p.fields.start;
  s.end     =p.fields.end;
  s.goal    =p.fields.goal;
  s.status  ='completed';
  s.updatedAt=_now();
  // ── FIX(Issue 1): Persist spillover snapshot on sprint so chart reads correctly ──
  s.spilloverTasks    = _spilloverParentCount;
  s.spilloverSubtasks = _spilloverSubCount;
  // Release Reports: persisted point snapshot (committed at completion + spilled points)
  s.committedPoints   = _committedPts;
  s.spilloverPoints   = _spilloverPts;
  invalidateStateMaps();

  SyncState.markPending(s.id);
  if(FirebaseDB.isReady()){
    FirebaseDB.saveEntity('sprints',s).then(ok=>{
      if(ok){ SyncState.markSynced(s.id); }
      else  { SyncState.markFailed(s.id); PendingSyncQueue.saveEntity('sprints',s); }
    }).catch(()=>{ SyncState.markFailed(s.id); PendingSyncQueue.saveEntity('sprints',s); });
  } else {
    PendingSyncQueue.saveEntity('sprints',s);
  }

  SaveManager.save(); // FIX: always persist — sprint now carries spilloverTasks/spilloverSubtasks regardless of toMove count
  window._scPending=null; // clean up stash
  // ── Retrospective: auto-create board on sprint completion ──────────
  console.log('[Retro] Sprint completed:', s.id);
  const _retroExists = (state.retrospectives||[]).find(r=>r.sprintId===s.id);
  if(_retroExists){
    console.log('[Retro] Retrospective already exists:', s.id);
  } else {
    console.log('[Retro] Creating retrospective board:', s.id);
    try{ RetroManager.createForSprint(s); } catch(e){ console.warn('[Retro] creation error:',e); }
  }
  // ── Release auto-creation: auto-create a release when sprint completes via completion modal ──
  _autoCreateReleaseForSprint(s);
  // ── Notification: sprint completed via completion modal ──
  console.log('[NotificationTriggers] sprint trigger fired — _executeSprintCompletion', s.id);
  try{ NotificationTriggers._onSprintSaved(s, { isNew: false, prevStatus: 'active' }); }
  catch(e){ console.error('Notification pipeline error', e); }
  closeModal();
  refreshAll();

  const destName=dest==='sprint'
    ?`moved to "${getSprint(targetSprintId)?.name||'sprint'}"`
    :'moved to backlog';
  showNotif(`Sprint completed ✓ — ${toMove.length} task${toMove.length!==1?'s':''} ${destName}`);
}

function confirmDeleteSprint(sprintId){
  if(!RBAC.isAdmin()){ showNotif('⚠ Only admins can delete sprints','error'); return; }
  const s=getSprint(sprintId);
  if(!s)return;
  const taskCount=state.tasks.filter(t=>t.sprint===sprintId).length;
  const msg=taskCount
    ?`Delete "${s.name}"? ${taskCount} task(s) will be moved to backlog.`
    :`Delete "${s.name}"?`;
  if(!confirm(msg))return;
  // ── Referential integrity: strip sprintId from tasks and releases ──
  cleanupSprintReferences(sprintId);
  state.sprints=state.sprints.filter(sp=>sp.id!==sprintId);
  invalidateStateMaps();
  _invalidateSearchCache();
  // ── Firebase: delete sprint; queue if unavailable ──
  if(FirebaseDB.isReady()){
    FirebaseDB.deleteEntity('sprints', sprintId).catch(e=>console.warn('[confirmDeleteSprint] Firebase error:',e));
  } else {
    PendingSyncQueue.deleteEntity('sprints', sprintId);
  }
  SaveManager.save();
  refreshAll();
  showNotif('Sprint deleted');
}

