// ── QA ASSIGNEE POINT SPLIT HELPER ─────────────────────────────────
// Returns effective story points for a given user on a work item.
// Case 1: No QA Assignee → 100% to Assignee.
// Case 2: Assignee + QA Assignee (different) → 80% to Assignee, 20% to QA.
// Case 3: Assignee = QA Assignee → 100% to that user (no split).
function _qaPointsFor(item, userId) {
  const pts = item.points || 0;
  const assigneeId = item.assignee || item.assigneeId || null;
  const qaId = item.qaAssigneeId || null;
  if (!qaId || qaId === assigneeId) {
    return userId === assigneeId ? pts : 0;
  }
  if (userId === assigneeId) return Math.round(pts * 0.8 * 10) / 10;
  if (userId === qaId)       return Math.round(pts * 0.2 * 10) / 10;
  return 0;
}
// Returns total effective points for a user across an array of items
function _qaUserPoints(items, userId) {
  return items.reduce((sum, item) => sum + _qaPointsFor(item, userId), 0);
}
// Returns whether a user is "involved" in a work item (as assignee or QA assignee)
function _qaItemBelongsTo(item, userId) {
  const assigneeId = item.assignee || item.assigneeId || null;
  return assigneeId === userId || (item.qaAssigneeId && item.qaAssigneeId === userId);
}
// ─────────────────────────────────────────────────────────────────

// ─── REFERENTIAL INTEGRITY CASCADE HELPERS ───────────────────────
// These clean up dangling references without hard-deleting tasks.

// Called when an epic is deleted: strips epicId from all tasks and syncs them.
function cleanupEpicReferences(epicId){
  if(!epicId) return;
  const affected = state.tasks.filter(t => t.epicId === epicId);
  affected.forEach(t => {
    t.epicId = null;
    t.updatedAt = _now();
    // Persist each affected task to Firebase
    if(FirebaseDB.isReady()){
      FirebaseDB.saveEntity('tasks', t).catch(e => console.warn('[cleanupEpicReferences] Firebase error:', t.id, e));
    } else {
      PendingSyncQueue.saveEntity('tasks', t);
    }
  });
  if(affected.length) SaveManager.save();
}

// Called when a sprint is deleted: strips sprintId from all tasks and syncs them.
// RBAC: admin-only operation
function cleanupSprintReferences(sprintId){
  if(!sprintId) return;
  const affected = state.tasks.filter(t => t.sprint === sprintId);
  affected.forEach(t => {
    t.sprint = null;
    t.updatedAt = _now();
    if(FirebaseDB.isReady()){
      FirebaseDB.saveEntity('tasks', t).catch(e => console.warn('[cleanupSprintReferences] Firebase error:', t.id, e));
    } else {
      PendingSyncQueue.saveEntity('tasks', t);
    }
  });
  // Also remove the sprint reference from any releases
  (state.releases||[]).forEach(r => {
    if(r.sprintId === sprintId){
      r.sprintId = null;
      r.updatedAt = _now();
      if(FirebaseDB.isReady()){
        FirebaseDB.saveEntity('releases', r).catch(e => console.warn('[cleanupSprintReferences/release] Firebase error:', r.id, e));
      } else {
        PendingSyncQueue.saveEntity('releases', r);
      }
    }
  });
  if(affected.length) SaveManager.save();
}

// Called when a release is deleted: strips releaseId from all tasks and syncs them.
function cleanupReleaseReferences(releaseId){
  if(!releaseId) return;
  const affected = state.tasks.filter(t => t.releaseId === releaseId);
  affected.forEach(t => {
    t.releaseId = null;
    t.updatedAt = _now();
    if(FirebaseDB.isReady()){
      FirebaseDB.saveEntity('tasks', t).catch(e => console.warn('[cleanupReleaseReferences] Firebase error:', t.id, e));
    } else {
      PendingSyncQueue.saveEntity('tasks', t);
    }
  });
  if(affected.length) SaveManager.save();
}

// Called when a team member is deleted: clears assignee on tasks and subtasks, syncs them.
function cleanupMemberReferences(userId){
  if(!userId) return;
  const affectedTasks = state.tasks.filter(t => t.assignee === userId || (t.subtasks||[]).some(s => s.assignee === userId));
  affectedTasks.forEach(t => {
    let changed = false;
    if(t.assignee === userId){ t.assignee = null; changed = true; }
    (t.subtasks||[]).forEach(s => { if(s.assignee === userId){ s.assignee = null; changed = true; } });
    if(changed){
      t.updatedAt = _now();
      if(FirebaseDB.isReady()){
        FirebaseDB.saveEntity('tasks', t).catch(e => console.warn('[cleanupMemberReferences] Firebase error:', t.id, e));
      } else {
        PendingSyncQueue.saveEntity('tasks', t);
      }
    }
  });
  if(affectedTasks.length) SaveManager.save();
}

// ─── EPIC HELPERS ────────────────────────────────────────────────
// getEpic() is defined above in the memoized helpers block
function getEpicTasks(epicId){return state.tasks.filter(t=>t.epicId===epicId);}
function getEpicProgress(epicId){
  const tasks=getEpicTasks(epicId);
  if(!tasks.length)return{total:0,done:0,pct:0,subtaskTotal:0,subtaskDone:0};
  const done=tasks.filter(t=>DONE_STATUSES.includes(t.status)).length;
  const subtaskTotal=tasks.reduce((a,t)=>a+(t.subtasks||[]).length,0);
  const subtaskDone=tasks.reduce((a,t)=>a+(t.subtasks||[]).filter(s=>DONE_STATUSES.includes(s.status)).length,0);
  const combinedTotal=tasks.length+subtaskTotal;
  const combinedDone=done+subtaskDone;
  return{total:tasks.length,done,pct:combinedTotal?Math.round((combinedDone/combinedTotal)*100):0,subtaskTotal,subtaskDone,combinedTotal,combinedDone};
}
function getEpicStoryPoints(epicId){
  const tasks=getEpicTasks(epicId);
  const total=tasks.reduce((a,t)=>a+(t.points||0),0);
  const done=tasks.filter(t=>DONE_STATUSES.includes(t.status)).reduce((a,t)=>a+(t.points||0),0);
  return{total,done,remaining:total-done};
}
function epicStatusBadgeClass(status){
  const map={'Planned':'epic-planned','Active':'epic-active','Completed':'epic-completed','On Hold':'epic-on-hold'};
  return map[status]||'epic-planned';
}

function sprintDaysLeft(sprint){
  const diff=Math.ceil((new Date(sprint.end)-new Date())/(1000*60*60*24));
  return diff>0?diff+' days left':'Ended';
}
function sprintProgress(sprint){
  const tasks=state.tasks.filter(t=>t.sprint===sprint.id);
  if(!tasks.length)return 0;
  const allSubs=(tasks).flatMap(t=>t.subtasks||[]);
  const total=tasks.length+allSubs.length;
  const done=tasks.filter(t=>DONE_STATUSES.includes(t.status)).length+allSubs.filter(s=>DONE_STATUSES.includes(s.status)).length;
  return Math.round((done/total)*100);
}
function userAvatar(userId,size=28){
  const u=getUser(userId);
  if(!u)return `<div class="avatar" style="width:${size}px;height:${size}px;background:#e2e8f0;color:#94a3b8;font-size:${size<24?9:11}px">?</div>`;
  return `<div class="avatar" style="width:${size}px;height:${size}px;background:${u.color};color:white;font-size:${size<24?9:11}px">${u.initials}</div>`;
}

// ── RBAC-scoped analytics data source ────────────────────────────
// Single function that returns role-appropriate collections for
// Dashboard and Reports. No UI, chart logic, or workflow changes.
function getRoleScopedAnalyticsData(){
  const role = (state.currentUser && state.currentUser.role
    ? state.currentUser.role : 'admin').toLowerCase();

  // ── ADMIN: full access ──
  if(role === 'admin'){
    return {
      tasks:    state.tasks    || [],
      projects: state.projects || [],
      sprints:  state.sprints  || [],
      epics:    state.epics    || [],
      releases: state.releases || []
    };
  }

  // ── PROGRAM MANAGER / SENIOR MANAGER: mapped scope (senior_manager resolves to org-wide since RBAC.getVisibleProjects() returns all projects for that role) ──
  if(role === 'program_manager' || role === 'senior_manager'){
    const visibleProjects  = RBAC.getVisibleProjects();
    const visibleProjectIds= new Set(visibleProjects.map(p => p.id));

    const visibleSprints   = (state.sprints || []).filter(
      s => visibleProjectIds.has(s.project)
    );
    const visibleSprintIds = new Set(visibleSprints.map(s => s.id));

    const visibleTasks = (state.tasks || []).filter(t =>
      visibleProjectIds.has(t.project) &&
      (!t.sprint || visibleSprintIds.has(t.sprint))
    );

    const visibleEpics = (state.epics || []).filter(e => {
      const ep = e.projectIds || (e.projectId ? [e.projectId] : []);
      return ep.some(pid => visibleProjectIds.has(pid));
    });

    const visibleReleases = (state.releases || []).filter(
      r => visibleProjectIds.has(r.projectId)
    );

    return {
      tasks:    visibleTasks,
      projects: visibleProjects,
      sprints:  visibleSprints,
      epics:    visibleEpics,
      releases: visibleReleases
    };
  }

  // ── TEAM MEMBER: assigned work + mapped project scope ──
  const memberProjects   = RBAC.getVisibleProjects();
  const memberProjectIds = new Set(memberProjects.map(p => p.id));
  const memberId         = state.currentUser ? state.currentUser.id : null;

  const memberSprints    = (state.sprints || []).filter(
    s => memberProjectIds.has(s.project)
  );
  const memberSprintIds  = new Set(memberSprints.map(s => s.id));

  // Member sees tasks assigned to them within their project scope
  const memberTasks = (state.tasks || []).filter(t =>
    memberProjectIds.has(t.project) &&
    (!t.sprint || memberSprintIds.has(t.sprint)) &&
    (t.assignee === memberId ||
     (t.subtasks || []).some(st => st.assignee === memberId))
  );

  const memberEpics = (state.epics || []).filter(e => {
    const ep = e.projectIds || (e.projectId ? [e.projectId] : []);
    return ep.some(pid => memberProjectIds.has(pid));
  });

  const memberReleases = (state.releases || []).filter(
    r => memberProjectIds.has(r.projectId)
  );

  return {
    tasks:    memberTasks,
    projects: memberProjects,
    sprints:  memberSprints,
    epics:    memberEpics,
    releases: memberReleases
  };
}

function getVisibleProjects(){
  return RBAC.getVisibleProjects();
}

const STATUS_META={
  'open':{label:'Open',cls:'open'},
  'dev-in-progress':{label:'Dev In Progress',cls:'dev-in-progress'},
  'dev-completed':{label:'Dev Completed',cls:'dev-completed'},
  'in-qa':{label:'In QA',cls:'in-qa'},
  'qa-in-progress':{label:'QA In Progress',cls:'qa-in-progress'},
  'reopen':{label:'Reopen',cls:'reopen'},
  'on-hold':{label:'On Hold',cls:'on-hold'},
  'pending-with-client':{label:'Pending With Client',cls:'pending-with-client'},
  'ready-for-prod':{label:'Ready for Prod',cls:'ready-for-prod'},
  'released':{label:'Released',cls:'released'},
  'rollback':{label:'Rollback',cls:'reopen'}
};
function statusLabel(s){return (STATUS_META[s]||{label:s}).label;}
function statusBadgeClass(s){return (STATUS_META[s]||{cls:(s||'').replace(/[^a-z-]/g,'')}).cls;}

// ─── SUBTASK HELPERS ─────────────────────────────────────────────
const DONE_STATUSES=['ready-for-prod','released'];

// ── RCA FIX: Sprint Spillover eligibility ──────────────────────────
// Spillover must carry forward every task/subtask NOT in 'released' status
// (e.g. 'Pending with client', 'Ready for Prod', etc). DONE_STATUSES above
// treats 'ready-for-prod' as done, which is correct for progress/completion
// metrics elsewhere in the app, but was incorrectly reused for spillover —
// causing tasks sitting at 'ready-for-prod' (and any status other than
// released) to be silently excluded from spillover. Spillover uses this
// dedicated list instead so only 'released' items are considered finished.
const SPILLOVER_DONE_STATUSES=['released'];

// ─── TASK STATE TRANSITION RULES ────────────────────────────────
// Tasks at Ready for Prod or Released are frozen.
// Released tasks may only transition to Rollback (resolves to dev-completed).
const LOCKED_TASK_STATUSES=['ready-for-prod','released'];

function isTaskLocked(task){
  return !!(task && LOCKED_TASK_STATUSES.includes(task.status));
}

// Returns {ok:true} or {ok:false, msg}
// ── BACKLOG → RELEASED VALIDATION ────────────────────────────────
// Shared validator: prevents any task or subtask from reaching
// "released" status unless it is assigned to a real Sprint.
// sprintId null / empty / 'backlog' all count as Backlog.
// Called from: canChangeTaskStatus (covers updateTaskStatus, kanbanDrop,
// releaseStatusActions), updateSubtaskStatus, _blApplyStatus subtask path.
function canReleaseItem(item){
  if(!item) return {ok:false, msg:'Item not found'};
  const sid = item.sprint || item.sprintId || null;
  if(!sid || String(sid).toLowerCase()==='backlog'){
    return {ok:false, msg:'This item must be assigned to a Sprint before it can be marked as Released.'};
  }
  return {ok:true};
}

function canChangeTaskStatus(task, newStatus){
  if(!task) return {ok:false, msg:'Task not found'};
  const cur=task.status;
  if(cur==='released'){
    if(newStatus==='rollback') return {ok:true};
    return {ok:false, msg:'Released tasks can only be rolled back. Use the Rollback option.'};
  }
  if(cur==='ready-for-prod'){
    if(newStatus==='released') return {ok:true};
    return {ok:false, msg:'Ready for Prod tasks are frozen and cannot be moved.'};
  }
  // ── Backlog → Released guard ──
  if(newStatus==='released'){
    const releaseCheck=canReleaseItem(task);
    if(!releaseCheck.ok) return releaseCheck;
  }
  return {ok:true};
}

// Rollback is an action only — resolves to in-qa; not persisted as a final state
function resolveRollbackStatus(status){
  return status==='rollback'?'in-qa':status;
}

// ─── QA REOPEN TRACKING ─────────────────────────────────────────
// QA stages: task has "entered QA" if it reached in-qa or qa-in-progress.
// Dev stages: open, dev-in-progress, dev-completed.
// A QA reopen event = task/subtask moves FROM a QA stage BACK TO a dev stage.
const _QA_STAGES  = new Set(['in-qa','qa-in-progress']);
const _DEV_STAGES = new Set(['open','dev-in-progress','dev-completed']);

function _trackQAReopen(item, newStatus){
  // Mark when an item first enters QA
  if(_QA_STAGES.has(newStatus)) {
    item._hasEnteredQA = true;
  }
  // If it was in QA and moves back to a dev stage → increment qaReopenCount
  if(item._hasEnteredQA && _QA_STAGES.has(item.status) && _DEV_STAGES.has(newStatus)){
    item.qaReopenCount = (item.qaReopenCount || 0) + 1;
  }
}

// ─── EPIC STATE TRANSITION RULES ────────────────────────────────
// Planned → Active → Completed (forward-only).
// Completed locked unless Admin + today < epic.dueDate.
const EPIC_STATUS_ORDER={Planned:0,Active:1,Completed:2};

function canChangeEpicStatus(epic, newStatus){
  const cur=epic.status;
  if(cur==='Completed'){
    if(!RBAC.isAdmin() && !RBAC.isSeniorManager()) return {ok:false, msg:'Completed epics are locked. Only an admin or senior manager can reopen them.'};
    const today=new Date(); today.setHours(0,0,0,0);
    const end=epic.dueDate?new Date(epic.dueDate):null;
    if(!end||today>end) return {ok:false, msg:'Completed epic cannot be reopened — the end date has passed.'};
    return {ok:true};
  }
  const curOrd=EPIC_STATUS_ORDER[cur]??-1;
  const newOrd=EPIC_STATUS_ORDER[newStatus]??-1;
  if(newOrd<curOrd) return {ok:false, msg:`Cannot move epic backwards from "${cur}" to "${newStatus}".`};
  if(cur==='Active'&&newStatus==='Planned') return {ok:false, msg:'Active epics cannot return to Planned.'};
  return {ok:true};
}

function isEpicLocked(epic){
  if(!epic||epic.status!=='Completed') return false;
  if(RBAC.isAdmin()||RBAC.isSeniorManager()){
    const today=new Date(); today.setHours(0,0,0,0);
    const end=epic.dueDate?new Date(epic.dueDate):null;
    if(end&&today<=end) return false;
  }
  return true;
}
// ── Field freeze helpers ──────────────────────────────────────────
function isReleaseLocked(release){
  return !!(release && release.status==='Released');
}
function isProjectCompleted(project){
  return !!(project && project.status==='completed');
}
function isSprintCompleted(sprint){
  return !!(sprint && sprint.status==='completed');
}
function getSubtasks(taskId){
  const t=getTask(taskId);
  return t?(t.subtasks||[]):[];
}
function subtaskProgress(taskId){
  const subs=getSubtasks(taskId);
  if(!subs.length)return{total:0,done:0,pct:0};
  const done=subs.filter(s=>DONE_STATUSES.includes(s.status)).length;
  return{total:subs.length,done,pct:Math.round((done/subs.length)*100)};
}
function subtaskStatusDot(status){
  const colors={'open':'#94a3b8','dev-in-progress':'#2563eb','dev-completed':'#4338ca','in-qa':'#b45309','qa-in-progress':'#c2410c','reopen':'#dc2626','on-hold':'#9a3412','pending-with-client':'#a16207','ready-for-prod':'#059669','released':'#16a34a'};
  return colors[status]||'#94a3b8';
}
function canMoveToClosedStatus(taskId,targetStatus){
  if(!DONE_STATUSES.includes(targetStatus))return{ok:true};
  const subs=getSubtasks(taskId);
  if(!subs.length)return{ok:true};
  const allDone=subs.every(s=>DONE_STATUSES.includes(s.status));
  if(allDone)return{ok:true};
  const pending=subs.filter(s=>!DONE_STATUSES.includes(s.status)).length;
  return{ok:false,msg:`All subtasks must be completed before closing parent task. (${pending} subtask${pending>1?'s':''} still open)`};
}
function subtaskAssigneeAvatars(taskId){
  const subs=getSubtasks(taskId);
  const ids=[...new Set(subs.map(s=>s.assignee).filter(Boolean))].slice(0,3);
  return ids.map(id=>userAvatar(id,18)).join('');
}

// ── DELAY REPORTS: additive completion-date stamp ──────────────────────────
// The app never stamped an "actual completion" timestamp anywhere — status
// mutations only ever touched the `status` field. Delay Reports needs a real
// completion timestamp to compute delay/TAT correctly, so this helper is
// called from every existing status-mutation site (task/subtask status
// dropdown, Kanban drag-and-drop, task edit form, epic save). It is purely
// additive: it only ever writes `item.completedDate` and changes no other
// behavior of the functions that call it.
function _drStampCompletionDate(item, prevStatus, newStatus, isDoneFn){
  if(isDoneFn(newStatus)){
    if(!isDoneFn(prevStatus)) item.completedDate = Date.now();
  } else {
    item.completedDate = null;
  }
}

