function taskRow(t, epicViewMode){
  const proj=getProject(t.project);
  const assignee=getUser(t.assignee);
  const sp=subtaskProgress(t.id);
  const hasSubtasks=sp.total>0;
  const epic=t.epicId?getEpic(t.epicId):null;
  const subRows=hasSubtasks?(t.subtasks||[]).map(s=>{
    const sa=getUser(s.assignee);
    const _blCanSelectSub = !epicViewMode && (RBAC.isAdmin() || RBAC.isProgramManager() || RBAC.isSeniorManager());
    const _blSubKey = 'sub:'+t.id+':'+s.id;
    const _blSubChecked = _blCanSelectSub && _blIsSelected(_blSubKey);
    const _subChkHtml = _blCanSelectSub
      ? `<input type="checkbox" class="bl-checkbox" style="margin-left:0;position:relative;z-index:2;flex-shrink:0;cursor:pointer" ${_blSubChecked?'checked':''} onchange="_blToggleSubtask('${t.id}','${s.id}',this)" onclick="event.stopPropagation()" title="Select subtask">`
      : '';
    return `<div class="backlog-subtask-row${_blSubChecked?' bl-selected':''}" id="bl-item-sub-${t.id}-${s.id}" onclick="if(event.target.type==='checkbox')return;event.stopPropagation();openSubtaskModal('${t.id}','${s.id}')">
      ${_subChkHtml}
      <div class="subtask-status-dot" style="background:${subtaskStatusDot(s.status)}"></div>
      ${_drIsCardDelayed(s,'subtask')?'<span class="delay-warning-dot" title="Delayed — past Due/End Date"></span>':''}
      <span class="text-xs text-slate-500 flex-1 truncate">${_escHtml(s.title)}</span>
      <span class="badge badge-${statusBadgeClass(s.status)}" style="font-size:9px">${statusLabel(s.status)}</span>
      <span class="text-xs text-slate-400">${s.points||0}sp</span>
      ${sa?userAvatar(s.assignee,18):''}
    </div>`;
  }).join(''):'';
  const _blCanSelect = !epicViewMode && (RBAC.isAdmin() || RBAC.isProgramManager() || RBAC.isSeniorManager());
  const _blChecked   = _blCanSelect && _blIsSelected('task:'+t.id);
  const _chkHtml     = _blCanSelect
    ? `<input type="checkbox" class="bl-checkbox" ${_blChecked?'checked':''} onchange="_blToggleTask('${t.id}',this)" onclick="event.stopPropagation()" title="Select task" style="position:relative;z-index:2;flex-shrink:0;cursor:pointer">`
    : '';
  return `<div>
    <div class="backlog-item group${_blChecked?' bl-selected':''}" id="bl-item-task-${t.id}" data-task-id="${t.id}" onclick="if(event.target.type==='checkbox')return;openTaskModal('${t.id}')">
      ${_chkHtml}
      ${hasSubtasks?`<button class="text-slate-400 hover:text-indigo-500 flex-shrink-0 transition-colors" onclick="event.stopPropagation();toggleBacklogSubtasks('${t.id}')" title="Toggle subtasks">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" id="btoggle-icon-${t.id}" style="transition:transform 0.2s"><path d="M9 18l6-6-6-6"/></svg>
      </button>`:'<span style="width:12px;flex-shrink:0"></span>'}
      <span style="color:${typeColor(t.type)};font-size:16px;width:16px;text-align:center;flex-shrink:0">${typeIcon(t.type)}</span>
      <span class="text-xs font-mono text-slate-400 flex-shrink-0">${proj?proj.key:'?'}-${t.id.slice(-3).toUpperCase()}</span>
      ${epic?`<span class="epic-badge flex-shrink-0" style="background:${epic.color}22;color:${epic.color};border:1px solid ${epic.color}55;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${_escHtml(epic.title)}">◈ ${_escHtml(epic.title)}</span>`:''}
      <div class="flex-1 min-w-0">
        <span class="text-sm text-slate-800 font-medium">${_escHtml(t.title)}</span>
        ${hasSubtasks?`<span class="ml-2 text-xs text-indigo-500 font-semibold">${sp.done}/${sp.total} subtasks · ${sp.pct}%</span>`:''}
      </div>
      <div class="hidden sm:flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        ${(t.tags||[]).slice(0,2).map(tag=>_coloredChip(tag,_tagColorByName(tag),'tag')).join('')}
        ${t.themeName?_coloredChip(t.themeName,t.themeColor||'var(--accent)','tag'):''}
      </div>
      ${_drIsCardDelayed(t,'task')?'<span class="delay-warning-dot" title="Delayed — past Due/End Date"></span>':''}
      <span class="badge badge-${t.priority} hidden sm:inline-flex">${t.priority}</span>
      <span class="badge badge-${statusBadgeClass(t.status)}">${statusLabel(t.status)}</span>
      <span class="text-xs font-semibold text-slate-500 w-8 text-right flex-shrink-0">${t.points}sp</span>
      ${assignee?userAvatar(t.assignee,24):`<div class="avatar" style="width:24px;height:24px;background:#f1f5f9;border:1px dashed #cbd5e1"></div>`}
    </div>
    ${hasSubtasks?`<div id="bsubs-${t.id}" style="max-height:0;overflow:hidden;transition:max-height 0.3s ease;padding-left:24px">
      <div class="subtask-connector mt-1 mb-1">${_blSubRows(t, subRows)}</div>
    </div>`:''}
  </div>`;
}


// ─── BACKLOG PLANNER ────────────────────────────────────────────────
// Stack-ranks Product Backlog items by a computed priority score, so a PM
// can see what to pull into the next sprint without manually re-reading
// every "Critical"/"High" tag. Deliberately reads ONLY fields that already
// exist on a task (priority, points, due/end date, createdDate) — no new
// data entry required to start using it.
//
// Score = (Value + Urgency + Aging) ÷ Effort(points)
//   Value   — from the existing Priority field (critical/high/medium/low)
//   Urgency — how close (or overdue) the Due/End Date is
//   Aging   — small boost for items that have sat untouched in the backlog
//   Effort  — existing Story Points, used as the WSJF-style divisor so
//             small-and-urgent items can outrank big-and-urgent ones
const _BLP_VALUE_WEIGHT = {critical:8, high:5, medium:3, low:1};

// ── Sprint Capacity: auto-suggested "ideal" value from team size ───────────
// Assumption: one team member completes ~8 story points per sprint on average
// (a common agile rule-of-thumb starting point, not a measured velocity — this
// app doesn't track per-sprint velocity yet). Ideal = sum of each member's
// role-weighted points (see _BLP_ROLE_POINTS below).
// The PM can always type their own number in; once they do, auto-suggestion
// steps aside (see _blpCapacityTouched) until they click "Use ideal" again.
const _BLP_POINTS_PER_MEMBER = 8; // Team Member rate — also the fallback for legacy/unknown roles
// Role-based sp/member: only Team Members are full-time delivery — PM/Senior
// Manager split their sprint between planning/oversight and hands-on work, and
// Admin/Viewer don't pick up sprint work at all, so they shouldn't inflate a
// project's ideal capacity the same way a Team Member does.
const _BLP_ROLE_POINTS = {
  team_member: _BLP_POINTS_PER_MEMBER,
  program_manager: 4,
  senior_manager: 4,
  viewer: 0,
  admin: 0
};
let _blpCapacityTouched = false;

// Resolve a member's sp/sprint contribution from their role (see _BLP_ROLE_POINTS).
// Legacy 'member' role and any unrecognized/missing role fall back to the
// Team Member rate, same as the rest of the app treats those cases.
function _blpMemberPoints(userId){
  const u = getUser(userId);
  const role = u ? u.role : null;
  return (role && Object.prototype.hasOwnProperty.call(_BLP_ROLE_POINTS, role)) ? _BLP_ROLE_POINTS[role] : _BLP_POINTS_PER_MEMBER;
}

function _blpIdealCapacity(projectId){
  let memberCount, capacity;
  if(projectId && projectId!=='all'){
    const proj = getProject(projectId);
    const memberIds = (proj && Array.isArray(proj.memberIds)) ? proj.memberIds : [];
    memberCount = memberIds.length;
    // A member shared across multiple projects can't give this project their
    // full sp/sprint — they're splitting their time. Prorate each member's
    // (role-weighted) contribution by how many (visible) projects they're
    // staffed on, so a project full of shared members doesn't get credited
    // with velocity it doesn't actually have. Members dedicated to just this
    // project still count their full role-based rate.
    const projectCountByMember = new Map();
    RBAC.getVisibleProjects().forEach(p=>(p.memberIds||[]).forEach(id=>{
      projectCountByMember.set(id, (projectCountByMember.get(id)||0)+1);
    }));
    capacity = memberIds.reduce((sum,id)=>sum + (_blpMemberPoints(id) / (projectCountByMember.get(id)||1)), 0);
  } else {
    // "All Projects": unique members across every project visible to this user —
    // each member's full (role-weighted) capacity is counted once, no need to prorate.
    const ids = new Set();
    RBAC.getVisibleProjects().forEach(p=>(p.memberIds||[]).forEach(id=>ids.add(id)));
    memberCount = ids.size;
    capacity = 0;
    ids.forEach(id=>{ capacity += _blpMemberPoints(id); });
  }
  const hadMembers = memberCount > 0;
  if(!memberCount) memberCount = 1; // guard: never suggest a 0-member project
  if(!hadMembers) capacity = _BLP_POINTS_PER_MEMBER; // guard: no members at all — assume one default contributor
  return {memberCount, capacity: Math.round(capacity)};
}

function _blpUseIdealCapacity(){
  _blpCapacityTouched = false;
  renderBacklogPlanner();
}

// ── ACTIVE SPRINT CAPACITY UTILIZATION — Kanban + Sprint Planning ──────────
// Reuses _blpIdealCapacity() (team size × pts/member) as the sprint's target
// capacity, with a ±10% buffer: within that band counts as well-utilized,
// above it is Overloaded, below it is Underutilized.
function _sprintUtilization(sprint, pointsUsed){
  const ideal = _blpIdealCapacity(sprint ? sprint.project : 'all');
  const capacity = ideal.capacity;
  const lower = capacity * 0.9;
  const upper = capacity * 1.1;
  let status, label, cls;
  if(pointsUsed > upper){ status='overloaded'; label='Overloaded'; cls='blp-util-over'; }
  else if(pointsUsed < lower){ status='under'; label='Underutilized'; cls='blp-util-under'; }
  else { status='ok'; label='Well Utilized'; cls='blp-util-ok'; }
  return {status, label, cls, capacity, pointsUsed, memberCount: ideal.memberCount};
}

function _sprintUtilizationBadgeHtml(sprint, pointsUsed){
  const u = _sprintUtilization(sprint, pointsUsed);
  return `<span class="blp-util-badge ${u.cls}" title="Capacity ${u.capacity}sp (${u.memberCount} member${u.memberCount!==1?'s':''}, role-weighted sp/member, prorated for members shared with other projects), ±10% buffer">${u.pointsUsed}/${u.capacity} pts — ${u.label}</span>`;
}

function _blpUrgencyScore(t){
  const raw = t.dueDate || t.endDate;
  if(!raw) return 0;
  const due = new Date(raw);
  if(isNaN(due.getTime())) return 0;
  const today = new Date(); today.setHours(0,0,0,0);
  const days = Math.round((due - today) / 86400000);
  if(days < 0) return 10;   // overdue
  if(days <= 7) return 6;   // due this week
  if(days <= 30) return 3;  // due this month
  return 0;
}

function _blpAgingScore(t){
  const created = t.createdDate || t.createdAt;
  if(!created) return 0;
  const createdMs = typeof created==='number' ? created : new Date(created).getTime();
  if(isNaN(createdMs)) return 0;
  const ageDays = (Date.now() - createdMs) / 86400000;
  if(ageDays <= 0) return 0;
  return Math.min(5, Math.floor(ageDays / 30)); // +1 per 30 days idle, capped at +5
}

function computeBacklogPriorityScore(t){
  const value   = _BLP_VALUE_WEIGHT[t.priority] || 1;
  const urgency = _blpUrgencyScore(t);
  const aging   = _blpAgingScore(t);
  const effort  = Math.max(1, t.points || 1); // guard divide-by-zero
  const score   = (value + urgency + aging) / effort;
  return {score: Math.round(score*100)/100, value, urgency, aging, effort};
}

function renderBacklogPlanner(){
  const filterEl      = document.getElementById('blp-project-filter');
  const epicFilterEl  = document.getElementById('blp-epic-filter');
  const statusFilterEl= document.getElementById('blp-status-filter');
  const capacityEl    = document.getElementById('blp-capacity');
  const capacityHintEl= document.getElementById('blp-capacity-hint');
  if(!filterEl) return;
  const currentProj = filterEl.value || 'all';
  const currentEpic = epicFilterEl ? (epicFilterEl.value||'all') : 'all';
  let currentStatus = statusFilterEl ? (statusFilterEl.value||'all') : 'all';

  // Populate project/epic dropdowns
  filterEl.innerHTML = `<option value="all">All Projects</option>` + RBAC.getVisibleProjects().map(p=>`<option value="${p.id}"${p.id===currentProj?' selected':''}>${p.name}</option>`).join('');
  if(epicFilterEl){
    const _epicPool = RBAC.isViewer() ? RBAC.getVisibleEpics() : (state.epics||[]);
    const relevantEpics = _epicPool.filter(e=>{
      if(currentProj==='all') return true;
      const epicProjects = e.projectIds || (e.projectId ? [e.projectId] : []);
      return epicProjects.includes(currentProj);
    });
    epicFilterEl.innerHTML = `<option value="all">All Epics</option>` + relevantEpics.map(e=>`<option value="${e.id}"${e.id===currentEpic?' selected':''}>${e.title}</option>`).join('');
  }

  // ── Sprint Capacity: auto-suggest from the selected project's team size,
  // but never fight a value the PM has typed in manually. ──
  const ideal = _blpIdealCapacity(currentProj);
  if(capacityEl && !_blpCapacityTouched) capacityEl.value = ideal.capacity;
  const capacity = capacityEl ? (parseInt(capacityEl.value)||0) : 0;
  if(capacityHintEl){
    capacityHintEl.innerHTML = (currentProj==='all'
        ? `Ideal: <strong>${ideal.capacity}sp</strong> (${ideal.memberCount} member${ideal.memberCount!==1?'s':''}, role-weighted sp/member)`
        : `Ideal: <strong>${ideal.capacity}sp</strong> (${ideal.memberCount} member${ideal.memberCount!==1?'s':''}, role-weighted sp/member — prorated for members shared with other projects)`)
      + (_blpCapacityTouched ? ` · <a href="javascript:void(0)" onclick="_blpUseIdealCapacity()" style="color:var(--accent);font-weight:600;text-decoration:none">Use ideal</a>` : '');
  }

  let tasks = RBAC.getVisibleTasks(currentProj==='all' ? state.tasks : state.tasks.filter(t=>t.project===currentProj));
  if(currentEpic!=='all') tasks = tasks.filter(t=>t.epicId===currentEpic);

  // Scope to true Product Backlog items (no sprint assigned). Finished-status
  // tasks (e.g. Released) are NOT excluded — the Importer and other flows can
  // create tasks with a final status that never get assigned to a sprint, and
  // those still need to be visible/rankable in the backlog.
  const _visSprintIds = new Set(RBAC.getVisibleSprints().map(s=>s.id));
  tasks = tasks.filter(t => !t.sprint || !_visSprintIds.has(t.sprint));

  // ── Status filter: options reflect only statuses actually present among
  // the current project/epic-scoped backlog items (mirrors the epic filter's
  // pattern of scoping to what's relevant rather than every possible value). ──
  if(statusFilterEl){
    const presentStatuses = Array.from(new Set(tasks.map(t=>t.status))).filter(s=>STATUS_META[s]);
    presentStatuses.sort((a,b)=>Object.keys(STATUS_META).indexOf(a)-Object.keys(STATUS_META).indexOf(b));
    statusFilterEl.innerHTML = `<option value="all">All Statuses</option>` + presentStatuses.map(s=>`<option value="${s}"${s===currentStatus?' selected':''}>${statusLabel(s)}</option>`).join('');
    if(currentStatus!=='all' && !presentStatuses.includes(currentStatus)){ statusFilterEl.value='all'; currentStatus='all'; }
  }
  if(currentStatus!=='all') tasks = tasks.filter(t=>t.status===currentStatus);

  const contentEl = document.getElementById('backlog-planner-content');
  if(!contentEl) return;

  if(!tasks.length){
    contentEl.innerHTML = `<div class="empty-state py-10">
      <div class="empty-state-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg></div>
      <div class="text-sm text-slate-400">No backlog items to rank 🎉</div>
    </div>`;
    if(typeof _blUpdateBar==='function') _blUpdateBar();
    return;
  }

  const ranked = [];
  tasks.forEach(t=>{
    try{ ranked.push({task:t, ...computeBacklogPriorityScore(t)}); }
    catch(e){ console.error('[Backlog Planner] Skipping malformed task (score calc):', t&&t.id, e); }
  });
  ranked.sort((a,b)=>b.score-a.score);

  // ── Bulk multi-select — uses the shared _bulkSelect state and the
  // _blToggleTask/_blToggleGroupAll functions (see BACKLOG PLANNER BULK-SELECT
  // & BULK ACTIONS above). ──
  const _blpCanSelect = (RBAC.isAdmin() || RBAC.isProgramManager() || RBAC.isSeniorManager());
  const _blpIds = ranked.map(r=>r.task.id);
  const _blpAllChecked = _blpCanSelect && _blpIds.length>0 && _blpIds.every(id=>_blIsSelected('task:'+id));
  const _blpSelectAllHtml = (_blpCanSelect && _blpIds.length>0)
    ? `<input type="checkbox" class="bl-checkbox bl-group-select-all" ${_blpAllChecked?'checked':''} data-ids='${JSON.stringify(_blpIds)}' onchange="_blToggleGroupAll(this)" title="Select all ranked items" style="cursor:pointer">`
    : '';

  let cumPts = 0;
  let cutlineDrawn = !capacity;
  const rows = ranked.map((r,i)=>{
    try{
      const t = r.task;
      const proj = getProject(t.project);
      const epic = t.epicId ? getEpic(t.epicId) : null;
      const assignee = getUser(t.assignee);
      cumPts += (t.points||0);
      let cutlineHtml = '';
      if(!cutlineDrawn && cumPts >= capacity){
        cutlineDrawn = true;
        cutlineHtml = `<div class="blp-cutline" title="Everything above this line fits within the ${capacity}sp sprint capacity you entered"><span>▲ Fits in next sprint (${capacity}sp capacity)</span></div>`;
      }
      const _blpChecked = _blpCanSelect && _blIsSelected('task:'+t.id);
      const _blpChkHtml = _blpCanSelect
        ? `<input type="checkbox" class="bl-checkbox" ${_blpChecked?'checked':''} onchange="_blToggleTask('${t.id}',this)" onclick="event.stopPropagation()" title="Select task" style="position:relative;z-index:2;flex-shrink:0;cursor:pointer">`
        : '';
      const row = `<div class="backlog-item group${_blpChecked?' bl-selected':''}" id="bl-item-planner-task-${t.id}" data-task-id="${t.id}" onclick="if(event.target.type==='checkbox')return;openTaskModal('${t.id}')">
        ${_blpChkHtml}
        <span class="text-xs font-semibold text-slate-400 w-6 text-right flex-shrink-0">#${i+1}</span>
        <span style="color:${typeColor(t.type)};font-size:16px;width:16px;text-align:center;flex-shrink:0">${typeIcon(t.type)}</span>
        <span class="text-xs font-mono text-slate-400 flex-shrink-0">${proj?proj.key:'?'}-${String(t.id).slice(-3).toUpperCase()}</span>
        ${epic?`<span class="epic-badge flex-shrink-0" style="background:${epic.color}22;color:${epic.color};border:1px solid ${epic.color}55;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${_escHtml(epic.title)}">◈ ${_escHtml(epic.title)}</span>`:''}
        <div class="flex-1 min-w-0"><span class="text-sm text-slate-800 font-medium">${_escHtml(t.title)}</span></div>
        <span class="badge badge-${statusBadgeClass(t.status)} hidden sm:inline-flex">${statusLabel(t.status)}</span>
        <span class="badge badge-${t.priority} hidden sm:inline-flex">${t.priority}</span>
        <span class="text-xs font-mono text-slate-400 hidden md:inline-flex flex-shrink-0" title="Value ${r.value} + Urgency ${r.urgency} + Aging ${r.aging}, divided by ${r.effort} story points">${r.value}+${r.urgency}+${r.aging} ÷ ${r.effort}sp</span>
        <span class="badge" style="background:rgba(91,95,199,0.12);color:#4648b0;font-weight:700" title="Computed priority score">${r.score.toFixed(1)}</span>
        <span class="text-xs font-semibold text-slate-500 w-8 text-right flex-shrink-0">${t.points||0}sp</span>
        ${assignee?userAvatar(t.assignee,24):`<div class="avatar" style="width:24px;height:24px;background:#f1f5f9;border:1px dashed #cbd5e1"></div>`}
      </div>`;
      return cutlineHtml + row;
    }catch(e){
      console.error('[Backlog Planner] Skipping malformed task row:', r.task&&r.task.id, e);
      return '';
    }
  }).join('');

  contentEl.innerHTML = `<div class="card mb-4">
    <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
      <div class="flex items-center gap-3">
        ${_blpSelectAllHtml}
        <span class="font-semibold text-slate-900">Ranked Backlog</span>
        <span class="badge badge-open">${ranked.length} items</span>
      </div>
      <span class="text-xs text-slate-500">${ranked.reduce((a,r)=>a+(r.task.points||0),0)} pts total</span>
    </div>
    <div class="space-y-1">${rows}</div>
  </div>`;

  // Keep the bulk toolbar in sync with the current selection
  if(typeof _blUpdateBar==='function') _blUpdateBar();
}

