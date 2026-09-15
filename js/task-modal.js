function _sprintOptionsForProject(projectId, selectedSprintId){
  const filtered = state.sprints.filter(s => {
    const st=(s.status||'').toLowerCase();
    if(st==='completed') return false;
    if(projectId && s.project!==projectId) return false;
    return true;
  });
  return `<option value="">Backlog</option>` + filtered.map(s=>`<option value="${s.id}"${s.id===selectedSprintId?' selected':''}>${s.name}</option>`).join('');
}

// Helper: build assignee options filtered to project members.
// For team_members, further restricts to only the logged-in user (self-assign only).
function _assigneeOptionsForProject(projectId, selectedAssigneeId){
  const proj = projectId ? state.projects.find(p=>p.id===projectId) : null;
  const memberIds = proj && Array.isArray(proj.memberIds) && proj.memberIds.length
    ? proj.memberIds
    : null; // null = no restriction
  let eligible = memberIds
    ? state.users.filter(u => memberIds.includes(u.id))
    : state.users;
  // ── RBAC: team members can only assign to themselves ──
  const selfId = RBAC.memberSelfOnlyId();
  if(selfId){
    eligible = eligible.filter(u => u.id === selfId);
    // Force selected to self
    selectedAssigneeId = selfId;
  }
  // Sort alphabetically (A→Z) by name for display
  eligible = eligible.slice().sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  return `<option value="">Unassigned</option>` +
    eligible.map(u=>`<option value="${u.id}"${u.id===selectedAssigneeId?' selected':''}>${u.name}</option>`).join('');
}

// QA Assignee dropdown — same project-membership filtering as _assigneeOptionsForProject,
// but blank option reads "Not assigned" (QA slot is always optional).
// Note: unlike the regular Assignee dropdown, this is NOT restricted to "self only" for
// team members — a task/subtask Assignee needs to be able to pick any eligible project
// member as QA Assignee (usually someone other than themselves). Whether the current user
// is allowed to touch this field at all is governed separately by RBAC.canEditQaAssignee(),
// which disables the <select> for anyone who isn't Admin/PM/the item's Assignee.
function _qaAssigneeOptionsForProject(projectId, selectedQaId){
  const proj = projectId ? state.projects.find(p=>p.id===projectId) : null;
  const memberIds = proj && Array.isArray(proj.memberIds) && proj.memberIds.length
    ? proj.memberIds
    : null;
  let eligible = memberIds
    ? state.users.filter(u => memberIds.includes(u.id))
    : state.users;
  // Sort alphabetically (A→Z) by name for display
  eligible = eligible.slice().sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  return `<option value="">Not assigned</option>` +
    eligible.map(u=>`<option value="${u.id}"${u.id===selectedQaId?' selected':''}>${u.name}</option>`).join('');
}

// Inline validation error helper
function _ctFieldError(id, msg){
  const el = document.getElementById(id);
  if(!el) return;
  el.style.borderColor = 'var(--danger)';
  el.style.boxShadow = '0 0 0 3px rgba(239,68,68,0.12)';
  let errEl = document.getElementById(id+'-err');
  if(!errEl){
    errEl = document.createElement('div');
    errEl.id = id+'-err';
    errEl.style.cssText = 'color:var(--danger);font-size:11px;font-weight:600;margin-top:3px';
    el.parentNode.appendChild(errEl);
  }
  errEl.textContent = msg;
  el.focus();
}
function _ctClearErrors(){
  document.querySelectorAll('#modal-box [id$="-err"]').forEach(e=>e.remove());
  document.querySelectorAll('#modal-box input,#modal-box select,#modal-box textarea').forEach(el=>{
    el.style.borderColor=''; el.style.boxShadow='';
  });
}

function ctOnProjectChange(projectId){
  const sprintSel = document.getElementById('ct-sprint');
  if(!sprintSel) return;
  const currentSprint = sprintSel.value;
  sprintSel.innerHTML = _sprintOptionsForProject(projectId, currentSprint);
  // If previously selected sprint no longer valid, reset to Backlog
  const stillValid = projectId && state.sprints.some(s=>s.id===currentSprint&&s.project===projectId);
  if(!stillValid) sprintSel.value = '';
  // Refresh assignee dropdown to project members only; reset if current selection not a member
  const assigneeSel = document.getElementById('ct-assignee');
  if(assigneeSel){
    const prevAssignee = assigneeSel.value;
    assigneeSel.innerHTML = _assigneeOptionsForProject(projectId, prevAssignee);
    // If previously selected user is not in the new project's members, reset to Unassigned
    const proj = projectId ? state.projects.find(p=>p.id===projectId) : null;
    const memberIds = proj && Array.isArray(proj.memberIds) && proj.memberIds.length ? proj.memberIds : null;
    if(prevAssignee && memberIds && !memberIds.includes(prevAssignee)){
      assigneeSel.value = '';
    }
  }
  // Also refresh epic filter to project's epics
  const epicSel = document.getElementById('ct-epic');
  if(epicSel){
    const prevEpic = epicSel.value;
    const projectEpics = (state.epics||[]).filter(e=>{
      if((e.status||'').toLowerCase()!=='active') return false;
      if(!projectId) return true;
      const epicProjects=e.projectIds||(e.projectId?[e.projectId]:[]);
      return epicProjects.includes(projectId);
    });
    epicSel.innerHTML = `<option value="">No Epic</option>` + projectEpics.map(e=>`<option value="${e.id}"${e.id===prevEpic?' selected':''}>◈ ${e.title}</option>`).join('');
  }
  ctOnSprintChange(sprintSel.value);
  // Refresh Products + Tags multi-selects to match new project
  if(_msState['ct-products']){
    const newProducts = (state.products||[]).filter(p=>(p.projectIds||[]).includes(projectId)).map(p=>({id:p.id,name:p.name,color:p.color||''}));
    _msRefreshItems('ct-products', newProducts, true);
  }
  if(_msState['ct-tags']){
    const newTags = (state.tags||[]).filter(t=>(t.projectIds||[]).includes(projectId)).map(t=>({id:t.id,name:t.name,color:t.color||''}));
    _msRefreshItems('ct-tags', newTags, true);
  }
  if(_msState['ct-theme']){
    const newThemes = (state.themes||[]).filter(th=>(th.projectIds||[]).includes(projectId)).map(th=>({id:th.id,name:th.name,color:th.color||''}));
    _msRefreshItems('ct-theme', newThemes, true);
  }
}

// Called when sprint changes — toggle mandatory asterisks on assignee + dates
function ctOnSprintChange(sprintVal){
  const isBacklog = !sprintVal;
  const assigneeLabel = document.getElementById('ct-assignee-label');
  const startLabel = document.getElementById('ct-start-label');
  const endLabel = document.getElementById('ct-end-label');
  if(assigneeLabel) assigneeLabel.textContent = isBacklog ? 'Assignee' : 'Assignee *';
  if(startLabel) startLabel.textContent = isBacklog ? 'Start Date' : 'Start Date *';
  if(endLabel) endLabel.textContent = isBacklog ? 'End Date' : 'End Date *';
}

// Called when Start Date changes — enforce End Date minimum (Create Task)
function ctOnStartDateChange(startVal){
  const endEl = document.getElementById('ct-end');
  if(!endEl) return;
  endEl.min = startVal || '';
  if(startVal && endEl.value && endEl.value < startVal){
    endEl.value = '';
  }
}

function etOnProjectChange(projectId){
  const sprintSel = document.getElementById('et-sprint');
  if(!sprintSel) return;
  const currentSprint = sprintSel.value;
  sprintSel.innerHTML = _sprintOptionsForProject(projectId, currentSprint);
  const stillValid = projectId && state.sprints.some(s=>s.id===currentSprint&&s.project===projectId);
  if(!stillValid) sprintSel.value = '';
  // Refresh assignee dropdown to project members only; reset if current selection not a member
  const assigneeSel = document.getElementById('et-assignee');
  if(assigneeSel){
    const prevAssignee = assigneeSel.value;
    assigneeSel.innerHTML = _assigneeOptionsForProject(projectId, prevAssignee);
    const proj = projectId ? state.projects.find(p=>p.id===projectId) : null;
    const memberIds = proj && Array.isArray(proj.memberIds) && proj.memberIds.length ? proj.memberIds : null;
    if(prevAssignee && memberIds && !memberIds.includes(prevAssignee)){
      assigneeSel.value = '';
    }
  }
  const epicSel = document.getElementById('et-epic');
  if(epicSel){
    const prevEpic = epicSel.value;
    const projectEpics = (state.epics||[]).filter(e=>{
      if((e.status||'').toLowerCase()!=='active') return false;
      if(!projectId) return true;
      const epicProjects=e.projectIds||(e.projectId?[e.projectId]:[]);
      return epicProjects.includes(projectId);
    });
    epicSel.innerHTML = `<option value="">No Epic</option>` + projectEpics.map(e=>`<option value="${e.id}"${e.id===prevEpic?' selected':''}>◈ ${e.title}</option>`).join('');
  }
  etOnSprintChange(sprintSel.value);
  // Refresh Products + Tags multi-selects to match new project
  if(_msState['et-products']){
    const newProducts = (state.products||[]).filter(p=>(p.projectIds||[]).includes(projectId)).map(p=>({id:p.id,name:p.name,color:p.color||''}));
    _msRefreshItems('et-products', newProducts, true);
  }
  if(_msState['et-tags']){
    const newTags = (state.tags||[]).filter(t=>(t.projectIds||[]).includes(projectId)).map(t=>({id:t.id,name:t.name,color:t.color||''}));
    _msRefreshItems('et-tags', newTags, true);
  }
  if(_msState['et-theme']){
    const newThemes = (state.themes||[]).filter(th=>(th.projectIds||[]).includes(projectId)).map(th=>({id:th.id,name:th.name,color:th.color||''}));
    _msRefreshItems('et-theme', newThemes, true);
  }
}

// Edit task modal — sprint change handler
function etOnSprintChange(sprintVal){
  const isBacklog = !sprintVal;
  const assigneeLabel = document.getElementById('et-assignee-label');
  const startLabel = document.getElementById('et-start-label');
  const endLabel = document.getElementById('et-end-label');
  if(assigneeLabel) assigneeLabel.textContent = isBacklog ? 'Assignee' : 'Assignee *';
  if(startLabel) startLabel.textContent = isBacklog ? 'Start Date' : 'Start Date *';
  if(endLabel) endLabel.textContent = isBacklog ? 'End Date' : 'End Date *';
}

// Called when status changes in Edit Task — show/hide QA Assignee row
function etOnStatusChange(statusVal){
  const qaStatuses=['in-qa','qa-in-progress'];
  const row=document.getElementById('et-qa-assignee-row');
  if(!row) return;
  const isQa=qaStatuses.includes(statusVal);
  row.style.display=isQa?'':'none';
  // When revealing, repopulate with project-scoped options (project is frozen in edit mode)
  if(isQa){
    const sel=document.getElementById('et-qa-assignee');
    if(sel){
      const projSel=document.getElementById('et-project');
      const projectId=projSel?projSel.value:'';
      const currentQaId=sel.value||'';
      sel.innerHTML=_qaAssigneeOptionsForProject(projectId, currentQaId);
    }
  }
}

// Called when Start Date changes — enforce End Date minimum (Edit Task)
function etOnStartDateChange(startVal){
  const endEl = document.getElementById('et-end');
  if(!endEl) return;
  endEl.min = startVal || '';
  if(startVal && endEl.value && endEl.value < startVal){
    endEl.value = '';
  }
}

// Called when Start Date changes — enforce End Date minimum (Create Subtask)
function cstOnStartDateChange(startVal){
  const endEl = document.getElementById('cst-endDate');
  if(!endEl) return;
  endEl.min = startVal || '';
  if(startVal && endEl.value && endEl.value < startVal){
    endEl.value = '';
  }
}

// Called when status changes in Edit Subtask — show/hide QA Assignee row
function estOnStatusChange(statusVal){
  const qaStatuses=['in-qa','qa-in-progress'];
  const row=document.getElementById('est-qa-assignee-row');
  if(!row) return;
  const isQa=qaStatuses.includes(statusVal);
  row.style.display=isQa?'':'none';
  // When revealing, repopulate with project-scoped options
  // Project is stored as data-project on the row (set at render time)
  if(isQa){
    const sel=document.getElementById('est-qa-assignee');
    if(sel){
      const projectId=row.dataset.project||'';
      const currentQaId=sel.value||'';
      sel.innerHTML=_qaAssigneeOptionsForProject(projectId, currentQaId);
    }
  }
}

// Called when Start Date changes — enforce End Date minimum (Edit Subtask)
function estOnStartDateChange(startVal){
  const endEl = document.getElementById('est-endDate');
  if(!endEl) return;
  endEl.min = startVal || '';
  if(startVal && endEl.value && endEl.value < startVal){
    endEl.value = '';
  }
}

