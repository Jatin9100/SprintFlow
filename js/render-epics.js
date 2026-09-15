function toggleEpicCard(card, prefix){
  const cb  = card.querySelector('input[type="checkbox"]');
  if(!cb) return;
  cb.checked = !cb.checked;
  _applyEpicCardState(card, cb.checked);
  const total = document.querySelectorAll('.'+prefix+'-epic-check:checked').length;
  const badge = document.getElementById(prefix+'-epic-count');
  if(badge) badge.textContent = total === 0 ? 'None' : total + ' selected';
}

function _applyEpicCardState(card, selected){
  const icon    = card.querySelector('.psc-check-circle');
  const checkSvg= card.querySelector('.psc-check-svg');
  if(selected){
    card.style.borderColor  = 'rgba(91,95,199,0.55)';
    card.style.background   = 'rgba(91,95,199,0.07)';
    card.style.boxShadow    = '0 0 0 3px rgba(91,95,199,0.1),inset 0 1px 0 rgba(255,255,255,0.6)';
    if(icon){ icon.style.background='var(--accent)'; icon.style.borderColor='var(--accent)'; }
    if(checkSvg) checkSvg.style.opacity='1';
  } else {
    card.style.borderColor  = 'rgba(0,0,0,0.08)';
    card.style.background   = 'rgba(248,249,252,0.9)';
    card.style.boxShadow    = 'none';
    if(icon){ icon.style.background='transparent'; icon.style.borderColor='rgba(0,0,0,0.15)'; }
    if(checkSvg) checkSvg.style.opacity='0';
  }
}

function initEpicCards(prefix){
  document.querySelectorAll('#'+prefix+'-epic-access-wrap .psc-card[data-prefix="'+prefix+'"]').forEach(card=>{
    const cb = card.querySelector('input[type="checkbox"]');
    if(cb) _applyEpicCardState(card, cb.checked);
    card.addEventListener('mouseenter', function(){
      if(this.querySelector('input[type="checkbox"]').checked) return;
      this.style.borderColor = 'rgba(0,0,0,0.14)';
      this.style.background  = 'rgba(255,255,255,0.98)';
      this.style.boxShadow   = '0 2px 8px rgba(0,0,0,0.06)';
    });
    card.addEventListener('mouseleave', function(){
      const checked = this.querySelector('input[type="checkbox"]').checked;
      _applyEpicCardState(this, checked);
    });
  });
  const total = document.querySelectorAll('.'+prefix+'-epic-check:checked').length;
  const badge = document.getElementById(prefix+'-epic-count');
  if(badge) badge.textContent = total === 0 ? 'None' : total + ' selected';
}

// ─── EPICS ────────────────────────────────────────────────────────
function renderEpics(){
  if(!state.epics)state.epics=[];
  const projFilterEl=document.getElementById('epics-project-filter');
  const statusFilterEl=document.getElementById('epics-status-filter');
  const currentProj=projFilterEl?projFilterEl.value:'all';
  const currentStatus=statusFilterEl?statusFilterEl.value:'all';

  // Populate project dropdown — RBAC FIX: use visible projects only
  const _visibleEpicProjects=RBAC.getVisibleProjects();
  if(projFilterEl){
    projFilterEl.innerHTML=`<option value="all">All Projects</option>`+_visibleEpicProjects.map(p=>`<option value="${p.id}"${p.id===currentProj?' selected':''}>${p.name}</option>`).join('');
  }

  // RBAC FIX: start from RBAC-scoped epics, not raw state.epics
  let epics=RBAC.getVisibleEpics();
  if(currentProj!=='all') epics=epics.filter(e=>{
    const epicProjects=e.projectIds||(e.projectId?[e.projectId]:[]);
    return epicProjects.includes(currentProj);
  });
  if(currentStatus!=='all') epics=epics.filter(e=>e.status===currentStatus);

  // RBAC FIX: subtitle counts reflect visible scope, not global totals
  const _allVisibleEpics=RBAC.getVisibleEpics();
  const subtitle=document.getElementById('epics-subtitle');
  if(subtitle) subtitle.textContent=`${_allVisibleEpics.length} epic${_allVisibleEpics.length!==1?'s':''} across ${_visibleEpicProjects.length} project${_visibleEpicProjects.length!==1?'s':''}`;

  const grid=document.getElementById('epics-grid');
  if(!epics.length){
    grid.innerHTML=`<div class="col-span-3 empty-state py-16">
      <div class="empty-state-icon" style="background:#ede9fe"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14l3 3 3-3m0-3v6"/></svg></div>
      <div class="font-semibold text-slate-700 mb-1">No epics yet</div>
      <div class="text-sm text-slate-400 mb-4">Group your tasks into large initiatives</div>
      <button class="btn btn-primary" onclick="openCreateEpicModal()">Create First Epic</button>
    </div>`;
    return;
  }

  grid.innerHTML=epics.map(e=>{
    const proj=getProject(e.projectId);
    const owner=getUser(e.ownerId);
    const prog=getEpicProgress(e.id);
    const pts=getEpicStoryPoints(e.id);
    const today=new Date();today.setHours(0,0,0,0);
    const isDelayed=e.dueDate&&new Date(e.dueDate)<today&&e.status!=='Completed';
    return `<div class="epic-card">
      <div class="epic-color-strip" style="background:${e.color}"></div>
      <div class="flex items-start justify-between mt-2 mb-3">
        <div class="flex-1 min-w-0 pr-2">
          <div class="flex items-center gap-2 flex-wrap mb-1">
            <span class="epic-badge badge-epic-${epicStatusBadgeClass(e.status)}">${e.status}</span>
            ${isDelayed?`<span class="epic-badge" style="background:#fee2e2;color:#dc2626">⚠ Delayed</span>`:''}
          </div>
          <div class="font-bold text-slate-900 text-base leading-tight cursor-pointer hover:text-indigo-600" onclick="openEpicDetailModal('${e.id}')">${_escHtml(e.title)}</div>
          ${e.description?`<div class="text-xs text-slate-500 mt-1 leading-relaxed line-clamp-2">${_escHtml(e.description)}</div>`:''}
        </div>
        <div class="flex gap-1 flex-shrink-0">
          ${RBAC.isAdmin()||RBAC.isProgramManager()||RBAC.isSeniorManager()?`<button onclick="openEditEpicModal('${e.id}')" class="text-slate-400 hover:text-indigo-500 p-1 rounded transition-colors" title="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`:''}
          ${RBAC.isAdmin()?`<button onclick="deleteEpic('${e.id}')" class="text-slate-400 hover:text-red-500 p-1 rounded transition-colors" title="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg></button>`:''}
        </div>
      </div>
      <div class="grid grid-cols-3 gap-2 mb-4 text-center">
        <div class="bg-slate-50 rounded-lg py-2">
          <div class="text-base font-bold text-slate-900">${prog.total}</div>
          <div class="text-xs text-slate-500">Tasks</div>
        </div>
        <div class="bg-slate-50 rounded-lg py-2">
          <div class="text-base font-bold text-slate-900">${prog.subtaskTotal}</div>
          <div class="text-xs text-slate-500">Subtasks</div>
        </div>
        <div class="bg-slate-50 rounded-lg py-2">
          <div class="text-base font-bold" style="color:${e.color}">${prog.pct}%</div>
          <div class="text-xs text-slate-500">Done</div>
        </div>
      </div>
      <div class="mb-3">
        <div class="flex justify-between text-xs text-slate-500 mb-1">
          <span>Progress · ${prog.combinedDone}/${prog.combinedTotal} items</span>
          <span>${pts.total} pts total</span>
        </div>
        <div class="progress-bar" style="height:7px">
          <div class="progress-fill" style="width:${prog.pct}%;background:${e.color}"></div>
        </div>
      </div>
      <div class="flex items-center justify-between text-xs text-slate-500 mt-3 pt-3 border-t border-slate-100">
        <div class="flex items-center gap-2">
          ${owner?`${userAvatar(owner.id,20)}<span class="text-slate-600">${_escHtml(owner.name)}</span>`:'<span class="text-slate-400">No owner</span>'}
          ${proj?`<span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:50%;background:${proj.color}"></span>${_escHtml(proj.name)}</span>`:''}
        </div>
        ${e.dueDate?`<span class="${isDelayed?'text-red-500 font-semibold':''}">${formatDate(e.dueDate)}</span>`:''}
      </div>
    </div>`;
  }).join('');
}

function openCreateEpicModal(){
  if(RBAC.isMember()||RBAC.isViewer()){ showNotif('⚠ Only admins, senior managers, and program managers can create epics','error'); return; }
  const epicProjects=RBAC.getVisibleProjects().filter(p=>(p.status||'').toLowerCase()==='active');
  openModal(`
    <div class="p-6">
      <div class="flex items-center justify-between mb-5">
        <h2 class="text-lg font-bold text-slate-900">Create New Epic</h2>
        <button onclick="closeModal()" style="color:var(--text-muted);cursor:pointer;transition:color 0.14s" onmouseenter="this.style.color='var(--text-primary)'" onmouseleave="this.style.color='var(--text-muted)'"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
      <div class="space-y-4">
        <div>
          <label>Epic Title *</label>
          <input type="text" id="ce-title" placeholder="e.g. User Authentication" autofocus/>
        </div>
        <div>
          <label>Description</label>
          <textarea id="ce-desc" rows="2" placeholder="What does this epic deliver?"></textarea>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label>Projects</label>
            <div id="ce-projects-list" style="display:flex;flex-wrap:wrap;gap:6px;padding:4px 0">
              ${epicProjects.map(p=>`<button type="button" data-proj-id="${p.id}" data-selected="false"
                onclick="(function(btn){btn.dataset.selected=btn.dataset.selected==='true'?'false':'true';btn.style.background=btn.dataset.selected==='true'?'#eef2ff':'';btn.style.borderColor=btn.dataset.selected==='true'?'#6366f1':'var(--control-border)';btn.style.color=btn.dataset.selected==='true'?'#4338ca':'var(--text-secondary)';btn.style.fontWeight=btn.dataset.selected==='true'?'600':'400';})(this)"
                style="display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border-radius:20px;border:1.5px solid var(--control-border);background:'';cursor:pointer;font-size:12px;color:var(--text-secondary);font-weight:400;transition:all 0.15s;white-space:nowrap">
                <span style="width:8px;height:8px;border-radius:50%;background:${p.color};display:inline-block;flex-shrink:0"></span>${_escHtml(p.name)}
              </button>`).join('')}
            </div>
          </div>
          <div>
            <label>Owner</label>
            <select id="ce-owner">
              <option value="">No Owner</option>
              ${state.users.map(u=>`<option value="${u.id}">${u.name}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label>Priority</label>
            <select id="ce-priority">
              <option value="medium" selected>Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div>
            <label>Status</label>
            <select id="ce-status">
              <option value="Planned" selected>Planned</option>
              <option value="Active">Active</option>
              <option value="Completed">Completed</option>
              <option value="On Hold">On Hold</option>
            </select>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label>Due Date</label>
            <input type="date" id="ce-due"/>
          </div>
          <div>
            <label>Color</label>
            <input type="color" id="ce-color" value="${randomColor()}" style="height:38px;padding:2px 4px;cursor:pointer"/>
          </div>
        </div>
      </div>
      <div class="flex justify-end gap-3 mt-6 pt-4" style="border-top:1px solid rgba(0,0,0,0.05)">
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="createEpic()">Create Epic</button>
      </div>
    </div>
  `);
}

function createEpic(){
  if(RBAC.isMember()||RBAC.isViewer()){ showNotif('⚠ Only admins, senior managers, and program managers can create epics','error'); return; }
  const title=document.getElementById('ce-title').value.trim();
  if(!title){showNotif('⚠ Epic title required','error');return;}
  const checkedBoxes=[...document.querySelectorAll('#ce-projects-list button[data-proj-id][data-selected="true"]')];
  const projectIds=checkedBoxes.map(btn=>btn.dataset.projId);
  if(!projectIds.length){showNotif('⚠ Select at least one project','error');return;}
  if(!state.epics)state.epics=[];
  const now=_now();
  const epic={
    id:epid(),
    title,
    description:document.getElementById('ce-desc').value.trim(),
    projectId:projectIds[0],  // backward compat: keep primary projectId
    projectIds,
    ownerId:document.getElementById('ce-owner').value||null,
    priority:document.getElementById('ce-priority').value,
    status:document.getElementById('ce-status').value,
    dueDate:document.getElementById('ce-due').value||null,
    color:document.getElementById('ce-color').value,
    createdAt:now,
    updatedAt:now
  };
  state.epics.push(epic);
  invalidateStateMaps();
  _invalidateSearchCache();
  // ── Firebase: persist new epic; queue if unavailable ──
  SyncState.markPending(epic.id);
  if(FirebaseDB.isReady()){
    FirebaseDB.saveEntity('epics', epic).then(ok=>{
      if(ok){ SyncState.markSynced(epic.id); }
      else   { SyncState.markFailed(epic.id); PendingSyncQueue.saveEntity('epics', epic); }
    }).catch(()=>{ SyncState.markFailed(epic.id); PendingSyncQueue.saveEntity('epics', epic); });
  } else {
    PendingSyncQueue.saveEntity('epics', epic);
  }
  SaveManager.save();
  closeModal();
  // ── Notification: epic created ──
  console.log('[NotificationTriggers] epic trigger fired — createEpic', epic.id);
  try{ NotificationTriggers._onEpicSaved(epic, { isNew: true, prevStatus: null }); }
  catch(e){ console.error('Notification pipeline error', e); }
  renderEpics();
  showNotif(`Epic "${title}" created ✓`);
}

function openEditEpicModal(epicId){
  const e=getEpic(epicId);
  if(!e)return;
  // ── Epic lock: if fully locked, show read-only notice and disable fields ──
  const _epicFullyLocked=isEpicLocked(e);
  const _epicLockedAttr=_epicFullyLocked?'disabled readonly style="opacity:0.6;pointer-events:none;cursor:not-allowed"':'';
  const _epicSelLocked=_epicFullyLocked?'disabled':'';
  const _epicProjBtnStyle=_epicFullyLocked?'pointer-events:none;opacity:0.6;cursor:not-allowed':'cursor:pointer';
  const epicProjects=RBAC.getVisibleProjects().filter(p=>(p.status||'').toLowerCase()==='active');
  openModal(`
    <div class="p-6">
      <div class="flex items-center justify-between mb-5">
        <h2 class="text-lg font-bold text-slate-900">Edit Epic${_epicFullyLocked?" <span style=\"font-size:11px;font-weight:500;color:#dc2626;background:#fef2f2;border:1px solid #fecaca;padding:2px 7px;border-radius:4px;vertical-align:middle\">Locked</span>":""}</h2>
        <button onclick="closeModal()" style="color:var(--text-muted);cursor:pointer;transition:color 0.14s" onmouseenter="this.style.color='var(--text-primary)'" onmouseleave="this.style.color='var(--text-muted)'"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
      <div class="space-y-4">
        <div>
          <label>Epic Title *</label>
          <input type="text" id="ee-title" value="${_escHtml(e.title)}" ${_epicLockedAttr}/>
        </div>
        <div>
          <label>Description</label>
          <textarea id="ee-desc" rows="2" ${_epicLockedAttr}>${_escHtml(e.description||'')}</textarea>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label>Projects</label>
            <div id="ee-projects-list" style="display:flex;flex-wrap:wrap;gap:6px;padding:4px 0${_epicFullyLocked?';opacity:0.6;pointer-events:none':''}">
              ${(()=>{
                const _epicSelIds=e.projectIds||(e.projectId?[e.projectId]:[]);
                return epicProjects.map(p=>{
                  const sel=_epicSelIds.includes(p.id);
                  return `<button type="button" data-proj-id="${p.id}" data-selected="${sel}"
                    onclick="(function(btn){if(btn.disabled)return;btn.dataset.selected=btn.dataset.selected==='true'?'false':'true';btn.style.background=btn.dataset.selected==='true'?'#eef2ff':'';btn.style.borderColor=btn.dataset.selected==='true'?'#6366f1':'var(--control-border)';btn.style.color=btn.dataset.selected==='true'?'#4338ca':'var(--text-secondary)';btn.style.fontWeight=btn.dataset.selected==='true'?'600':'400';})(this)"
                    ${_epicFullyLocked?'disabled':''}
                    style="display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border-radius:20px;border:1.5px solid ${sel?'#6366f1':'var(--control-border)'};background:${sel?'#eef2ff':''};${_epicProjBtnStyle};font-size:12px;color:${sel?'#4338ca':'var(--text-secondary)'};font-weight:${sel?'600':'400'};transition:all 0.15s;white-space:nowrap">
                    <span style="width:8px;height:8px;border-radius:50%;background:${p.color};display:inline-block;flex-shrink:0"></span>${_escHtml(p.name)}
                  </button>`;
                }).join('');
              })()}
            </div>
          </div>
          <div>
            <label>Owner</label>
            <select id="ee-owner" ${_epicSelLocked}>
              <option value="" ${!e.ownerId?'selected':''}>No Owner</option>
              ${state.users.map(u=>`<option value="${u.id}"${u.id===e.ownerId?' selected':''}>${u.name}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label>Priority</label>
            <select id="ee-priority" ${_epicSelLocked}>
              <option value="critical"${e.priority==='critical'?' selected':''}>Critical</option>
              <option value="high"${e.priority==='high'?' selected':''}>High</option>
              <option value="medium"${e.priority==='medium'?' selected':''}>Medium</option>
              <option value="low"${e.priority==='low'?' selected':''}>Low</option>
            </select>
          </div>
          <div>
            <label>Status</label>
            <select id="ee-status" ${isEpicLocked(e)?'disabled title="Epic is locked — completed and past end date"':''}>
              ${(()=>{
                const _ec=e.status;
                const _allEpic=[
                  {v:'Planned',  l:'Planned'},
                  {v:'Active',   l:'Active'},
                  {v:'Completed',l:'Completed'}
                ];
                // Forward-only: only show current status and statuses ahead of it
                const _epicOrd=EPIC_STATUS_ORDER;
                const _curOrd=_epicOrd[_ec]??0;
                return _allEpic
                  .filter(x=>(_epicOrd[x.v]??0)>=_curOrd)
                  .map(x=>`<option value="${x.v}"${_ec===x.v?' selected':''}>${x.l}</option>`)
                  .join('');
              })()}
            </select>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label>Due Date</label>
            <input type="date" id="ee-due" value="${e.dueDate||''}" ${_epicLockedAttr}/>
          </div>
          <div>
            <label>Color</label>
            <input type="color" id="ee-color" value="${e.color}" style="height:38px;padding:2px 4px;cursor:pointer" ${_epicSelLocked}/>
          </div>
        </div>
      </div>
      <div class="flex justify-end gap-3 mt-6 pt-4" style="border-top:1px solid rgba(0,0,0,0.05)">
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        ${_epicFullyLocked?'':`<button class="btn btn-primary" onclick="saveEpic('${e.id}')">Save Changes</button>`}
      </div>
    </div>
  `);
}

function saveEpic(epicId){
  const e=getEpic(epicId);
  if(!e)return;
  const title=document.getElementById('ee-title').value.trim();
  if(!title){showNotif('⚠ Title required','error');return;}
  const checkedBoxes=[...document.querySelectorAll('#ee-projects-list button[data-proj-id][data-selected="true"]')];
  const projectIds=checkedBoxes.map(btn=>btn.dataset.projId);
  if(!projectIds.length){showNotif('⚠ Select at least one project','error');return;}
  // ── Epic lock check: fully locked epics cannot be saved ──
  if(isEpicLocked(e)){
    showNotif('⚠ This epic is locked and cannot be edited.','error');
    return;
  }
  // ── Epic state transition guard ──
  const _eeNewStatus=document.getElementById('ee-status').value;
  const _eeStateCheck=canChangeEpicStatus(e,_eeNewStatus);
  if(!_eeStateCheck.ok){
    showNotif('⚠ '+_eeStateCheck.msg,'error');
    document.getElementById('ee-status').value=e.status; // reset select
    return;
  }
  // ── Incomplete-task guard: block Completed if any mapped task is not done ──
  if(_eeNewStatus==='Completed'){
    const _epicTasks=getEpicTasks(e.id);
    const _incomplete=_epicTasks.filter(t=>!DONE_STATUSES.includes(t.status));
    if(_incomplete.length){
      showNotif('⚠ Cannot complete epic — '+_incomplete.length+' task'+(_incomplete.length>1?'s':'')+' still incomplete','error');
      document.getElementById('ee-status').value=e.status;
      return;
    }
  }
  e.title=title;
  e.description=document.getElementById('ee-desc').value.trim();
  e.projectIds=projectIds;
  e.projectId=projectIds[0];  // backward compat: keep primary projectId in sync
  e.ownerId=document.getElementById('ee-owner').value||null;
  e.priority=document.getElementById('ee-priority').value;
  _drStampCompletionDate(e, e.status, _eeNewStatus, s=>s==='Completed');
  e.status=_eeNewStatus;
  e.dueDate=document.getElementById('ee-due').value||null;
  e.color=document.getElementById('ee-color').value;
  e.updatedAt=_now();
  // ── Firebase: persist updated epic; queue if unavailable ──
  SyncState.markPending(e.id);
  if(FirebaseDB.isReady()){
    FirebaseDB.saveEntity('epics', e).then(ok=>{
      if(ok){ SyncState.markSynced(e.id); }
      else   { SyncState.markFailed(e.id); PendingSyncQueue.saveEntity('epics', e); }
    }).catch(()=>{ SyncState.markFailed(e.id); PendingSyncQueue.saveEntity('epics', e); });
  } else {
    PendingSyncQueue.saveEntity('epics', e);
  }
  SaveManager.save();
  closeModal();
  // ── Notification: epic updated / completed ──
  console.log('[NotificationTriggers] epic trigger fired — saveEpic', e.id);
  try{ NotificationTriggers._onEpicSaved(e, { isNew: false, prevStatus: undefined }); }
  catch(e2){ console.error('Notification pipeline error', e2); }
  renderEpics();
  showNotif('Epic updated ✓');
}

function deleteEpic(epicId){
  if(!RBAC.isAdmin()){ showNotif('⚠ Only admins can delete epics','error'); return; }
  if(!confirm('Delete this epic? Tasks linked to it will be unassigned.'))return;
  // ── Referential integrity: strip epicId from all linked tasks (no hard delete) ──
  cleanupEpicReferences(epicId);
  state.epics=(state.epics||[]).filter(e=>e.id!==epicId);
  invalidateStateMaps();
  _invalidateSearchCache();
  // ── Firebase: delete epic; queue if unavailable ──
  if(FirebaseDB.isReady()){
    FirebaseDB.deleteEntity('epics', epicId).catch(e=>console.warn('[deleteEpic] Firebase error:',e));
  } else {
    PendingSyncQueue.deleteEntity('epics', epicId);
  }
  SaveManager.save();
  renderEpics();
  showNotif('Epic deleted');
}

function openEpicDetailModal(epicId){
  const e=getEpic(epicId);
  if(!e)return;
  const proj=getProject(e.projectId);
  const owner=getUser(e.ownerId);
  const prog=getEpicProgress(e.id);
  const pts=getEpicStoryPoints(e.id);
  const tasks=getEpicTasks(e.id);
  const today=new Date();today.setHours(0,0,0,0);
  const isDelayed=e.dueDate&&new Date(e.dueDate)<today&&e.status!=='Completed';
  openModal(`
    <div class="p-6">
      <div class="flex items-center justify-between mb-1">
        <div class="flex items-center gap-2">
          <div style="width:14px;height:14px;border-radius:50%;background:${e.color}"></div>
          <span class="epic-badge badge-epic-${epicStatusBadgeClass(e.status)}">${e.status}</span>
          ${isDelayed?`<span class="epic-badge" style="background:#fee2e2;color:#dc2626">⚠ Delayed</span>`:''}
        </div>
        <button onclick="closeModal()" style="color:var(--text-muted);cursor:pointer;transition:color 0.14s" onmouseenter="this.style.color='var(--text-primary)'" onmouseleave="this.style.color='var(--text-muted)'"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
      <h2 class="text-xl font-bold text-slate-900 mb-1">${_escHtml(e.title)}</h2>
      ${e.description?`<p class="text-sm text-slate-600 mb-4 leading-relaxed bg-slate-50 rounded-lg p-3">${_escHtml(e.description)}</p>`:''}
      <div class="grid grid-cols-3 gap-3 mb-4 text-center">
        <div class="bg-slate-50 rounded-lg py-3">
          <div class="text-xl font-bold text-slate-900">${prog.total}</div>
          <div class="text-xs text-slate-500">Tasks</div>
        </div>
        <div class="bg-slate-50 rounded-lg py-3">
          <div class="text-xl font-bold text-slate-900">${prog.subtaskTotal}</div>
          <div class="text-xs text-slate-500">Subtasks</div>
        </div>
        <div class="bg-slate-50 rounded-lg py-3">
          <div class="text-xl font-bold" style="color:${e.color}">${prog.pct}%</div>
          <div class="text-xs text-slate-500">Complete</div>
        </div>
      </div>
      <div class="mb-5">
        <div class="flex justify-between text-xs text-slate-500 mb-1">
          <span>${prog.combinedDone}/${prog.combinedTotal} items done · ${pts.done}/${pts.total} pts</span>
          <span>${prog.pct}%</span>
        </div>
        <div class="progress-bar" style="height:8px"><div class="progress-fill" style="width:${prog.pct}%;background:${e.color}"></div></div>
      </div>
      <div class="grid grid-cols-2 gap-4 mb-5 text-sm">
        <div><label>Project</label>
          <div class="flex items-center gap-2 mt-1">${proj?`<span style="width:10px;height:10px;border-radius:50%;background:${proj.color};display:inline-block"></span><span>${_escHtml(proj.name)}</span>`:'—'}</div>
        </div>
        <div><label>Owner</label>
          <div class="flex items-center gap-2 mt-1">${owner?`${userAvatar(owner.id,24)}<span>${_escHtml(owner.name)}</span>`:'<span class="text-slate-400">No owner</span>'}</div>
        </div>
        <div><label>Priority</label><div class="mt-1 font-medium">${e.priority}</div></div>
        <div><label>Due Date</label><div class="mt-1 ${isDelayed?'text-red-600 font-semibold':''}">${e.dueDate?formatDate(e.dueDate):'—'}</div></div>
      </div>
      ${tasks.length?`<div>
        <div class="font-semibold text-slate-800 text-sm mb-2">Tasks in this Epic</div>
        <div class="space-y-1 max-h-48 overflow-y-auto scroll-thin">${tasks.map(t=>taskRow(t,true)).join('')}</div>
      </div>`:'<div class="text-center text-slate-400 text-sm py-4">No tasks linked to this epic yet.</div>'}
      <div class="flex justify-end gap-3 mt-5 pt-4 border-t border-slate-100">
        ${RBAC.isAdmin()||RBAC.isProgramManager()||RBAC.isSeniorManager()?`<button class="btn btn-secondary" onclick="openEditEpicModal('${e.id}')">Edit</button>`:''}
        ${RBAC.isAdmin()?`<button class="btn btn-danger" onclick="deleteEpic('${e.id}')">Delete</button>`:''}
      </div>
    </div>
  `);
}

