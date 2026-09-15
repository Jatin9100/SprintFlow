// ─── RELEASE MANAGEMENT ──────────────────────────────────────────

// Release statuses
const RELEASE_STATUSES = ['Planned', 'Ready', 'Released', 'Rolled Back'];


// ── HELPERS ──
function getRelease(id){ return (state.releases||[]).find(r=>r.id===id)||null; }

function getReleaseTasks(releaseId){
  const release=getRelease(releaseId);
  if(!release)return[];
  const taskIdSet=new Set(release.taskIds||[]);
  // RBAC FIX: scope task lookup to role-visible projects only.
  // Admins receive all tasks; PMs and Members receive only tasks
  // belonging to their mapped projects — preventing cross-project
  // task data leaking through release card rows, progress bars,
  // and story-point statistics.
  const scopedTasks=RBAC.getVisibleTasks(state.tasks);
  return scopedTasks.filter(t=>t.releaseId===releaseId||taskIdSet.has(t.id));
}

function getReleaseProgress(releaseId){
  const tasks = getReleaseTasks(releaseId);
  if(!tasks.length) return {total:0, done:0, pct:0};
  const done = tasks.filter(t=>DONE_STATUSES.includes(t.status)).length;
  return { total:tasks.length, done, pct:Math.round((done/tasks.length)*100) };
}

function getReleaseStoryPoints(releaseId){
  const tasks = getReleaseTasks(releaseId);
  const total = tasks.reduce((a,t)=>a+(t.points||0), 0);
  const done  = tasks.filter(t=>DONE_STATUSES.includes(t.status)).reduce((a,t)=>a+(t.points||0), 0);
  return { total, done, remaining: total-done };
}

// ── CRUD ──
function createRelease(data){
  if(!state.releases) state.releases = [];
  const now = _now();
  const release = {
    id:          rlid(),
    name:        data.name        || 'Untitled Release',
    version:     data.version     || '1.0.0',
    sprintId:    data.sprintId    || null,
    projectId:   data.projectId   || null,
    ownerId:     data.ownerId     || null,
    releaseDate: data.releaseDate || null,
    status:      RELEASE_STATUSES.includes(data.status) ? data.status : 'Planned',
    releaseNotes:data.releaseNotes|| '',
    taskIds:     Array.isArray(data.taskIds) ? data.taskIds : [],
    createdAt:   now,
    updatedAt:   now
  };
  state.releases.push(release);
  // Stamp releaseId on linked tasks
  release.taskIds.forEach(tid=>{ const t=getTask(tid); if(t) t.releaseId=release.id; });
  // ── Firebase: persist new release; queue if unavailable ──
  SyncState.markPending(release.id);
  if(FirebaseDB.isReady()){
    FirebaseDB.saveEntity('releases', release).then(ok=>{
      if(ok){ SyncState.markSynced(release.id); }
      else   { SyncState.markFailed(release.id); PendingSyncQueue.saveEntity('releases', release); }
    }).catch(()=>{ SyncState.markFailed(release.id); PendingSyncQueue.saveEntity('releases', release); });
  } else {
    PendingSyncQueue.saveEntity('releases', release);
  }
  saveReleases();
  return release;
}

// ── TARGETED ADD: auto-create a Release when a Sprint completes ────────────
// Manual release creation (createRelease / openCreateReleaseModal) is untouched —
// program managers can still create releases by hand at any time. This only adds
// an automatic release record on top, mirroring the existing auto-retrospective
// pattern (RetroManager.createForSprint) called from the same two sprint-completion
// sites: saveSprint() and _executeSprintCompletion().
// Field mapping (per requirement):
//   Title            -> sprint.name
//   Version           -> sprint has no Version field; auto-generated from the
//                        sprint's name (fallback to its end date if name is blank)
//   Project Selection -> sprint.project
//   Sprint Selection   -> sprint.id
//   Project Owner     -> the completed sprint's Project's owner (project.lead)
//   Release Date      -> sprint.end
//   Status            -> 'Planned' (createRelease's default)
function _autoCreateReleaseForSprint(sprint){
  if(!sprint || sprint.status!=='completed') return;
  // Avoid duplicates if this ever fires twice for the same sprint.
  const already=(state.releases||[]).find(r=>r.sprintId===sprint.id);
  if(already){ console.log('[ReleaseAutoCreate] Release already exists for sprint:', sprint.id); return; }
  const proj=(state.projects||[]).find(p=>p.id===sprint.project)||null;
  const autoVersion=sprint.name || sprint.end || 'Untitled';
  try{
    console.log('[ReleaseAutoCreate] Creating release for completed sprint:', sprint.id);
    createRelease({
      name:        sprint.name,
      version:     autoVersion,
      projectId:   sprint.project,
      sprintId:    sprint.id,
      ownerId:     proj ? proj.lead : null,
      releaseDate: sprint.end,
      status:      'Planned'
    });
  }catch(e){ console.warn('[ReleaseAutoCreate] creation error:', e); }
}

function updateRelease(id, changes){
  const release = getRelease(id);
  if(!release){ showNotif('Release not found','error'); return null; }
  if(changes.status && !RELEASE_STATUSES.includes(changes.status)){
    showNotif('Invalid release status','error'); return null;
  }
  // Handle taskIds delta: unlink removed tasks, link added tasks
  if(changes.taskIds){
    const removed = (release.taskIds||[]).filter(tid=>!changes.taskIds.includes(tid));
    const added   = changes.taskIds.filter(tid=>!(release.taskIds||[]).includes(tid));
    removed.forEach(tid=>{ const t=getTask(tid); if(t) t.releaseId=null; });
    added.forEach(tid=>{ const t=getTask(tid); if(t) t.releaseId=id; });
  }
  const _updBy = state.currentUser ? (state.currentUser.id || state.currentUser.uid || null) : null;
  Object.assign(release, changes, { updatedAt: _now(), updatedBy: _updBy });
  // ── Firebase: persist updated release; queue if unavailable ──
  SyncState.markPending(release.id);
  if(FirebaseDB.isReady()){
    FirebaseDB.saveEntity('releases', release).then(ok=>{
      if(ok){ SyncState.markSynced(release.id); }
      else   { SyncState.markFailed(release.id); PendingSyncQueue.saveEntity('releases', release); }
    }).catch(()=>{ SyncState.markFailed(release.id); PendingSyncQueue.saveEntity('releases', release); });
  } else {
    PendingSyncQueue.saveEntity('releases', release);
  }
  saveReleases();
  return release;
}

function deleteRelease(id){
  if(!state.releases) return;
  // ── Referential integrity: strip releaseId from all linked tasks ──
  cleanupReleaseReferences(id);
  state.releases = state.releases.filter(r=>r.id!==id);
  // ── Firebase: delete release; queue if unavailable ──
  if(FirebaseDB.isReady()){
    FirebaseDB.deleteEntity('releases', id).catch(e=>console.warn('[deleteRelease] Firebase error:',e));
  } else {
    PendingSyncQueue.deleteEntity('releases', id);
  }
  saveReleases();
}

// ── VALIDATION ──
const RELEASE_VALIDATION_WARNINGS = {
  noRelease:  '⚠ Task must be linked to a release before marking as Released.',
  noNotes:    '⚠ Release notes are required on the release before tasks can be marked as Released.'
};

/**
 * Enhancement 1 — Release Notes Validation Before Release
 * Strips HTML tags and counts only meaningful text characters.
 * Returns { valid: boolean, length: number }
 */
function _releaseNotesTextLength(notes) {
  if (!notes || typeof notes !== 'string') return 0;
  // Strip HTML tags
  const stripped = notes.replace(/<[^>]*>/g, '');
  // Collapse whitespace-only content; count non-whitespace characters + single spaces between words
  const trimmed = stripped.replace(/\s+/g, ' ').trim();
  return trimmed.length;
}

function validateReleaseNotesForRelease(notes) {
  const len = _releaseNotesTextLength(notes);
  if (len < 100) {
    return {
      valid: false,
      message: 'Release Notes are mandatory before releasing.\nMinimum required length: 100 characters.\nPlease complete Release Notes and try again.',
      length: len
    };
  }
  return { valid: true, length: len };
}

function validateTaskStatusTransition(taskId, targetStatus){
  if(targetStatus !== 'released') return { valid:true };
  const task    = getTask(taskId);
  if(!task)      return { valid:false, warning:'Task not found.' };
  if(!task.releaseId)
    return { valid:false, warning: RELEASE_VALIDATION_WARNINGS.noRelease };
  const release = getRelease(task.releaseId);
  if(!release || !release.releaseNotes || !release.releaseNotes.trim())
    return { valid:false, warning: RELEASE_VALIDATION_WARNINGS.noNotes };
  return { valid:true };
}

// ── LOCALSTORAGE ──
function saveReleases(){
  SaveManager.saveReleases();
}

function loadReleases(){
  try{
    const saved = localStorage.getItem('sprintflow_releases');
    return saved ? JSON.parse(saved) : [];
  }catch(e){ return []; }
}

// ─── RELEASE BOARD UI ─────────────────────────────────────────────

const RELEASE_STATUS_COLORS={
  'Planned':    {strip:'#94a3b8',badge:'release-badge-planned'},
  'Ready':      {strip:'#3b82f6',badge:'release-badge-ready'},
  'Released':   {strip:'#10b981',badge:'release-badge-released'},
  'Rolled Back':{strip:'#ef4444',badge:'release-badge-rolledback'}
};
function releaseStatusColor(s){return (RELEASE_STATUS_COLORS[s]||{strip:'#94a3b8'}).strip;}
function releaseStatusBadge(s){return (RELEASE_STATUS_COLORS[s]||{badge:'release-badge-planned'}).badge;}

// ── Queue helpers ──────────────────────────────────────────────────
function getQueueTasks(){
  // All tasks whose status === 'released' (task-level status, lowercase) AND not mapped to any release.
  // RBAC FIX: filter the task pool to role-visible projects first so that PMs
  // and Members never see Release Queue items from projects outside their scope.
  // FILTER FIX: also respect the Release Board Project/Sprint/Status filters so the
  // Release Queue always shows the same scope as the Release Board on the right.
  const mappedIds=new Set((state.releases||[]).flatMap(r=>r.taskIds||[]));
  const scopedTasks=RBAC.getVisibleTasks(state.tasks);

  // Read the same filter controls used by getFilteredReleases()
  const filterProj=(document.getElementById('rf-project')||{}).value||'';
  const filterSprint=(document.getElementById('rf-sprint')||{}).value||'';
  const filterStatus=(document.getElementById('rf-status')||{}).value||'';
  // Resolve group sprint filter to a Set of IDs (mirrors getFilteredReleases logic)
  let _queueSprintIds=null;
  if(filterSprint==='active-group'){
    _queueSprintIds=new Set(RBAC.getVisibleSprints().filter(s=>(s.status||'').toLowerCase()==='active').map(s=>s.id));
  } else if(filterSprint==='completed-group'){
    _queueSprintIds=new Set(RBAC.getVisibleSprints().filter(s=>(s.status||'').toLowerCase()==='completed').map(s=>s.id));
  }

  return scopedTasks.filter(t=>{
    if(t.status!=='released') return false;
    if(mappedIds.has(t.id)) return false;
    // Apply Release Board Project filter
    if(filterProj && t.project!==filterProj) return false;
    // Apply Release Board Sprint filter
    if(_queueSprintIds!==null){ if(!_queueSprintIds.has(t.sprint)) return false; }
    else if(filterSprint && t.sprint!==filterSprint) return false;
    // Apply Release Board Status filter — status filter targets release status, not task status,
    // but when "Released" status is selected in the board filter it is consistent to show
    // only released tasks (which is already guaranteed above). For non-"released" status
    // values the queue should be empty because queue tasks always have status=released.
    if(filterStatus && filterStatus!=='released') return false;
    return true;
  });
}

function toggleReleaseQueue(){
  const area=document.getElementById('rq-area');
  const icon=document.getElementById('rq-toggle-icon');
  if(!area)return;
  // ENHANCEMENT 3: queue uses flex:1+overflow-y:auto, so toggle via display
  const open=area.style.display!=='none';
  area.style.display=open?'none':'';
  if(icon)icon.style.transform=open?'rotate(-90deg)':'rotate(90deg)';
}

// ── ENHANCEMENT 2: Drag & Drop release mapping ──────────────────────────────
// Single source-of-truth: the task ID being dragged
let _rqDragTaskId = null;
let _rqDragProjectId = null;

function _rqDragMousedown(e){
  // Prevent drag from starting when user interacts with the select or button inside the card
  if(e.target.closest('select,button')) e.currentTarget.setAttribute('draggable','false');
  else e.currentTarget.setAttribute('draggable','true');
}

function _rqDragStart(e){
  const card = e.currentTarget;
  _rqDragTaskId    = card.dataset.taskId    || null;
  _rqDragProjectId = card.dataset.projectId || null;
  if(!_rqDragTaskId){ e.preventDefault(); return; }
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', _rqDragTaskId);
  // Slight delay so the "dragging" class applies after the ghost image is captured
  setTimeout(() => card.classList.add('rq-dragging'), 0);
}

function _rqDragEnd(e){
  const card = e.currentTarget;
  card.classList.remove('rq-dragging');
  card.setAttribute('draggable','true');
  _rqDragTaskId = null;
  _rqDragProjectId = null;
  // Clear any leftover drop-over highlights
  document.querySelectorAll('.release-card.rq-drop-over').forEach(el=>el.classList.remove('rq-drop-over'));
}

function _rqDragOver(e){
  if(!_rqDragTaskId) return;
  const card = e.currentTarget;
  const releaseStatus = card.dataset.releaseStatus || '';
  const releaseProject = card.dataset.releaseProjectId || card.dataset.releaseProject || '';
  // Block: released status
  if(releaseStatus === 'released'){ e.dataTransfer.dropEffect='none'; return; }
  // Block: project mismatch
  if(_rqDragProjectId && releaseProject && _rqDragProjectId !== releaseProject){ e.dataTransfer.dropEffect='none'; return; }
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  card.classList.add('rq-drop-over');
}

function _rqDragLeave(e){
  // Only remove highlight when truly leaving the card (not a child element)
  if(!e.currentTarget.contains(e.relatedTarget)){
    e.currentTarget.classList.remove('rq-drop-over');
  }
}

function _rqDrop(e){
  e.preventDefault();
  const card = e.currentTarget;
  card.classList.remove('rq-drop-over');
  const taskId    = _rqDragTaskId || e.dataTransfer.getData('text/plain');
  const releaseId = card.dataset.releaseId || '';
  const releaseStatus  = card.dataset.releaseStatus || '';
  const releaseProject = card.dataset.releaseProjectId || card.dataset.releaseProject || '';

  if(!taskId || !releaseId) return;

  // Validation 2: block drop onto released release
  if(releaseStatus === 'released'){
    showNotif('⚠ Cannot map to an already-Released release','error');
    return;
  }

  const release = getRelease(releaseId);
  const task    = getTask(taskId);
  if(!release || !task){ showNotif('⚠ Task or release not found','error'); return; }

  // Validation 1: project match
  const taskProject = task.project || task.projectId || '';
  if(taskProject && release.projectId && taskProject !== release.projectId){
    showNotif('⚠ Cannot map: task and release belong to different projects','error');
    return;
  }

  // Validation 3: reuse existing mapTaskToRelease logic — set the select value then call it,
  // OR call the update flow directly (same operations as mapTaskToRelease).
  if(RBAC.isMember()||RBAC.isViewer()){ showNotif('⚠ Only admins, senior managers, and program managers can map tasks to releases','error'); return; }
  if(task.status!=='released'){ showNotif('⚠ Only Released tasks can be mapped','error'); return; }

  // Apply the same update flow as mapTaskToRelease
  const newIds=[...new Set([...(release.taskIds||[]),taskId])];
  updateRelease(releaseId,{taskIds:newIds});
  task.releaseId=releaseId;
  FirebaseDB.saveEntity('tasks', task).catch(e=>console.warn('[rqDrop] Firebase error:',e));
  SaveManager.save();
  SaveManager.saveReleases();
  renderReleaseBoard();
  showNotif(`Task mapped to "${release.name}" ✓`);
}
// ── End Enhancement 2 ───────────────────────────────────────────────────────

function renderReleaseQueue(){
  const list=document.getElementById('release-queue-list');
  const badge=document.getElementById('rq-count-badge');
  const selectAllWrap=document.getElementById('rq-select-all-wrap');
  if(!list)return;
  const tasks=getQueueTasks();
  if(badge)badge.textContent=tasks.length;
  const _rqCanBulk=RBAC.isAdmin()||RBAC.isProgramManager()||RBAC.isSeniorManager();
  if(selectAllWrap) selectAllWrap.style.display=(_rqCanBulk && tasks.length)?'':'none';
  const selectAllCb=document.getElementById('rq-select-all');
  if(selectAllCb) selectAllCb.dataset.ids=JSON.stringify(tasks.map(t=>t.id));
  if(!tasks.length){
    list.innerHTML=`<div class="rq-empty">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="1.5" style="margin:0 auto 8px"><path d="M9 12l2 2 4-4"/><path d="M12 2a10 10 0 100 20A10 10 0 0012 2z"/></svg>
      <div>No released tasks awaiting mapping</div>
      <div style="font-size:11px;margin-top:4px;color:#cbd5e1">Tasks move here when status = Released</div>
    </div>`;
    _blSyncGroupHeaders(); _blUpdateBar();
    return;
  }
  // NOTE: releaseOpts are now built per-task inside the map() below so each
  // task's dropdown shows only releases belonging to that task's own project.
  // (The old single shared releaseOpts from state.releases was removed.)
  list.innerHTML=`<div class="space-y-2">`+tasks.map(t=>{
    const proj=getProject(t.project);
    const sprint=getSprint(t.sprint);
    const epic=t.epicId?getEpic(t.epicId):null;
    // DROPDOWN FIX: filter releases to this task's project only (and RBAC-visible)
    // ENHANCEMENT 1: also exclude releases whose status === 'Released' (case-insensitive)
    const taskReleases=RBAC.getVisibleReleases().filter(r=>
      r.projectId===t.project &&
      (r.status||'').toLowerCase()!=='released'
    );
    const releaseOpts=taskReleases.map(r=>`<option value="${r.id}">${_escHtml(r.name)} (v${_escHtml(r.version)})</option>`).join('');
    const hasReleases=taskReleases.length>0;
    const _rqChecked=_blIsSelected('task:'+t.id);
    return `<div class="rq-card${_rqChecked?' bl-selected':''}" id="rqc-${t.id}" draggable="true" data-task-id="${t.id}" data-project-id="${t.project || ''}" onmousedown="_rqDragMousedown(event)" ondragstart="_rqDragStart(event)" ondragend="_rqDragEnd(event)">
      <div style="display:flex;align-items:flex-start;gap:8px">
        ${_rqCanBulk?`<input type="checkbox" class="bl-checkbox" style="margin-top:2px" ${_rqChecked?'checked':''} onchange="_blToggleTask('${t.id}',this)" onmousedown="event.stopPropagation()"/>`:''}
        <span style="color:${typeColor(t.type)};font-size:14px;flex-shrink:0;margin-top:1px">${typeIcon(t.type)}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;color:#1e293b;line-height:1.3;margin-bottom:5px">${_escHtml(t.title)}</div>
          <div style="display:flex;flex-wrap:wrap;gap:5px;align-items:center">
            ${proj?`<span style="font-size:10px;font-weight:700;padding:1px 7px;border-radius:10px;background:${proj.color}18;color:${proj.color}">${_escHtml(proj.name)}</span>`:''}
            ${sprint?`<span class="tag" style="font-size:10px">${_escHtml(sprint.name)}</span>`:''}
            ${epic?`<span style="font-size:10px;padding:1px 7px;border-radius:10px;background:${epic.color}18;color:${epic.color};font-weight:600">◈ ${_escHtml(epic.title)}</span>`:''}
            <span class="badge badge-released" style="font-size:9px;padding:1px 6px">Released</span>
          </div>
        </div>
      </div>
      <div class="rq-map-row">
        ${hasReleases
          ?`<select class="rq-map-select" id="rqsel-${t.id}"><option value="">— Select release —</option>${releaseOpts}</select>
             <button class="rq-map-btn" onclick="mapTaskToRelease('${t.id}')">Add →</button>`
          :`<span style="font-size:11px;color:#94a3b8;flex:1">Create a release first</span>
             <button class="btn btn-secondary" style="font-size:11px;padding:4px 10px" onclick="openCreateReleaseModal()">+ Release</button>`
        }
      </div>
    </div>`;
  }).join('')+`</div>`;
  _blSyncGroupHeaders(); _blUpdateBar();
}

function mapTaskToRelease(taskId){
  if(RBAC.isMember()||RBAC.isViewer()){ showNotif('⚠ Only admins, senior managers, and program managers can map tasks to releases','error'); return; }
  const sel=document.getElementById('rqsel-'+taskId);
  if(!sel||!sel.value){showNotif('⚠ Select a release first','error');return;}
  const releaseId=sel.value;
  const release=getRelease(releaseId);
  if(!release){showNotif('⚠ Release not found','error');return;}
  const task=getTask(taskId);
  if(!task){showNotif('⚠ Task not found','error');return;}
  if(task.status!=='released'){showNotif('⚠ Only Released tasks can be mapped','error');return;}
  // Add to release
  const newIds=[...new Set([...(release.taskIds||[]),taskId])];
  updateRelease(releaseId,{taskIds:newIds});
  task.releaseId=releaseId;
  // ── Firebase: persist task.releaseId change ──
  FirebaseDB.saveEntity('tasks', task).catch(e=>console.warn('[mapTaskToRelease] Firebase error:',e));
  SaveManager.save();
  SaveManager.saveReleases();
  renderReleaseBoard();
  showNotif(`Task mapped to "${release.name}" ✓`);
}

function unmapTaskFromRelease(taskId,releaseId){
  const release=getRelease(releaseId);
  if(!release)return;
  const newIds=(release.taskIds||[]).filter(id=>id!==taskId);
  updateRelease(releaseId,{taskIds:newIds});
  const task=getTask(taskId);
  if(task){
    task.releaseId=null;
    // ── Firebase: persist task.releaseId cleared ──
    FirebaseDB.saveEntity('tasks', task).catch(e=>console.warn('[unmapTaskFromRelease] Firebase error:',e));
  }
  SaveManager.save();
  SaveManager.saveReleases();
  renderReleaseBoard();
  showNotif('Task removed from release');
}

// ── Filters ───────────────────────────────────────────────────────
function populateReleaseFilters(){
  const projSel=document.getElementById('rf-project');
  const sprintSel=document.getElementById('rf-sprint');
  if(!projSel||!sprintSel)return;
  const prevProj=projSel.value, prevSprint=sprintSel.value;
  projSel.innerHTML=`<option value="">All Projects</option>`+
    RBAC.getVisibleProjects().map(p=>`<option value="${p.id}"${p.id===prevProj?' selected':''}>${p.name}</option>`).join('');
  // Sprint filter: group by active/completed
  const _allSpr=RBAC.getVisibleSprints();
  const _activeSpr=_allSpr.filter(s=>(s.status||'').toLowerCase()==='active');
  const _completedSpr=_allSpr.filter(s=>(s.status||'').toLowerCase()==='completed');
  // Validate prev value
  const _validIds=_allSpr.map(s=>s.id);
  const _validGroups=['','active-group','completed-group'];
  if(!_validGroups.includes(prevSprint)&&!_validIds.includes(prevSprint)) sprintSel.value='';
  _sfDropBuild('rf',[
    {groupValue:'active-group',   groupLabel:'Active Sprints',    sprints:_activeSpr},
    {groupValue:'completed-group',groupLabel:'Completed Sprints', sprints:_completedSpr}
  ],'','All Sprints');
  // Sync button label
  const lbl=document.getElementById('rf-sprint-label');
  if(lbl){
    const cur=sprintSel.value||'';
    if(!cur) lbl.textContent='All Sprints';
    else if(cur==='active-group') lbl.textContent='Active Sprints';
    else if(cur==='completed-group') lbl.textContent='Completed Sprints';
    else{ const f=_allSpr.find(s=>s.id===cur); lbl.textContent=f?f.name:'All Sprints'; }
  }
}

function clearReleaseFilters(){
  ['rf-project','rf-status'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const sprintSel=document.getElementById('rf-sprint');
  if(sprintSel) sprintSel.value='';
  const lbl=document.getElementById('rf-sprint-label');
  if(lbl) lbl.textContent='All Sprints';
  renderReleaseBoard();
}

function getFilteredReleases(){
  const proj=(document.getElementById('rf-project')||{}).value||'';
  const sprint=(document.getElementById('rf-sprint')||{}).value||'';
  const status=(document.getElementById('rf-status')||{}).value||'';
  // Resolve group values into sprint ID sets
  let sprintIds=null;
  if(sprint==='active-group'){
    sprintIds=new Set(RBAC.getVisibleSprints().filter(s=>(s.status||'').toLowerCase()==='active').map(s=>s.id));
  } else if(sprint==='completed-group'){
    sprintIds=new Set(RBAC.getVisibleSprints().filter(s=>(s.status||'').toLowerCase()==='completed').map(s=>s.id));
  }
  // RBAC: start from user-visible releases only
  return RBAC.getVisibleReleases().filter(r=>{
    if(proj&&r.projectId!==proj)return false;
    if(sprintIds!==null){ if(!sprintIds.has(r.sprintId))return false; }
    else if(sprint&&r.sprintId!==sprint)return false;
    if(status&&r.status!==status)return false;
    return true;
  });
}

// ── Main render ───────────────────────────────────────────────────
function renderReleaseBoard(){
  if(!state.releases)state.releases=[];
  populateReleaseFilters();
  renderReleaseQueue();

  const releases=getFilteredReleases();
  const grid=document.getElementById('release-board-grid');
  const countEl=document.getElementById('rf-count');
  const sub=document.getElementById('releases-subtitle');
  const rbBadge=document.getElementById('rb-count-badge');
  // RBAC FIX: subtitle reflects visible releases only, not global total
  const _visibleReleasesForSub=RBAC.getVisibleReleases();
  if(sub)sub.textContent=`${_visibleReleasesForSub.length} release${_visibleReleasesForSub.length!==1?'s':''}`;
  if(countEl)countEl.textContent=releases.length+' shown';
  if(rbBadge)rbBadge.textContent=releases.length;
  if(!grid)return;
  if(!releases.length){
    grid.innerHTML=`<div style="grid-column:1/-1" class="empty-state">
      <div class="empty-state-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg></div>
      <div class="text-sm text-slate-400 mb-3">No releases found</div>
      <button class="btn btn-primary text-xs" onclick="openCreateReleaseModal()">Create first release</button>
    </div>`;
    return;
  }

  // ── Enhancement 2: Group cards by status ──
  const _rbGroups = [
    { key: 'Planned',      label: 'Planned Releases',      emptyLabel: 'No planned releases' },
    { key: 'Ready',        label: 'In Progress / Ready',   emptyLabel: 'No in-progress releases' },
    { key: 'Released',     label: 'Released',              emptyLabel: 'No released releases' },
    { key: 'Rolled Back',  label: 'Rolled Back',           emptyLabel: 'No rolled back releases' },
  ];
  const _rbGroupMap = {};
  _rbGroups.forEach(g => { _rbGroupMap[g.key] = []; });
  releases.forEach(r => {
    const bucket = _rbGroupMap.hasOwnProperty(r.status) ? r.status : 'Planned';
    _rbGroupMap[bucket].push(r);
  });

  const _groupStatusColors = {
    'Planned':     '#64748b',
    'Ready':       '#2563eb',
    'Released':    '#16a34a',
    'Rolled Back': '#dc2626',
  };

  let html = '';
  _rbGroups.forEach(g => {
    const groupReleases = _rbGroupMap[g.key] || [];
    const count = groupReleases.length;
    const color = _groupStatusColors[g.key] || '#64748b';
    html += `<div style="grid-column:1/-1;margin-top:8px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding-bottom:8px;border-bottom:2px solid rgba(0,0,0,0.06)">
        <span style="font-size:12px;font-weight:700;color:${color};letter-spacing:0.04em;text-transform:uppercase">${g.label}</span>
        <span style="display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;background:${color};color:#fff;border-radius:999px;font-size:10px;font-weight:700">${count}</span>
      </div>
      ${count === 0
        ? `<div style="font-size:12px;color:#94a3b8;padding:12px 0 4px">${g.emptyLabel}</div>`
        : `<div class="grid gap-4" style="grid-template-columns:repeat(auto-fill,minmax(340px,1fr))">${groupReleases.map(r=>releaseCard(r)).join('')}</div>`
      }
    </div>`;
  });
  grid.innerHTML = html;
}

// ── Release card ──────────────────────────────────────────────────
function releaseCard(r){
  const prog=getReleaseProgress(r.id);
  const proj=getProject(r.projectId);
  const sprint=getSprint(r.sprintId);
  const owner=getUser(r.ownerId);
  const tasks=getReleaseTasks(r.id);
  const stripColor=releaseStatusColor(r.status);
  const badgeCls=releaseStatusBadge(r.status);
  const releasedCount=tasks.filter(t=>DONE_STATUSES.includes(t.status)).length;
  const readinessPct=tasks.length?Math.round((releasedCount/tasks.length)*100):0;
  const warnMissingNotes=!r.releaseNotes||!r.releaseNotes.trim();
  const warnNoTasks=!tasks.length;

  const taskRows=tasks.map(t=>{
    const _tEpic=t.epicId?getEpic(t.epicId):null;
    const _epicTag=_tEpic?`<span class="epic-badge flex-shrink-0" style="background:${_tEpic.color}22;color:${_tEpic.color};border:1px solid ${_tEpic.color}55;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:9px;padding:1px 6px" title="${_escHtml(_tEpic.title)}">◈ ${_escHtml(_tEpic.title)}</span>`:'';
    // Subtasks (if any) inherit the parent task's epic when they have none of their own
    const _tSubtasks=Array.isArray(t.subtasks)?t.subtasks:[];
    const _subtaskRows=_tSubtasks.map(st=>{
      const _stEpic=st.epicId?getEpic(st.epicId):_tEpic;
      const _stEpicTag=_stEpic?`<span class="epic-badge flex-shrink-0" style="background:${_stEpic.color}22;color:${_stEpic.color};border:1px solid ${_stEpic.color}55;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:9px;padding:1px 6px" title="${_escHtml(_stEpic.title)}">◈ ${_escHtml(_stEpic.title)}</span>`:'';
      return `
    <div class="release-task-row" style="padding-left:28px" onclick="openSubtaskModal('${t.id}','${st.id}')">
      <span style="color:#94a3b8;font-size:11px;flex-shrink:0">↳</span>
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#64748b;font-size:11.5px">${_escHtml(st.title)}</span>
      ${_stEpicTag}
      <span class="badge badge-${statusBadgeClass(st.status)}" style="font-size:9px;padding:1px 6px;flex-shrink:0">${statusLabel(st.status)}</span>
    </div>`;
    }).join('');
    return `
    <div class="release-task-row" onclick="openTaskModal('${t.id}')">
      <span style="color:${typeColor(t.type)};font-size:12px;flex-shrink:0">${typeIcon(t.type)}</span>
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#334155;font-size:12px">${_escHtml(t.title)}</span>
      ${_epicTag}
      <span class="badge badge-${statusBadgeClass(t.status)}" style="font-size:9px;padding:1px 6px;flex-shrink:0">${statusLabel(t.status)}</span>
      <button onclick="event.stopPropagation();unmapTaskFromRelease('${t.id}','${r.id}')" title="Remove from release"
        style="flex-shrink:0;background:none;border:none;cursor:pointer;color:#cbd5e1;padding:0;display:flex;align-items:center;transition:color 0.15s"
        onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='#cbd5e1'">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>${_subtaskRows}`;
  }).join('');

  // ENHANCEMENT 2: drop target attrs; blocked if released status
  const _ddBlocked=(r.status||'').toLowerCase()==='released';
  return `<div class="release-card${_ddBlocked?' rq-drop-blocked':''}" data-release-id="${r.id}" data-release-project="${r.projectId||''}" data-release-status="${(r.status||'').toLowerCase()}" ondragover="_rqDragOver(event)" ondragleave="_rqDragLeave(event)" ondrop="_rqDrop(event)">
    <div class="release-status-strip" style="background:${stripColor}"></div>
    <div style="padding:16px 18px">
      <!-- Header -->
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:12px">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px">
            <span class="badge ${badgeCls}" style="font-size:10px">${r.status}</span>
            <span class="tag" style="font-family:'DM Mono',monospace;font-size:10px">v${_escHtml(r.version)}</span>
            <span style="font-size:11px;color:#94a3b8">${tasks.length} task${tasks.length!==1?'s':''}</span>
          </div>
          <div style="font-size:15px;font-weight:700;color:#0f172a;line-height:1.3">${_escHtml(r.name)}</div>
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0">
          ${RBAC.isAdmin()||RBAC.isProgramManager()||RBAC.isSeniorManager()?`<button class="btn btn-secondary" style="padding:4px 9px;font-size:11px" onclick="openEditReleaseModal('${r.id}')">Edit</button>`:''}
          ${RBAC.isAdmin()?`<button class="btn btn-danger" style="padding:4px 9px;font-size:11px" onclick="confirmDeleteRelease('${r.id}')">×</button>`:''}
        </div>
      </div>

      <!-- Meta -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:12px;font-size:11px;color:#64748b">
        <div style="display:flex;align-items:center;gap:5px">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>
          <span style="color:${proj?proj.color:'#94a3b8'};font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${proj?proj.name:'—'}</span>
        </div>
        <div style="display:flex;align-items:center;gap:5px">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${sprint?sprint.name:'No sprint'}</span>
        </div>
        <div style="display:flex;align-items:center;gap:5px">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <span>${r.releaseDate?formatDate(r.releaseDate):'No date'}</span>
        </div>
        <div style="display:flex;align-items:center;gap:5px">
          ${owner?`${userAvatar(owner.id,14)}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_escHtml(owner.name)}</span>`:`<span>No owner</span>`}
        </div>
      </div>

      <!-- Progress -->
      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-size:11px;color:#64748b;margin-bottom:4px">
          <span>${prog.done}/${prog.total} done · ${readinessPct}% released</span>
          <span style="font-weight:700;color:${prog.pct===100?'#10b981':'#6366f1'}">${prog.pct}%</span>
        </div>
        <div class="progress-bar" style="height:6px">
          <div class="progress-fill" style="width:${prog.pct}%;background:${prog.pct===100?'#10b981':'#6366f1'}"></div>
        </div>
      </div>

      <!-- Release notes -->
      ${r.releaseNotes&&r.releaseNotes.trim()?`<div class="release-notes-preview">${_escHtml(r.releaseNotes.trim().slice(0,120))}${r.releaseNotes.trim().length>120?'…':''}</div>`:''}

      <!-- Warnings -->
      ${warnMissingNotes?`<div class="release-warn">⚠ Release notes missing</div>`:''}
      ${warnNoTasks?`<div class="release-warn" style="background:#fce7f3;color:#be185d">⚠ No tasks mapped yet</div>`:''}

      <!-- Collapsible task list -->
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid #f1f5f9">
        <button class="release-section-toggle" onclick="toggleReleaseTasks('${r.id}')">
          <svg id="rtoggle-icon-${r.id}" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="transition:transform 0.2s;flex-shrink:0"><path d="M9 18l6-6-6-6"/></svg>
          <span>Mapped Tasks (${tasks.length})</span>
          <span style="margin-left:auto;font-size:11px;font-weight:400;color:#94a3b8">${releasedCount} released · ${tasks.length-releasedCount} pending</span>
        </button>
        <div class="release-tasks-area" id="rtasks-${r.id}" style="max-height:0">
          ${tasks.length
            ?`<div style="margin-top:6px;display:flex;flex-direction:column;gap:1px">${taskRows}</div>`
            :`<div style="text-align:center;padding:14px;font-size:12px;color:#94a3b8;border:1px dashed #e2e8f0;border-radius:8px;margin-top:6px">No tasks mapped — use the Release Queue on the left</div>`
          }
        </div>
      </div>
    </div>
  </div>`;
}

function toggleReleaseTasks(releaseId){
  const area=document.getElementById('rtasks-'+releaseId);
  const icon=document.getElementById('rtoggle-icon-'+releaseId);
  if(!area)return;
  const open=area.style.maxHeight!=='0px'&&area.style.maxHeight!=='';
  area.style.maxHeight=open?'0':'800px';
  if(icon)icon.style.transform=open?'':'rotate(90deg)';
}

function confirmDeleteRelease(id){
  if(!RBAC.isAdmin()){ showNotif('⚠ Only admins can delete releases','error'); return; }
  if(!confirm('Delete this release?'))return;
  deleteRelease(id);
  renderReleaseBoard();
  showNotif('Release deleted');
}

// ── Create Release Modal ──────────────────────────────────────────
// ── Release modal helpers ─────────────────────────────────────────
// Build sprint <option> list for a given projectId ('' = no project = no sprints shown).
function _releaseSprintOptions(projectId, selectedId){
  if(!projectId) return '<option value="">— select a project first —</option>';
  const sprints=state.sprints.filter(s=>s.project===projectId);
  if(!sprints.length) return '<option value="">No sprints in this project</option>';
  return `<option value="">None</option>`+sprints.map(s=>`<option value="${s.id}"${s.id===selectedId?' selected':''}>${s.name}</option>`).join('');
}
// Build owner <option> list filtered to project members (or all users when no project).
function _releaseOwnerOptions(projectId, selectedId){
  const proj=projectId?state.projects.find(p=>p.id===projectId):null;
  const memberIds=proj&&Array.isArray(proj.memberIds)&&proj.memberIds.length?proj.memberIds:null;
  const users=memberIds?state.users.filter(u=>memberIds.includes(u.id)):state.users;
  return `<option value="">None</option>`+users.map(u=>`<option value="${u.id}"${u.id===selectedId?' selected':''}>${u.name}</option>`).join('');
}
// Called when Project select changes in either release modal.
// prefix = 'cr' (create) or 'er' (edit).
function _releaseProjectChanged(prefix){
  const projectId=document.getElementById(prefix+'-project').value;
  const sprintSel=document.getElementById(prefix+'-sprint');
  const ownerSel =document.getElementById(prefix+'-owner');
  if(sprintSel) sprintSel.innerHTML=_releaseSprintOptions(projectId,'');
  if(ownerSel)  ownerSel.innerHTML =_releaseOwnerOptions(projectId,'');
}

function openCreateReleaseModal(){
  if(RBAC.isMember()||RBAC.isViewer()){ showNotif('⚠ Only admins, senior managers, and program managers can create releases','error'); return; }
  const visibleProjects=RBAC.getVisibleProjects();
  openModal(`
    <div class="p-6">
      <div class="flex items-center justify-between mb-5">
        <h2 class="text-lg font-bold text-slate-900">New Release</h2>
        <button onclick="closeModal()" style="color:var(--text-muted);cursor:pointer;transition:color 0.14s" onmouseenter="this.style.color='var(--text-primary)'" onmouseleave="this.style.color='var(--text-muted)'"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
      <div class="space-y-4">
        <div class="grid grid-cols-2 gap-4">
          <div><label>Release Name *</label><input type="text" id="cr-name" placeholder="e.g. Sprint 4 Release"/></div>
          <div><label>Version *</label><input type="text" id="cr-version" placeholder="e.g. 2.1.0"/></div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div><label>Project</label>
            <select id="cr-project" onchange="_releaseProjectChanged('cr')">
              <option value="">None</option>
              ${visibleProjects.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}
            </select>
          </div>
          <div><label>Sprint</label>
            <select id="cr-sprint"><option value="">— select a project first —</option></select>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div><label>Owner</label>
            <select id="cr-owner"><option value="">None</option>${state.users.map(u=>`<option value="${u.id}">${u.name}</option>`).join('')}</select>
          </div>
          <div><label>Release Date</label><input type="date" id="cr-date"/></div>
        </div>
        <div><label>Status</label>
          <select id="cr-status">${RELEASE_STATUSES.map(s=>`<option value="${s}">${s}</option>`).join('')}</select>
        </div>
        <div>
          <label>Release Notes</label>
          <textarea id="cr-notes" rows="3" placeholder="Describe what's included in this release…"></textarea>
          <div id="cr-warn-notes" class="release-warn" style="display:none">⚠ Release notes required for tasks to be marked Released</div>
        </div>
      </div>
      <div class="flex justify-end gap-3 mt-6 pt-4" style="border-top:1px solid rgba(0,0,0,0.05)">
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="submitCreateRelease()">Create Release</button>
      </div>
    </div>
  `);
}

function submitCreateRelease(){
  if(RBAC.isMember()||RBAC.isViewer()){ showNotif('⚠ Only admins, senior managers, and program managers can create releases','error'); return; }
  const name=document.getElementById('cr-name').value.trim();
  const version=document.getElementById('cr-version').value.trim();
  if(!name){showNotif('⚠ Release name required','error');return;}
  if(!version){showNotif('⚠ Version required','error');return;}
  const notes=document.getElementById('cr-notes').value.trim();
  document.getElementById('cr-warn-notes').style.display=notes?'none':'flex';
  createRelease({
    name,version,
    projectId:document.getElementById('cr-project').value||null,
    sprintId:document.getElementById('cr-sprint').value||null,
    ownerId:document.getElementById('cr-owner').value||null,
    releaseDate:document.getElementById('cr-date').value||null,
    status:document.getElementById('cr-status').value||'Planned',
    releaseNotes:notes,
    taskIds:[]
  });
  closeModal();
  renderReleaseBoard();
  showNotif(`Release "${name}" created ✓`);
}

// ── Edit Release Modal ────────────────────────────────────────────
function openEditReleaseModal(id){
  const r=getRelease(id);
  if(!r)return;
  // ── Field-freeze: released release locks all fields EXCEPT status dropdown ──
  const isLocked = isReleaseLocked(r);
  const _rdis = (cond) => cond ? 'disabled' : '';
  const visibleProjects=RBAC.getVisibleProjects();
  openModal(`
    <div class="p-6">
      <div class="flex items-center justify-between mb-5">
        <h2 class="text-lg font-bold text-slate-900">Edit Release${isLocked?' <span style="font-size:11px;font-weight:500;color:#dc2626;background:#fef2f2;border:1px solid #fecaca;padding:2px 7px;border-radius:4px;vertical-align:middle">Released — Locked</span>':''}</h2>
        <button onclick="closeModal()" style="color:var(--text-muted);cursor:pointer;transition:color 0.14s" onmouseenter="this.style.color='var(--text-primary)'" onmouseleave="this.style.color='var(--text-muted)'"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
      <div class="space-y-4">
        <div class="grid grid-cols-2 gap-4">
          <div><label>Release Name *</label><input type="text" id="er-name" value="${_escHtml(r.name)}" ${_rdis(isLocked)}/></div>
          <div><label>Version *</label><input type="text" id="er-version" value="${_escHtml(r.version)}" ${_rdis(isLocked)}/></div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div><label>Project</label>
            <select id="er-project" ${_rdis(isLocked)} ${isLocked?'':'onchange="_releaseProjectChanged(\'er\')"'}>
              <option value="">None</option>
              ${visibleProjects.map(p=>`<option value="${p.id}"${p.id===r.projectId?' selected':''}>${p.name}</option>`).join('')}
            </select>
          </div>
          <div><label>Sprint</label>
            <select id="er-sprint" ${_rdis(isLocked)}>${_releaseSprintOptions(r.projectId||'',r.sprintId||'')}</select>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div><label>Owner</label>
            <select id="er-owner" ${_rdis(isLocked)}>${_releaseOwnerOptions(r.projectId||'',r.ownerId||'')}</select>
          </div>
          <div><label>Release Date</label><input type="date" id="er-date" value="${r.releaseDate||''}" ${_rdis(isLocked)}/></div>
        </div>
        <div><label>Status</label>
          <select id="er-status">${isLocked
            ? '<option value="Released" selected>Released</option><option value="rollback">Rollback</option>'
            : RELEASE_STATUSES.map(s=>`<option value="${s}"${s===r.status?' selected':''}>${s}</option>`).join('')
          }</select>
        </div>
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
            <label>Release Notes</label>
            ${isLocked?'':`<button type="button" class="ai-writing-only" id="ai-relnotes-btn-${r.id}" onclick="AI.generateReleaseNotes('${r.id}','er-notes','ai-relnotes-btn-${r.id}')" style="display:none;background:none;border:none;cursor:pointer;color:var(--accent);font-size:11.5px;font-weight:600;padding:2px 4px" title="Draft release notes from mapped tasks with AI">✨ Generate Release Notes</button>`}
          </div>
          <textarea id="er-notes" rows="3" ${_rdis(isLocked)}>${_escHtml(r.releaseNotes||'')}</textarea>
          <div id="er-warn-notes" class="release-warn" style="display:${_releaseNotesTextLength(r.releaseNotes||'') < 100 && (!r.releaseNotes || r.status !== 'Released') ? 'flex' : 'none'}">${(!r.releaseNotes||!r.releaseNotes.trim()) ? '⚠ Release notes required before marking Released (min 100 chars)' : '⚠ Release notes too short — minimum 100 characters required to mark as Released (current: '+_releaseNotesTextLength(r.releaseNotes||'')+' chars)'}</div>
        </div>
      </div>
      <div class="flex justify-end gap-3 mt-6 pt-4" style="border-top:1px solid rgba(0,0,0,0.05)">
        ${RBAC.isAdmin()?`<button class="btn btn-danger text-sm" onclick="confirmDeleteRelease('${r.id}');closeModal()">Delete</button>`:''}
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="submitEditRelease('${r.id}')">${isLocked?'Rollback':'Save Changes'}</button>
      </div>
    </div>
  `);
}

function submitEditRelease(id){
  const existing=getRelease(id);
  if(!existing)return;
  // ── Released release: only rollback is allowed ──
  if(isReleaseLocked(existing)){
    const selectedStatus = document.getElementById('er-status') ? document.getElementById('er-status').value : '';
    if(selectedStatus==='rollback'){
      updateRelease(id,{ status:'Rolled Back', taskIds:existing.taskIds });
      closeModal();
      renderReleaseBoard();
      showNotif('Release rolled back','success');
      return;
    }
    showNotif('⚠ Released releases are locked and cannot be edited.','error');
    return;
  }
  const name=document.getElementById('er-name').value.trim();
  const version=document.getElementById('er-version').value.trim();
  if(!name){showNotif('⚠ Release name required','error');return;}
  if(!version){showNotif('⚠ Version required','error');return;}
  const notes=document.getElementById('er-notes').value.trim();
  document.getElementById('er-warn-notes').style.display=notes?'none':'flex';
  // ── Enhancement 1: Release Notes Validation — block Released if notes < 100 chars ──
  const _erNewStatus=document.getElementById('er-status').value;
  if(_erNewStatus==='Released'){
    const _notesVal = document.getElementById('er-notes').value;
    const _rnValidation = validateReleaseNotesForRelease(_notesVal);
    if(!_rnValidation.valid){
      showNotif('⚠ ' + _rnValidation.message.split('\n')[0], 'error');
      // Show inline error under notes field
      const _warnEl = document.getElementById('er-warn-notes');
      if(_warnEl){
        _warnEl.textContent = '⚠ ' + _rnValidation.message.replace(/\n/g,' ');
        _warnEl.style.display = 'flex';
      }
      return;
    }
    const _relTaskIds=(existing.taskIds||[]);
    if(!_relTaskIds.length){
      showNotif('⚠ Cannot mark release as Released — no tasks are mapped to this release yet. Map tasks from the Release Queue first.','error');
      return;
    }
    const _relIncomplete=_relTaskIds.filter(tid=>{const t=getTask(tid);return t&&t.status!=='released';});
    if(_relIncomplete.length){
      showNotif('⚠ Cannot mark release as Released — '+_relIncomplete.length+' task'+(_relIncomplete.length>1?'s':'')+' not yet released','error');
      return;
    }
  }
  // Preserve existing taskIds — mapping is done via queue only
  updateRelease(id,{
    name,version,
    projectId:document.getElementById('er-project').value||null,
    sprintId:document.getElementById('er-sprint').value||null,
    ownerId:document.getElementById('er-owner').value||null,
    releaseDate:document.getElementById('er-date').value||null,
    status:document.getElementById('er-status').value,
    releaseNotes:notes,
    taskIds:existing?existing.taskIds:[]
  });
  closeModal();
  renderReleaseBoard();
  showNotif('Release updated ✓');
}

