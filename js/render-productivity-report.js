// ══════════════════════════════════════════════════════════════════
//  PRODUCTIVITY REPORT — Admin-only · Filter state
// ══════════════════════════════════════════════════════════════════
const _prSelProjs     = new Set(); // empty = All
const _prSelAssignees = new Set(); // empty = All
let   _prDatePreset    = '90';     // default: last 90 days
let   _prDateStart     = null;
let   _prDateEnd       = null;

// ── Date helpers ─────────────────────────────────────────────────
function _prComputeDateRange(){
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if(_prDatePreset === '7'){
    _prDateStart = new Date(today); _prDateStart.setDate(today.getDate() - 6);
    _prDateEnd   = new Date(today); _prDateEnd.setHours(23,59,59,999);
  } else if(_prDatePreset === '30'){
    _prDateStart = new Date(today); _prDateStart.setDate(today.getDate() - 29);
    _prDateEnd   = new Date(today); _prDateEnd.setHours(23,59,59,999);
  } else if(_prDatePreset === '90'){
    _prDateStart = new Date(today); _prDateStart.setDate(today.getDate() - 89);
    _prDateEnd   = new Date(today); _prDateEnd.setHours(23,59,59,999);
  } else if(_prDatePreset === 'thismonth'){
    _prDateStart = new Date(now.getFullYear(), now.getMonth(), 1);
    _prDateEnd   = new Date(now.getFullYear(), now.getMonth()+1, 0, 23,59,59,999);
  } else if(_prDatePreset === 'lastmonth'){
    _prDateStart = new Date(now.getFullYear(), now.getMonth()-1, 1);
    _prDateEnd   = new Date(now.getFullYear(), now.getMonth(), 0, 23,59,59,999);
  } else {
    _prDateStart = null; _prDateEnd = null; // all time
  }
}

function _prOnDatePreset(){
  const sel = document.getElementById('pr-date-preset');
  if(!sel) return;
  _prDatePreset = sel.value;
  const cr = document.getElementById('pr-custom-dates');
  if(_prDatePreset === 'custom'){
    if(cr) cr.style.display = 'inline-flex';
    _prUpdateDateChip(); return;
  }
  if(cr) cr.style.display = 'none';
  _prComputeDateRange();
  _prUpdateDateChip();
  renderProductivityReport();
}

function _prOnCustomDate(){
  const f = document.getElementById('pr-date-from');
  const t = document.getElementById('pr-date-to');
  if(!f || !t || !f.value || !t.value) return;
  _prDateStart = new Date(f.value + 'T00:00:00');
  _prDateEnd   = new Date(t.value + 'T23:59:59');
  _prUpdateDateChip();
  renderProductivityReport();
}

function _prClearDateFilter(){
  _prDatePreset = 'all';
  _prDateStart  = null; _prDateEnd = null;
  const sel = document.getElementById('pr-date-preset');
  if(sel) sel.value = 'all';
  const cr = document.getElementById('pr-custom-dates');
  if(cr) cr.style.display = 'none';
  _prUpdateDateChip();
  renderProductivityReport();
}

function _prUpdateDateChip(){
  const chip     = document.getElementById('pr-date-chip');
  const clearBtn = document.getElementById('pr-date-clear-btn');
  if(!chip || !clearBtn) return;
  const labels = {'7':'Last 7 Days','30':'Last 30 Days','90':'Last 90 Days','thismonth':'This Month','lastmonth':'Last Month'};
  if(_prDatePreset === 'all'){
    chip.style.display = 'none'; clearBtn.style.display = 'none';
  } else if(_prDatePreset === 'custom'){
    const f = document.getElementById('pr-date-from');
    const t = document.getElementById('pr-date-to');
    if(f && t && f.value && t.value){
      chip.innerHTML = `<span class="rr-date-active-chip">📅 ${f.value} → ${t.value}</span>`;
      chip.style.display = 'inline'; clearBtn.style.display = 'inline';
    }
  } else {
    chip.innerHTML = `<span class="rr-date-active-chip">📅 ${labels[_prDatePreset]||_prDatePreset}</span>`;
    chip.style.display = 'inline'; clearBtn.style.display = 'inline';
  }
}

// ── Multi-select drop helpers ─────────────────────────────────────
function _prToggleProjDrop(e){
  const p = document.getElementById('sf-msdrop-panel');
  if(p && p.style.display !== 'none' && _prToggleProjDrop._open){
    _sfMsDrop.apply(); _prToggleProjDrop._open = false; return;
  }
  const allProj = RBAC.getVisibleProjects();
  const active    = allProj.filter(p=>(p.status||'').toLowerCase()==='active');
  const completed = allProj.filter(p=>(p.status||'').toLowerCase()==='completed');
  const items = [
    ...active.map(p=>({id:p.id,name:p.name,group:'Active'})),
    ...completed.map(p=>({id:p.id,name:p.name,group:'Completed'}))
  ];
  _sfMsDrop.open(
    document.getElementById('pr-proj-btn'), items, _prSelProjs,
    sel=>{ _prSelProjs.clear(); sel.forEach(id=>_prSelProjs.add(id)); renderProductivityReport(); },
    document.getElementById('pr-proj-label')
  );
  document.getElementById('pr-proj-label').dataset.allLabel = 'All Projects';
  _prToggleProjDrop._open = true;
}
_prToggleProjDrop._open = false;

function _prToggleAssigneeDrop(e){
  const p = document.getElementById('sf-msdrop-panel');
  if(p && p.style.display !== 'none' && _prToggleAssigneeDrop._open){
    _sfMsDrop.apply(); _prToggleAssigneeDrop._open = false; return;
  }
  // Members scoped to selected projects
  const selPids = [..._prSelProjs];
  let members = (state.users||[]).filter(u=>u.id&&u.name&&u.role!=='admin');
  if(selPids.length){
    const memberSet = new Set();
    RBAC.getVisibleProjects().filter(p=>selPids.includes(p.id)).forEach(p=>{
      (p.memberIds||[]).forEach(id=>memberSet.add(id));
    });
    members = members.filter(u=>memberSet.has(u.id));
  }
  const items = members.map(u=>({id:u.id,name:u.name||u.email||u.id,group:''}))
    .sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  _sfMsDrop.open(
    document.getElementById('pr-asgn-btn'), items, _prSelAssignees,
    sel=>{ _prSelAssignees.clear(); sel.forEach(id=>_prSelAssignees.add(id)); renderProductivityReport(); },
    document.getElementById('pr-asgn-label')
  );
  document.getElementById('pr-asgn-label').dataset.allLabel = 'All Members';
  _prToggleAssigneeDrop._open = true;
}
_prToggleAssigneeDrop._open = false;

// ── Core data computation ─────────────────────────────────────────
// Collect sprint IDs in date range (using sprint.start and sprint.end)
function _prGetFilteredSprintIds(){
  _prComputeDateRange();
  const allSpr = RBAC.getVisibleSprints();
  const selPids = [..._prSelProjs];
  let sprints = selPids.length ? allSpr.filter(s=>selPids.includes(s.project)) : allSpr;
  if(_prDateStart && _prDateEnd){
    sprints = sprints.filter(s=>{
      if(!s.start || !s.end) return false;
      const ss = new Date(s.start + 'T00:00:00');
      const se = new Date(s.end   + 'T23:59:59');
      return ss <= _prDateEnd && se >= _prDateStart;
    });
  }
  return new Set(sprints.map(s=>s.id));
}

// RELEASED status (tasks that count as "released")
const _PR_RELEASED_STATUSES = ['released'];
// COMPLETED = done but not necessarily released (ready-for-prod + released)
const _PR_DONE_STATUSES     = ['ready-for-prod','released'];
// ACTIVE (utilization)
const _PR_ACTIVE_STATUSES   = ['open','dev-in-progress','in-qa','qa-in-progress'];

function _prCalcScore(released, completed, totalAssigned, relPoints, donePoints, reopenCount, totalAssignedPoints){
  // 40% Released Work, 30% Completed Work, 20% Story Points Delivered, 10% QA Quality
  const relRate  = totalAssigned > 0 ? Math.min(1, released / totalAssigned) : 0;
  const compRate = totalAssigned > 0 ? Math.min(1, completed / totalAssigned) : 0;
  const ptRate   = totalAssignedPoints > 0 ? Math.min(1, donePoints / totalAssignedPoints) : 0;
  const qaItems  = released + completed; // items that went through QA cycle
  const reopenPct = qaItems > 0 ? Math.min(100, (reopenCount / qaItems) * 100) : 0;
  const qaScore  = (100 - reopenPct) / 100;
  return Math.round(40*relRate + 30*compRate + 20*ptRate + 10*qaScore);
}

function _prScoreBadge(score){
  if(score >= 80) return {label:'Excellent',color:'#10b981',bg:'rgba(16,185,129,0.1)'};
  if(score >= 60) return {label:'Good',color:'#f59e0b',bg:'rgba(245,158,11,0.1)'};
  return {label:'Attention Needed',color:'#ef4444',bg:'rgba(239,68,68,0.1)'};
}

function _prUtilLabel(activePts){
  if(activePts <= 15)  return {label:'Underutilized',color:'#94a3b8'};
  if(activePts <= 40)  return {label:'Healthy',color:'#10b981'};
  if(activePts <= 60)  return {label:'High Load',color:'#f59e0b'};
  return {label:'Overloaded',color:'#ef4444'};
}

function _prTopPerformerScore(relPts, compPts, compRate, qaQuality){
  // 50% Released Points (normalised to 100), 25% Completed Points, 15% Completion Rate, 10% QA Quality
  return relPts * 0.5 + compPts * 0.25 + compRate * 15 + qaQuality * 10;
}

// Build per-user metrics from filtered sprint scope
function _prBuildUserMetrics(sprintIdSet){
  const allTasks    = state.tasks || [];
  const allUsers    = state.users || [];
  const selPids     = [..._prSelProjs];
  const selAsgns    = [..._prSelAssignees];

  // Scope tasks to filtered sprints and projects
  const scopedTasks = allTasks.filter(t=>{
    if(!sprintIdSet.has(t.sprint)) return false;
    if(selPids.length && !selPids.includes(t.project)) return false;
    return true;
  });

  // Build flat list: tasks + subtasks each with parent fields
  const flatItems = [];
  scopedTasks.forEach(t=>{
    flatItems.push({...t, _type:'task', _parentId:null});
    (t.subtasks||[]).forEach(st=>{
      flatItems.push({
        ...st,
        _type:'subtask',
        _parentId:t.id,
        project: st.project || t.project,
        sprint:  st.sprint  || t.sprint,
        releaseId: st.releaseId || t.releaseId,
        epicId: st.epicId || t.epicId
      });
    });
  });

  // All users in scope — exclude admins to match dropdown behaviour
  const _baseMembers = allUsers.filter(u=>u.id&&u.name&&u.role!=='admin');
  let members;
  if(selAsgns.length){
    members = _baseMembers.filter(u=>selAsgns.includes(u.id));
  } else if(selPids.length){
    const mset = new Set();
    RBAC.getVisibleProjects().filter(p=>selPids.includes(p.id)).forEach(p=>(p.memberIds||[]).forEach(id=>mset.add(id)));
    members = _baseMembers.filter(u=>mset.has(u.id));
  } else {
    members = _baseMembers;
  }

  // Group scoped items by assignee/QA-assignee ONCE — this loop previously
  // re-filtered flatItems (and, below, re-flattened the FULL unscoped
  // state.tasks from scratch) for every single member, i.e. O(members ×
  // items), which gets slow with 150+ members and a large task list.
  const _prByAssignee = new Map();
  const _prByQaAssignee = new Map();
  flatItems.forEach(it=>{
    if(it.assignee){
      if(!_prByAssignee.has(it.assignee)) _prByAssignee.set(it.assignee,[]);
      _prByAssignee.get(it.assignee).push(it);
    }
    if(it.qaAssigneeId){
      if(!_prByQaAssignee.has(it.qaAssigneeId)) _prByQaAssignee.set(it.qaAssigneeId,[]);
      _prByQaAssignee.get(it.qaAssigneeId).push(it);
    }
  });
  // Full (unscoped) task+subtask list grouped by assignee, for the "current
  // state" utilization metric below — intentionally NOT scoped to the
  // selected sprints/projects, so it can't reuse flatItems/_prByAssignee.
  const _prAllByAssignee = new Map();
  (state.tasks||[]).forEach(t=>{
    const items=[{...t,_type:'task'}];
    (t.subtasks||[]).forEach(st=>items.push({...st,_type:'subtask',project:st.project||t.project}));
    items.forEach(it=>{
      if(!it.assignee) return;
      if(!_prAllByAssignee.has(it.assignee)) _prAllByAssignee.set(it.assignee,[]);
      _prAllByAssignee.get(it.assignee).push(it);
    });
  });

  const metrics = {};
  members.forEach(u=>{
    // Items assigned to this user
    const assigned = _prByAssignee.get(u.id) || [];
    const asDevAssigned = assigned; // full credit as developer
    // Items where user is QA assignee (and not also the developer)
    const asQA = (_prByQaAssignee.get(u.id) || []).filter(it=>it.assignee !== u.id);

    const tasks_assigned   = assigned.filter(it=>it._type==='task').length;
    const subs_assigned    = assigned.filter(it=>it._type==='subtask').length;
    const tasks_completed  = assigned.filter(it=>it._type==='task'    && _PR_DONE_STATUSES.includes(it.status)).length;
    const subs_completed   = assigned.filter(it=>it._type==='subtask' && _PR_DONE_STATUSES.includes(it.status)).length;
    const tasks_released   = assigned.filter(it=>it._type==='task'    && _PR_RELEASED_STATUSES.includes(it.status)).length;
    const subs_released    = assigned.filter(it=>it._type==='subtask' && _PR_RELEASED_STATUSES.includes(it.status)).length;

    const totalAssigned    = tasks_assigned + subs_assigned;
    const totalCompleted   = tasks_completed + subs_completed;
    const totalReleased    = tasks_released + subs_released;

    const devPts  = assigned.filter(it=>_PR_DONE_STATUSES.includes(it.status)).reduce((a,it)=>a+(it.points||0),0);
    const qaPts   = asQA.filter(it=>_PR_DONE_STATUSES.includes(it.status)).reduce((a,it)=>a+(it.points||0),0);
    const totalPts= devPts; // QA points additive for display but not double-counted in scoring
    const assignedPts = assigned.reduce((a,it)=>a+(it.points||0),0);

    // Reopens: items where this user is assignee that have status 'reopen' (counted once per item)
    const reopenCount = assigned.filter(it=>it.status==='reopen').length;

    const score = totalAssigned > 0 ? _prCalcScore(totalReleased, totalCompleted, totalAssigned, devPts, devPts, reopenCount, assignedPts) : 0;

    // Utilization: active items currently (not sprint-scoped — current state)
    const allAssignedAll = _prAllByAssignee.get(u.id) || [];
    const activePts = allAssignedAll.filter(it=>_PR_ACTIVE_STATUSES.includes(it.status)).reduce((a,it)=>a+(it.points||0),0);

    // Projects this user touches in scope
    const projSet = new Set(assigned.map(it=>it.project).filter(Boolean));

    const compRate = totalAssigned > 0 ? Math.round((totalCompleted/totalAssigned)*100) : 0;
    const relPts   = assigned.filter(it=>_PR_RELEASED_STATUSES.includes(it.status)).reduce((a,it)=>a+(it.points||0),0);

    metrics[u.id] = {
      user: u, tasks_assigned, subs_assigned, tasks_completed, subs_completed,
      tasks_released, subs_released, totalAssigned, totalCompleted, totalReleased,
      devPts, qaPts, totalPts, assignedPts, reopenCount, score,
      activePts, projSet, compRate, relPts,
      flatItems: assigned
    };
  });
  return { metrics, flatItems, scopedTasks };
}

// ── Main render ───────────────────────────────────────────────────
function renderProductivityReport(){
  if(!RBAC.isAdmin() && !RBAC.isSeniorManager()) return; // guard — menu hidden, but double-check
  try{ _renderProductivityReport(); }catch(e){ console.error('[PR] render error:',e); }
}

let _prDebounceTimer = null;
function _prDebounced(){ clearTimeout(_prDebounceTimer); _prDebounceTimer = setTimeout(()=>renderProductivityReport(), 120); }

function _renderProductivityReport(){
  // Initialise date on first render
  _prComputeDateRange();

  const sprintIdSet = _prGetFilteredSprintIds();
  const { metrics, flatItems, scopedTasks } = _prBuildUserMetrics(sprintIdSet);
  const userMetrics = Object.values(metrics);

  const _set = (id,v)=>{ const el=document.getElementById(id); if(el) el.textContent=v; };
  const contentEl = document.getElementById('pr-content');
  const emptyEl   = document.getElementById('pr-empty');

  const totalAssigned = userMetrics.reduce((a,m)=>a+m.totalAssigned,0);

  if(userMetrics.length === 0 || totalAssigned === 0){
    if(contentEl) contentEl.style.display = 'none';
    if(emptyEl)   emptyEl.style.display   = '';
    // Still fill KPI zeros
    _set('pr-kpi-members', userMetrics.length);
    _set('pr-kpi-assigned', 0); _set('pr-kpi-completed', 0);
    _set('pr-kpi-released', 0); _set('pr-kpi-points', 0);
    _set('pr-kpi-score', '—');
    document.getElementById('pr-summary-card').style.display = 'none';
    return;
  }
  if(contentEl) contentEl.style.display = '';
  if(emptyEl)   emptyEl.style.display   = 'none';

  // ── KPI cards ──
  const totalCompleted = userMetrics.reduce((a,m)=>a+m.totalCompleted,0);
  const totalReleased  = userMetrics.reduce((a,m)=>a+m.totalReleased,0);
  const totalPts       = userMetrics.reduce((a,m)=>a+m.devPts,0);
  const avgScore       = userMetrics.length ? Math.round(userMetrics.reduce((a,m)=>a+m.score,0)/userMetrics.length) : 0;
  _set('pr-kpi-members',   userMetrics.length);
  _set('pr-kpi-assigned',  totalAssigned);
  _set('pr-kpi-completed', totalCompleted);
  _set('pr-kpi-released',  totalReleased);
  _set('pr-kpi-points',    totalPts);
  const avgBadge = _prScoreBadge(avgScore);
  const scoreEl  = document.getElementById('pr-kpi-score');
  if(scoreEl){ scoreEl.textContent = avgScore; scoreEl.style.color = avgBadge.color; }
  _set('pr-kpi-score-sub', avgBadge.label);

  // ── Single-member summary card ──
  const selAsgns = [..._prSelAssignees];
  const summaryCard = document.getElementById('pr-summary-card');
  if(selAsgns.length === 1 && metrics[selAsgns[0]]){
    const m = metrics[selAsgns[0]];
    const badge = _prScoreBadge(m.score);
    const util  = _prUtilLabel(m.activePts);
    summaryCard.style.display = '';
    const avEl = document.getElementById('pr-summary-avatar');
    if(avEl) avEl.innerHTML = userAvatar(m.user.id, 36);
    _set('pr-summary-name', m.user.name||m.user.email||'—');
    const badgeEl = document.getElementById('pr-summary-score-badge');
    if(badgeEl){ badgeEl.textContent = `${m.score} · ${badge.label}`; badgeEl.style.background = badge.bg; badgeEl.style.color = badge.color; }
    const grid = document.getElementById('pr-summary-grid');
    if(grid){
      const kpis = [
        ['Projects',        [...m.projSet].map(pid=>{const p=getProject(pid);return p?p.name:pid;}).join(', ')||'—'],
        ['Assigned Tasks',  m.tasks_assigned],
        ['Assigned Subtasks',m.subs_assigned],
        ['Completed Tasks', m.tasks_completed],
        ['Completed Subtasks',m.subs_completed],
        ['Released Tasks',  m.tasks_released],
        ['Released Subtasks',m.subs_released],
        ['Delivered SP',    m.devPts],
        ['QA Points',       m.qaPts],
        ['Reopen Count',    m.reopenCount],
        ['Productivity Score', `${m.score}/100`],
        ['Utilization',     `${m.activePts} SP · ${util.label}`],
      ];
      grid.innerHTML = kpis.map(([label,val])=>`
        <div style="background:rgba(0,0,0,0.025);border-radius:var(--r-md);padding:10px 14px">
          <div style="font-size:11px;color:var(--text-tertiary);font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">${_escHtml(label)}</div>
          <div style="font-size:14px;font-weight:700;color:var(--text-primary)">${_escHtml(String(val))}</div>
        </div>`).join('');
    }
    // Project contribution table
    const pcBody = document.getElementById('pr-proj-contrib-tbody');
    const pcDiv  = document.getElementById('pr-proj-contribution');
    if(pcBody && m.projSet.size > 0){
      if(pcDiv) pcDiv.style.display = '';
      pcBody.innerHTML = [...m.projSet].map((pid,idx)=>{
        const proj = getProject(pid);
        const pItems = m.flatItems.filter(it=>it.project===pid);
        const pAsgn  = pItems.length;
        const pComp  = pItems.filter(it=>_PR_DONE_STATUSES.includes(it.status)).length;
        const pRel   = pItems.filter(it=>_PR_RELEASED_STATUSES.includes(it.status)).length;
        const pPts   = pItems.filter(it=>_PR_DONE_STATUSES.includes(it.status)).reduce((a,it)=>a+(it.points||0),0);
        const bg     = idx%2!==0?'background:rgba(0,0,0,0.018)':'';
        return `<tr style="${bg};border-bottom:1px solid rgba(0,0,0,0.05)">
          <td style="padding:9px 12px;font-weight:500">${_escHtml(proj?proj.name:pid)}</td>
          <td style="padding:9px 12px;text-align:right">${pAsgn}</td>
          <td style="padding:9px 12px;text-align:right">${pComp}</td>
          <td style="padding:9px 12px;text-align:right">${pRel}</td>
          <td style="padding:9px 12px;text-align:right">${pPts}</td>
        </tr>`;
      }).join('');
    } else {
      if(pcDiv) pcDiv.style.display = 'none';
    }
  } else {
    summaryCard.style.display = 'none';
  }

  // ── Top Performers ──
  const selPids = [..._prSelProjs];
  let topCandidates = userMetrics;
  if(selPids.length){
    topCandidates = topCandidates.filter(m=>[...m.projSet].some(pid=>selPids.includes(pid)));
  }
  const topRaw = topCandidates.map(m=>{
    // Normalise released points score for ranking (higher = better)
    const relPtsNorm  = m.relPts;
    const compPtsNorm = m.devPts;
    const qaQ = m.totalAssigned > 0 ? Math.max(0, 1 - m.reopenCount / Math.max(1,m.totalAssigned)) : 1;
    const tScore = _prTopPerformerScore(relPtsNorm, compPtsNorm, m.compRate/100, qaQ);
    return { ...m, tScore };
  }).sort((a,b)=>b.tScore-a.tScore).slice(0,10);

  const topBody = document.getElementById('pr-top-performers-tbody');
  if(topBody){
    topBody.innerHTML = topRaw.length ? topRaw.map((m,i)=>{
      const badge = _prScoreBadge(m.score);
      const projs = [...m.projSet].map(pid=>{const p=getProject(pid);return p?p.name:pid;}).slice(0,2).join(', ')+(m.projSet.size>2?'…':'');
      return `<tr style="border-bottom:1px solid rgba(0,0,0,0.05)${i===0?';background:rgba(99,102,241,0.04)':''}">
        <td style="padding:8px 10px;font-weight:700;color:${i===0?'#6366f1':'#94a3b8'};text-align:center;width:28px">${i+1}</td>
        <td style="padding:8px 10px;font-weight:600;color:var(--text-primary)">${_escHtml(m.user.name||m.user.email)}</td>
        <td style="padding:8px 10px;color:var(--text-secondary);font-size:11px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_escHtml(projs||'—')}</td>
        <td style="padding:8px 10px;text-align:right;font-variant-numeric:tabular-nums">${m.relPts}</td>
        <td style="padding:8px 10px;text-align:right">${m.compRate}%</td>
        <td style="padding:8px 10px;text-align:right;font-weight:700;color:#6366f1;font-variant-numeric:tabular-nums">${Math.round(m.tScore)}</td>
        <td style="padding:8px 10px;text-align:right;font-weight:700;color:${badge.color}">${m.score}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="7" style="padding:14px;text-align:center;color:var(--text-tertiary);font-size:13px">No data</td></tr>';
  }

  // ── Team Productivity Table ──
  const sortKey = (document.getElementById('pr-sort-col')||{}).value || 'score';
  const sortedMetrics = [...userMetrics].sort((a,b)=>{
    const map = {
      score: b.score - a.score,
      released: b.totalReleased - a.totalReleased,
      completed: b.totalCompleted - a.totalCompleted,
      assigned: b.totalAssigned - a.totalAssigned,
      points: b.devPts - a.devPts,
      completion_pct: b.compRate - a.compRate,
      utilization: b.activePts - a.activePts
    };
    return map[sortKey] !== undefined ? map[sortKey] : 0;
  });

  const teamBody = document.getElementById('pr-team-tbody');
  if(teamBody){
    teamBody.innerHTML = sortedMetrics.map((m,idx)=>{
      const badge = _prScoreBadge(m.score);
      const util  = _prUtilLabel(m.activePts);
      const projs = [...m.projSet].map(pid=>{const p=getProject(pid);return p?p.name:pid;}).slice(0,2).join(', ')+(m.projSet.size>2?'…':'');
      const bg    = idx%2!==0?'background:rgba(0,0,0,0.018)':'';
      return `<tr style="${bg};border-bottom:1px solid rgba(0,0,0,0.05)">
        <td style="padding:9px 12px;font-weight:600;white-space:nowrap">${_escHtml(m.user.name||m.user.email)}</td>
        <td style="padding:9px 12px;color:var(--text-secondary);font-size:11px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_escHtml(projs||'—')}</td>
        <td style="padding:9px 12px;text-align:right;font-variant-numeric:tabular-nums">${m.totalAssigned}</td>
        <td style="padding:9px 12px;text-align:right;font-variant-numeric:tabular-nums">${m.totalCompleted}</td>
        <td style="padding:9px 12px;text-align:right;font-variant-numeric:tabular-nums">${m.totalReleased}</td>
        <td style="padding:9px 12px;text-align:right;font-variant-numeric:tabular-nums">${m.devPts}</td>
        <td style="padding:9px 12px;text-align:right;font-variant-numeric:tabular-nums">${m.qaPts}</td>
        <td style="padding:9px 12px;text-align:right">${m.compRate}%</td>
        <td style="padding:9px 12px;text-align:right;font-weight:700;color:${badge.color}">${m.score}</td>
        <td style="padding:9px 12px"><span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;color:${util.color};background:${util.color}18;border-radius:999px;padding:2px 9px">${m.activePts} SP · ${util.label}</span></td>
      </tr>`;
    }).join('') || '<tr><td colspan="10" style="padding:14px;text-align:center;color:var(--text-tertiary)">No data</td></tr>';
  }

  // ── Workload Distribution Chart ──
  const wlSorted = [...userMetrics].sort((a,b)=>b.activePts-a.activePts);
  if(charts.prWorkload){ try{charts.prWorkload.destroy();}catch(e){} delete charts.prWorkload; }
  const wCtx = _getCtx('prWorkloadChart');
  if(wCtx){
    const wIn = document.getElementById('pr-workload-inner');
    if(wIn){
      const scrollWrap = wIn.parentElement;
      // Derive available height from the scroll wrapper (which is flex:1); fall back to 240px
      const availH = (scrollWrap && scrollWrap.clientHeight > 40) ? scrollWrap.clientHeight : 240;
      wIn.style.height = availH + 'px';
      const w = (scrollWrap && scrollWrap.clientWidth) || 600;
      wIn.style.width = Math.max(w, (wlSorted.length||1)*60) + 'px';
    }
    const wOpts = _chartOpts({plugins:{legend:{display:false}}});
    wOpts.scales = wOpts.scales||{};
    wOpts.scales.y = Object.assign(wOpts.scales.y||{},{beginAtZero:true,grace:'10%',ticks:{font:{family:'DM Sans',size:11},color:'#9399b0'}});
    wOpts.scales.x = Object.assign(wOpts.scales.x||{},{ticks:{font:{family:'DM Sans',size:11},color:'#9399b0',maxRotation:30}});
    wOpts.plugins.datalabels = {display:ctx=>ctx.dataset.data[ctx.dataIndex]>0,anchor:'end',align:'top',offset:4,clamp:true,clip:false,color:'#6b7194',font:{size:10,weight:'600'},formatter:v=>v+' SP'};
    wOpts.layout = {padding:{top:24}};
    charts.prWorkload = new Chart(wCtx,{
      type:'bar',
      data:{
        labels:wlSorted.length?wlSorted.map(m=>m.user.name||m.user.email):['No Members'],
        datasets:[{label:'Active SP',data:wlSorted.length?wlSorted.map(m=>m.activePts):[0],
          backgroundColor:wlSorted.map(m=>{
            const v=m.activePts;
            return v>60?'rgba(239,68,68,0.7)':v>40?'rgba(245,158,11,0.7)':v>15?'rgba(16,185,129,0.7)':'rgba(148,163,184,0.7)';
          }),borderRadius:5}]
      },
      options:wOpts
    });
  }

  // ── Release Contribution Table ──
  const allReleases = state.releases || [];
  const relBody = document.getElementById('pr-release-contrib-tbody');
  if(relBody){
    const relMap = {};
    flatItems.filter(it=>it.releaseId && _PR_RELEASED_STATUSES.includes(it.status)).forEach(it=>{
      const key = it.releaseId;
      if(!relMap[key]) relMap[key]={ releaseId:key, projectId:it.project, taskCount:0, subtaskCount:0, pts:0 };
      if(it._type==='task') relMap[key].taskCount++;
      else relMap[key].subtaskCount++;
      relMap[key].pts += (it.points||0);
    });
    relBody.innerHTML = Object.values(relMap).map((r,idx)=>{
      const rel  = getRelease(r.releaseId);
      const proj = getProject(r.projectId);
      const bg   = idx%2!==0?'background:rgba(0,0,0,0.018)':'';
      return `<tr style="${bg};border-bottom:1px solid rgba(0,0,0,0.05)">
        <td style="padding:9px 12px;font-weight:500">${_escHtml(rel?rel.name:r.releaseId)}</td>
        <td style="padding:9px 12px;color:var(--text-secondary)">${_escHtml(proj?proj.name:(r.projectId||'—'))}</td>
        <td style="padding:9px 12px;text-align:right">${r.taskCount}</td>
        <td style="padding:9px 12px;text-align:right">${r.subtaskCount}</td>
        <td style="padding:9px 12px;text-align:right;font-weight:600">${r.pts}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="5" style="padding:14px;text-align:center;color:var(--text-tertiary);font-size:13px">No released work</td></tr>';
  }

  // ── Assigned Work List ──
  // FIX 1: Build a table-scoped filtered list that respects the Assignee filter.
  // _prBuildUserMetrics returns flatItems filtered by project+sprint+date but NOT by
  // assignee (it iterates all members independently). Apply the assignee filter here
  // so the table matches the same scope used for KPI/metrics calculations.
  const _tableSelAsgns = [..._prSelAssignees];
  const assignedFlatItems = _tableSelAsgns.length
    ? flatItems.filter(it => _tableSelAsgns.includes(it.assignee))
    : flatItems;

  const assignedBody = document.getElementById('pr-assigned-tbody');
  if(assignedBody){
    const badgeStyle='display:inline-flex;align-items:center;padding:2px 7px;border-radius:999px;font-size:10px;font-weight:600;white-space:nowrap';
    const statusBadge=s=>{
      const mp={'open':'background:#fef3c7;color:#b45309','dev-in-progress':'background:#dbeafe;color:#2461c8','in-qa':'background:#ede9fe;color:#6d28d9','qa-in-progress':'background:#ffedd5;color:#b83a0c','reopen':'background:#fee2e2;color:#c82020','ready-for-prod':'background:#d1fae5;color:#065f46','released':'background:#d1fae5;color:#059669','dev-completed':'background:#e0e7ff;color:#3730a3'};
      const st=mp[s]||'background:#f1f5f9;color:#475569';
      return `<span style="${badgeStyle};${st}">${_escHtml(s||'—')}</span>`;
    };
    assignedBody.innerHTML = assignedFlatItems.slice(0,500).map((it,idx)=>{
      const proj  = getProject(it.project);
      const spr   = getSprint(it.sprint);
      const epic  = getEpic(it.epicId);
      const aUser = getUser(it.assignee);
      const qUser = getUser(it.qaAssigneeId);
      const bg    = idx%2!==0?'background:rgba(0,0,0,0.018)':'';
      const tid   = it._type==='subtask'?'↳ '+_escHtml(it.id||''):_escHtml(it.id||'');
      return `<tr style="${bg};border-bottom:1px solid rgba(0,0,0,0.04)">
        <td style="padding:7px 10px;font-size:11px;color:#94a3b8;white-space:nowrap">${tid}</td>
        <td style="padding:7px 10px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${_escHtml(it.title||'')}">${_escHtml(it.title||'—')}</td>
        <td style="padding:7px 10px;font-size:11px;color:var(--text-secondary);white-space:nowrap">${_escHtml(it._type||'—')}</td>
        <td style="padding:7px 10px;font-size:11px;color:var(--text-secondary);white-space:nowrap">${_escHtml(proj?proj.name:(it.project||'—'))}</td>
        <td style="padding:7px 10px;font-size:11px;color:var(--text-secondary);white-space:nowrap">${_escHtml(spr?spr.name:(it.sprint||'—'))}</td>
        <td style="padding:7px 10px;font-size:11px;color:var(--text-secondary);white-space:nowrap">${_escHtml(epic?epic.title:(it.epicId||'—'))}</td>
        <td style="padding:7px 10px;white-space:nowrap">${statusBadge(it.status)}</td>
        <td style="padding:7px 10px;white-space:nowrap">${_escHtml(aUser?aUser.name:'—')}</td>
        <td style="padding:7px 10px;white-space:nowrap">${_escHtml(qUser?qUser.name:'—')}</td>
        <td style="padding:7px 10px;text-align:right;font-variant-numeric:tabular-nums">${it.points||0}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="10" style="padding:14px;text-align:center;color:var(--text-tertiary)">No assigned work</td></tr>';
    const _aNotice=document.getElementById('pr-assigned-count-notice');
    if(_aNotice){ _aNotice.textContent = assignedFlatItems.length>500 ? `· Showing 500 of ${assignedFlatItems.length.toLocaleString()} records` : ''; }
  }

  // ── Delivered Work List (Released only) ──
  // FIX 2: Use assignedFlatItems (already assignee-filtered above) so this list
  // stays in sync with the Assignee filter, matching KPI/metrics calculations.
  const delivBody = document.getElementById('pr-delivered-tbody');
  if(delivBody){
    const relItems = assignedFlatItems.filter(it=>_PR_RELEASED_STATUSES.includes(it.status));
    delivBody.innerHTML = relItems.slice(0,500).map((it,idx)=>{
      const proj  = getProject(it.project);
      const spr   = getSprint(it.sprint);
      const rel   = getRelease(it.releaseId);
      const epic  = getEpic(it.epicId);
      const aUser = getUser(it.assignee);
      const qUser = getUser(it.qaAssigneeId);
      const bg    = idx%2!==0?'background:rgba(0,0,0,0.018)':'';
      const tid   = it._type==='subtask'?'↳ '+_escHtml(it.id||''):_escHtml(it.id||'');
      const relDate = rel && rel.releaseDate ? rel.releaseDate : '—';
      return `<tr style="${bg};border-bottom:1px solid rgba(0,0,0,0.04)">
        <td style="padding:7px 10px;font-size:11px;color:#94a3b8;white-space:nowrap">${tid}</td>
        <td style="padding:7px 10px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${_escHtml(it.title||'')}">${_escHtml(it.title||'—')}</td>
        <td style="padding:7px 10px;font-size:11px;white-space:nowrap">${_escHtml(it._type||'—')}</td>
        <td style="padding:7px 10px;font-size:11px;white-space:nowrap">${_escHtml(proj?proj.name:(it.project||'—'))}</td>
        <td style="padding:7px 10px;font-size:11px;white-space:nowrap">${_escHtml(spr?spr.name:(it.sprint||'—'))}</td>
        <td style="padding:7px 10px;font-size:11px;white-space:nowrap">${_escHtml(rel?rel.name:(it.releaseId||'—'))}</td>
        <td style="padding:7px 10px;font-size:11px;white-space:nowrap">${_escHtml(epic?epic.title:(it.epicId||'—'))}</td>
        <td style="padding:7px 10px;white-space:nowrap">${_escHtml(aUser?aUser.name:'—')}</td>
        <td style="padding:7px 10px;white-space:nowrap">${_escHtml(qUser?qUser.name:'—')}</td>
        <td style="padding:7px 10px;text-align:right;font-variant-numeric:tabular-nums">${it.points||0}</td>
        <td style="padding:7px 10px;font-size:11px;white-space:nowrap;color:var(--text-secondary)">${relDate}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="11" style="padding:14px;text-align:center;color:var(--text-tertiary)">No delivered work</td></tr>';
    const _dNotice=document.getElementById('pr-delivered-count-notice');
    if(_dNotice){ _dNotice.textContent = relItems.length>500 ? `· Showing 500 of ${relItems.length.toLocaleString()} records` : ''; }
  }
}

// ══════════════════════════════════════════════════════════════════
//  PRODUCTIVITY REPORT — PDF Export
// ══════════════════════════════════════════════════════════════════
async function exportProductivityPDF(){
  if(!RBAC.isAdmin() && !RBAC.isSeniorManager()){ showNotif('Admin access required','error'); return; }
  if(typeof window.jspdf === 'undefined'){ showNotif('PDF library not loaded','error'); return; }

  const btn = document.getElementById('pr-pdf-btn');
  if(btn){ btn.disabled=true; btn.style.opacity='0.5'; }

  try{
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation:'landscape', unit:'pt', format:'a4', compress:true });
    const ca  = _pdfContentArea(doc);

    // Filter labels for header
    const selPids   = [..._prSelProjs];
    const selAsgns  = [..._prSelAssignees];
    const projNames = selPids.length   ? selPids.map(id=>{const p=getProject(id);return p?p.name:id;}).join(', ')   : 'All Projects';
    const asgnNames = selAsgns.length  ? selAsgns.map(id=>{const u=getUser(id);return u?u.name:id;}).join(', ')    : 'All Members';
    const dateLabel = _prDatePreset==='all'?'All Time':
      _prDatePreset==='90'?'Last 90 Days':_prDatePreset==='30'?'Last 30 Days':
      _prDatePreset==='7'?'Last 7 Days':_prDatePreset==='thismonth'?'This Month':
      _prDatePreset==='lastmonth'?'Last Month':
      (_prDateStart&&_prDateEnd)?`${_prDateStart.toLocaleDateString()} – ${_prDateEnd.toLocaleDateString()}`:'All Time';

    const meta = {
      date: new Date().toLocaleDateString(),
      user: state.currentUser?(state.currentUser.name||state.currentUser.email||''):'',
      filters: `Projects: ${projNames}  |  Members: ${asgnNames}  |  Date: ${dateLabel}`
    };

    // Gather data
    const sprintIdSet = _prGetFilteredSprintIds();
    const { metrics, flatItems } = _prBuildUserMetrics(sprintIdSet);
    const userMetrics = Object.values(metrics);
    const sortedMetrics = [...userMetrics].sort((a,b)=>b.score-a.score);
    const relItems = flatItems.filter(it=>_PR_RELEASED_STATUSES.includes(it.status));

    // KPI values
    const totalAssigned  = userMetrics.reduce((a,m)=>a+m.totalAssigned,0);
    const totalCompleted = userMetrics.reduce((a,m)=>a+m.totalCompleted,0);
    const totalReleased  = userMetrics.reduce((a,m)=>a+m.totalReleased,0);
    const totalPts       = userMetrics.reduce((a,m)=>a+m.devPts,0);
    const avgScore       = userMetrics.length?Math.round(userMetrics.reduce((a,m)=>a+m.score,0)/userMetrics.length):0;

    // Capture charts (stop animation first)
    ['prWorkloadChart'].forEach(id=>{
      const c=document.getElementById(id);
      if(c){ const inst=Chart.getChart?Chart.getChart(c):null; if(inst){inst.stop();inst.render();} }
    });
    await new Promise(r=>requestAnimationFrame(()=>setTimeout(r,120)));
    const workloadImg = await _pdfCaptureChart('prWorkloadChart');

    // ── PAGE 1: Summary ──
    const totalPages = 4 + Math.max(1,Math.ceil(flatItems.length/30));
    _pdfDrawHeader(doc, meta, 'Productivity Report');
    let y = ca.y + 8;

    doc.setFontSize(15); doc.setFont('helvetica','bold'); doc.setTextColor(...PDF_TEXT_DARK);
    doc.text('Productivity Summary', ca.x, y+12); y+=28;

    // 6 KPI boxes
    const boxW = (ca.w-15)/6;
    [
      {label:'Team Members',value:String(userMetrics.length)},
      {label:'Assigned Work',value:String(totalAssigned)},
      {label:'Completed Work',value:String(totalCompleted)},
      {label:'Released Work',value:String(totalReleased)},
      {label:'Points Delivered',value:String(totalPts)},
      {label:'Avg Prod Score',value:String(avgScore)+'/100'},
    ].forEach((s,i)=>{
      const bx=ca.x+i*(boxW+3);
      doc.setFillColor(245,247,252); doc.roundedRect(bx,y,boxW,50,5,5,'F');
      doc.setFontSize(18); doc.setFont('helvetica','bold'); doc.setTextColor(...PDF_ACCENT);
      doc.text(s.value,bx+boxW/2,y+28,{align:'center'});
      doc.setFontSize(7.5); doc.setFont('helvetica','normal'); doc.setTextColor(...PDF_TEXT_LIGHT);
      doc.text(s.label,bx+boxW/2,y+42,{align:'center'});
    });
    y+=62;

    // Filter summary
    y=_pdfSectionBand(doc,'Applied Filters',y);
    doc.setFontSize(10); doc.setFont('helvetica','normal'); doc.setTextColor(...PDF_TEXT_MID);
    doc.text(`Projects: ${projNames}`,ca.x+8,y); y+=15;
    doc.text(`Members: ${asgnNames}`,ca.x+8,y); y+=15;
    doc.text(`Date Range: ${dateLabel}`,ca.x+8,y); y+=20;

    // Top performers mini-table on page 1
    const topRaw2 = [...userMetrics].sort((a,b)=>b.relPts-a.relPts||b.score-a.score).slice(0,5);
    y=_pdfSectionBand(doc,'Top 5 Performers',y);
    if(typeof doc.autoTable==='function'){
      doc.autoTable({
        startY:y,margin:{left:ca.x,right:PDF_MARGIN},
        head:[['#','Member','Projects','Released Pts','Completion %','Score']],
        body:topRaw2.map((m,i)=>[
          i+1,
          m.user.name||m.user.email,
          [...m.projSet].map(pid=>{const p=getProject(pid);return p?p.name:pid;}).slice(0,2).join(', ')||'—',
          m.relPts, m.compRate+'%', m.score+'/100'
        ]),
        headStyles:{fillColor:PDF_ACCENT,textColor:255,fontStyle:'bold',fontSize:8},
        bodyStyles:{fontSize:9,textColor:PDF_TEXT_MID},
        alternateRowStyles:{fillColor:[248,249,252]},
        columnStyles:{0:{halign:'center',cellWidth:22},3:{halign:'right'},4:{halign:'right'},5:{halign:'right',fontStyle:'bold'}},
        theme:'grid'
      });
      y=doc.lastAutoTable.finalY+16;
    }
    _pdfDrawFooter(doc,1,totalPages,totalAssigned);

    // ── PAGE 2: Team Productivity Table ──
    doc.addPage(); _pdfDrawHeader(doc,meta,'Productivity Report');
    y=ca.y+8;
    y=_pdfSectionBand(doc,'Team Productivity Table',y);
    if(typeof doc.autoTable==='function'){
      doc.autoTable({
        startY:y,margin:{left:ca.x,right:PDF_MARGIN},
        head:[['Member','Projects','Assigned','Completed','Released','SP Delivered','QA Pts','Comp %','Score','Utilization']],
        body:sortedMetrics.map(m=>[
          m.user.name||m.user.email,
          [...m.projSet].map(pid=>{const p=getProject(pid);return p?p.name:pid;}).slice(0,2).join(', ')||'—',
          m.totalAssigned, m.totalCompleted, m.totalReleased,
          m.devPts, m.qaPts, m.compRate+'%',
          m.score+'/100', `${m.activePts} SP`
        ]),
        headStyles:{fillColor:PDF_ACCENT,textColor:255,fontStyle:'bold',fontSize:7.5},
        bodyStyles:{fontSize:8.5,textColor:PDF_TEXT_MID},
        alternateRowStyles:{fillColor:[248,249,252]},
        columnStyles:{2:{halign:'right'},3:{halign:'right'},4:{halign:'right'},5:{halign:'right'},6:{halign:'right'},7:{halign:'right'},8:{halign:'right',fontStyle:'bold'},9:{halign:'right'}},
        theme:'grid'
      });
    }
    _pdfDrawFooter(doc,2,totalPages,totalAssigned);

    // ── PAGE 3: Charts ──
    doc.addPage(); _pdfDrawHeader(doc,meta,'Productivity Report');
    y=ca.y+8;
    const chartH=170;
    if(workloadImg){
      y=_pdfSectionBand(doc,'Workload Distribution — Active Story Points per Member',y);
      _pdfInsertChart(doc,workloadImg,ca.x,y,ca.w,chartH);
    }
    _pdfDrawFooter(doc,3,totalPages,totalAssigned);

    // ── PAGE 4: Release Contribution ──
    doc.addPage(); _pdfDrawHeader(doc,meta,'Productivity Report');
    y=ca.y+8;
    y=_pdfSectionBand(doc,'Release Contribution',y);
    const relMap={};
    relItems.forEach(it=>{
      const key=it.releaseId||'(No Release)';
      if(!relMap[key]) relMap[key]={releaseId:it.releaseId,projectId:it.project,taskCount:0,subtaskCount:0,pts:0};
      if(it._type==='task') relMap[key].taskCount++;
      else relMap[key].subtaskCount++;
      relMap[key].pts+=(it.points||0);
    });
    if(typeof doc.autoTable==='function'){
      doc.autoTable({
        startY:y,margin:{left:ca.x,right:PDF_MARGIN},
        head:[['Release','Project','Tasks Released','Subtasks Released','Delivered Points']],
        body:Object.values(relMap).map(r=>{
          const rel=getRelease(r.releaseId); const proj=getProject(r.projectId);
          return [rel?rel.name:(r.releaseId||'—'),proj?proj.name:(r.projectId||'—'),r.taskCount,r.subtaskCount,r.pts];
        }),
        headStyles:{fillColor:PDF_ACCENT,textColor:255,fontStyle:'bold',fontSize:8},
        bodyStyles:{fontSize:9,textColor:PDF_TEXT_MID},
        alternateRowStyles:{fillColor:[248,249,252]},
        columnStyles:{2:{halign:'right'},3:{halign:'right'},4:{halign:'right',fontStyle:'bold'}},
        theme:'grid'
      });
      y=doc.lastAutoTable.finalY+20;
    }
    _pdfDrawFooter(doc,4,totalPages,relItems.length);

    // ── REMAINING PAGES: Work Lists ──
    const allWork = flatItems.slice(0,500);
    const ROWS_PER_PAGE=30;
    let pg=5;
    for(let i=0;i<allWork.length;i+=ROWS_PER_PAGE){
      doc.addPage(); _pdfDrawHeader(doc,meta,'Productivity Report');
      y=ca.y+8;
      const isFirst=i===0;
      if(isFirst){ y=_pdfSectionBand(doc,'Assigned Work List',y);
        if(flatItems.length>500){ doc.setFontSize(8); doc.setTextColor(180,83,9); doc.text(`Showing 500 of ${flatItems.length.toLocaleString()} records`, ca.x, y); doc.setTextColor(0,0,0); y+=12; }
      }
      const chunk=allWork.slice(i,i+ROWS_PER_PAGE);
      if(typeof doc.autoTable==='function'){
        doc.autoTable({
          startY:y,margin:{left:ca.x,right:PDF_MARGIN},
          head:isFirst?[['ID','Title','Type','Project','Sprint','Status','Assignee','SP']]:undefined,
          body:chunk.map(it=>{
            const proj=getProject(it.project); const spr=getSprint(it.sprint);
            const aUser=getUser(it.assignee);
            const tid=(it._type==='subtask'?'↳ ':'')+(_escHtml(it.id||''));
            return [tid,it.title||'—',it._type||'—',proj?proj.name:(it.project||'—'),spr?spr.name:(it.sprint||'—'),it.status||'—',aUser?aUser.name:'—',it.points||0];
          }),
          headStyles:{fillColor:PDF_ACCENT,textColor:255,fontStyle:'bold',fontSize:7.5},
          bodyStyles:{fontSize:8,textColor:PDF_TEXT_MID},
          alternateRowStyles:{fillColor:[248,249,252]},
          columnStyles:{7:{halign:'right'}},
          theme:'grid'
        });
      }
      _pdfDrawFooter(doc,pg++,totalPages,allWork.length);
    }

    // Save
    const d=new Date(), pad=n=>String(n).padStart(2,'0');
    const fname=`SprintFlow_Productivity_${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}.pdf`;
    doc.save(fname);
    showNotif('Productivity PDF exported ✓','default');
  } catch(err){
    console.error('[PR PDF] Error:',err);
    showNotif('PDF export failed: '+err.message,'error');
  } finally {
    if(btn){ btn.disabled=false; btn.style.opacity=''; }
  }
}

