// ─── KANBAN ───────────────────────────────────────────────────────
function renderKanban(){
  const selectEl=document.getElementById('kanban-sprint-select');
  const epicFilterEl=document.getElementById('kanban-epic-filter');
  const projectFilterEl=document.getElementById('kanban-project-filter');

  // ── Populate Project filter (Active / Completed groups) ──
  if(projectFilterEl){
    const prevProject=projectFilterEl.value;
    const visibleProjects=RBAC.getVisibleProjects ? RBAC.getVisibleProjects() : state.projects;
    const activeProjects=visibleProjects.filter(p=>p.status!=='completed');
    const completedProjects=visibleProjects.filter(p=>p.status==='completed');
    let projHTML=`<option value="all">All Projects</option>`;
    if(activeProjects.length){
      projHTML+=`<optgroup label="── Active Projects ──">`;
      projHTML+=activeProjects.map(p=>`<option value="${p.id}"${p.id===prevProject?' selected':''}>${p.name}</option>`).join('');
      projHTML+=`</optgroup>`;
    }
    if(completedProjects.length){
      projHTML+=`<optgroup label="── Completed Projects ──">`;
      projHTML+=completedProjects.map(p=>`<option value="${p.id}"${p.id===prevProject?' selected':''}>${p.name}</option>`).join('');
      projHTML+=`</optgroup>`;
    }
    projectFilterEl.innerHTML=projHTML;
    // Reset to "all" if previously selected project no longer exists in visible list
    if(prevProject && prevProject!=='all' && !visibleProjects.find(p=>p.id===prevProject)){
      projectFilterEl.value='all';
    }
  }
  const selectedProject=projectFilterEl?projectFilterEl.value:'all';

  // ── Populate Sprint filter (Active / Completed groups), scoped to selected project ──
  const allSprints=RBAC.getVisibleSprints();
  const scopedSprints=selectedProject==='all'
    ? allSprints
    : allSprints.filter(s=>s.project===selectedProject);
  const prevVal=selectEl.value;
  const activeSprints=scopedSprints.filter(s=>(s.status||'').toLowerCase()==='active');
  const completedSprints=scopedSprints.filter(s=>(s.status||'').toLowerCase()==='completed');
  let sprintHTML='';
  if(activeSprints.length){
    sprintHTML+=`<optgroup label="── Active Sprints ──">`;
    sprintHTML+=activeSprints.map(s=>{
      const proj=getProject(s.project);
      return `<option value="${s.id}"${s.id===prevVal?' selected':''}>${s.name}${proj&&selectedProject==='all'?' — '+proj.name:''}`;
    }).join('');
    sprintHTML+=`</optgroup>`;
  }
  if(completedSprints.length){
    sprintHTML+=`<optgroup label="── Completed Sprints ──">`;
    sprintHTML+=completedSprints.map(s=>{
      const proj=getProject(s.project);
      return `<option value="${s.id}"${s.id===prevVal?' selected':''}>${s.name}${proj&&selectedProject==='all'?' — '+proj.name:''}`;
    }).join('');
    sprintHTML+=`</optgroup>`;
  }
  selectEl.innerHTML=sprintHTML;

  // Safety: if previously selected sprint was planned (not rendered), reset to first active/completed
  const _prevSprint=prevVal?getSprint(prevVal):null;
  if(_prevSprint&&(_prevSprint.status||'').toLowerCase()==='planned'){
    selectEl.value=activeSprints[0]?.id||completedSprints[0]?.id||'';
  }
  const sprintId=selectEl.value||activeSprints[0]?.id||completedSprints[0]?.id||'';
  const board=document.getElementById('kanban-board');
  if(!sprintId){
    board.innerHTML=`<div class="empty-state w-full">
      <div class="empty-state-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><rect x="3" y="3" width="5" height="14" rx="1"/><rect x="10" y="3" width="5" height="9" rx="1"/><rect x="17" y="3" width="4" height="11" rx="1"/></svg></div>
      <div class="text-sm">No sprints yet</div>
      ${RBAC.isViewer()?'':`<button class="btn btn-secondary text-xs mt-3" onclick="navigate('sprint-planning')">Create a sprint →</button>`}
    </div>`;
    return;
  }
  selectEl.value=sprintId;
  const sprint=getSprint(sprintId);
  if(sprint){
    const proj=getProject(sprint.project);
    const labelEl=document.getElementById('kanban-sprint-label');
    if(labelEl) labelEl.textContent=`${sprint.name||'Sprint'}${proj?' — '+proj.name:''}`;
    // ── Active Sprint capacity utilization badge (targeted add) ──────
    const utilBadgeEl=document.getElementById('kanban-sprint-util-badge');
    if(utilBadgeEl){
      if((sprint.status||'').toLowerCase()==='active'){
        const _sprintPts=RBAC.getVisibleTasks(state.tasks.filter(t=>t.sprint===sprintId)).reduce((a,t)=>a+(t.points||0),0);
        utilBadgeEl.innerHTML=_sprintUtilizationBadgeHtml(sprint,_sprintPts);
      } else {
        utilBadgeEl.innerHTML='';
      }
    }
  }

  // ── Populate Epic filter (Active / Completed groups), scoped to sprint's project ──
  if(epicFilterEl){
    const prevEpic=epicFilterEl.value;
    const sprintProjectId=sprint?sprint.project:null;
    // Viewer: epic pool respects their configured scope (epic-wise or project-wise);
    // all other roles keep the existing unrestricted epic list here (unchanged).
    const _epicPoolKanban = RBAC.isViewer() ? RBAC.getVisibleEpics() : (state.epics||[]);
    const relevantEpics=_epicPoolKanban.filter(e=>{
      if(!sprintProjectId) return false;
      const epicProjects=e.projectIds||(e.projectId?[e.projectId]:[]);
      return epicProjects.includes(sprintProjectId);
    });
    const activeEpics=relevantEpics.filter(e=>e.status!=='completed'&&e.status!=='Completed');
    const completedEpics=relevantEpics.filter(e=>e.status==='completed'||e.status==='Completed');
    let epicHTML=`<option value="all">All Epics</option>`;
    if(activeEpics.length){
      epicHTML+=`<optgroup label="── Active Epics ──">`;
      epicHTML+=activeEpics.map(e=>`<option value="${e.id}"${e.id===prevEpic?' selected':''}>${e.title}</option>`).join('');
      epicHTML+=`</optgroup>`;
    }
    if(completedEpics.length){
      epicHTML+=`<optgroup label="── Completed Epics ──">`;
      epicHTML+=completedEpics.map(e=>`<option value="${e.id}"${e.id===prevEpic?' selected':''}>${e.title}</option>`).join('');
      epicHTML+=`</optgroup>`;
    }
    epicFilterEl.innerHTML=epicHTML;
  }
  const epicFilter=epicFilterEl?epicFilterEl.value:'all';

  // ── Populate Assignee filter, scoped to selected project + sprint ──
  const assigneeFilterEl=document.getElementById('kanban-assignee-filter');
  if(assigneeFilterEl){
    const prevAssignee=assigneeFilterEl.value;
    // Determine the pool of tasks in the current project+sprint scope (pre-RBAC-filter)
    const scopedForAssignees=RBAC.getVisibleTasks(state.tasks.filter(t=>{
      if(t.sprint!==sprintId) return false;
      return true;
    }));
    // Collect unique assignee IDs from those tasks — includes Task Assignee, Task QA
    // Assignee, Subtask Assignee, and Subtask QA Assignee, so the dropdown always offers
    // every user the Assignee filter can actually match (see _qaItemBelongsTo usage below).
    const assigneeIds=new Set();
    scopedForAssignees.forEach(t=>{
      if(t.assignee) assigneeIds.add(t.assignee);
      if(t.qaAssigneeId) assigneeIds.add(t.qaAssigneeId);
      (t.subtasks||[]).forEach(s=>{
        if(s.assignee) assigneeIds.add(s.assignee);
        if(s.qaAssigneeId) assigneeIds.add(s.qaAssigneeId);
      });
    });
    // Get RBAC-visible users and intersect with task assignees
    const visibleUsers=RBAC.isAdmin()
      ? (state.users||[])
      : (RBAC.getVisibleProjects
          ? (()=>{
              const vpIds=new Set((RBAC.getVisibleProjects()||[]).map(p=>p.id));
              return (state.users||[]).filter(u=>{
                const uProj=(u.projectIds||[]);
                return uProj.some(id=>vpIds.has(id)) || assigneeIds.has(u.id);
              });
            })()
          : (state.users||[]));
    const assigneesInScope=visibleUsers.filter(u=>assigneeIds.has(u.id));
    assigneesInScope.sort((a,b)=>(a.name||'').localeCompare(b.name||''));
    let assigneeHTML=`<option value="all">All Assignees</option>`;
    assigneeHTML+=assigneesInScope.map(u=>`<option value="${u.id}"${u.id===prevAssignee?' selected':''}>${u.name||u.initials||u.id}</option>`).join('');
    assigneeFilterEl.innerHTML=assigneeHTML;
    // Clear stale selection if previously selected user no longer appears in scope
    if(prevAssignee && prevAssignee!=='all' && !assigneesInScope.find(u=>u.id===prevAssignee)){
      assigneeFilterEl.value='all';
    }
  }
  const assigneeFilter=assigneeFilterEl?assigneeFilterEl.value:'all';

  const cols=[
    {id:'open',label:'Open',color:'#64748b'},
    {id:'dev-in-progress',label:'Dev In Progress',color:'#2563eb'},
    {id:'dev-completed',label:'Dev Completed',color:'#4338ca'},
    {id:'in-qa',label:'In QA',color:'#b45309'},
    {id:'qa-in-progress',label:'QA In Progress',color:'#c2410c'},
    {id:'reopen',label:'Reopen',color:'#dc2626'},
    {id:'on-hold',label:'On Hold',color:'#9a3412'},
    {id:'pending-with-client',label:'Pending With Client',color:'#a16207'},
    {id:'ready-for-prod',label:'Ready for Prod',color:'#065f46'},
    {id:'released',label:'Released',color:'#166534'}
  ];

  // Pre-filter once, not inside each column loop
  let sprintTasks=RBAC.getVisibleTasks(state.tasks.filter(t=>t.sprint===sprintId));
  if(epicFilter!=='all') sprintTasks=sprintTasks.filter(t=>t.epicId===epicFilter);
  // Assignee filter now matches: Task Assignee, Task QA Assignee, any Subtask Assignee,
  // or any Subtask QA Assignee — reusing the existing _qaItemBelongsTo() helper
  // (assignee === userId || qaAssigneeId === userId) at both task and subtask level.
  if(assigneeFilter!=='all'){
    sprintTasks=sprintTasks.filter(t=>{
      if(_qaItemBelongsTo(t, assigneeFilter)) return true;
      return (t.subtasks||[]).some(s=>_qaItemBelongsTo(s, assigneeFilter));
    });
  }

  // Pre-bucket tasks and subtasks by status for O(1) column lookup
  const tasksByStatus = new Map();
  const subtasksByStatus = new Map();
  cols.forEach(c=>{ tasksByStatus.set(c.id,[]); subtasksByStatus.set(c.id,[]); });

  sprintTasks.forEach(t=>{
    if(tasksByStatus.has(t.status)) tasksByStatus.get(t.status).push(t);
    (t.subtasks||[]).forEach(s=>{
      // When an Assignee filter is active, only show subtasks that themselves satisfy
      // the filter (Subtask Assignee or Subtask QA Assignee === selected user). A parent
      // task can still qualify/appear via its own assignee/QA-assignee or via a matching
      // subtask, but only matching subtasks are listed under it (no unrelated subtasks).
      if(assigneeFilter!=='all' && !_qaItemBelongsTo(s, assigneeFilter)) return;
      if(subtasksByStatus.has(s.status)) subtasksByStatus.get(s.status).push({sub:s,parent:t});
    });
  });

  // Preserve per-column scroll positions
  const scrollPositions = new Map();
  cols.forEach(c=>{
    const el=document.getElementById('col-'+c.id);
    if(el) scrollPositions.set(c.id, el.scrollTop);
  });

  // v27: Build render-scoped lookup caches to avoid repeated O(n) map traversals per card
  _kanbanRenderProjectCache = new Map(state.projects.map(p=>[p.id,p]));
  _kanbanRenderUserCache    = new Map(state.users.map(u=>[u.id,u]));
  _kanbanRenderEpicCache    = new Map((state.epics||[]).map(e=>[e.id,e]));

  // Build HTML for all columns, then set innerHTML once (single reflow)
  const boardHTML=cols.map(col=>{
    const tasks=tasksByStatus.get(col.id)||[];
    const colSubtasks=subtasksByStatus.get(col.id)||[];
    const totalCount=tasks.length+colSubtasks.length;

    return `<div style="min-width:256px;width:256px;flex-shrink:0;display:flex;flex-direction:column"
      ondragover="kanbanDragOver(event,'${col.id}')"
      ondrop="kanbanDrop(event,'${col.id}')"
      ondragleave="kanbanDragLeave(event)">
      <div class="kanban-header">
        <div class="flex items-center gap-2">
          <div style="width:8px;height:8px;border-radius:50%;background:${col.color}"></div>
          <span style="font-size:11px">${col.label}</span>
        </div>
        <div class="flex items-center gap-1">
          ${colSubtasks.length?`<span style="background:#ede9fe;color:#7c3aed;border-radius:20px;padding:1px 6px;font-size:10px;font-weight:700" title="${colSubtasks.length} subtask(s) in this column">⬡${colSubtasks.length}</span>`:''}
          <span class="kanban-count" id="kcnt-${col.id}" title="${tasks.length} parent task(s)">${tasks.length}</span>
        </div>
      </div>
      <div class="kanban-col p-2 rounded-xl flex-1" id="col-${col.id}" style="background:rgba(0,0,0,0.02);min-height:300px;display:flex;flex-direction:column;gap:8px">
        ${tasks.map(t=>kanbanCard(t,sprintId)).join('')}
        ${colSubtasks.map(({sub,parent})=>kanbanSubtaskCard(sub,parent)).join('')}
        <div style="min-height:40px"></div>
      </div>
    </div>`;
  }).join('');

  board.innerHTML=boardHTML;

  // v27: Clear render-scoped caches (data now in DOM; no need to hold references)
  _kanbanRenderProjectCache = null;
  _kanbanRenderUserCache    = null;
  _kanbanRenderEpicCache    = null;

  // v27: Restore scroll positions via rAF to avoid forced sync layout
  requestAnimationFrame(()=>{
    cols.forEach(c=>{
      const el=document.getElementById('col-'+c.id);
      if(el&&scrollPositions.has(c.id)) el.scrollTop=scrollPositions.get(c.id);
    });
  });
}

// Parent task card — clean, no subtask list inside
// v27: Per-render-call lookup cache — populated by renderKanban, used by kanbanCard/kanbanSubtaskCard
// Avoids repeated O(n) map traversals for each card during a single board render pass.
let _kanbanRenderProjectCache = null;
let _kanbanRenderUserCache = null;
let _kanbanRenderEpicCache = null;

function kanbanCard(t){
  // Use render-scoped caches if available (set by renderKanban), else fall back to global lookups
  const proj=_kanbanRenderProjectCache?_kanbanRenderProjectCache.get(t.project):getProject(t.project);
  const assignee=_kanbanRenderUserCache?_kanbanRenderUserCache.get(t.assignee):getUser(t.assignee);
  const prioColors={critical:'#be185d',high:'#dc2626',medium:'#d97706',low:'#16a34a'};
  const sp=subtaskProgress(t.id);
  const hasSubs=sp.total>0;
  const epic=t.epicId?(_kanbanRenderEpicCache?_kanbanRenderEpicCache.get(t.epicId):getEpic(t.epicId)):null;
  const syncState=SyncState.get(t.id);
  const syncDotHtml=syncState==='synced'?''
    :`<span class="sync-dot sync-dot-${syncState}" id="syncdot-${t.id}"${syncState==='failed'?` title="Sync failed — click to retry" onclick="event.stopPropagation();_retrySingleEntity('${t.id}')"`:` title="Syncing…"`}></span>`;
  return `<div class="task-card kanban-parent-card${hasSubs?' has-subtasks':''}" draggable="true"
    ondragstart="kanbanDragStart(event,'${t.id}')"
    ondragend="kanbanDragEnd(event)"
    onclick="openTaskModal('${t.id}')">
    ${epic?`<div class="kanban-epic-strip" style="background:${epic.color}"></div>`:''}
    <div class="flex items-center gap-2 mb-2">
      <span style="color:${typeColor(t.type)};font-size:12px">${typeIcon(t.type)}</span>
      <span class="text-xs text-slate-400 font-mono">${proj?proj.key:'?'}-${String(t.id||'').slice(-3).toUpperCase()}</span>
      ${epic?`<span class="epic-badge ml-1" style="background:${epic.color}22;color:${epic.color};border:1px solid ${epic.color}44;max-width:70px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px" title="${_escHtml(epic.title)}">◈ ${_escHtml(epic.title)}</span>`:''}
      <div style="margin-left:auto;display:flex;align-items:center;gap:5px">
        ${syncDotHtml}
        ${_drIsCardDelayed(t,'task')?'<span class="delay-warning-dot" title="Delayed — past Due/End Date"></span>':''}
        <button class="sf-share-btn" onclick="event.stopPropagation();shareTaskLink('${t.id}')" title="Copy link" style="background:none;border:none;cursor:pointer;padding:1px;line-height:1;color:#cbd5e1;border-radius:4px;transition:color 0.12s" onmouseenter="this.style.color='#6366f1'" onmouseleave="this.style.color='#cbd5e1'"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></button>
        <div style="width:8px;height:8px;border-radius:50%;background:${prioColors[t.priority]||'#94a3b8'}" title="${t.priority}"></div>
      </div>
    </div>
    <div class="text-sm font-medium text-slate-800 mb-2 leading-snug">${_escHtml(t.title)}</div>
    ${(t.tags||[]).length||t.themeName?`<div class="flex flex-wrap gap-1 mb-2">${(t.tags||[]).slice(0,3).map(tag=>_coloredChip(tag,_tagColorByName(tag),'tag')).join('')}${t.themeName?_coloredChip(t.themeName,t.themeColor||'var(--accent)','tag'):''}</div>`:''}
    <div class="flex items-center justify-between">
      <span class="text-xs font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">${t.points}sp</span>
      <div class="flex items-center gap-1">
        ${assignee?userAvatar(t.assignee,22):`<div class="avatar" style="width:22px;height:22px;background:#f1f5f9;border:1px dashed #cbd5e1"></div>`}
      </div>
    </div>
    ${hasSubs?`<div class="mt-2 pt-2 border-t border-slate-100">
      <div class="flex items-center justify-between mb-1">
        <span class="text-xs text-violet-600 font-semibold">⬡ ${sp.done}/${sp.total} subtasks</span>
        <div style="display:flex;align-items:center;gap:4px">
          <div class="subtask-progress-bar" style="width:52px"><div class="subtask-progress-fill" style="width:${sp.pct}%;background:${sp.pct===100?'#10b981':'#6366f1'}"></div></div>
          <span class="text-xs font-semibold" style="color:${sp.pct===100?'#16a34a':'#6366f1'}">${sp.pct}%</span>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:2px;margin-top:2px">${subtaskAssigneeAvatars(t.id)}</div>
    </div>`:''}
  </div>`;
}

// Subtask card — smaller, visually distinct, draggable, shows link to parent
function kanbanSubtaskCard(sub,parent){
  if(!sub||!parent)return '';
  const sa=_kanbanRenderUserCache?_kanbanRenderUserCache.get(sub.assignee):getUser(sub.assignee);
  const prioColors={critical:'#be185d',high:'#dc2626',medium:'#d97706',low:'#16a34a'};
  const proj=_kanbanRenderProjectCache?_kanbanRenderProjectCache.get(parent.project):getProject(parent.project);
  const epic=parent.epicId?(_kanbanRenderEpicCache?_kanbanRenderEpicCache.get(parent.epicId):getEpic(parent.epicId)):null;
  return `<div class="kanban-subtask-card" draggable="true"
    ondragstart="kanbanSubDragStart(event,'${sub.id}','${parent.id}')"
    ondragend="kanbanSubDragEnd(event)"
    onclick="openSubtaskModal('${parent.id}','${sub.id}')">
    <div class="flex items-center gap-1.5 mb-1.5">
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#a5b4fc" stroke-width="2.5"><path d="M9 20H5a2 2 0 01-2-2V6a2 2 0 012-2h4m4-2h4a2 2 0 012 2v12a2 2 0 01-2 2h-4M9 12h6"/></svg>
      <span class="text-xs text-indigo-400 font-semibold truncate" style="max-width:130px" title="${_escHtml(parent.title||'')}">${proj?proj.key:'?'} · ${parent.title?_escHtml(parent.title):'—'}</span>
      <div style="margin-left:auto;display:flex;align-items:center;gap:4px;flex-shrink:0">
        ${_drIsCardDelayed(sub,'subtask')?'<span class="delay-warning-dot" title="Delayed — past Due/End Date"></span>':''}
        <button class="sf-share-btn" onclick="event.stopPropagation();shareSubtaskLink('${parent.id}','${sub.id}')" title="Copy link" style="background:none;border:none;cursor:pointer;padding:1px;line-height:1;color:#cbd5e1;border-radius:4px;transition:color 0.12s" onmouseenter="this.style.color='#6366f1'" onmouseleave="this.style.color='#cbd5e1'"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></button>
        <div style="width:6px;height:6px;border-radius:50%;background:${prioColors[sub.priority]||'#94a3b8'}" title="${sub.priority||''}"></div>
      </div>
    </div>
    ${epic?`<div class="mb-1.5"><span class="epic-badge ml-1" style="background:${epic.color}22;color:${epic.color};border:1px solid ${epic.color}44;max-width:70px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px" title="${_escHtml(epic.title)}">◈ ${_escHtml(epic.title)}</span></div>`:''}
    <div class="text-xs font-semibold text-slate-700 mb-1.5 leading-snug">${sub.title?_escHtml(sub.title):'—'}</div>
    ${(sub.products||[]).length||(sub.tags||[]).length||sub.themeName?`<div class="flex flex-wrap gap-1 mb-1.5">${(sub.products||[]).map(name=>{const c=_productColorByName(name);return c?_coloredChip(name,c,'tag'):`<span class="tag" style="font-size:10px;background:var(--accent-ghost);color:var(--accent-dark);border:1px solid var(--accent-ring)">${_escHtml(name)}</span>`;}).join('')}${(sub.tags||[]).slice(0,2).map(tag=>_coloredChip(tag,_tagColorByName(tag),'tag')).join('')}${sub.themeName?_coloredChip(sub.themeName,sub.themeColor||'var(--accent)','tag'):''}</div>`:''}
    <div class="flex items-center justify-between">
      <span class="text-xs text-slate-400">${sub.points||0}sp</span>
      ${sa?userAvatar(sub.assignee,18):`<div class="avatar" style="width:18px;height:18px;background:#f1f5f9;border:1px dashed #cbd5e1"></div>`}
    </div>
  </div>`;
}

function kanbanDragStart(e,id){
  const _t=getTask(id);
  // ── Released tasks are fully frozen — cannot be dragged at all ──
  if(_t && _t.status==='released'){
    e.preventDefault();
    showNotif('⚠ '+statusLabel(_t.status)+' tasks cannot be moved via drag-drop','error');
    return;
  }
  // ── RBAC: members can only drag tasks assigned to themselves (as Assignee or QA Assignee) ──
  if(_t && !RBAC.canEditStatus(_t)){
    e.preventDefault();
    showNotif('⚠ You can only move tasks assigned to you','error');
    return;
  }
  kanbanDraggedId=id;kanbanDraggedSubtask=null;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('type','task');setTimeout(()=>e.target.classList.add('dragging'),0);
}
function kanbanDragEnd(e){
  // Clean up on the specific target and also sweep any orphaned dragging classes
  e.target.classList.remove('dragging');
  document.querySelectorAll('.task-card.dragging,.kanban-subtask-card.dragging').forEach(el=>el.classList.remove('dragging'));
  document.querySelectorAll('.kanban-col.drag-over,.kanban-col.drag-over-sub').forEach(el=>el.classList.remove('drag-over','drag-over-sub'));
  kanbanDraggedId=null;
}

function kanbanSubDragStart(e,subId,parentId){
  // ── RBAC: members can only drag subtasks assigned to themselves (as Assignee or QA Assignee) ──
  const _parent=getTask(parentId);
  const _sub=_parent&&(_parent.subtasks||[]).find(s=>s.id===subId);
  if(_sub && !RBAC.canEditStatus(_sub)){
    e.preventDefault();
    showNotif('⚠ You can only move subtasks assigned to you','error');
    return;
  }
  kanbanDraggedSubtask={subId,parentId};
  kanbanDraggedId=null;
  e.dataTransfer.effectAllowed='move';
  e.dataTransfer.setData('type','subtask');
  e.stopPropagation();
  setTimeout(()=>e.target.classList.add('dragging'),0);
}
function kanbanSubDragEnd(e){
  e.target.classList.remove('dragging');
  document.querySelectorAll('.kanban-subtask-card.dragging').forEach(el=>el.classList.remove('dragging'));
  document.querySelectorAll('.kanban-col.drag-over-sub').forEach(el=>el.classList.remove('drag-over-sub'));
  kanbanDraggedSubtask=null;
}

// v27: cache last drag-over column el to avoid repeated querySelector
let _lastDragOverCol = null;
function kanbanDragOver(e,status){
  e.preventDefault();
  const col=e.currentTarget.querySelector('.kanban-col');
  if(col){
    if(_lastDragOverCol && _lastDragOverCol!==col){
      _lastDragOverCol.classList.remove('drag-over','drag-over-sub');
    }
    if(kanbanDraggedSubtask) col.classList.add('drag-over-sub');
    else col.classList.add('drag-over');
    _lastDragOverCol=col;
  }
}
function kanbanDragLeave(e){
  if(!e.currentTarget.contains(e.relatedTarget)){
    const col=e.currentTarget.querySelector('.kanban-col');
    if(col){col.classList.remove('drag-over');col.classList.remove('drag-over-sub');}
    if(_lastDragOverCol===col) _lastDragOverCol=null;
  }
}
function kanbanDrop(e,status){
  e.preventDefault();
  const col=e.currentTarget.querySelector('.kanban-col');
  if(col){col.classList.remove('drag-over');col.classList.remove('drag-over-sub');}
  _lastDragOverCol=null;

  // ── Subtask drop ──
  if(kanbanDraggedSubtask){
    const {subId,parentId}=kanbanDraggedSubtask;
    const parent=getTask(parentId);
    if(!parent){kanbanDraggedSubtask=null;return;}
    const sub=(parent.subtasks||[]).find(s=>s&&s.id===subId);
    // ── RBAC: members can only drag/drop their own subtasks (as Assignee or QA Assignee) ──
    if(sub && !RBAC.canEditStatus(sub)){
      showNotif('⚠ You can only move subtasks assigned to you','error');
      kanbanDraggedSubtask=null;return;
    }
    if(sub&&sub.status!==status){
      // ── Task state transition guard (subtasks use same lock rules) ──
      const stateCheck=canChangeTaskStatus(sub,status);
      if(!stateCheck.ok){showNotif('⚠ '+stateCheck.msg,'error');kanbanDraggedSubtask=null;return;}
      const resolvedSubStatus=resolveRollbackStatus(status);
      const _drPrevSubStatus=sub.status;
      _trackQAReopen(sub, resolvedSubStatus);
      sub.status=resolvedSubStatus;
      _drStampCompletionDate(sub, _drPrevSubStatus, resolvedSubStatus, st=>DONE_STATUSES.includes(st));
      // ── Debounced Firebase write — absorbs rapid drag/drop sequences ──
      DebounceWrite.schedule('tasks', parent);
      SaveManager.save();
      renderKanban();
      showNotif(`Subtask moved to ${statusLabel(sub.status)} ✓`);
    }
    kanbanDraggedSubtask=null;
    return;
  }

  // ── Parent task drop ──
  if(!kanbanDraggedId)return;
  const task=getTask(kanbanDraggedId);
  // ── RBAC: members can only drag/drop their own tasks (as Assignee or QA Assignee) ──
  if(task && !RBAC.canEditStatus(task)){
    showNotif('⚠ You can only move tasks assigned to you','error');
    kanbanDraggedId=null;return;
  }
  if(task&&task.status!==status){
    // ── Task state transition guard (covers ready-for-prod → released and blocks backward moves) ──
    const stateCheck=canChangeTaskStatus(task,status);
    if(!stateCheck.ok){showNotif('⚠ '+stateCheck.msg,'error');kanbanDraggedId=null;return;}
    const resolvedStatus=resolveRollbackStatus(status);
    const check=canMoveToClosedStatus(kanbanDraggedId,resolvedStatus);
    if(!check.ok){showNotif('⚠ '+check.msg,'error');kanbanDraggedId=null;return;}
    const _drPrevKanbanStatus=task.status;
    _trackQAReopen(task, resolvedStatus);
    task.status=resolvedStatus;
    _drStampCompletionDate(task, _drPrevKanbanStatus, resolvedStatus, s=>DONE_STATUSES.includes(s));
    // ── Debounced Firebase write — absorbs rapid drag/drop sequences ──
    DebounceWrite.schedule('tasks', task);
    SaveManager.save();
    renderKanban();
    showNotif(`Moved to ${statusLabel(resolvedStatus)} ✓`);
  }
  kanbanDraggedId=null;
}

