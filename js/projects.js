function showProjectSwitcher(){
  // RBAC FIX: only show projects the current user has access to
  const _switcherProjects=RBAC.getVisibleProjects();
  if(_switcherProjects.length===0){showNotif('No projects yet','info');return;}
  let html=`<div class="p-4"><div class="font-semibold text-slate-900 mb-3">Switch Project</div><div class="space-y-2">`;
  html+=_switcherProjects.map(p=>{
    const tasks=state.tasks.filter(t=>t.project===p.id).length;
    return `<div class="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-50 cursor-pointer border border-transparent hover:border-slate-200 transition-all" onclick="selectProject('${p.id}');closeModal()">
      <div style="width:36px;height:36px;background:${p.color};border-radius:8px;display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:12px;flex-shrink:0">${_esc(p.key)}</div>
      <div class="flex-1 min-w-0">
        <div class="font-medium text-slate-800 text-sm">${_esc(p.name)}</div>
        <div class="text-xs text-slate-500">${tasks} tasks</div>
      </div>
      <span class="badge badge-${p.status}">${p.status}</span>
    </div>`;
  }).join('');
  html+=`</div><div class="mt-3 pt-3 border-t border-slate-100">
    <button class="btn btn-secondary w-full text-sm" onclick="closeModal();openCreateProjectModal()">+ New Project</button>
  </div></div>`;
  openModal(html);
}






// ─── PROJECTS ─────────────────────────────────────────────────────
function renderProjects(){
  const visibleProjects=getVisibleProjects();
  const grid=document.getElementById('projects-grid');
  if(!grid)return;
  if(!visibleProjects.length){
    grid.innerHTML=`<div class="col-span-3 empty-state">
      <div class="empty-state-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg></div>
      <div class="text-sm mb-3">No projects yet</div>
      <button class="btn btn-primary text-xs" onclick="openCreateProjectModal()">Create first project</button>
    </div>`;
    return;
  }
  grid.innerHTML=visibleProjects.map(p=>{
    const tasks=state.tasks.filter(t=>t.project===p.id);
    const allSubs=(tasks).flatMap(t=>t.subtasks||[]);
    const totalWithSubs=tasks.length+allSubs.length;
    const done=tasks.filter(t=>DONE_STATUSES.includes(t.status)).length+allSubs.filter(s=>DONE_STATUSES.includes(s.status)).length;
    const pct=totalWithSubs?Math.round((done/totalWithSubs)*100):0;
    const lead=getUser(p.lead);
    const activeSprints=state.sprints.filter(s=>s.project===p.id&&s.status==='active').length;
    return `<div class="card hover:shadow-md transition-shadow">
      <div class="flex items-start justify-between mb-4">
        <div class="flex items-center gap-3">
          <div style="width:40px;height:40px;background:${p.color};border-radius:10px;display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:13px;flex-shrink:0">${_esc(p.key)}</div>
          <div class="min-w-0">
            <div class="font-semibold text-slate-900">${_esc(p.name)}</div>
            <div class="text-xs text-slate-500">${_esc(p.key)}</div>
          </div>
        </div>
        <span class="badge badge-${p.status}">${p.status}</span>
      </div>
      <p class="text-sm text-slate-600 mb-4 leading-relaxed">${_esc(p.description||'No description.')}</p>
      <div class="flex gap-2 mb-3 text-center">
        <div class="flex-1 rounded-lg py-2" style="background:rgba(91,95,199,0.05);border:1px solid rgba(91,95,199,0.07)">
          <div class="text-lg font-bold text-slate-900">${totalWithSubs}</div>
          <div class="text-xs text-slate-500">Tasks</div>
        </div>
        <div class="flex-1 rounded-lg py-2" style="background:rgba(91,95,199,0.05);border:1px solid rgba(91,95,199,0.07)">
          <div class="text-lg font-bold text-slate-900">${activeSprints}</div>
          <div class="text-xs text-slate-500">Sprints</div>
        </div>
        <div class="flex-1 rounded-lg py-2" style="background:rgba(91,95,199,0.05);border:1px solid rgba(91,95,199,0.07)">
          <div class="text-lg font-bold text-slate-900">${pct}%</div>
          <div class="text-xs text-slate-500">Done</div>
        </div>
      </div>
      <div class="progress-bar mb-3">
        <div class="progress-fill" style="width:${pct}%;background:${p.color}"></div>
      </div>
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          ${lead?`${userAvatar(lead.id,24)}<span class="text-xs text-slate-600">${_esc(lead.name)}</span>`:'<span class="text-xs text-slate-400">No lead</span>'}
        </div>
        <div class="flex items-center gap-2">
          ${RBAC.isAdmin()||RBAC.canManageProject(p.id)?`<button class="btn btn-ghost" style="height:28px;padding:0 9px;font-size:11.5px;color:var(--text-tertiary)" onclick="event.stopPropagation();openEditProjectModal('${p.id}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Edit</button>`:''}
          ${RBAC.isAdmin()?`<button class="btn btn-danger" style="height:28px;padding:0 9px;font-size:11.5px" onclick="event.stopPropagation();deleteProject('${p.id}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>Del</button>`:''}
        </div>
      </div>
    </div>`;
  }).join('');

  if(RBAC.isAdmin()){
    grid.innerHTML+=`<div class="card flex flex-col items-center justify-center text-center cursor-pointer hover:shadow-md transition-shadow border-dashed" style="min-height:240px;border-color:#c7d2fe;border-width:2px;background:#fafafe" onclick="openCreateProjectModal()">
      <div style="width:48px;height:48px;background:#ede9fe;border-radius:12px;display:flex;align-items:center;justify-content:center;margin-bottom:12px">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5b5fc7" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </div>
      <div class="font-semibold text-slate-700 mb-1">New Project</div>
      <div class="text-sm text-slate-500">Start a new initiative</div>
    </div>`;
  }
}


function selectProject(id){
  const p=getProject(id);
  if(!p)return;
  const _nd=document.getElementById('proj-name-display');if(_nd)_nd.textContent=p.name;
  const _dd=document.getElementById('proj-dot');if(_dd)_dd.style.background=p.color;
  showNotif(`Switched to ${p.name}`);
}

// ─── CREATE PROJECT ───────────────────────────────────────────────
function openCreateProjectModal(){
  if(!RBAC.isAdmin()){ showNotif('⚠ Admin access required','error'); return; }
  openModal(`
    <div class="p-6">
      <div class="flex items-center justify-between mb-5">
        <h2 class="text-lg font-bold text-slate-900">Create New Project</h2>
        <button onclick="closeModal()" style="color:var(--text-muted);cursor:pointer;transition:color 0.14s" onmouseenter="this.style.color='var(--text-primary)'" onmouseleave="this.style.color='var(--text-muted)'"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
      <div class="space-y-4">
        <div>
          <label>Project Name *</label>
          <input type="text" id="cp-name" placeholder="e.g. Mobile App v2"/>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label>Project Key *</label>
            <input type="text" id="cp-key" placeholder="e.g. MAP" maxlength="5" style="font-family:'DM Mono',monospace;text-transform:uppercase"/>
          </div>
          <div>
            <label>Project Color</label>
            <input type="color" id="cp-color" value="#6366f1" style="height:38px;padding:2px 4px;cursor:pointer"/>
          </div>
        </div>
        <div>
          <label>Lead</label>
          <select id="cp-lead">
            <option value="">No lead</option>
            ${state.users.map(u=>`<option value="${u.id}">${u.name}</option>`).join('')}
          </select>
        </div>
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <label style="margin-bottom:0">Members</label>
            <span id="cp-member-count" style="font-size:11px;font-weight:600;color:var(--accent);background:rgba(91,95,199,0.08);border:1px solid rgba(91,95,199,0.14);border-radius:20px;padding:2px 9px">None selected</span>
          </div>
          <div style="border:1px solid rgba(0,0,0,0.09);border-radius:10px;overflow:hidden;background:#fff">
            ${state.users.slice().sort((a,b)=>(a.name||'').localeCompare(b.name||'')).map((u,i,_sortedCpUsers)=>{
              const roleLabel = u.role==='admin'?'Admin':u.role==='senior_manager'?'Senior Manager':u.role==='program_manager'?'Prog. Manager':u.role==='viewer'?'Viewer':'Team Member';
              const roleBadgeClass = u.role==='admin'?'admin':u.role==='senior_manager'?'senior_manager':u.role==='program_manager'?'program_manager':u.role==='viewer'?'viewer':'team_member';
              return `<label onclick="(function(el){const cb=el.querySelector('.cp-member-check');cb.checked=!cb.checked;const isChecked=cb.checked;el.style.background=isChecked?'rgba(91,95,199,0.06)':'#fff';el.querySelector('.cp-chk-box').style.background=isChecked?'var(--accent)':'transparent';el.querySelector('.cp-chk-box').style.borderColor=isChecked?'var(--accent)':'rgba(0,0,0,0.2)';el.querySelector('.cp-chk-icon').style.opacity=isChecked?'1':'0';const total=document.querySelectorAll('.cp-member-check:checked').length;const badge=document.getElementById('cp-member-count');badge.textContent=total===0?'None selected':total+' selected';})(this.closest('label'))" style="display:flex;align-items:center;gap:12px;padding:10px 14px;cursor:pointer;border-bottom:${i<_sortedCpUsers.length-1?'1px solid rgba(0,0,0,0.05)':'none'};background:#fff;transition:background 0.12s;user-select:none" onmouseenter="if(!this.querySelector('.cp-member-check').checked)this.style.background='rgba(0,0,0,0.02)'" onmouseleave="if(!this.querySelector('.cp-member-check').checked)this.style.background='#fff'">
                <input type="checkbox" value="${u.id}" class="cp-member-check" style="position:absolute;opacity:0;pointer-events:none"/>
                <div class="cp-chk-box" style="width:18px;height:18px;border-radius:5px;border:1.5px solid rgba(0,0,0,0.2);background:transparent;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background 0.12s,border-color 0.12s">
                  <svg class="cp-chk-icon" width="10" height="10" viewBox="0 0 10 10" fill="none" style="opacity:0;transition:opacity 0.12s"><polyline points="1.5,5 4,7.5 8.5,2.5" stroke="white" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </div>
                ${userAvatar(u.id,28)}
                <div style="flex:1;min-width:0">
                  <div style="font-size:13px;font-weight:500;color:var(--text-primary);line-height:1.3">${_esc(u.name)}</div>
                  ${u.email?`<div style="font-size:11px;color:var(--text-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_esc(u.email)}</div>`:''}
                </div>
                <span class="badge badge-${roleBadgeClass}" style="flex-shrink:0">${roleLabel}</span>
              </label>`;
            }).join('')}
          </div>
        </div>
        <div>
          <label>Description</label>
          <textarea id="cp-desc" rows="2" placeholder="Brief description..."></textarea>
        </div>
      </div>
      <div class="flex justify-end gap-3 mt-6 pt-4" style="border-top:1px solid rgba(0,0,0,0.05)">
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="createProject()">Create Project</button>
      </div>
    </div>
  `);
}

function createProject(){
  if(!RBAC.isAdmin()){ showNotif('⚠ Admin access required','error'); return; }
  const name=document.getElementById('cp-name').value.trim();
  const key=document.getElementById('cp-key').value.trim().toUpperCase();
  if(!name||!key){showNotif('⚠ Name and key required','error');return;}
  const memberIds=Array.from(document.querySelectorAll('.cp-member-check:checked')).map(el=>el.value);
  const proj={
    id:ppid(),
    name,key,
    color:document.getElementById('cp-color').value,
    lead:document.getElementById('cp-lead').value||null,
    status:'active',
    description:document.getElementById('cp-desc').value.trim(),
    memberIds
  };
  state.projects.push(proj);
  invalidateStateMaps();
  _invalidateSearchCache();
  // ── Firebase: persist new project; queue if unavailable ──
  SyncState.markPending(proj.id);
  if(FirebaseDB.isReady()){
    FirebaseDB.saveEntity('projects', proj).then(ok=>{
      if(ok){ SyncState.markSynced(proj.id); }
      else   { SyncState.markFailed(proj.id); PendingSyncQueue.saveEntity('projects', proj); }
    }).catch(()=>{ SyncState.markFailed(proj.id); PendingSyncQueue.saveEntity('projects', proj); });
  } else {
    PendingSyncQueue.saveEntity('projects', proj);
  }
  SaveManager.save();
  closeModal();
  refreshAll();
  updateSidebarProject();
  showNotif(`${name} created ✓`);
}

// ─── EDIT / DELETE PROJECT ────────────────────────────────────────

function _epToggleMember(el){
  const cb = el.querySelector('.ep-member-check');
  if(!cb || cb.disabled) return;
  cb.checked = !cb.checked;
  const on = cb.checked;
  el.style.background = on ? 'rgba(91,95,199,0.06)' : '#fff';
  const box = el.querySelector('.ep-chk-box');
  if(box){ box.style.background = on ? 'var(--accent)' : 'transparent'; box.style.borderColor = on ? 'var(--accent)' : 'rgba(0,0,0,0.2)'; }
  const icon = el.querySelector('.ep-chk-icon');
  if(icon) icon.style.opacity = on ? '1' : '0';
  const total = document.querySelectorAll('.ep-member-check:checked').length;
  const badge = document.getElementById('ep-member-count');
  if(badge) badge.textContent = total === 0 ? 'None selected' : total + ' selected';
}

function openEditProjectModal(projId){
  if(!RBAC.isAdmin() && !RBAC.canManageProject(projId)){ showNotif('⚠ Permission denied','error'); return; }
  const p = state.projects.find(x=>x.id===projId);
  if(!p){ showNotif('Project not found','error'); return; }
  const canDelete = RBAC.isAdmin();
  // ── Field-freeze: completed project is fully locked ──
  const isCompleted = isProjectCompleted(p);
  const _pdis = (cond) => cond ? 'disabled' : '';
  openModal(`
    <div class="p-6">
      <div class="flex items-center justify-between mb-5">
        <h2 class="text-lg font-bold text-slate-900">Edit Project${isCompleted?' <span style="font-size:11px;font-weight:500;color:#dc2626;background:#fef2f2;border:1px solid #fecaca;padding:2px 7px;border-radius:4px;vertical-align:middle">Completed — Locked</span>':''}</h2>
        <button onclick="closeModal()" style="color:var(--text-muted);cursor:pointer;transition:color 0.14s" onmouseenter="this.style.color='var(--text-primary)'" onmouseleave="this.style.color='var(--text-muted)'"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
      <input type="hidden" id="ep-id" value="${p.id}"/>
      <div class="space-y-4">
        <div>
          <label>Project Name *</label>
          <input type="text" id="ep-name" value="${_esc(p.name)}" ${_pdis(isCompleted)}/>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label>Project Key *</label>
            <input type="text" id="ep-key" value="${_esc(p.key)}" maxlength="5" style="font-family:'DM Mono',monospace;text-transform:uppercase" ${_pdis(isCompleted)}/>
          </div>
          <div>
            <label>Project Color</label>
            <input type="color" id="ep-color" value="${p.color||'#6366f1'}" style="height:38px;padding:2px 4px;cursor:pointer" ${_pdis(isCompleted)}/>
          </div>
        </div>
        <div>
          <label>Status</label>
          <select id="ep-status" ${_pdis(isCompleted)}>
            ${['active','planned','on-hold','completed'].map(s=>`<option value="${s}"${p.status===s?' selected':''}>${s.charAt(0).toUpperCase()+s.slice(1)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label>Lead</label>
          <select id="ep-lead" ${_pdis(isCompleted)}>
            <option value="">No lead</option>
            ${state.users.map(u=>`<option value="${u.id}"${p.lead===u.id?' selected':''}>${u.name}</option>`).join('')}
          </select>
        </div>
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <label style="margin-bottom:0">Members</label>
            <span id="ep-member-count" style="font-size:11px;font-weight:600;color:var(--accent);background:rgba(91,95,199,0.08);border:1px solid rgba(91,95,199,0.14);border-radius:20px;padding:2px 9px">None selected</span>
          </div>
          <div style="border:1px solid rgba(0,0,0,0.09);border-radius:10px;overflow:hidden;background:#fff${isCompleted?';opacity:0.65;pointer-events:none':''}">
            ${state.users.slice().sort((a,b)=>(a.name||'').localeCompare(b.name||'')).map((u,i,_sortedEpUsers)=>{
              const checked=(p.memberIds||[]).includes(u.id);
              const roleLabel=u.role==='admin'?'Admin':u.role==='senior_manager'?'Senior Manager':u.role==='program_manager'?'Prog. Manager':u.role==='viewer'?'Viewer':'Team Member';
              const roleBadgeClass=u.role==='admin'?'admin':u.role==='senior_manager'?'senior_manager':u.role==='program_manager'?'program_manager':u.role==='viewer'?'viewer':'team_member';
              return `<label data-ep-member="${u.id}" onclick="_epToggleMember(this)" style="display:flex;align-items:center;gap:12px;padding:10px 14px;cursor:${isCompleted?'default':'pointer'};border-bottom:${i<_sortedEpUsers.length-1?'1px solid rgba(0,0,0,0.05)':'none'};background:${checked?'rgba(91,95,199,0.06)':'#fff'};transition:background 0.12s;user-select:none">
                <input type="checkbox" value="${u.id}" class="ep-member-check" ${checked?'checked':''} style="position:absolute;opacity:0;pointer-events:none" ${_pdis(isCompleted)}/>
                <div class="ep-chk-box" style="width:18px;height:18px;border-radius:5px;border:1.5px solid ${checked?'var(--accent)':'rgba(0,0,0,0.2)'};background:${checked?'var(--accent)':'transparent'};display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background 0.12s,border-color 0.12s">
                  <svg class="ep-chk-icon" width="10" height="10" viewBox="0 0 10 10" fill="none" style="opacity:${checked?'1':'0'};transition:opacity 0.12s"><polyline points="1.5,5 4,7.5 8.5,2.5" stroke="white" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </div>
                ${userAvatar(u.id,28)}
                <div style="flex:1;min-width:0">
                  <div style="font-size:13px;font-weight:500;color:var(--text-primary);line-height:1.3">${_esc(u.name)}</div>
                  ${u.email?`<div style="font-size:11px;color:var(--text-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_esc(u.email)}</div>`:''}
                </div>
                <span class="badge badge-${roleBadgeClass}" style="flex-shrink:0">${roleLabel}</span>
              </label>`;
            }).join('')}
          </div>
        </div>
        <div>
          <label>Description</label>
          <textarea id="ep-desc" rows="2" placeholder="Brief description..." ${_pdis(isCompleted)}>${_esc(p.description||'')}</textarea>
        </div>
      </div>
      <div class="flex justify-between gap-3 mt-6 pt-4" style="border-top:1px solid rgba(0,0,0,0.05)">
        <div>
          ${canDelete?`<button class="btn btn-danger" onclick="closeModal();deleteProject('${p.id}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>Delete Project</button>`:''}
        </div>
        <div class="flex gap-3">
          <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          ${isCompleted?'':`<button class="btn btn-primary" onclick="saveProjectEdit()">Save Changes</button>`}
        </div>
      </div>
    </div>
  `);
  // sync count badge on open
  const checked=(p.memberIds||[]).length;
  const badge=document.getElementById('ep-member-count');
  if(badge) badge.textContent=checked===0?'None selected':checked+' selected';
}

function saveProjectEdit(){
  const id=document.getElementById('ep-id').value;
  const p=state.projects.find(x=>x.id===id);
  if(!p){showNotif('Project not found','error');return;}
  if(!RBAC.isAdmin()&&!RBAC.canManageProject(id)){showNotif('⚠ Permission denied','error');return;}
  // ── Completed project is fully locked ──
  if(isProjectCompleted(p)){showNotif('⚠ Completed projects are locked and cannot be edited.','error');return;}
  const name=document.getElementById('ep-name').value.trim();
  const key=document.getElementById('ep-key').value.trim().toUpperCase();
  if(!name||!key){showNotif('⚠ Name and key required','error');return;}
  p.name=name;
  p.key=key;
  p.color=document.getElementById('ep-color').value;
  p.lead=document.getElementById('ep-lead').value||null;
  p.status=document.getElementById('ep-status').value;
  p.description=document.getElementById('ep-desc').value.trim();
  p.memberIds=Array.from(document.querySelectorAll('.ep-member-check:checked')).map(el=>el.value);
  invalidateStateMaps();
  _invalidateSearchCache();
  SyncState.markPending(p.id);
  if(FirebaseDB.isReady()){
    FirebaseDB.saveEntity('projects',p).then(ok=>{
      if(ok){SyncState.markSynced(p.id);}
      else{SyncState.markFailed(p.id);PendingSyncQueue.saveEntity('projects',p);}
    }).catch(()=>{SyncState.markFailed(p.id);PendingSyncQueue.saveEntity('projects',p);});
  } else {
    PendingSyncQueue.saveEntity('projects',p);
  }
  SaveManager.save();
  closeModal();
  refreshAll();
  updateSidebarProject();
  showNotif(`${name} updated ✓`);
}

function deleteProject(projId){
  if(!RBAC.isAdmin()){showNotif('⚠ Admin access required','error');return;}
  const p=state.projects.find(x=>x.id===projId);
  if(!p){showNotif('Project not found','error');return;}
  if(!confirm(`Delete "${p.name}"? This cannot be undone.`))return;
  state.projects=state.projects.filter(x=>x.id!==projId);
  invalidateStateMaps();
  _invalidateSearchCache();
  if(FirebaseDB.isReady()){
    FirebaseDB.deleteEntity('projects',projId).catch(()=>{});
  }
  SaveManager.save();
  refreshAll();
  updateSidebarProject();
  showNotif(`"${p.name}" deleted`);
}



// ── Project Access Card Toggle (Create/Edit Member modals) ────────
// Toggles hidden checkbox + updates visual card state.
// prefix: 'cm' (create) | 'em' (edit)
function toggleProjCard(card, prefix){
  const cb  = card.querySelector('input[type="checkbox"]');
  if(!cb) return;
  cb.checked = !cb.checked;
  _applyProjCardState(card, cb.checked);
  // Update "X selected" count badge
  const total = document.querySelectorAll('.'+prefix+'-proj-check:checked').length;
  const badge = document.getElementById(prefix+'-proj-count');
  if(badge) badge.textContent = total === 0 ? 'None' : total + ' selected';
}

// Apply or remove the selected visual state on a project card.
function _applyProjCardState(card, selected){
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

// Initialise project cards after modal renders (call once on open).
function initProjCards(prefix){
  document.querySelectorAll('.psc-card[data-prefix="'+prefix+'"]').forEach(card=>{
    const cb = card.querySelector('input[type="checkbox"]');
    if(cb) _applyProjCardState(card, cb.checked);
    // Hover listeners
    card.addEventListener('mouseenter', function(){
      if(this.querySelector('input[type="checkbox"]').checked) return;
      this.style.borderColor = 'rgba(0,0,0,0.14)';
      this.style.background  = 'rgba(255,255,255,0.98)';
      this.style.boxShadow   = '0 2px 8px rgba(0,0,0,0.06)';
    });
    card.addEventListener('mouseleave', function(){
      const checked = this.querySelector('input[type="checkbox"]').checked;
      _applyProjCardState(this, checked);
    });
  });
  // Sync count badge
  const total = document.querySelectorAll('.'+prefix+'-proj-check:checked').length;
  const badge = document.getElementById(prefix+'-proj-count');
  if(badge) badge.textContent = total === 0 ? 'None' : total + ' selected';
}

