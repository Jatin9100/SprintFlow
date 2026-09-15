function toggleBacklogSubtasks(taskId){
  const el=document.getElementById('bsubs-'+taskId);
  const icon=document.getElementById('btoggle-icon-'+taskId);
  if(!el)return;
  const isOpen=el.style.maxHeight!=='0px'&&el.style.maxHeight!=='';
  el.style.maxHeight=isOpen?'0':'600px';
  if(icon)icon.style.transform=isOpen?'':'rotate(90deg)';
}

function removeTaskFromSprint(taskId){
  const task=getTask(taskId);
  if(task){
    // ISSUE 2: Block removal if task's sprint is completed — only once the
    // task itself is Released; spillover items (any other status) sitting in
    // a completed sprint should still be movable back to the backlog.
    const sourceSprint=task.sprint?getSprint(task.sprint):null;
    if(sourceSprint&&sourceSprint.status==='completed'&&task.status==='released'){
      showNotif('Tasks from completed sprints are locked','error');
      return;
    }
    task.sprint=null;
    // ── Firebase: persist task removed from sprint ──
    FirebaseDB.saveEntity('tasks', task).catch(e=>console.warn('[removeTaskFromSprint] Firebase error:',e));
    SaveManager.save();
    renderSprintPlanning();
    showNotif('Task moved to backlog');
  }
}

function openTaskModal(taskId){
  const t=getTask(taskId);
  if(!t){showNotif('⚠ Task not found','error');return;}
  const proj=getProject(t.project);
  const sprint=t.sprint?getSprint(t.sprint):null;
  const sp=subtaskProgress(taskId);
  const subs=t.subtasks||[];

  const subtaskSection=`
    <div class="mt-5 pt-5 border-t border-slate-100">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <span class="font-semibold text-slate-800 text-sm">Subtasks</span>
          ${sp.total?`<span class="bg-indigo-50 text-indigo-700 text-xs font-semibold px-2 py-0.5 rounded-full">${sp.done}/${sp.total}</span>`:''}
        </div>
        <button class="btn btn-secondary text-xs" onclick="openCreateSubtaskModal('${taskId}')" ${RBAC.canCreateSubtask(t)?'':'style="display:none"'}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Subtask
        </button>
      </div>
      ${sp.total?`<div class="mb-3">
        <div class="flex justify-between text-xs text-slate-500 mb-1"><span>Progress</span><span class="font-semibold text-indigo-600">${sp.pct}%</span></div>
        <div class="subtask-progress-bar" style="height:6px"><div class="subtask-progress-fill" style="width:${sp.pct}%;background:${sp.pct===100?'#10b981':'#6366f1'}"></div></div>
      </div>`:''}
      <div class="space-y-2">
        ${subs.length?subs.map(s=>{
          const sa=getUser(s.assignee);
          const isDone=DONE_STATUSES.includes(s.status);
          return `<div class="subtask-mini-card flex items-center gap-2" onclick="openSubtaskModal('${taskId}','${s.id}')">
            <div class="subtask-status-dot" style="background:${subtaskStatusDot(s.status)}"></div>
            <span class="flex-1 text-xs font-medium text-slate-700 truncate ${isDone?'line-through opacity-60':''}">${_escHtml(s.title)}</span>
            <span class="badge badge-${statusBadgeClass(s.status)}" style="font-size:9px;padding:1px 6px">${statusLabel(s.status)}</span>
            <span class="text-xs text-slate-400 font-semibold">${s.points||0}sp</span>
            ${sa?userAvatar(s.assignee,18):''}
            <button class="text-slate-300 hover:text-red-400 transition-colors ml-1" onclick="event.stopPropagation();deleteSubtask('${taskId}','${s.id}')" title="Delete" ${!RBAC.isViewer()&&(RBAC.isAdmin()||RBAC.canDeleteAnyTask()||(state.currentUser&&state.currentUser.id===s.assignee))?'':'style="display:none"'}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>`;
        }).join(''):`<div class="text-center py-5 text-slate-400 text-xs border-2 border-dashed border-slate-200 rounded-lg">No subtasks yet — click <strong>Add Subtask</strong> to break this task down</div>`}
      </div>
    </div>`;

  openModal(`
    <div class="p-6">
      <div class="flex items-start justify-between mb-4">
        <div class="flex items-center gap-2">
          <span style="color:${typeColor(t.type)};font-size:16px">${typeIcon(t.type)}</span>
          <span class="text-xs text-slate-400 font-mono">${proj?proj.key:'?'}-${String(t.id||'').slice(-3).toUpperCase()}</span>
        </div>
        <div class="flex items-center">
          ${_modalFullscreenBtnHtml()}
          <button onclick="closeModal()" class="text-slate-400 hover:text-slate-700 transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
      <div class="flex items-start justify-between gap-3 mb-3">
        <h2 class="text-xl font-bold text-slate-900">${_escHtml(t.title)}</h2>
        <select onchange="updateTaskStatus('${t.id}',this.value)" class="text-sm" style="width:auto;flex-shrink:0"
          ${(()=>{
            if(!RBAC.canEditStatus(t)) return 'disabled title="You can only update status for tasks assigned to you"';
            if(t.status!=='released' && isTaskLocked(t)) return 'disabled title="This task is frozen and cannot change status"';
            return '';
          })()}>
          ${(()=>{
            if(t.status==='released'){
              return '<option value="released" selected>Released</option><option value="rollback">Rollback</option>';
            }
            if(t.status==='ready-for-prod'){
              return '<option value="ready-for-prod" selected>Ready for Prod</option>';
            }
            return Object.entries(STATUS_META).filter(([v])=>v!=='rollback').map(([v,m])=>`<option value="${v}" ${t.status===v?'selected':''}>${m.label}</option>`).join('');
          })()}
        </select>
      </div>
      <div class="flex flex-wrap gap-2 mb-4">
        <span class="badge badge-${t.type}">${t.type}</span>
        <span class="badge badge-${t.priority}">${t.priority}</span>
        <span class="badge badge-${statusBadgeClass(t.status)}">${statusLabel(t.status)}</span>
        <span class="bg-indigo-50 text-indigo-700 badge">${t.points} story pts</span>
        ${sp.total?`<span class="bg-violet-50 text-violet-700 badge">${sp.done}/${sp.total} subtasks · ${sp.pct}%</span>`:''}
      </div>
      <div class="text-sm text-slate-600 leading-relaxed mb-5 bg-slate-50 rounded-lg p-3 desc-editor" id="task-modal-desc-view" style="min-height:unset;cursor:default;pointer-events:none;border:none;background:var(--control-bg)">${t.descriptionPreview?`<span style="color:var(--text-muted);font-style:italic">Loading description…</span>`:'<span style="color:var(--text-muted)">No description provided.</span>'}</div>
      <div class="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label>Project</label>
          <div class="flex items-center gap-2 mt-1">
            ${proj?`<div style="width:12px;height:12px;border-radius:3px;background:${proj.color}"></div><span class="text-sm text-slate-700">${_escHtml(proj.name)}</span>`:'—'}
          </div>
        </div>
        <div>
          <label>Sprint</label>
          <div class="text-sm text-slate-700 mt-1">${sprint?_escHtml(sprint.name):'Not assigned'}</div>
        </div>
        <div>
          <label>Assignee</label>
          <select onchange="updateTaskAssignee('${t.id}',this.value)" class="text-sm mt-1" style="width:100%"
            ${(()=>{
              const canEditAssignee = RBAC.isAdmin()||RBAC.isProgramManager()||RBAC.isSeniorManager();
              if(!canEditAssignee) return 'disabled title="Only Program Managers and above can change the assignee"';
              if(t.status==='released') return 'disabled title="Released tasks are read-only"';
              return '';
            })()}>
            ${_assigneeOptionsForProject(t.project, t.assignee||'')}
          </select>
        </div>
        ${(()=>{
          const qaStatuses=['in-qa','qa-in-progress'];
          // Show QA Assignee row if status is QA stage OR if a QA assignee is already set
          if(!qaStatuses.includes(t.status)&&!t.qaAssigneeId) return '';
          const canEditQa = RBAC.canEditQaAssignee(t);
          return `<div>
            <label style="display:flex;align-items:center;gap:5px">QA Assignee <span style="font-size:9.5px;font-weight:600;background:rgba(245,158,11,0.12);color:#a8600a;border:1px solid rgba(245,158,11,0.25);padding:1px 5px;border-radius:4px;letter-spacing:.02em">QA</span></label>
            <select onchange="updateTaskQaAssignee('${t.id}',this.value)" class="text-sm mt-1" style="width:100%"
              ${canEditQa && t.status!=='released' ? '' : 'disabled title="You do not have permission to change the QA Assignee"'}>
              ${_qaAssigneeOptionsForProject(t.project, t.qaAssigneeId||'')}
            </select>
          </div>`;
        })()}
        ${(()=>{
          const _epic=t.epicId?(state.epics||[]).find(e=>e.id===t.epicId):null;
          return `<div>
            <label>Epic</label>
            <div class="flex flex-wrap gap-1 mt-1">${_epic
              ? `<span class="epic-badge" style="background:${_epic.color}22;color:${_epic.color};border:1px solid ${_epic.color}55" title="${_esc(_epic.title)}">◈ ${_esc(_epic.title)}</span>`
              : '<span class="text-sm text-slate-400">—</span>'
            }</div>
          </div>`;
        })()}
        <div>
          <label>Tags</label>
          <div class="flex flex-wrap gap-1 mt-1">${(t.tags||[]).map(tag=>_coloredChip(tag,_tagColorByName(tag),'tag')).join('')||'—'}</div>
        </div>
        <div>
          <label>Products</label>
          <div class="flex flex-wrap gap-1 mt-1">${(t.products||[]).map(name=>{ const c=_productColorByName(name); return c ? _coloredChip(name,c,'tag') : `<span class="tag" style="background:var(--accent-ghost);color:var(--accent-dark);border:1px solid var(--accent-ring)">${name}</span>`; }).join('')||'—'}</div>
        </div>
        <div>
          <label>Theme</label>
          <div class="flex flex-wrap gap-1 mt-1">${t.themeName ? _coloredChip(t.themeName, t.themeColor||'var(--accent)', 'tag') : '—'}</div>
        </div>
        <div>
          <label>Created By <span style="color:var(--text-muted);font-weight:400">(read-only)</span></label>
          <div class="text-sm text-slate-700 mt-1">${_createdByLabel(t.createdBy)}</div>
        </div>
        <div>
          <label>Created Date <span style="color:var(--text-muted);font-weight:400">(read-only)</span></label>
          <div class="text-sm text-slate-700 mt-1">${formatDateTime(t.createdDate)}</div>
        </div>
      </div>
      ${subtaskSection}
      <!-- COMMENTS SECTION — below subtasks -->
      ${_cmSectionHtml(taskId, '')}
      <div class="flex justify-end items-center pt-4 mt-4 border-t border-slate-100 flex-wrap gap-2">
        <div class="flex gap-2">
          <button class="btn btn-secondary" onclick="event.stopPropagation();shareTaskLink('${t.id}')" title="Copy shareable link" style="padding:0 9px"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:block"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></button>
          ${RBAC.canEditTask(t)?`<button class="btn btn-secondary" onclick="closeModal();setTimeout(()=>openEditTaskModal('${t.id}'),220)">Edit</button>`:''}
          ${RBAC.canDeleteAnyTask()?`<button class="btn btn-danger" onclick="deleteTask('${t.id}')">Delete</button>`:''}
        </div>
      </div>
    </div>
  `);
  // Load description on-demand (cache-first, then Firebase); replaces placeholder in place
  _descHydrate(taskId, '');
  // Load comments on-demand (cache-first, then Firebase); replaces placeholder in place
  _cmHydrate(taskId, '');
}

function updateTaskStatus(taskId,status){
  const task=getTask(taskId);
  if(!task){showNotif('⚠ Task not found','error');return;}
  // ── Notification: snapshot pre-mutation status ──
  const _ntPrevStatus = task.status || null;
  // ── RBAC: members can only update status on their own tasks (as Assignee or QA Assignee) ──
  if(!RBAC.canEditStatus(task)){
    showNotif('⚠ You can only update status for tasks assigned to you','error');
    try{const sel=document.querySelector(`select[onchange*="updateTaskStatus"][onchange*="${taskId}"]`)||document.querySelector(`select[onchange*="${taskId}"]`);if(sel)sel.value=task.status;}catch(e){}
    return;
  }
  // ── Task state transition guard ──
  const stateCheck=canChangeTaskStatus(task,status);
  if(!stateCheck.ok){
    showNotif('⚠ '+stateCheck.msg,'error');
    try{const sel=document.querySelector(`select[onchange*="updateTaskStatus"][onchange*="${taskId}"]`)||document.querySelector(`select[onchange*="${taskId}"]`);if(sel)sel.value=task.status;}catch(e){}
    return;
  }
  // ── Resolve rollback → in-qa; all other statuses pass through unchanged ──
  const resolvedStatus=resolveRollbackStatus(status);
  const check=canMoveToClosedStatus(taskId,resolvedStatus);
  if(!check.ok){
    showNotif('⚠ '+check.msg,'error');
    try{const sel=document.querySelector(`select[onchange*="updateTaskStatus"][onchange*="${taskId}"]`)||document.querySelector(`select[onchange*="${taskId}"]`);if(sel)sel.value=task.status;}catch(e){}
    return;
  }
  _trackQAReopen(task, resolvedStatus);
  task.status=resolvedStatus;
  _drStampCompletionDate(task, _ntPrevStatus, resolvedStatus, s=>DONE_STATUSES.includes(s));
  // ── Debounced Firebase write ──
  DebounceWrite.schedule('tasks', task, 300);
  SaveManager.save();
  renderPage(currentPage);
  if(_modalOpen) openTaskModal(taskId);
  const notifMsg=status==='rollback'?'Task rolled back to In QA':`Status updated to ${statusLabel(resolvedStatus)} ✓`;
  showNotif(notifMsg,'success');
  // ── Notification triggers (standalone — no workflow impact) ──
  NotificationTriggers._onTaskStatusChanged(task, _ntPrevStatus, resolvedStatus);
}

// ── Inline quick-edit from the Task view modal — mirrors the Assignee/QA
// Assignee RBAC rules enforced in saveTask()/openEditTaskModal(), but lets
// either field be changed directly from the view modal (no need to open Edit).
function updateTaskAssignee(taskId,newAssigneeId){
  const task=getTask(taskId);
  if(!task){showNotif('⚠ Task not found','error');return;}
  if(!(RBAC.isAdmin()||RBAC.isProgramManager()||RBAC.isSeniorManager())){
    showNotif('⚠ Only Program Managers and above can change the assignee','error');
    return;
  }
  if(task.status==='released'){
    showNotif('⚠ Released tasks are read-only','error');
    return;
  }
  const _ntPrevAssignee=task.assignee||null;
  const _ntPrevStatus=task.status||null;
  task.assignee=RBAC.memberSelfOnlyId()||newAssigneeId||null;
  SyncState.markPending(task.id);
  DebounceWrite.schedule('tasks', task, 300);
  SaveManager.save();
  invalidateStateMaps();
  _invalidateSearchCache();
  refreshAll();
  if(_modalOpen) openTaskModal(taskId);
  showNotif('Assignee updated ✓');
  NotificationTriggers._onTaskSaved(task, { prevAssignee:_ntPrevAssignee, prevStatus:_ntPrevStatus });
}
function updateTaskQaAssignee(taskId,newQaId){
  const task=getTask(taskId);
  if(!task){showNotif('⚠ Task not found','error');return;}
  if(!RBAC.canEditQaAssignee(task)){
    showNotif('⚠ You do not have permission to change the QA Assignee','error');
    return;
  }
  if(task.status==='released'){
    showNotif('⚠ Released tasks are read-only','error');
    return;
  }
  task.qaAssigneeId=newQaId||null;
  const qaUser=task.qaAssigneeId?getUser(task.qaAssigneeId):null;
  task.qaAssigneeName=qaUser?qaUser.name:null;
  SyncState.markPending(task.id);
  DebounceWrite.schedule('tasks', task, 300);
  SaveManager.save();
  invalidateStateMaps();
  _invalidateSearchCache();
  refreshAll();
  if(_modalOpen) openTaskModal(taskId);
  showNotif('QA Assignee updated ✓');
}

function deleteTask(taskId){
  if(!RBAC.canDeleteAnyTask()){ showNotif('⚠ You do not have permission to delete tasks','error'); return; }
  if(!confirm('Delete this task?'))return;
  state.tasks=state.tasks.filter(t=>t.id!==taskId);
  invalidateStateMaps();
  _invalidateSearchCache();
  // ── Firebase: remove task; queue if unavailable ──
  SyncState.clear(taskId);
  if(FirebaseDB.isReady()){
    FirebaseDB.deleteEntity('tasks', taskId).catch(()=>PendingSyncQueue.deleteEntity('tasks', taskId));
  } else {
    PendingSyncQueue.deleteEntity('tasks', taskId);
  }
  SaveManager.save();
  closeModal();
  renderPage(currentPage);
  showNotif('Task deleted');
}

// ─── SUBTASK CRUD ─────────────────────────────────────────────────
function openCreateSubtaskModal(parentTaskId){
  const parent=getTask(parentTaskId);
  if(!parent)return;
  // ── RBAC: only Admin/PM, the Task Assignee, or the Task QA Assignee may add Subtasks ──
  if(!RBAC.canCreateSubtask(parent)){
    showNotif('⚠ You do not have permission to add subtasks to this task','error');
    return;
  }
  const inheritedProject=getProject(parent.project);
  const inheritedSprint=parent.sprint?getSprint(parent.sprint):null;
  openModal(`
    <div class="p-6">
      <div class="flex items-center justify-between mb-5">
        <div>
          <h2 class="text-lg font-bold text-slate-900">Add Subtask</h2>
          <div class="text-xs text-slate-500 mt-0.5 truncate max-w-xs">Parent: ${_escHtml(parent.title)}</div>
        </div>
        <button onclick="openTaskModal('${parentTaskId}')" style="color:var(--text-muted);cursor:pointer;transition:color 0.14s" onmouseenter="this.style.color='var(--text-primary)'" onmouseleave="this.style.color='var(--text-muted)'"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
      <div class="space-y-4">
        <!-- Inherited fields (read-only) -->
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label>Project <span style="color:var(--text-muted);font-weight:400">(inherited)</span></label>
            <div style="height:var(--control-h);background:var(--control-bg);border:1px solid var(--control-border);border-radius:var(--control-radius);padding:0 10px;display:flex;align-items:center;font-size:13px;color:var(--text-secondary);opacity:0.8">${inheritedProject?inheritedProject.name:'—'}</div>
          </div>
          <div>
            <label>Sprint <span style="color:var(--text-muted);font-weight:400">(inherited)</span></label>
            <div style="height:var(--control-h);background:var(--control-bg);border:1px solid var(--control-border);border-radius:var(--control-radius);padding:0 10px;display:flex;align-items:center;font-size:13px;color:var(--text-secondary);opacity:0.8">${inheritedSprint?inheritedSprint.name:'Backlog'}</div>
          </div>
        </div>
        <div>
          <label>Title *</label>
          <input type="text" id="cst-title" placeholder="Subtask description..." autofocus/>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label>Type</label>
            <select id="cst-type">
              <option value="task" selected>Task</option>
              <option value="bug">Bug</option>
            </select>
          </div>
          <div>
            <label>Priority</label>
            <select id="cst-priority">
              <option value="medium" selected>Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
              <option value="low">Low</option>
            </select>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label>Status</label>
            <select id="cst-status">
              ${Object.entries(STATUS_META).filter(([v])=>v!=='rollback').map(([v,m])=>`<option value="${v}"${v==='open'?' selected':''}>${m.label}</option>`).join('')}
            </select>
          </div>
          <div>
            <label>Story Points</label>
            <select id="cst-points">
              ${[1,2,3,5,8,13].map(p=>`<option value="${p}"${p===3?' selected':''}>${p}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label>Assignee</label>
            <select id="cst-assignee">
              <option value="">Unassigned</option>
              ${(()=>{
                const selfId = RBAC.memberSelfOnlyId();
                const users = (selfId ? state.users.filter(u=>u.id===selfId) : state.users)
                  .slice().sort((a,b)=>(a.name||'').localeCompare(b.name||''));
                return users.map(u=>`<option value="${u.id}"${selfId&&u.id===selfId?' selected':''}>${u.name}</option>`).join('');
              })()}
            </select>
          </div>
          <div>
            <label>Due Date</label>
            <input type="date" id="cst-due"/>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label>Start Date</label>
            <input type="date" id="cst-startDate" onchange="cstOnStartDateChange(this.value)"/>
          </div>
          <div>
            <label>End Date</label>
            <input type="date" id="cst-endDate"/>
          </div>
        </div>
        <div class="grid grid-cols-3 gap-3 p-3 rounded-lg" style="background:var(--accent-ghost);border:1px solid var(--accent-ring)">
          <div>
            <label style="color:var(--accent-dark)">Products <span style="color:var(--text-muted);font-weight:400">(inherited)</span></label>
            <div class="flex flex-wrap gap-1 mt-1">${(parent.products||[]).map(name=>{const c=_productColorByName(name);return c?_coloredChip(name,c,'tag'):`<span class="tag" style="background:var(--accent-ghost);color:var(--accent-dark);border:1px solid var(--accent-ring)">${name}</span>`;}).join('')||'<span class="text-xs text-slate-400">—</span>'}</div>
          </div>
          <div>
            <label style="color:var(--accent-dark)">Tags <span style="color:var(--text-muted);font-weight:400">(inherited)</span></label>
            <div class="flex flex-wrap gap-1 mt-1">${(parent.tags||[]).map(tag=>_coloredChip(tag,_tagColorByName(tag),'tag')).join('')||'<span class="text-xs text-slate-400">—</span>'}</div>
          </div>
          <div>
            <label style="color:var(--accent-dark)">Theme * <span style="color:var(--text-muted);font-weight:400">(inherited)</span></label>
            <div class="flex flex-wrap gap-1 mt-1">${parent.themeName?_coloredChip(parent.themeName,parent.themeColor||'var(--accent)','tag'):'<span class="text-xs text-slate-400">—</span>'}</div>
          </div>
        </div>
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
            <label>Description</label>
            <button type="button" class="ai-writing-only" id="ai-rewrite-btn-cst" onclick="AI.rewriteText('cst-description','ai-rewrite-btn-cst')" style="display:none;background:none;border:none;cursor:pointer;color:var(--accent);font-size:11.5px;font-weight:600;padding:2px 4px" title="Improve wording with AI">✨ Improve wording</button>
          </div>
          <div id="cst-description" class="desc-editor" data-placeholder="Add more context..."></div>
        </div>
      </div>
      <div class="flex justify-end gap-3 mt-6 pt-4" style="border-top:1px solid rgba(0,0,0,0.05)">
        <button class="btn btn-secondary" onclick="openTaskModal('${parentTaskId}')">Cancel</button>
        <button class="btn btn-primary" onclick="createSubtask('${parentTaskId}')">Create Subtask</button>
      </div>
    </div>
  `);
  _initDescEditor('cst-description','','Add more context...');
}

function createSubtask(parentTaskId){
  const parent=getTask(parentTaskId);
  if(!parent)return;
  // ── RBAC: only Admin/PM, the Task Assignee, or the Task QA Assignee may add Subtasks ──
  if(!RBAC.canCreateSubtask(parent)){
    showNotif('⚠ You do not have permission to add subtasks to this task','error');
    return;
  }
  const title=document.getElementById('cst-title').value.trim();
  if(!title){showNotif('⚠ Subtask title required','error');return;}
  if(!parent.themeId){showNotif('⚠ Parent task must have a Theme before adding a subtask','error');return;}
  const startDate=document.getElementById('cst-startDate').value||null;
  const endDate=document.getElementById('cst-endDate').value||null;
  if(startDate&&endDate&&endDate<startDate){showNotif('⚠ End Date cannot be before Start Date','error');return;}
  if(!parent.subtasks)parent.subtasks=[];
  const selfId = RBAC.memberSelfOnlyId();
  const _cstDescHtml = _getDescValue('cst-description');
  const subtask={
    id:stid(),
    title,
    type:document.getElementById('cst-type').value||'task',
    status:document.getElementById('cst-status').value,
    priority:document.getElementById('cst-priority').value,
    // Project & Sprint auto-inherited from parent — Assignee is independent
    project:parent.project||null,
    sprint:parent.sprint||null,
    assignee:selfId || document.getElementById('cst-assignee').value||null,
    points:parseInt(document.getElementById('cst-points').value)||3,
    startDate,
    endDate,
    dueDate:document.getElementById('cst-due').value||null,
    // Description stored in taskDescriptions collection — no embedding here
    // ── Inherited from parent (snapshot at creation time) ──
    tags:      parent.tags      || [],
    tagIds:    parent.tagIds    || [],
    productIds:parent.productIds|| [],
    products:  parent.products  || [],
    themeId:   parent.themeId   || null,
    themeName: parent.themeName  || null,
    themeColor:parent.themeColor || null,
    comments:[],
    createdAt:Date.now(),
    qaAssigneeId:null,
    qaAssigneeName:null,
    // ── Audit trail: creation metadata (read-only) ──
    createdBy:_captureCreator(),
    createdDate:Date.now()
  };
  parent.subtasks.push(subtask);
  // ── Firebase: persist parent task with updated subtasks array ──
  FirebaseDB.saveEntity('tasks', parent).catch(e=>console.warn('[createSubtask] Firebase error:',e));
  // ── Write subtask description to taskDescriptions (non-blocking) ──
  if(_cstDescHtml){
    _descSave(parentTaskId, subtask.id, _cstDescHtml);
  }
  SaveManager.save();
  openTaskModal(parentTaskId);
  showNotif(`Subtask "${title}" added ✓`);
}

function openSubtaskModal(parentTaskId,subtaskId){
  const parent=getTask(parentTaskId);
  if(!parent)return;
  const s=(parent.subtasks||[]).find(x=>x.id===subtaskId);
  if(!s)return;
  const subProject=s.project?getProject(s.project):null;
  const subSprint=s.sprint?getSprint(s.sprint):null;
  const idProj=subProject||getProject(parent.project);
  replaceModal(`
    <div class="p-6">
      <div class="flex items-center justify-between mb-1">
        <div class="text-xs text-slate-400 font-semibold uppercase tracking-wide flex items-center gap-2">
          <span>Subtask</span>
          <span class="font-mono normal-case tracking-normal">${idProj?idProj.key:'?'}-${String(s.id||'').slice(-3).toUpperCase()}</span>
        </div>
        <div class="flex items-center">
          ${_modalFullscreenBtnHtml()}
          <button onclick="closeModal()" style="color:var(--text-muted);cursor:pointer;transition:color 0.14s" onmouseenter="this.style.color='var(--text-primary)'" onmouseleave="this.style.color='var(--text-muted)'"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
      </div>
      <div class="flex items-start justify-between gap-3 mb-4">
        <h2 class="text-lg font-bold text-slate-900">${_escHtml(s.title)}</h2>
        <select onchange="updateSubtaskStatus('${parentTaskId}','${s.id}',this.value)" class="text-sm" style="width:auto;flex-shrink:0"
          ${(()=>{
            if(!RBAC.canEditStatus(s)) return 'disabled title="You can only update status for subtasks assigned to you"';
            if(s.status!=='released' && isTaskLocked(s)) return 'disabled title="This subtask is frozen and cannot change status"';
            return '';
          })()}>
          ${(()=>{
            if(s.status==='released') return '<option value="released" selected>Released</option><option value="rollback">Rollback</option>';
            if(s.status==='ready-for-prod') return '<option value="ready-for-prod" selected>Ready for Prod</option>';
            return Object.entries(STATUS_META).filter(([v])=>v!=='rollback').map(([v,m])=>`<option value="${v}" ${s.status===v?'selected':''}>${m.label}</option>`).join('');
          })()}
        </select>
      </div>
      <div class="flex flex-wrap gap-2 mb-4">
        ${s.type?`<span class="badge badge-${s.type}">${s.type.charAt(0).toUpperCase()+s.type.slice(1)}</span>`:''}
        <span class="badge badge-${s.priority}">${s.priority}</span>
        <span class="badge badge-${statusBadgeClass(s.status)}">${statusLabel(s.status)}</span>
        <span class="bg-indigo-50 text-indigo-700 badge">${s.points||0} pts</span>
      </div>
      <div class="bg-slate-50 rounded-lg p-3 mb-4 text-xs text-slate-600 flex items-center gap-2">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 20H5a2 2 0 01-2-2V6a2 2 0 012-2h4m4-2h4a2 2 0 012 2v12a2 2 0 01-2 2h-4M9 12h6"/></svg>
        Parent: <span class="font-semibold text-slate-700">${_escHtml(parent.title)}</span>
        <button class="ml-auto text-indigo-500 hover:text-indigo-700 font-medium" onclick="openTaskModal('${parentTaskId}')">View parent →</button>
      </div>
      <div class="grid grid-cols-2 gap-4 mb-5">
        <div>
          <label>Project</label>
          <div class="text-sm text-slate-700 mt-1">${subProject?_escHtml(subProject.name):'—'}</div>
        </div>
        <div>
          <label>Sprint</label>
          <div class="text-sm text-slate-700 mt-1">${subSprint?_escHtml(subSprint.name):'Backlog'}</div>
        </div>
        <div>
          <label>Assignee</label>
          <select onchange="updateSubtaskAssignee('${parentTaskId}','${s.id}',this.value)" class="text-sm mt-1" style="width:100%"
            ${(()=>{
              const canEditAssignee = RBAC.isAdmin()||RBAC.isProgramManager()||RBAC.isSeniorManager();
              if(!canEditAssignee) return 'disabled title="Only Program Managers and above can change the assignee"';
              if(s.status==='released') return 'disabled title="Released subtasks are read-only"';
              return '';
            })()}>
            ${_assigneeOptionsForProject(s.project||parent.project, s.assignee||'')}
          </select>
        </div>
        ${(()=>{
          const qaStatuses=['in-qa','qa-in-progress'];
          if(!qaStatuses.includes(s.status)&&!s.qaAssigneeId) return '';
          const canEditQa = RBAC.canEditQaAssignee(s);
          return `<div>
            <label style="display:flex;align-items:center;gap:5px">QA Assignee <span style="font-size:9.5px;font-weight:600;background:rgba(245,158,11,0.12);color:#a8600a;border:1px solid rgba(245,158,11,0.25);padding:1px 5px;border-radius:4px;letter-spacing:.02em">QA</span></label>
            <select onchange="updateSubtaskQaAssignee('${parentTaskId}','${s.id}',this.value)" class="text-sm mt-1" style="width:100%"
              ${canEditQa && s.status!=='released' ? '' : 'disabled title="You do not have permission to change the QA Assignee"'}>
              ${_qaAssigneeOptionsForProject(s.project||parent.project, s.qaAssigneeId||'')}
            </select>
          </div>`;
        })()}
        ${(()=>{
          // Epic: use subtask's own epicId if set, otherwise inherit from parent task
          const _epicId = s.epicId || parent.epicId || null;
          const _epic = _epicId ? (state.epics||[]).find(e=>e.id===_epicId) : null;
          return `<div>
            <label>Epic <span style="color:var(--text-muted);font-weight:400">(inherited)</span></label>
            <div class="flex flex-wrap gap-1 mt-1">${_epic
              ? `<span class="epic-badge" style="background:${_epic.color}22;color:${_epic.color};border:1px solid ${_epic.color}55" title="${_esc(_epic.title)}">◈ ${_esc(_epic.title)}</span>`
              : '<span class="text-sm text-slate-400">—</span>'
            }</div>
          </div>`;
        })()}
        <div>
          <label>Due Date</label>
          <div class="text-sm text-slate-700 mt-1">${s.dueDate?formatDate(s.dueDate):'—'}</div>
        </div>
        <div>
          <label>Start Date</label>
          <div class="text-sm text-slate-700 mt-1">${s.startDate?formatDate(s.startDate):'—'}</div>
        </div>
        <div>
          <label>End Date</label>
          <div class="text-sm text-slate-700 mt-1">${s.endDate?formatDate(s.endDate):'—'}</div>
        </div>
        <div>
          <label>Tags</label>
          <div class="flex flex-wrap gap-1 mt-1">${(s.tags||[]).map(tag=>_coloredChip(tag,_tagColorByName(tag),'tag')).join('')||'—'}</div>
        </div>
        <div>
          <label>Products</label>
          <div class="flex flex-wrap gap-1 mt-1">${(s.products||[]).map(name=>{const c=_productColorByName(name);return c?_coloredChip(name,c,'tag'):`<span class="tag" style="background:var(--accent-ghost);color:var(--accent-dark);border:1px solid var(--accent-ring)">${name}</span>`;}).join('')||'—'}</div>
        </div>
        <div>
          <label>Theme</label>
          <div class="flex flex-wrap gap-1 mt-1">${s.themeName ? _coloredChip(s.themeName, s.themeColor||'var(--accent)', 'tag') : '—'}</div>
        </div>
        <div>
          <label>Created By <span style="color:var(--text-muted);font-weight:400">(read-only)</span></label>
          <div class="text-sm text-slate-700 mt-1">${_createdByLabel(s.createdBy)}</div>
        </div>
        <div>
          <label>Created Date <span style="color:var(--text-muted);font-weight:400">(read-only)</span></label>
          <div class="text-sm text-slate-700 mt-1">${formatDateTime(s.createdDate||s.createdAt)}</div>
        </div>
      </div>
      <div class="mb-4"><label class="text-xs font-semibold text-slate-500 uppercase tracking-wide">Description</label><div class="mt-1 text-sm text-slate-700 bg-slate-50 rounded-lg p-3 desc-editor" id="subtask-modal-desc-view" style="min-height:unset;cursor:default;pointer-events:none">${s.descriptionPreview?'<span style="color:var(--text-muted);font-style:italic">Loading description…</span>':''}</div></div>
      <!-- COMMENTS SECTION -->
      ${_cmSectionHtml(parentTaskId, subtaskId)}
      <div class="flex justify-end items-center pt-4 border-t border-slate-100 flex-wrap gap-2">
        <div class="flex gap-2">
          <button class="btn btn-secondary" onclick="event.stopPropagation();shareSubtaskLink('${parentTaskId}','${s.id}')" title="Copy shareable link" style="padding:0 9px"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:block"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></button>
          ${RBAC.canEditSubtask(s)?`<button class="btn btn-secondary" onclick="openEditSubtaskModal('${parentTaskId}','${s.id}')">Edit</button>`:''}
          ${!RBAC.isViewer()&&(RBAC.isAdmin()||RBAC.canDeleteAnyTask()||(state.currentUser&&state.currentUser.id===s.assignee))?`<button class="btn btn-danger" onclick="deleteSubtask('${parentTaskId}','${s.id}')">Delete</button>`:''}
        </div>
      </div>
    </div>
  `);
  // Load description on-demand (cache-first, then Firebase); replaces placeholder in place
  _descHydrate(parentTaskId, subtaskId);
  // Load comments on-demand (cache-first, then Firebase); replaces placeholder in place
  _cmHydrate(parentTaskId, subtaskId);
}

function openEditSubtaskModal(parentTaskId,subtaskId){
  const parent=getTask(parentTaskId);
  if(!parent)return;
  const s=(parent.subtasks||[]).find(x=>x.id===subtaskId);
  if(!s)return;
  // ── RBAC: members can only edit subtasks assigned to themselves ──
  if(!RBAC.canEditSubtask(s)){
    showNotif('⚠ You can only edit subtasks assigned to you','error');
    return;
  }
  const isReleased = s.status==='released';
  const _sdis = (cond) => cond ? 'disabled' : '';
  const _sro  = (cond) => cond ? 'style="opacity:0.65;pointer-events:none;cursor:not-allowed"' : '';
  const inheritedProject=s.project?getProject(s.project):null;
  const inheritedSprint=s.sprint?getSprint(s.sprint):null;
  replaceModal(`
    <div class="p-6">
      <div class="flex items-center justify-between mb-5">
        <h2 class="text-lg font-bold text-slate-900">Edit Subtask${isReleased?' <span style="font-size:11px;font-weight:500;color:#dc2626;background:#fef2f2;border:1px solid #fecaca;padding:2px 7px;border-radius:4px;vertical-align:middle">Released — Read Only</span>':''}</h2>
        <button onclick="openSubtaskModal('${parentTaskId}','${subtaskId}')" style="color:var(--text-muted);cursor:pointer;transition:color 0.14s" onmouseenter="this.style.color='var(--text-primary)'" onmouseleave="this.style.color='var(--text-muted)'"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
      <div class="space-y-4">
        <!-- Inherited fields (read-only) -->
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label>Project <span style="color:var(--text-muted);font-weight:400">(inherited)</span></label>
            <div style="height:var(--control-h);background:var(--control-bg);border:1px solid var(--control-border);border-radius:var(--control-radius);padding:0 10px;display:flex;align-items:center;font-size:13px;color:var(--text-secondary);opacity:0.8">${inheritedProject?inheritedProject.name:'—'}</div>
          </div>
          <div>
            <label>Sprint <span style="color:var(--text-muted);font-weight:400">(inherited)</span></label>
            <div style="height:var(--control-h);background:var(--control-bg);border:1px solid var(--control-border);border-radius:var(--control-radius);padding:0 10px;display:flex;align-items:center;font-size:13px;color:var(--text-secondary);opacity:0.8">${inheritedSprint?inheritedSprint.name:'Backlog'}</div>
          </div>
        </div>
        <div>
          <label>Title *</label>
          <input type="text" id="est-title" value="${_esc(s.title)}" ${_sdis(isReleased)}/>
        </div>
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
            <label>Description</label>
            <button type="button" class="ai-writing-only" id="ai-rewrite-btn-est" onclick="AI.rewriteText('est-description','ai-rewrite-btn-est')" style="display:none;background:none;border:none;cursor:pointer;color:var(--accent);font-size:11.5px;font-weight:600;padding:2px 4px" title="Improve wording with AI">✨ Improve wording</button>
          </div>
          <div id="est-description" class="desc-editor" data-placeholder="Add more context..." ${_sro(isReleased)}></div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label>Type</label>
            <select id="est-type" ${_sdis(isReleased)}>
              <option value="task" ${(!s.type||s.type==='task')?'selected':''}>Task</option>
              <option value="bug" ${s.type==='bug'?'selected':''}>Bug</option>
            </select>
          </div>
          <div>
            <label>Priority</label>
            <select id="est-priority" ${_sdis(isReleased)}>
              <option value="critical" ${s.priority==='critical'?'selected':''}>Critical</option>
              <option value="high" ${s.priority==='high'?'selected':''}>High</option>
              <option value="medium" ${s.priority==='medium'?'selected':''}>Medium</option>
              <option value="low" ${s.priority==='low'?'selected':''}>Low</option>
            </select>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label>Status</label>
            <select id="est-status" ${isTaskLocked(s)?'disabled title="Subtask is frozen — status cannot be changed"':''} onchange="estOnStatusChange(this.value)">
              ${(()=>{
                if(s.status==='released') return '<option value="released" selected>Released</option><option value="rollback">Rollback</option>';
                if(s.status==='ready-for-prod') return '<option value="ready-for-prod" selected>Ready for Prod</option>';
                return Object.entries(STATUS_META).filter(([v])=>v!=='rollback').map(([v,m])=>`<option value="${v}" ${s.status===v?'selected':''}>${m.label}</option>`).join('');
              })()}
            </select>
          </div>
          <div>
            <label>Story Points</label>
            <select id="est-points" ${_sdis(isReleased)}>
              ${[1,2,3,5,8,13].map(p=>`<option value="${p}" ${s.points===p?'selected':''}>${p}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label>Assignee</label>
            <select id="est-assignee" ${_sdis(isReleased)}>
              <option value="" ${!s.assignee?'selected':''}>Unassigned</option>
              ${(()=>{
                const selfId = RBAC.memberSelfOnlyId();
                const users = (selfId ? state.users.filter(u=>u.id===selfId) : state.users)
                  .slice().sort((a,b)=>(a.name||'').localeCompare(b.name||''));
                const sel = selfId ? selfId : (s.assignee||'');
                return users.map(u=>`<option value="${u.id}" ${u.id===sel?'selected':''}>${u.name}</option>`).join('');
              })()}
            </select>
          </div>
          <div id="est-qa-assignee-row" data-project="${s.project||parent.project||''}" style="${['in-qa','qa-in-progress'].includes(s.status)?'':'display:none'}">
            <label style="display:flex;align-items:center;gap:5px">QA Assignee <span style="font-size:9.5px;font-weight:600;background:rgba(245,158,11,0.12);color:#a8600a;border:1px solid rgba(245,158,11,0.25);padding:1px 5px;border-radius:4px;letter-spacing:.02em">QA</span></label>
            <select id="est-qa-assignee" ${_sdis(isReleased||!RBAC.canEditQaAssignee(s))}>
              ${_qaAssigneeOptionsForProject(s.project||parent.project, s.qaAssigneeId||'')}
            </select>
          </div>
          <div>
            <label>Due Date</label>
            <input type="date" id="est-due" value="${s.dueDate||''}" ${_sdis(isReleased)}/>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label>Start Date</label>
            <input type="date" id="est-startDate" value="${s.startDate||''}" ${_sdis(isReleased)} ${isReleased?'':'onchange="estOnStartDateChange(this.value)"'}/>
          </div>
          <div>
            <label>End Date</label>
            <input type="date" id="est-endDate" value="${s.endDate||''}" min="${s.startDate||''}" ${_sdis(isReleased)}/>
          </div>
        </div>
        <div class="grid grid-cols-3 gap-3 p-3 rounded-lg" style="background:var(--accent-ghost);border:1px solid var(--accent-ring)">
          <div>
            <label style="color:var(--accent-dark)">Products <span style="color:var(--text-muted);font-weight:400">(inherited)</span></label>
            <div class="flex flex-wrap gap-1 mt-1">${(parent.products||[]).map(name=>{const c=_productColorByName(name);return c?_coloredChip(name,c,'tag'):`<span class="tag" style="background:var(--accent-ghost);color:var(--accent-dark);border:1px solid var(--accent-ring)">${name}</span>`;}).join('')||'<span class="text-xs text-slate-400">—</span>'}</div>
          </div>
          <div>
            <label style="color:var(--accent-dark)">Tags <span style="color:var(--text-muted);font-weight:400">(inherited)</span></label>
            <div class="flex flex-wrap gap-1 mt-1">${(parent.tags||[]).map(tag=>_coloredChip(tag,_tagColorByName(tag),'tag')).join('')||'<span class="text-xs text-slate-400">—</span>'}</div>
          </div>
          <div>
            <label style="color:var(--accent-dark)">Theme <span style="color:var(--text-muted);font-weight:400">(inherited)</span></label>
            <div class="flex flex-wrap gap-1 mt-1">${parent.themeName?_coloredChip(parent.themeName,parent.themeColor||'var(--accent)','tag'):'<span class="text-xs text-slate-400">—</span>'}</div>
          </div>
          <div>
            <label style="color:var(--accent-dark)">Epic <span style="color:var(--text-muted);font-weight:400">(inherited)</span></label>
            <div class="flex flex-wrap gap-1 mt-1">${(()=>{
              const _epicId=s.epicId||parent.epicId||null;
              const _epic=_epicId?(state.epics||[]).find(e=>e.id===_epicId):null;
              return _epic
                ? `<span class="epic-badge" style="background:${_epic.color}22;color:${_epic.color};border:1px solid ${_epic.color}55" title="${_esc(_epic.title)}">◈ ${_esc(_epic.title)}</span>`
                : '<span class="text-xs text-slate-400">—</span>';
            })()}</div>
          </div>
        </div>
      </div>
      <div class="flex justify-end gap-3 mt-6 pt-4" style="border-top:1px solid rgba(0,0,0,0.05)">
        <button class="btn btn-secondary" onclick="openSubtaskModal('${parentTaskId}','${subtaskId}')">Cancel</button>
        <button class="btn btn-primary" onclick="saveSubtask('${parentTaskId}','${subtaskId}')">${isReleased?'Rollback':'Save Changes'}</button>
      </div>
    </div>
  `);
  _initDescEditor('est-description', '', 'Add more context...');
  // Load description on-demand and populate editor (cache-first, Firebase fallback)
  _descLoad(parentTaskId, subtaskId).then(html=>{
    _setDescValue('est-description', html);
  }).catch(()=>{});
}

function saveSubtask(parentTaskId,subtaskId){
  const parent=getTask(parentTaskId);
  if(!parent)return;
  const s=(parent.subtasks||[]).find(x=>x.id===subtaskId);
  if(!s)return;
  // ── Notification: snapshot pre-save state before any mutation ──
  const _ntPrevAssignee = s.assignee || null;
  const _ntPrevStatus   = s.status   || null;
  // ── RBAC: members can only save subtasks assigned to themselves ──
  if(!RBAC.canEditSubtask(s)){
    showNotif('⚠ You can only edit subtasks assigned to you','error');
    return;
  }
  // ── Freeze guard: released subtasks are fully frozen except rollback action ──
  if(s.status==='released'){
    const selectedStatus = document.getElementById('est-status') ? document.getElementById('est-status').value : '';
    if(selectedStatus==='rollback'){
      s.status='in-qa';
      _drStampCompletionDate(s, _ntPrevStatus, s.status, st=>DONE_STATUSES.includes(st));
      s.updatedAt=_now();
      FirebaseDB.saveEntity('tasks', parent).catch(e=>console.warn('[saveSubtask] Firebase error:',e));
      SaveManager.save();
      renderPage(currentPage);
      openSubtaskModal(parentTaskId,subtaskId);
      showNotif('Task rolled back to In QA','success');
      return;
    }
    showNotif('⚠ Released subtasks are read-only. Use Rollback to move back.','error');
    return;
  }
  const title=document.getElementById('est-title').value.trim();
  if(!title){showNotif('⚠ Title required','error');return;}
  const startDate=document.getElementById('est-startDate').value||null;
  const endDate=document.getElementById('est-endDate').value||null;
  if(startDate&&endDate&&endDate<startDate){showNotif('⚠ End Date cannot be before Start Date','error');return;}
  s.title=title;
  s.type=document.getElementById('est-type').value||'task';
  // ── Description: save to taskDescriptions collection, NOT into subtask/task document ──
  const _estDescHtml = _getDescValue('est-description');
  _descSave(parentTaskId, subtaskId, _estDescHtml); // async — non-blocking
  // Remove any legacy embedded description (idempotent)
  if(s.description !== undefined) delete s.description;
  s.status=document.getElementById('est-status').value;
  _drStampCompletionDate(s, _ntPrevStatus, s.status, st=>DONE_STATUSES.includes(st));
  s.priority=document.getElementById('est-priority').value;
  // ── RBAC: members can only assign subtasks to themselves ──
  s.assignee= RBAC.memberSelfOnlyId() || document.getElementById('est-assignee').value||null;
  s.points=parseInt(document.getElementById('est-points').value)||3;
  s.startDate=startDate;
  s.endDate=endDate;
  s.dueDate=document.getElementById('est-due').value||null;
  // ── QA Assignee: Admin/PM, or the subtask's own Assignee, may set it ──
  if(RBAC.canEditQaAssignee(s)){
    const _qaEl=document.getElementById('est-qa-assignee');
    const _qaId=_qaEl?_qaEl.value||null:s.qaAssigneeId||null;
    s.qaAssigneeId=_qaId;
    const _qaUser=_qaId?getUser(_qaId):null;
    s.qaAssigneeName=_qaUser?_qaUser.name:null;
  }
  // ── Re-sync inherited metadata from parent (tags/products/theme are never editable on subtask) ──
  s.tags=       parent.tags      || [];
  s.tagIds=     parent.tagIds    || [];
  s.productIds= parent.productIds|| [];
  s.products=   parent.products  || [];
  s.themeId=    parent.themeId   || null;
  s.themeName=  parent.themeName  || null;
  s.themeColor= parent.themeColor || null;
  // ── Firebase: persist parent task with updated subtask ──
  FirebaseDB.saveEntity('tasks', parent).catch(e=>console.warn('[saveSubtask] Firebase error:',e));
  SaveManager.save();
  renderPage(currentPage);
  openSubtaskModal(parentTaskId,subtaskId);
  showNotif('Subtask updated ✓');
  // ── Notification triggers (standalone — no workflow impact) ──
  NotificationTriggers._onSubtaskSaved(s, parent, { prevAssignee: _ntPrevAssignee, prevStatus: _ntPrevStatus });
}

function updateSubtaskStatus(parentTaskId,subtaskId,status){
  const parent=getTask(parentTaskId);
  if(!parent)return;
  const s=(parent.subtasks||[]).find(x=>x.id===subtaskId);
  if(!s)return;
  // ── Notification: snapshot pre-mutation status ──
  const _ntPrevStatus = s.status || null;
  // ── RBAC: members can only update status on their own subtasks (as Assignee or QA Assignee) ──
  if(!RBAC.canEditStatus(s)){
    showNotif('⚠ You can only update status for subtasks assigned to you','error');
    return;
  }
  if(s){
    // ── Backlog → Released guard ──
    if(resolveRollbackStatus(status)==='released'){
      const releaseCheck=canReleaseItem(parent);
      if(!releaseCheck.ok){
        showNotif('⚠ '+releaseCheck.msg,'error');
        try{const sel=document.querySelector(`select[onchange*="updateSubtaskStatus"][onchange*="${subtaskId}"]`);if(sel)sel.value=s.status;}catch(e){}
        return;
      }
    }
    const resolvedStatus=resolveRollbackStatus(status);
    _trackQAReopen(s, resolvedStatus);
    s.status=resolvedStatus;
    _drStampCompletionDate(s, _ntPrevStatus, resolvedStatus, st=>DONE_STATUSES.includes(st));
    // ── Firebase: persist parent task with updated subtask status ──
    FirebaseDB.saveEntity('tasks', parent).catch(e=>console.warn('[updateSubtaskStatus] Firebase error:',e));
    SaveManager.save();
    renderPage(currentPage);
    openSubtaskModal(parentTaskId,subtaskId);
    const notifMsg=status==='rollback'?'Task rolled back to In QA':`Subtask status → ${statusLabel(resolvedStatus)} ✓`;
    showNotif(notifMsg,'success');
    // ── Notification triggers (standalone — no workflow impact) ──
    NotificationTriggers._onSubtaskStatusChanged(s, parent, _ntPrevStatus, resolvedStatus);
  }
}

// ── Inline quick-edit from the Subtask view modal — same RBAC rules as
// saveSubtask()/openEditSubtaskModal(), without needing to open Edit.
function updateSubtaskAssignee(parentTaskId,subtaskId,newAssigneeId){
  const parent=getTask(parentTaskId);
  if(!parent)return;
  const s=(parent.subtasks||[]).find(x=>x.id===subtaskId);
  if(!s)return;
  if(!(RBAC.isAdmin()||RBAC.isProgramManager()||RBAC.isSeniorManager())){
    showNotif('⚠ Only Program Managers and above can change the assignee','error');
    return;
  }
  if(s.status==='released'){
    showNotif('⚠ Released subtasks are read-only','error');
    return;
  }
  const _ntPrevAssignee=s.assignee||null;
  const _ntPrevStatus=s.status||null;
  s.assignee=RBAC.memberSelfOnlyId()||newAssigneeId||null;
  FirebaseDB.saveEntity('tasks', parent).catch(e=>console.warn('[updateSubtaskAssignee] Firebase error:',e));
  SaveManager.save();
  renderPage(currentPage);
  openSubtaskModal(parentTaskId,subtaskId);
  showNotif('Assignee updated ✓');
  NotificationTriggers._onSubtaskSaved(s, parent, { prevAssignee:_ntPrevAssignee, prevStatus:_ntPrevStatus });
}
function updateSubtaskQaAssignee(parentTaskId,subtaskId,newQaId){
  const parent=getTask(parentTaskId);
  if(!parent)return;
  const s=(parent.subtasks||[]).find(x=>x.id===subtaskId);
  if(!s)return;
  if(!RBAC.canEditQaAssignee(s)){
    showNotif('⚠ You do not have permission to change the QA Assignee','error');
    return;
  }
  if(s.status==='released'){
    showNotif('⚠ Released subtasks are read-only','error');
    return;
  }
  s.qaAssigneeId=newQaId||null;
  const qaUser=s.qaAssigneeId?getUser(s.qaAssigneeId):null;
  s.qaAssigneeName=qaUser?qaUser.name:null;
  FirebaseDB.saveEntity('tasks', parent).catch(e=>console.warn('[updateSubtaskQaAssignee] Firebase error:',e));
  SaveManager.save();
  renderPage(currentPage);
  openSubtaskModal(parentTaskId,subtaskId);
  showNotif('QA Assignee updated ✓');
}

function deleteSubtask(parentTaskId,subtaskId){
  const parent=getTask(parentTaskId);
  if(!parent)return;
  const s=(parent.subtasks||[]).find(x=>x.id===subtaskId);
  if(!s)return;
  // ── RBAC: Admins and toggle-enabled Program/Senior Managers may delete any subtask;
  // everyone else may only delete subtasks assigned to themselves; Viewer can never delete ──
  if(!RBAC.isAdmin()&&!RBAC.canDeleteAnyTask()&&(RBAC.isViewer()||!(state.currentUser&&state.currentUser.id===s.assignee))){
    showNotif('⚠ You can only delete subtasks assigned to you','error');
    return;
  }
  if(!confirm('Delete this subtask?'))return;
  parent.subtasks=(parent.subtasks||[]).filter(s=>s.id!==subtaskId);
  // ── Firebase: persist parent task with subtask removed ──
  FirebaseDB.saveEntity('tasks', parent).catch(e=>console.warn('[deleteSubtask] Firebase error:',e));
  SaveManager.save();
  renderPage(currentPage);
  openTaskModal(parentTaskId);
  showNotif('Subtask deleted');
}

function openCreateTaskModal(){
  if(RBAC.isViewer()){ showNotif('⚠ Viewers cannot create tasks','error'); return; }
  const _visibleProjects = RBAC.getVisibleProjects().filter(p=>(p.status||'').toLowerCase()==='active');
  const firstProjectId = _visibleProjects.length ? _visibleProjects[0].id : '';
  const sprintOptsHtml = _sprintOptionsForProject(firstProjectId, '');
  openModal(`
    <div class="p-6">
      <div class="flex items-center justify-between mb-5">
        <h2 class="text-lg font-bold text-slate-900">Create New Task</h2>
        <button onclick="closeModal()" style="color:var(--text-muted);cursor:pointer;transition:color 0.14s" onmouseenter="this.style.color='var(--text-primary)'" onmouseleave="this.style.color='var(--text-muted)'"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
      <div class="space-y-4">
        <div>
          <label>Title *</label>
          <input type="text" id="ct-title" placeholder="What needs to be done?" autofocus/>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label>Type *</label>
            <select id="ct-type">
              <option value="">— Select type —</option>
              <option value="story">Story</option>
              <option value="task">Task</option>
              <option value="bug">Bug</option>
            </select>
          </div>
          <div>
            <label>Priority *</label>
            <select id="ct-priority">
              <option value="">— Select priority —</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label>Project *</label>
            <select id="ct-project" onchange="ctOnProjectChange(this.value)">
              <option value="">— Select project —</option>
              ${_visibleProjects.map(p=>`<option value="${p.id}"${p.id===firstProjectId?' selected':''}>${p.name}</option>`).join('')}
            </select>
          </div>
          <div>
            <label>Sprint / Backlog *</label>
            <select id="ct-sprint" onchange="ctOnSprintChange(this.value)">
              ${sprintOptsHtml}
            </select>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label id="ct-assignee-label">Assignee</label>
            <select id="ct-assignee">
              ${_assigneeOptionsForProject(firstProjectId, '')}
            </select>
          </div>
          <div>
            <label>Story Points *</label>
            <select id="ct-points">
              <option value="">— Select —</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="5" selected>5</option>
              <option value="8">8</option>
              <option value="13">13</option>
            </select>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4" id="ct-date-row">
          <div>
            <label id="ct-start-label">Start Date</label>
            <input type="date" id="ct-start" onchange="ctOnStartDateChange(this.value)"/>
          </div>
          <div>
            <label id="ct-end-label">End Date</label>
            <input type="date" id="ct-end"/>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label>Status</label>
            <select id="ct-status">
              ${Object.entries(STATUS_META).filter(([v])=>v!=='rollback').map(([v,m])=>`<option value="${v}"${v==='open'?' selected':''}>${m.label}</option>`).join('')}
            </select>
          </div>
          <div>
            <label>Epic</label>
            <select id="ct-epic">
              <option value="">No Epic</option>
              ${(state.epics||[]).filter(e=>(e.status||'').toLowerCase()==='active').map(e=>`<option value="${e.id}">◈ ${e.title}</option>`).join('')}
            </select>
          </div>
        </div>
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
            <label>Description</label>
            <button type="button" class="ai-writing-only" id="ai-rewrite-btn-ct" onclick="AI.rewriteText('ct-desc','ai-rewrite-btn-ct')" style="display:none;background:none;border:none;cursor:pointer;color:var(--accent);font-size:11.5px;font-weight:600;padding:2px 4px" title="Improve wording with AI">✨ Improve wording</button>
          </div>
          <div id="ct-desc" class="desc-editor" data-placeholder="Add more context..."></div>
        </div>
        <div>
          <label>Theme *</label>
          <div class="ms-control" id="ct-theme">
            <div class="ms-chips-row">
              <span id="ct-theme-chips"></span>
              <input class="ms-input" id="ct-theme-input" type="text" placeholder="Search themes…" autocomplete="off"
                oninput="_msInput('ct-theme')" onfocus="_msFocus('ct-theme')" onblur="_msBlur('ct-theme')"/>
            </div>
            <div class="ms-dropdown" id="ct-theme-drop"></div>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label>Products</label>
            <div class="ms-control" id="ct-products">
              <div class="ms-chips-row">
                <span id="ct-products-chips"></span>
                <input class="ms-input" id="ct-products-input" type="text" placeholder="Search products…" autocomplete="off"
                  oninput="_msInput('ct-products')" onfocus="_msFocus('ct-products')" onblur="_msBlur('ct-products')"/>
              </div>
              <div class="ms-dropdown" id="ct-products-drop"></div>
            </div>
          </div>
          <div>
            <label>Tags</label>
            <div class="ms-control" id="ct-tags">
              <div class="ms-chips-row">
                <span id="ct-tags-chips"></span>
                <input class="ms-input" id="ct-tags-input" type="text" placeholder="Search tags…" autocomplete="off"
                  oninput="_msInput('ct-tags')" onfocus="_msFocus('ct-tags')" onblur="_msBlur('ct-tags')"/>
              </div>
              <div class="ms-dropdown" id="ct-tags-drop"></div>
            </div>
          </div>
        </div>
      </div>
      <div class="flex justify-end gap-3 mt-6 pt-4" style="border-top:1px solid rgba(0,0,0,0.05)">
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="createTask()">Create Task</button>
      </div>
    </div>
  `);
  _initDescEditor('ct-desc','','Add more context...');
  // Initialize label states
  ctOnSprintChange(document.getElementById('ct-sprint').value);
  ctOnProjectChange(firstProjectId);
  // Initialize Products + Tags multi-selects (project-filtered)
  const _ctProductItems = (state.products||[]).filter(p=>(p.projectIds||[]).includes(firstProjectId)).map(p=>({id:p.id,name:p.name,color:p.color||''}));
  const _ctTagItems     = (state.tags||[]).filter(t=>(t.projectIds||[]).includes(firstProjectId)).map(t=>({id:t.id,name:t.name,color:t.color||''}));
  const _ctThemeItems   = (state.themes||[]).filter(th=>(th.projectIds||[]).includes(firstProjectId)).map(th=>({id:th.id,name:th.name,color:th.color||''}));
  initMultiSelect('ct-products', _ctProductItems, []);
  initMultiSelect('ct-tags',     _ctTagItems,     []);
  initMultiSelect('ct-theme',    _ctThemeItems,   [], false);
}

function createTask(){
  if(RBAC.isViewer()){ showNotif('⚠ Viewers cannot create tasks','error'); return; }
  _ctClearErrors();
  let firstError = null;

  const title = document.getElementById('ct-title').value.trim();
  const type = document.getElementById('ct-type').value;
  const priority = document.getElementById('ct-priority').value;
  const projectId = document.getElementById('ct-project').value;
  const sprintId = document.getElementById('ct-sprint').value || null;
  const assigneeId = document.getElementById('ct-assignee').value || null;
  const points = document.getElementById('ct-points').value;
  const startDate = document.getElementById('ct-start').value;
  const endDate = document.getElementById('ct-end').value;
  const isBacklog = !sprintId;

  // ── Mandatory field checks ──
  if(!title){
    if(!firstError){_ctFieldError('ct-title','Title is required');firstError='ct-title';}
  }
  if(!type){
    if(!firstError){_ctFieldError('ct-type','Type is required');firstError='ct-type';}
    else _ctFieldError('ct-type','Type is required');
  }
  if(!priority){
    if(!firstError){_ctFieldError('ct-priority','Priority is required');firstError='ct-priority';}
    else _ctFieldError('ct-priority','Priority is required');
  }
  if(!projectId){
    if(!firstError){_ctFieldError('ct-project','Project is required');firstError='ct-project';}
    else _ctFieldError('ct-project','Project is required');
  }
  if(!points){
    if(!firstError){_ctFieldError('ct-points','Story points required');firstError='ct-points';}
    else _ctFieldError('ct-points','Story points required');
  }
  if(!_msGetSelectedIds('ct-theme').length){
    if(!firstError){_ctFieldError('ct-theme','Theme is required');firstError='ct-theme';}
    else _ctFieldError('ct-theme','Theme is required');
  }
  // ── Conditional: assignee mandatory for sprint tasks ──
  if(!isBacklog && !assigneeId){
    if(!firstError){_ctFieldError('ct-assignee','Assignee required for sprint tasks');firstError='ct-assignee';}
    else _ctFieldError('ct-assignee','Assignee required for sprint tasks');
  }
  // ── Conditional: dates mandatory for sprint tasks ──
  if(!isBacklog && !startDate){
    if(!firstError){_ctFieldError('ct-start','Start date required for sprint tasks');firstError='ct-start';}
    else _ctFieldError('ct-start','Start date required for sprint tasks');
  }
  if(!isBacklog && !endDate){
    if(!firstError){_ctFieldError('ct-end','End date required for sprint tasks');firstError='ct-end';}
    else _ctFieldError('ct-end','End date required for sprint tasks');
  }
  // ── Date order validation ──
  if(startDate && endDate && endDate < startDate){
    if(!firstError){_ctFieldError('ct-end','End date cannot be before start date');firstError='ct-end';}
    else _ctFieldError('ct-end','End date cannot be before start date');
  }

  if(firstError){ document.getElementById(firstError)?.focus(); return; }

  const tagIds      = _msGetSelectedIds('ct-tags');
  const productIds  = _msGetSelectedIds('ct-products');
  const tagNames    = _msGetSelected('ct-tags');
  const productNames= _msGetSelected('ct-products');
  // Theme: single selection (first selected id)
  const _ctThemeIds   = _msGetSelectedIds('ct-theme');
  const _ctThemeId    = _ctThemeIds[0] || null;
  const _ctThemeObj   = _ctThemeId ? (state.themes||[]).find(th=>th.id===_ctThemeId) : null;
  const _ctThemeName  = _ctThemeObj ? _ctThemeObj.name  : null;
  const _ctThemeColor = _ctThemeObj ? (_ctThemeObj.color||null) : null;
  const _selfId = RBAC.memberSelfOnlyId();
  const _ctDescHtml = _getDescValue('ct-desc');
  const cu = state.currentUser;
  const _ctDescBy = cu ? (cu.name || cu.email || '') : '';
  const task = {
    id:uid(),
    title,
    type,
    priority,
    project:projectId,
    assignee:_selfId || assigneeId,
    sprint:sprintId,
    epicId:document.getElementById('ct-epic')?document.getElementById('ct-epic').value||null:null,
    points:parseInt(points)||5,
    // Description stored in taskDescriptions collection — only preview metadata here
    descriptionPreview   : _ctDescHtml ? _descGeneratePreview(_ctDescHtml) : '',
    descriptionUpdatedAt : _ctDescHtml ? _now() : null,
    descriptionUpdatedBy : _ctDescHtml ? _ctDescBy : '',
    status:document.getElementById('ct-status').value||'open',
    startDate:startDate||null,
    endDate:endDate||null,
    tagIds,
    productIds,
    tags:tagNames,
    products:productNames,
    themeId:_ctThemeId,
    themeName:_ctThemeName,
    themeColor:_ctThemeColor,
    subtasks:[],
    qaAssigneeId:null,
    qaAssigneeName:null,
    // ── Audit trail: creation metadata (read-only) ──
    createdBy:_captureCreator(),
    createdDate:Date.now()
  };
  state.tasks.push(task);
  invalidateStateMaps();
  _invalidateSearchCache();
  // ── Firebase: persist new task; queue if Firebase is unavailable ──
  SyncState.markPending(task.id);
  if(FirebaseDB.isReady()){
    FirebaseDB.saveEntity('tasks', task).then(ok=>{
      if(ok){ SyncState.markSynced(task.id); }
      else   { SyncState.markFailed(task.id); PendingSyncQueue.saveEntity('tasks', task); }
    }).catch(()=>{ SyncState.markFailed(task.id); PendingSyncQueue.saveEntity('tasks', task); });
  } else {
    PendingSyncQueue.saveEntity('tasks', task);
  }
  // ── Write description to taskDescriptions (non-blocking, after task document exists) ──
  if(_ctDescHtml){
    _descSave(task.id, '', _ctDescHtml);
  }
  SaveManager.save();
  // ── Notification: task created (no previous assignee/status) ──
  console.log('[NotificationTriggers] task trigger fired — createTask', task.id);
  try{ NotificationTriggers._onTaskSaved(task, { prevAssignee: null, prevStatus: null }); }
  catch(e){ console.error('Notification pipeline error', e); }
  closeModal();
  refreshAll();
  showNotif(`"${title}" created ✓`);
}

// ─── EDIT TASK ────────────────────────────────────────────────────
function openEditTaskModal(taskId){
  const t=getTask(taskId);
  if(!t)return;
  // ── RBAC: members can only edit tasks assigned to themselves ──
  if(!RBAC.canEditTask(t)){
    showNotif('⚠ You can only edit tasks assigned to you','error');
    return;
  }

  // ── Field-freeze flags ──────────────────────────────────────────
  const isReleased     = t.status==='released';
  const isReadyForProd = t.status==='ready-for-prod';
  // All fields frozen for released tasks; only status allowed for ready-for-prod
  const freezeAll      = isReleased;
  const freezeNonStatus= isReadyForProd; // freeze everything except status
  // Assignee: only Admin, Program Manager, or Senior Manager may change
  const canEditAssignee= RBAC.isAdmin() || RBAC.isProgramManager() || RBAC.isSeniorManager();
  // QA Assignee: Admin/PM, or the task's own Assignee, may set/change it
  const canEditQaAssignee= RBAC.canEditQaAssignee(t);
  // Project & Type: frozen after task creation (always in edit mode)
  const freezeProjType = true;
  // Sprint: frozen once mapped to a sprint
  const freezeSprint   = !!(t.sprint);

  const _dis = (cond) => cond ? 'disabled' : '';
  const _ro  = (cond) => cond ? 'readonly style="opacity:0.65;pointer-events:none;cursor:not-allowed"' : '';

  const sprintOptsHtml = _sprintOptionsForProject(t.project, t.sprint||'');
  const projectEpics = (state.epics||[]).filter(e=>{
    if((e.status||'').toLowerCase()!=='active') return false;
    if(!t.project) return true;
    const epicProjects=e.projectIds||(e.projectId?[e.projectId]:[]);
    return epicProjects.includes(t.project);
  });
  const isBacklog = !t.sprint;
  openModal(`
    <div class="p-6">
      <div class="flex items-center justify-between mb-5">
        <h2 class="text-lg font-bold text-slate-900">Edit Task${freezeAll?' <span style="font-size:11px;font-weight:500;color:#dc2626;background:#fef2f2;border:1px solid #fecaca;padding:2px 7px;border-radius:4px;vertical-align:middle">Released — Read Only</span>':(freezeNonStatus?' <span style="font-size:11px;font-weight:500;color:#065945;background:#d1fae5;border:1px solid #6ee7b7;padding:2px 7px;border-radius:4px;vertical-align:middle">Ready For Prod</span>':'')}</h2>
        <button onclick="closeModal()" style="color:var(--text-muted);cursor:pointer;transition:color 0.14s" onmouseenter="this.style.color='var(--text-primary)'" onmouseleave="this.style.color='var(--text-muted)'"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
      <div class="space-y-4">
        <div>
          <label>Title *</label>
          <input type="text" id="et-title" value="${_esc(t.title)}" ${_dis(freezeAll||freezeNonStatus)}/>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label>Type *</label>
            <select id="et-type" ${_dis(freezeAll||freezeNonStatus||freezeProjType)}>
              <option value="">— Select type —</option>
              <option value="story" ${t.type==='story'?'selected':''}>Story</option>
              <option value="task" ${t.type==='task'?'selected':''}>Task</option>
              <option value="bug" ${t.type==='bug'?'selected':''}>Bug</option>
            </select>
          </div>
          <div>
            <label>Priority *</label>
            <select id="et-priority" ${_dis(freezeAll||freezeNonStatus)}>
              <option value="">— Select priority —</option>
              <option value="critical" ${t.priority==='critical'?'selected':''}>Critical</option>
              <option value="high" ${t.priority==='high'?'selected':''}>High</option>
              <option value="medium" ${t.priority==='medium'?'selected':''}>Medium</option>
              <option value="low" ${t.priority==='low'?'selected':''}>Low</option>
            </select>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label>Status</label>
            <select id="et-status" ${_dis(freezeAll)} onchange="etOnStatusChange(this.value)">
              ${(()=>{
                if(t.status==='released') return '<option value="released" selected>Released</option><option value="rollback">Rollback</option>';
                if(t.status==='ready-for-prod') return '<option value="ready-for-prod" selected>Ready for Prod</option><option value="released">Released</option>';
                return Object.entries(STATUS_META).filter(([v])=>v!=='rollback').map(([v,m])=>`<option value="${v}" ${t.status===v?'selected':''}>${m.label}</option>`).join('');
              })()}
            </select>
          </div>
          <div>
            <label>Story Points *</label>
            <select id="et-points" ${_dis(freezeAll||freezeNonStatus)}>
              <option value="">— Select —</option>
              ${[1,2,3,5,8,13].map(p=>`<option value="${p}" ${t.points===p?'selected':''}>${p}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label>Project *</label>
            <select id="et-project" ${_dis(freezeAll||freezeNonStatus||freezeProjType)} onchange="${(freezeAll||freezeNonStatus||freezeProjType)?'':'etOnProjectChange(this.value)'}">
              <option value="">— Select project —</option>
              ${RBAC.getVisibleProjects().filter(p=>(p.status||'').toLowerCase()==='active').map(p=>`<option value="${p.id}" ${t.project===p.id?'selected':''}>${p.name}</option>`).join('')}
            </select>
          </div>
          <div>
            <label>Sprint / Backlog *</label>
            <select id="et-sprint" ${_dis(freezeAll||freezeNonStatus||freezeSprint)} onchange="${(freezeAll||freezeNonStatus||freezeSprint)?'':'etOnSprintChange(this.value)'}">
              ${sprintOptsHtml}
            </select>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label id="et-assignee-label">${isBacklog?'Assignee':'Assignee *'}</label>
            <select id="et-assignee" ${_dis(freezeAll||freezeNonStatus||!canEditAssignee)}>
              ${_assigneeOptionsForProject(t.project, t.assignee||'')}
            </select>
          </div>
          <div>
            <label>Epic</label>
            <select id="et-epic" ${_dis(freezeAll||freezeNonStatus)}>
              <option value="" ${!t.epicId?'selected':''}>No Epic</option>
              ${projectEpics.map(e=>`<option value="${e.id}" ${t.epicId===e.id?'selected':''}>◈ ${e.title}</option>`).join('')}
            </select>
          </div>
        </div>
        ${(()=>{
          // QA Assignee field — only visible when status is In QA or QA In Progress
          const qaStatuses=['in-qa','qa-in-progress'];
          const isQaStatus=qaStatuses.includes(t.status);
          const _qaOpts=_qaAssigneeOptionsForProject(t.project, t.qaAssigneeId||'');
          if(!isQaStatus) return `<div id="et-qa-assignee-row" style="display:none">
            <label style="display:flex;align-items:center;gap:5px">QA Assignee <span style="font-size:9.5px;font-weight:600;background:rgba(245,158,11,0.12);color:#a8600a;border:1px solid rgba(245,158,11,0.25);padding:1px 5px;border-radius:4px;letter-spacing:.02em">QA</span></label>
            <select id="et-qa-assignee" ${_dis(freezeAll||freezeNonStatus||!canEditQaAssignee)}>
              ${_qaOpts}
            </select>
          </div>`;
          return `<div id="et-qa-assignee-row">
            <label style="display:flex;align-items:center;gap:5px">QA Assignee <span style="font-size:9.5px;font-weight:600;background:rgba(245,158,11,0.12);color:#a8600a;border:1px solid rgba(245,158,11,0.25);padding:1px 5px;border-radius:4px;letter-spacing:.02em">QA</span></label>
            <select id="et-qa-assignee" ${_dis(freezeAll||freezeNonStatus||!canEditQaAssignee)}>
              ${_qaOpts}
            </select>
          </div>`;
        })()}
        <div class="grid grid-cols-2 gap-4" id="et-date-row">
          <div>
            <label id="et-start-label">${isBacklog?'Start Date':'Start Date *'}</label>
            <input type="date" id="et-start" value="${t.startDate||''}" ${_dis(freezeAll||freezeNonStatus)} ${(freezeAll||freezeNonStatus)?'':'onchange="etOnStartDateChange(this.value)"'} min="${t.startDate||''}" />
          </div>
          <div>
            <label id="et-end-label">${isBacklog?'End Date':'End Date *'}</label>
            <input type="date" id="et-end" value="${t.endDate||''}" ${_dis(freezeAll||freezeNonStatus)}/>
          </div>
        </div>
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
            <label>Description</label>
            <button type="button" class="ai-writing-only" id="ai-rewrite-btn-et" onclick="AI.rewriteText('et-desc','ai-rewrite-btn-et')" style="display:none;background:none;border:none;cursor:pointer;color:var(--accent);font-size:11.5px;font-weight:600;padding:2px 4px" title="Improve wording with AI">✨ Improve wording</button>
          </div>
          <div id="et-desc" class="desc-editor" data-placeholder="Add more context..." ${(freezeAll||freezeNonStatus)?'style="opacity:0.65;pointer-events:none;cursor:not-allowed"':''}></div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label>Products</label>
            <div class="ms-control" id="et-products">
              <div class="ms-chips-row">
                <span id="et-products-chips"></span>
                <input class="ms-input" id="et-products-input" type="text" placeholder="Search products…" autocomplete="off" ${(freezeAll||freezeNonStatus)?'disabled style="display:none"':''}
                  oninput="_msInput('et-products')" onfocus="_msFocus('et-products')" onblur="_msBlur('et-products')"/>
              </div>
              <div class="ms-dropdown" id="et-products-drop"></div>
            </div>
          </div>
          <div>
            <label>Tags</label>
            <div class="ms-control" id="et-tags">
              <div class="ms-chips-row">
                <span id="et-tags-chips"></span>
                <input class="ms-input" id="et-tags-input" type="text" placeholder="Search tags…" autocomplete="off" ${(freezeAll||freezeNonStatus)?'disabled style="display:none"':''}
                  oninput="_msInput('et-tags')" onfocus="_msFocus('et-tags')" onblur="_msBlur('et-tags')"/>
              </div>
              <div class="ms-dropdown" id="et-tags-drop"></div>
            </div>
          </div>
        </div>
        <div>
          <label>Theme</label>
          <div class="ms-control" id="et-theme">
            <div class="ms-chips-row">
              <span id="et-theme-chips"></span>
              <input class="ms-input" id="et-theme-input" type="text" placeholder="Search themes…" autocomplete="off" ${(freezeAll||freezeNonStatus)?'disabled style="display:none"':''}
                oninput="_msInput('et-theme')" onfocus="_msFocus('et-theme')" onblur="_msBlur('et-theme')"/>
            </div>
            <div class="ms-dropdown" id="et-theme-drop"></div>
          </div>
        </div>
      </div>
      <div class="flex justify-end gap-3 mt-6 pt-4" style="border-top:1px solid rgba(0,0,0,0.05)">
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        ${freezeAll?'':'<button class="btn btn-primary" onclick="saveTask(\''+t.id+'\')">Save Changes</button>'}
      </div>
    </div>
  `);
  // Initialise rich-text description editor with existing content
  _initDescEditor('et-desc', '', 'Add more context...');
  // Load description on-demand and populate editor (cache-first, Firebase fallback)
  _descLoad(t.id, '').then(html=>{
    _setDescValue('et-desc', html);
  }).catch(()=>{});
  // Initialise End Date minimum from existing start date
  const _etStartEl = document.getElementById('et-start');
  const _etEndEl   = document.getElementById('et-end');
  if(_etStartEl && _etEndEl && _etStartEl.value){
    _etEndEl.min = _etStartEl.value;
  }
  const _etProjectId    = t.project || '';
  const _etProductItems = (state.products||[]).filter(p=>(p.projectIds||[]).includes(_etProjectId)).map(p=>({id:p.id,name:p.name,color:p.color||''}));
  const _etTagItems     = (state.tags||[]).filter(tg=>(tg.projectIds||[]).includes(_etProjectId)).map(tg=>({id:tg.id,name:tg.name,color:tg.color||''}));
  const _etThemeItems   = (state.themes||[]).filter(th=>(th.projectIds||[]).includes(_etProjectId)).map(th=>({id:th.id,name:th.name,color:th.color||''}));
  const _frozen = freezeAll || freezeNonStatus;
  // Backward compat: use id-arrays if present; otherwise resolve legacy name-arrays
  const _etProductIds = (t.productIds||[]).length
    ? t.productIds
    : (t.products||[]).map(name=>{ const p=_etProductItems.find(x=>x.name===name); return p?p.id:null; }).filter(Boolean);
  const _etTagIds = (t.tagIds||[]).length
    ? t.tagIds
    : (t.tags||[]).map(name=>{ const tg=_etTagItems.find(x=>x.name===name); return tg?tg.id:null; }).filter(Boolean);
  const _etThemeIds = t.themeId ? [t.themeId] : [];
  initMultiSelect('et-products', _etProductItems, _etProductIds, _frozen);
  initMultiSelect('et-tags',     _etTagItems,     _etTagIds,     _frozen);
  initMultiSelect('et-theme',    _etThemeItems,   _etThemeIds,   _frozen);
}

function saveTask(taskId){
  const t=getTask(taskId);
  if(!t)return;
  // ── Notification: snapshot pre-save state before any mutation ──
  const _ntPrevAssignee = t.assignee || null;
  const _ntPrevStatus   = t.status   || null;
  // ── Freeze guard: released tasks are fully frozen except rollback action ──
  if(t.status==='released'){
    const selectedStatus = document.getElementById('et-status') ? document.getElementById('et-status').value : '';
    if(selectedStatus==='rollback'){
      // Allow rollback: resolve to 'in-qa', keep all other fields unchanged
      t.status='in-qa';
      _drStampCompletionDate(t, _ntPrevStatus, t.status, s=>DONE_STATUSES.includes(s));
      t.updatedAt=_now();
      SyncState.markPending(t.id);
      DebounceWrite.schedule('tasks', t, 300);
      SaveManager.save();
      invalidateStateMaps();
      _invalidateSearchCache();
      closeModal();
      refreshAll();
      showNotif('Task rolled back to In QA','success');
      return;
    }
    showNotif('⚠ Released tasks are read-only. Use Rollback to move back.','error');
    return;
  }
  // ── RBAC: block save for members who are not the assignee ──
  if(!RBAC.canEditTask(t)){
    showNotif('⚠ You can only edit tasks assigned to you','error');
    return;
  }
  _ctClearErrors();
  let firstError = null;

  const title = document.getElementById('et-title').value.trim();
  const type = document.getElementById('et-type').value;
  const priority = document.getElementById('et-priority').value;
  const projectId = document.getElementById('et-project') ? document.getElementById('et-project').value : t.project;
  const sprintId = document.getElementById('et-sprint') ? document.getElementById('et-sprint').value || null : t.sprint;
  const assigneeId = document.getElementById('et-assignee').value || null;
  const points = document.getElementById('et-points').value;
  const startDate = document.getElementById('et-start') ? document.getElementById('et-start').value : (t.startDate||'');
  const endDate = document.getElementById('et-end') ? document.getElementById('et-end').value : (t.endDate||'');
  const isBacklog = !sprintId;

  // ── Mandatory fields ──
  if(!title){
    if(!firstError){_ctFieldError('et-title','Title is required');firstError='et-title';}
  }
  if(!type){
    if(!firstError){_ctFieldError('et-type','Type is required');firstError='et-type';}
    else _ctFieldError('et-type','Type is required');
  }
  if(!priority){
    if(!firstError){_ctFieldError('et-priority','Priority is required');firstError='et-priority';}
    else _ctFieldError('et-priority','Priority is required');
  }
  if(!projectId){
    if(!firstError){_ctFieldError('et-project','Project is required');firstError='et-project';}
    else _ctFieldError('et-project','Project is required');
  }
  if(!points){
    if(!firstError){_ctFieldError('et-points','Story points required');firstError='et-points';}
    else _ctFieldError('et-points','Story points required');
  }
  // ── Conditional: assignee mandatory for sprint tasks ──
  if(!isBacklog && !assigneeId){
    if(!firstError){_ctFieldError('et-assignee','Assignee required for sprint tasks');firstError='et-assignee';}
    else _ctFieldError('et-assignee','Assignee required for sprint tasks');
  }
  // ── Conditional: dates mandatory for sprint tasks ──
  if(!isBacklog && !startDate){
    if(!firstError){_ctFieldError('et-start','Start date required for sprint tasks');firstError='et-start';}
    else _ctFieldError('et-start','Start date required for sprint tasks');
  }
  if(!isBacklog && !endDate){
    if(!firstError){_ctFieldError('et-end','End date required for sprint tasks');firstError='et-end';}
    else _ctFieldError('et-end','End date required for sprint tasks');
  }
  // ── Date order ──
  if(startDate && endDate && endDate < startDate){
    if(!firstError){_ctFieldError('et-end','End date cannot be before start date');firstError='et-end';}
    else _ctFieldError('et-end','End date cannot be before start date');
  }

  if(firstError){ document.getElementById(firstError)?.focus(); return; }

  t.title=title;
  t.type=t.type;         // frozen after creation — keep original
  t.priority=priority;
  t.project=t.project;   // frozen after creation — keep original
  // ── Task state transition guard on save ──
  const _etNewStatus=document.getElementById('et-status').value;
  const _etStateCheck=canChangeTaskStatus(t,_etNewStatus);
  if(!_etStateCheck.ok){showNotif('⚠ '+_etStateCheck.msg,'error');return;}
  const _etPrevStatus=t.status;
  t.status=resolveRollbackStatus(_etNewStatus);
  _drStampCompletionDate(t, _etPrevStatus, t.status, s=>DONE_STATUSES.includes(s));
  t.points=parseInt(points);
  // ── RBAC: assignee editable only by Admin / PM / Senior Manager; members assign to themselves ──
  if(RBAC.isAdmin()||RBAC.isProgramManager()||RBAC.isSeniorManager()){
    t.assignee= RBAC.memberSelfOnlyId() || assigneeId;
  } else {
    t.assignee= RBAC.memberSelfOnlyId() || t.assignee; // members: keep existing or self
  }
  // ── Sprint: frozen once mapped; only update if task was in backlog ──
  if(!t.sprint){ t.sprint=sprintId; } // allow mapping from backlog; frozen once set
  t.epicId=document.getElementById('et-epic')?document.getElementById('et-epic').value||null:t.epicId;
  t.startDate=startDate||null;
  t.endDate=endDate||null;
  // ── Description: save to taskDescriptions collection, NOT into task document ──
  const _etDescHtml = _getDescValue('et-desc');
  _descSave(t.id, '', _etDescHtml); // async — non-blocking; updates cache + Firebase + metadata
  // Remove any legacy embedded description (idempotent)
  if(t.description !== undefined) delete t.description;
  t.tagIds     = _msGetSelectedIds('et-tags');
  t.productIds = _msGetSelectedIds('et-products');
  // Resolve to name arrays for all existing display paths (kanban, view modal, search, export)
  t.tags     = _msGetSelected('et-tags');
  t.products = _msGetSelected('et-products');
  // Theme: single selection
  const _etSavedThemeIds = _msGetSelectedIds('et-theme');
  const _etSavedThemeId  = _etSavedThemeIds[0] || null;
  const _etSavedThemeObj = _etSavedThemeId ? (state.themes||[]).find(th=>th.id===_etSavedThemeId) : null;
  t.themeId    = _etSavedThemeId;
  t.themeName  = _etSavedThemeObj ? _etSavedThemeObj.name  : null;
  t.themeColor = _etSavedThemeObj ? (_etSavedThemeObj.color||null) : null;
  // ── QA Assignee: editable by Admin/PM or the task's own Assignee; retain existing value otherwise ──
  if(RBAC.canEditQaAssignee(t)){
    const _qaEl=document.getElementById('et-qa-assignee');
    const _qaId=_qaEl?_qaEl.value||null:t.qaAssigneeId||null;
    t.qaAssigneeId=_qaId;
    const _qaUser=_qaId?getUser(_qaId):null;
    t.qaAssigneeName=_qaUser?_qaUser.name:null;
  }
  // ── Debounced Firebase write — protects against rapid save sequences ──
  SyncState.markPending(t.id);
  DebounceWrite.schedule('tasks', t, 300);
  SaveManager.save();
  invalidateStateMaps();
  _invalidateSearchCache();
  closeModal();
  refreshAll();
  showNotif('Changes saved ✓');
  // ── Notification triggers (standalone — no workflow impact) ──
  NotificationTriggers._onTaskSaved(t, { prevAssignee: _ntPrevAssignee, prevStatus: _ntPrevStatus });
}

