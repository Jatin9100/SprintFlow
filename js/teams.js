// ─── TEAMS ────────────────────────────────────────────────────────
let _teamsViewMode = 'tiles'; // 'tiles' | 'list'
function setTeamsView(mode){
  _teamsViewMode = (mode === 'list') ? 'list' : 'tiles';
  const tilesBtn = document.getElementById('teams-view-tiles-btn');
  const listBtn  = document.getElementById('teams-view-list-btn');
  if(tilesBtn) tilesBtn.classList.toggle('active', _teamsViewMode === 'tiles');
  if(listBtn)  listBtn.classList.toggle('active', _teamsViewMode === 'list');
  renderTeams();
}

function renderTeams(){
  const grid=document.getElementById('teams-grid');
  // RBAC: hide the Create Member button for non-admins
  const createMemberBtn=document.querySelector('[onclick="openCreateMemberModal()"]');
  if(createMemberBtn) createMemberBtn.style.display=RBAC.isAdmin()?'':'none';
  // subtitle set below after RBAC filtering
  // RBAC: PM sees only users within their mapped projects
  const visibleProjIds = RBAC.isAdmin() ? null
    : new Set(RBAC.getVisibleProjects().map(p=>p.id));
  const visibleUsers = RBAC.isAdmin()
    ? state.users
    : state.users.filter(u =>
        state.projects.some(p =>
          visibleProjIds.has(p.id) &&
          Array.isArray(p.memberIds) && p.memberIds.includes(u.id)
        ) || u.id === (state.currentUser||{}).id
      );
  // ── Filter by Project ──
  const projFilterEl=document.getElementById('teams-project-filter');
  if(projFilterEl){
    const prevProjFilter=projFilterEl.value||'all';
    const _teamsFilterProjects=RBAC.getVisibleProjects();
    projFilterEl.innerHTML=`<option value="all">All Projects</option>`+_teamsFilterProjects.map(p=>`<option value="${p.id}"${p.id===prevProjFilter?' selected':''}>${_escHtml(p.name)}</option>`).join('');
    if(prevProjFilter!=='all' && !_teamsFilterProjects.find(p=>p.id===prevProjFilter)) projFilterEl.value='all';
  }
  const _teamsProjFilter=projFilterEl?projFilterEl.value:'all';
  const _teamsRoleFilter=(document.getElementById('teams-role-filter')||{}).value||'all';
  const _teamsSearchQ=(document.getElementById('teams-search')||{}).value||'';
  let _teamsFiltered=_teamsSearchQ.trim()
    ? visibleUsers.filter(u=>(u.name||'').toLowerCase().includes(_teamsSearchQ.trim().toLowerCase())||(u.role||'').toLowerCase().includes(_teamsSearchQ.trim().toLowerCase()))
    : visibleUsers;
  if(_teamsProjFilter!=='all'){
    _teamsFiltered=_teamsFiltered.filter(u=>
      state.projects.some(p=>p.id===_teamsProjFilter && Array.isArray(p.memberIds) && p.memberIds.includes(u.id))
    );
  }
  if(_teamsRoleFilter!=='all'){
    _teamsFiltered=_teamsFiltered.filter(u=>{
      const r=(u.role==='member')?'team_member':u.role;
      return r===_teamsRoleFilter;
    });
  }
  const _teamSubtitle=document.getElementById('teams-subtitle');
  if(_teamSubtitle) _teamSubtitle.textContent=`${_teamsFiltered.length} member${_teamsFiltered.length!==1?'s':''}${(_teamsSearchQ.trim()||_teamsProjFilter!=='all'||_teamsRoleFilter!=='all')?' found':''}`;

  // Group tasks by assignee ONCE — this used to re-scan the full state.tasks
  // array (state.tasks.filter(t=>t.assignee===u.id)) for every single member
  // card, i.e. O(members × tasks), which gets slow with 150+ members and a
  // large task list.
  const _teamsTasksByAssignee=new Map();
  state.tasks.forEach(t=>{
    if(!t.assignee) return;
    if(!_teamsTasksByAssignee.has(t.assignee)) _teamsTasksByAssignee.set(t.assignee,[]);
    _teamsTasksByAssignee.get(t.assignee).push(t);
  });

  // ── View mode: swap grid layout classes; tile-card markup is unchanged ──
  if(_teamsViewMode==='list'){
    grid.className='space-y-2';
    grid.innerHTML=_teamsListHtml(_teamsFiltered,_teamsTasksByAssignee);
  } else {
    grid.className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4';
    grid.innerHTML=_teamsFiltered.map(u=>{
    const tasks=_teamsTasksByAssignee.get(u.id)||[];
    const taskAllSubs=(tasks).flatMap(t=>t.subtasks||[]);
    const done=tasks.filter(t=>DONE_STATUSES.includes(t.status)).length+taskAllSubs.filter(s=>DONE_STATUSES.includes(s.status)).length;
    const pts=tasks.reduce((a,t)=>a+(t.points||0),0)+taskAllSubs.reduce((a,s)=>a+(s.points||0),0);
    const activeTasks=tasks.filter(t=>t.status==='dev-in-progress');
    const mappedProjects=state.projects.filter(p=>p.memberIds&&p.memberIds.includes(u.id));
    return `<div class="team-card">
      <div class="flex items-center gap-3 mb-4">
        <div class="avatar" style="width:48px;height:48px;background:${u.color};color:white;font-size:16px;flex-shrink:0">${u.initials}</div>
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-slate-900">${_escHtml(u.name)}</div>
          <div class="flex items-center gap-2 mt-0.5">
            <span class="badge badge-${u.role==='admin'?'admin':u.role==='senior_manager'?'senior_manager':u.role==='program_manager'?'program_manager':u.role==='viewer'?'viewer':'team_member'}">${u.role==='admin'?'Admin':u.role==='senior_manager'?'Senior Manager':u.role==='program_manager'?'Prog. Manager':u.role==='viewer'?'Viewer':'Team Member'}</span>
          </div>
        </div>
        <div class="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" title="Active"></div>
      </div>
      <div class="grid grid-cols-3 gap-2 mb-4 text-center">
        <div class="bg-slate-50 rounded-lg py-2">
          <div class="text-lg font-bold text-slate-900">${tasks.length}</div>
          <div class="text-xs text-slate-500">Tasks</div>
        </div>
        <div class="bg-slate-50 rounded-lg py-2">
          <div class="text-lg font-bold text-slate-900">${pts}</div>
          <div class="text-xs text-slate-500">Points</div>
        </div>
        <div class="bg-slate-50 rounded-lg py-2">
          <div class="text-lg font-bold text-slate-900">${done}</div>
          <div class="text-xs text-slate-500">Done</div>
        </div>
      </div>
      ${mappedProjects.length?`<div class="mb-3">
        <div class="text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">Projects</div>
        <div class="flex flex-wrap gap-1">${mappedProjects.map(p=>`<span class="tag" style="background:${p.color}20;color:${p.color}">${_escHtml(p.name)}</span>`).join('')}</div>
      </div>`:''}
      ${activeTasks.length?`<div class="border-t border-slate-100 pt-3 mb-3">
        <div class="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">Active Now</div>
        ${activeTasks.slice(0,2).map(t=>`<div class="flex items-center gap-2 py-1">
          <span style="color:${typeColor(t.type)};font-size:12px">${typeIcon(t.type)}</span>
          <span class="text-xs text-slate-700 truncate flex-1">${_escHtml(t.title)}</span>
          <span class="text-xs text-indigo-600 font-semibold">${t.points}sp</span>
        </div>`).join('')}
      </div>`:''}
      <div class="mt-auto pt-3 border-t border-slate-100">
        <div class="flex justify-between text-xs text-slate-500 mb-1">
          <span>Completion</span>
          <span>${tasks.length?Math.round((done/tasks.length)*100):0}%</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width:${tasks.length?Math.round((done/tasks.length)*100):0}%;background:${u.color}"></div>
        </div>
      </div>
      ${RBAC.isAdmin()?`<div class="mt-3 flex gap-2"><button class="btn btn-secondary text-xs flex-1" onclick="openEditMemberModal('${u.id}')">Edit</button><button class="btn btn-danger text-xs" onclick="deleteMember('${u.id}')">Remove</button></div>`:RBAC.isProgramManager()&&u.role!=='admin'?`<div class="mt-3"><button class="btn btn-secondary text-xs w-full" onclick="openEditMemberModal('${u.id}')">Edit</button></div>`:''}
    </div>`;
    }).join('');
  }

  if(!_teamsFiltered.length){
    grid.className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4';
    grid.innerHTML=`<div class="col-span-3 empty-state">
      <div class="empty-state-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg></div>
      <div class="text-sm">${(_teamsSearchQ.trim()||_teamsProjFilter!=='all'||_teamsRoleFilter!=='all') ? 'No members match your filters' : RBAC.isAdmin() ? 'No team members yet' : 'No team members in your projects yet'}</div>
      ${!_teamsSearchQ.trim() && _teamsProjFilter==='all' && _teamsRoleFilter==='all' && RBAC.isAdmin() ? `<button class="btn btn-primary text-xs mt-3" onclick="openCreateMemberModal()">Add first member</button>` : ''}
    </div>`;
  }
}

// ── List-view row markup (Teams page) — same data/actions as tile view,
// just a compact horizontal row layout for scanning many members quickly. ──
function _teamsListHtml(users,tasksByAssignee){
  if(!users.length) return '';
  return users.map(u=>{
    const tasks=tasksByAssignee?(tasksByAssignee.get(u.id)||[]):state.tasks.filter(t=>t.assignee===u.id);
    const taskAllSubs=(tasks).flatMap(t=>t.subtasks||[]);
    const done=tasks.filter(t=>DONE_STATUSES.includes(t.status)).length+taskAllSubs.filter(s=>DONE_STATUSES.includes(s.status)).length;
    const pts=tasks.reduce((a,t)=>a+(t.points||0),0)+taskAllSubs.reduce((a,s)=>a+(s.points||0),0);
    const mappedProjects=state.projects.filter(p=>p.memberIds&&p.memberIds.includes(u.id));
    const pct=tasks.length?Math.round((done/tasks.length)*100):0;
    return `<div class="teams-list-row">
      <div class="avatar" style="width:38px;height:38px;background:${u.color};color:white;font-size:13px;flex-shrink:0">${u.initials}</div>
      <div style="min-width:150px;flex-shrink:0">
        <div class="font-semibold text-slate-900 text-sm truncate">${_escHtml(u.name)}</div>
        <div class="text-xs text-slate-500 truncate">${_escHtml(u.email||'')}</div>
      </div>
      <span class="badge badge-${u.role==='admin'?'admin':u.role==='senior_manager'?'senior_manager':u.role==='program_manager'?'program_manager':u.role==='viewer'?'viewer':'team_member'}" style="flex-shrink:0">${u.role==='admin'?'Admin':u.role==='senior_manager'?'Senior Manager':u.role==='program_manager'?'Prog. Manager':u.role==='viewer'?'Viewer':'Team Member'}</span>
      <div style="flex:1;min-width:120px;display:flex;flex-wrap:wrap;gap:4px">
        ${mappedProjects.length?mappedProjects.map(p=>`<span class="tag" style="background:${p.color}20;color:${p.color}">${_escHtml(p.name)}</span>`).join(''):'<span class="text-xs text-slate-400">No projects</span>'}
      </div>
      <div style="display:flex;align-items:center;gap:16px;flex-shrink:0;font-size:12px;color:var(--text-secondary)">
        <div style="text-align:center;min-width:36px"><div class="font-bold text-slate-900">${tasks.length}</div><div style="font-size:10px;color:var(--text-tertiary)">Tasks</div></div>
        <div style="text-align:center;min-width:36px"><div class="font-bold text-slate-900">${pts}</div><div style="font-size:10px;color:var(--text-tertiary)">Points</div></div>
        <div style="text-align:center;min-width:70px">
          <div class="progress-bar" style="width:60px;height:6px"><div class="progress-fill" style="width:${pct}%;background:${u.color}"></div></div>
          <div style="font-size:10px;color:var(--text-tertiary);margin-top:2px">${pct}% done</div>
        </div>
      </div>
      ${RBAC.isAdmin()?`<div style="display:flex;gap:6px;flex-shrink:0"><button class="btn btn-secondary text-xs" onclick="openEditMemberModal('${u.id}')">Edit</button><button class="btn btn-danger text-xs" onclick="deleteMember('${u.id}')">Remove</button></div>`:RBAC.isProgramManager()&&u.role!=='admin'?`<div style="flex-shrink:0"><button class="btn btn-secondary text-xs" onclick="openEditMemberModal('${u.id}')">Edit</button></div>`:'<div style="flex-shrink:0"></div>'}
    </div>`;
  }).join('');
}

// ── Show/hide the Viewer Scope toggle + swap Project/Epic Access panels ──
// prefix is 'cm' (Create Member) or 'em' (Edit Member).
function _viewerScopeUI(prefix){
  const roleEl = document.getElementById(prefix+'-role');
  const scopeWrap = document.getElementById(prefix+'-viewer-scope-wrap');
  const projWrap = document.getElementById(prefix+'-project-access-wrap');
  const epicWrap = document.getElementById(prefix+'-epic-access-wrap');
  if(!roleEl || !scopeWrap || !projWrap || !epicWrap) return;
  const isViewerRole = roleEl.value === 'viewer';
  scopeWrap.style.display = isViewerRole ? '' : 'none';
  if(!isViewerRole){
    projWrap.style.display = '';
    epicWrap.style.display = 'none';
    return;
  }
  const checkedRadio = document.querySelector(`input[name="${prefix}-viewer-scope-type"]:checked`);
  const scopeType = checkedRadio ? checkedRadio.value : 'project';
  projWrap.style.display = scopeType === 'epic' ? 'none' : '';
  epicWrap.style.display = scopeType === 'epic' ? '' : 'none';
}
function _cmToggleViewerScopeUI(){ _viewerScopeUI('cm'); }
function _emToggleViewerScopeUI(){ _viewerScopeUI('em'); _emSyncDeleteToggleVisibility(); _emSyncAiToggleVisibility(); }

// ── "Can Delete Tasks" toggle (Edit Member modal only) ──────────
// Only meaningful for Program Manager / Senior Manager members — hidden
// for every other role so the flag can't be set on roles it doesn't apply to.
function _emSyncDeleteToggleVisibility(){
  const roleEl = document.getElementById('em-role');
  const wrap = document.getElementById('em-delete-toggle-wrap');
  if(!roleEl || !wrap) return;
  const applies = roleEl.value === 'program_manager' || roleEl.value === 'senior_manager';
  wrap.style.display = applies ? '' : 'none';
}
function _emToggleDeleteFlag(){
  const cb = document.getElementById('em-can-delete-tasks');
  if(!cb) return;
  cb.checked = !cb.checked;
  const track = document.getElementById('em-cdt-track');
  const knob = document.getElementById('em-cdt-knob');
  if(track) track.style.background = cb.checked ? '#6366f1' : '#cbd5e1';
  if(knob) knob.style.left = cb.checked ? '18px' : '2px';
}

// ── AI Chatbot / AI Writing toggles (Edit Member modal only) ────
// Same rule as "Can Delete Tasks": only meaningful for Program Manager /
// Senior Manager — Admin always has both regardless of these flags (see
// AI.canUseChat/canUseWriting in ai-chatbot.js), and no other role can use
// AI features at all, so the controls are hidden rather than shown-but-inert.
function _emSyncAiToggleVisibility(){
  const roleEl = document.getElementById('em-role');
  const wrap = document.getElementById('em-ai-toggle-wrap');
  if(!roleEl || !wrap) return;
  const applies = roleEl.value === 'program_manager' || roleEl.value === 'senior_manager';
  wrap.style.display = applies ? '' : 'none';
}
function _emToggleAiChatFlag(){
  const cb = document.getElementById('em-ai-chat-enabled');
  if(!cb) return;
  cb.checked = !cb.checked;
  const track = document.getElementById('em-aichat-track');
  const knob = document.getElementById('em-aichat-knob');
  if(track) track.style.background = cb.checked ? '#6366f1' : '#cbd5e1';
  if(knob) knob.style.left = cb.checked ? '18px' : '2px';
}
function _emToggleAiWritingFlag(){
  const cb = document.getElementById('em-ai-writing-enabled');
  if(!cb) return;
  cb.checked = !cb.checked;
  const track = document.getElementById('em-aiwriting-track');
  const knob = document.getElementById('em-aiwriting-knob');
  if(track) track.style.background = cb.checked ? '#6366f1' : '#cbd5e1';
  if(knob) knob.style.left = cb.checked ? '18px' : '2px';
}

function openCreateMemberModal(){
  if(!RBAC.isAdmin()){ showNotif('⚠ Admin access required','error'); return; }
  openModal(`
    <div class="p-6">
      <div class="flex items-center justify-between mb-5">
        <h2 class="text-lg font-bold text-slate-900">Create Member</h2>
        <button onclick="closeModal()" style="color:var(--text-muted);cursor:pointer;transition:color 0.14s" onmouseenter="this.style.color='var(--text-primary)'" onmouseleave="this.style.color='var(--text-muted)'"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
      <div class="space-y-4">
        <div>
          <label>Email Address *</label>
          <input type="email" id="cm-email" placeholder="user@company.com" autocomplete="off" spellcheck="false"/>
          <div style="font-size:11px;color:#64748b;margin-top:4px;">User must already exist in Firebase Authentication.</div>
        </div>
        <div>
          <label>Full Name *</label>
          <input type="text" id="cm-name" placeholder="e.g. Priya Sharma"/>
        </div>
        <div>
          <label>Role</label>
          <select id="cm-role" onchange="_cmToggleViewerScopeUI()">
            <option value="viewer">Viewer</option>
            <option value="team_member">Team Member</option>
            <option value="program_manager">Program Manager</option>
            <option value="senior_manager">Senior Manager</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div>
          <label>Avatar Color</label>
          <input type="color" id="cm-color" value="${randomColor()}" style="height:38px;padding:2px 4px;cursor:pointer"/>
        </div>
        <div id="cm-viewer-scope-wrap" style="display:none">
          <label style="margin-bottom:8px;display:block">Viewer Access Scope</label>
          <div style="display:flex;gap:10px;margin-bottom:6px">
            <label class="vscope-pill">
              <input type="radio" name="cm-viewer-scope-type" value="project" checked onchange="_cmToggleViewerScopeUI()"/>
              <span class="vscope-pill-inner">
                <svg class="vscope-pill-check" viewBox="0 0 10 8" fill="none"><polyline points="1,4 3.5,6.5 9,1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                By Projects
              </span>
            </label>
            <label class="vscope-pill">
              <input type="radio" name="cm-viewer-scope-type" value="epic" onchange="_cmToggleViewerScopeUI()"/>
              <span class="vscope-pill-inner">
                <svg class="vscope-pill-check" viewBox="0 0 10 8" fill="none"><polyline points="1,4 3.5,6.5 9,1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                By Epics
              </span>
            </label>
          </div>
          <div style="font-size:11px;color:#64748b;margin-bottom:2px">Choose whether this Viewer's read-only access is scoped by whole Projects or by specific Epics.</div>
        </div>
        <div id="cm-project-access-wrap">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <label style="margin-bottom:0;font-size:11.5px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.07em">Project Access</label>
            <span id="cm-proj-count" style="font-size:11px;font-weight:600;color:var(--accent);background:rgba(91,95,199,0.09);border:1px solid rgba(91,95,199,0.14);border-radius:20px;padding:2px 9px">None</span>
          </div>
          ${state.projects.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(175px,1fr));gap:8px">
            ${state.projects.map(p=>`
              <div class="psc-card" data-prefix="cm"
                onclick="toggleProjCard(this,'cm')"
                style="position:relative;display:flex;align-items:center;gap:10px;
                       padding:10px 12px;border-radius:10px;cursor:pointer;
                       border:1.5px solid rgba(0,0,0,0.08);
                       background:rgba(248,249,252,0.9);
                       transition:border-color 0.15s,background 0.15s,box-shadow 0.15s;
                       user-select:none">
                <input type="checkbox" value="${p.id}" class="cm-proj-check" style="display:none"/>
                <div style="width:9px;height:9px;border-radius:50%;background:${p.color};flex-shrink:0;box-shadow:0 0 0 2px ${p.color}28"></div>
                <span style="font-size:12.5px;font-weight:500;color:var(--text-primary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.3">${_escHtml(p.name)}</span>
                <div class="psc-check-circle" style="width:18px;height:18px;border-radius:50%;border:1.5px solid rgba(0,0,0,0.15);flex-shrink:0;display:flex;align-items:center;justify-content:center;background:transparent;transition:background 0.15s,border-color 0.15s">
                  <svg class="psc-check-svg" width="10" height="8" viewBox="0 0 10 8" fill="none" style="opacity:0;transition:opacity 0.15s">
                    <polyline points="1,4 3.5,6.5 9,1" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </div>
              </div>
            `).join('')}
          </div>` : '<div style="color:var(--text-tertiary);font-size:13px;padding:10px 0">No projects yet</div>'}
        </div>
        <div id="cm-epic-access-wrap" style="display:none">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <label style="margin-bottom:0;font-size:11.5px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.07em">Epic Access</label>
            <span id="cm-epic-count" style="font-size:11px;font-weight:600;color:var(--accent);background:rgba(91,95,199,0.09);border:1px solid rgba(91,95,199,0.14);border-radius:20px;padding:2px 9px">None</span>
          </div>
          ${(state.epics||[]).length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(175px,1fr));gap:8px">
            ${(state.epics||[]).map(e=>`
              <div class="psc-card" data-prefix="cm"
                onclick="toggleEpicCard(this,'cm')"
                style="position:relative;display:flex;align-items:center;gap:10px;
                       padding:10px 12px;border-radius:10px;cursor:pointer;
                       border:1.5px solid rgba(0,0,0,0.08);
                       background:rgba(248,249,252,0.9);
                       transition:border-color 0.15s,background 0.15s,box-shadow 0.15s;
                       user-select:none">
                <input type="checkbox" value="${e.id}" class="cm-epic-check" style="display:none"/>
                <div style="width:9px;height:9px;border-radius:50%;background:${e.color||'#6366f1'};flex-shrink:0;box-shadow:0 0 0 2px ${(e.color||'#6366f1')}28"></div>
                <span style="font-size:12.5px;font-weight:500;color:var(--text-primary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.3">${_escHtml(e.title)}</span>
                <div class="psc-check-circle" style="width:18px;height:18px;border-radius:50%;border:1.5px solid rgba(0,0,0,0.15);flex-shrink:0;display:flex;align-items:center;justify-content:center;background:transparent;transition:background 0.15s,border-color 0.15s">
                  <svg class="psc-check-svg" width="10" height="8" viewBox="0 0 10 8" fill="none" style="opacity:0;transition:opacity 0.15s">
                    <polyline points="1,4 3.5,6.5 9,1" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </div>
              </div>
            `).join('')}
          </div>` : '<div style="color:var(--text-tertiary);font-size:13px;padding:10px 0">No epics yet</div>'}
        </div>
      </div>
      <div class="flex justify-end gap-3 mt-6 pt-4" style="border-top:1px solid rgba(0,0,0,0.05)">
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="createMember()">Create Member</button>
      </div>
    </div>
  `);
  // Initialise project access cards after DOM renders
  setTimeout(()=>{ initProjCards('cm'); initEpicCards('cm'); _cmToggleViewerScopeUI(); }, 0);
}

function createMember(){
  if(!RBAC.isAdmin()){ showNotif('⚠ Admin access required','error'); return; }
  const emailRaw=document.getElementById('cm-email').value.trim();
  const email=emailRaw.toLowerCase();
  if(!email){showNotif('⚠ Email is required','error');return;}
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){showNotif('⚠ Enter a valid email address','error');return;}
  if(state.users.some(u=>(u.email||'').toLowerCase()===email)){showNotif('⚠ A member with this email already exists','error');return;}
  const name=document.getElementById('cm-name').value.trim();
  if(!name){showNotif('⚠ Name required','error');return;}
  // RBAC-safe role validation: only allow known roles
  const rawRole=document.getElementById('cm-role').value;
  const VALID_ROLES=['admin','program_manager','team_member','senior_manager','viewer'];
  const role=VALID_ROLES.includes(rawRole)?rawRole:'team_member';
  const color=document.getElementById('cm-color').value;
  // ── Viewer scope: admin chooses Project-wise or Epic-wise read-only access ──
  const viewerScopeRadio=document.querySelector('input[name="cm-viewer-scope-type"]:checked');
  const viewerScopeType=viewerScopeRadio?viewerScopeRadio.value:'project';
  const isEpicScopedViewer=role==='viewer'&&viewerScopeType==='epic';
  const projIds=isEpicScopedViewer?[]:Array.from(document.querySelectorAll('.cm-proj-check:checked')).map(el=>el.value);
  const epicIds=isEpicScopedViewer?Array.from(document.querySelectorAll('.cm-epic-check:checked')).map(el=>el.value):[];
  const now=_now();
  const member={
    id:muid(),
    name,
    email,
    role,
    initials:initials(name),
    color,
    createdAt:now,
    updatedAt:now
  };
  if(role==='viewer'){
    member.viewerScopeType=viewerScopeType;
    member.epicIds=epicIds;
  }
  state.users.push(member);
  // Map member to selected projects
  projIds.forEach(pid=>{
    const p=getProject(pid);
    if(p){if(!p.memberIds)p.memberIds=[];if(!p.memberIds.includes(member.id))p.memberIds.push(member.id);}
  });
  invalidateStateMaps();
  // ── Firebase: persist new user entity; queue if unavailable ──
  SyncState.markPending(member.id);
  if(FirebaseDB.isReady()){
    FirebaseDB.saveEntity('users', member).then(ok=>{
      if(ok){ SyncState.markSynced(member.id); }
      else   { SyncState.markFailed(member.id); PendingSyncQueue.saveEntity('users', member); }
    }).catch(()=>{ SyncState.markFailed(member.id); PendingSyncQueue.saveEntity('users', member); });
    // ── Firebase: persist affected projects (memberIds changed) ──
    projIds.forEach(pid=>{
      const p=getProject(pid);
      if(p) FirebaseDB.saveEntity('projects', p).catch(e=>console.warn('[createMember/project] Firebase error:',e));
    });
  } else {
    PendingSyncQueue.saveEntity('users', member);
    projIds.forEach(pid=>{
      const p=getProject(pid);
      if(p) PendingSyncQueue.saveEntity('projects', p);
    });
  }
  SaveManager.save();
  closeModal();
  renderTeams();
  showNotif(`${name} added ✓`);
}

function openEditMemberModal(userId){
  const u=getUser(userId);
  if(!u)return;
  // Auto-migrate legacy role before rendering
  if(u.role==='member') u.role='team_member';
  openModal(`
    <div class="p-6">
      <div class="flex items-center justify-between mb-5">
        <h2 class="text-lg font-bold text-slate-900">Edit Member</h2>
        <button onclick="closeModal()" style="color:var(--text-muted);cursor:pointer;transition:color 0.14s" onmouseenter="this.style.color='var(--text-primary)'" onmouseleave="this.style.color='var(--text-muted)'"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
      <div class="space-y-4">
        <div>
          <label>Email Address *</label>
          <input type="email" id="em-email" value="${_escHtml(u.email||'')}" autocomplete="off" spellcheck="false"/>
          <div style="font-size:11px;color:#64748b;margin-top:4px;">User must already exist in Firebase Authentication.</div>
        </div>
        <div>
          <label>Full Name *</label>
          <input type="text" id="em-name" value="${_escHtml(u.name)}"/>
        </div>
        <div>
          <label>Role</label>
          <select id="em-role" onchange="_emToggleViewerScopeUI()">
            <option value="viewer" ${u.role==='viewer'?'selected':''}>Viewer</option>
            <option value="team_member" ${(u.role==='team_member'||u.role==='member')?'selected':''}>Team Member</option>
            <option value="program_manager" ${u.role==='program_manager'?'selected':''}>Program Manager</option>
            <option value="senior_manager" ${u.role==='senior_manager'?'selected':''}>Senior Manager</option>
            <option value="admin" ${u.role==='admin'?'selected':''}>Admin</option>
          </select>
        </div>
        <div id="em-delete-toggle-wrap" style="display:none">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border-radius:10px;border:1.5px solid rgba(0,0,0,0.08);background:rgba(248,249,252,0.9)">
            <div>
              <div style="font-size:12.5px;font-weight:600;color:var(--text-primary)">Can Delete Tasks / Subtasks</div>
              <div style="font-size:11px;color:#64748b;margin-top:2px">When enabled, this member can delete tasks &amp; subtasks from the Edit Task/Subtask modal and via bulk delete in the Backlog.</div>
            </div>
            <span id="em-cdt-track" onclick="_emToggleDeleteFlag()" style="flex-shrink:0;position:relative;width:38px;height:22px;border-radius:22px;cursor:pointer;background:${u.canDeleteTasks?'#6366f1':'#cbd5e1'};transition:background 0.15s;display:inline-block">
              <input type="checkbox" id="em-can-delete-tasks" ${u.canDeleteTasks?'checked':''} style="position:absolute;opacity:0;width:100%;height:100%;margin:0;cursor:pointer;pointer-events:none">
              <span id="em-cdt-knob" style="position:absolute;top:2px;left:${u.canDeleteTasks?'18px':'2px'};width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.25);transition:left 0.15s;pointer-events:none"></span>
            </span>
          </div>
        </div>
        <div id="em-ai-toggle-wrap" style="display:none">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border-radius:10px;border:1.5px solid rgba(0,0,0,0.08);background:rgba(248,249,252,0.9);margin-bottom:8px">
            <div>
              <div style="font-size:12.5px;font-weight:600;color:var(--text-primary)">AI Chatbot Access</div>
              <div style="font-size:11px;color:#64748b;margin-top:2px">Lets this member ask SprintFlow's AI assistant about project status, completion, epics, and workload.</div>
            </div>
            <span id="em-aichat-track" onclick="_emToggleAiChatFlag()" style="flex-shrink:0;position:relative;width:38px;height:22px;border-radius:22px;cursor:pointer;background:${u.aiChatEnabled?'#6366f1':'#cbd5e1'};transition:background 0.15s;display:inline-block">
              <input type="checkbox" id="em-ai-chat-enabled" ${u.aiChatEnabled?'checked':''} style="position:absolute;opacity:0;width:100%;height:100%;margin:0;cursor:pointer;pointer-events:none">
              <span id="em-aichat-knob" style="position:absolute;top:2px;left:${u.aiChatEnabled?'18px':'2px'};width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.25);transition:left 0.15s;pointer-events:none"></span>
            </span>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border-radius:10px;border:1.5px solid rgba(0,0,0,0.08);background:rgba(248,249,252,0.9)">
            <div>
              <div style="font-size:12.5px;font-weight:600;color:var(--text-primary)">AI Writing Assistance</div>
              <div style="font-size:11px;color:#64748b;margin-top:2px">Lets this member use "Improve wording" on task/subtask descriptions and auto-generate Release Notes.</div>
            </div>
            <span id="em-aiwriting-track" onclick="_emToggleAiWritingFlag()" style="flex-shrink:0;position:relative;width:38px;height:22px;border-radius:22px;cursor:pointer;background:${u.aiWritingEnabled?'#6366f1':'#cbd5e1'};transition:background 0.15s;display:inline-block">
              <input type="checkbox" id="em-ai-writing-enabled" ${u.aiWritingEnabled?'checked':''} style="position:absolute;opacity:0;width:100%;height:100%;margin:0;cursor:pointer;pointer-events:none">
              <span id="em-aiwriting-knob" style="position:absolute;top:2px;left:${u.aiWritingEnabled?'18px':'2px'};width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.25);transition:left 0.15s;pointer-events:none"></span>
            </span>
          </div>
        </div>
        <div>
          <label>Avatar Color</label>
          <input type="color" id="em-color" value="${u.color}" style="height:38px;padding:2px 4px;cursor:pointer"/>
        </div>
        <div id="em-viewer-scope-wrap" style="display:none">
          <label style="margin-bottom:8px;display:block">Viewer Access Scope</label>
          <div style="display:flex;gap:10px;margin-bottom:6px">
            <label class="vscope-pill">
              <input type="radio" name="em-viewer-scope-type" value="project" ${u.viewerScopeType!=='epic'?'checked':''} onchange="_emToggleViewerScopeUI()"/>
              <span class="vscope-pill-inner">
                <svg class="vscope-pill-check" viewBox="0 0 10 8" fill="none"><polyline points="1,4 3.5,6.5 9,1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                By Projects
              </span>
            </label>
            <label class="vscope-pill">
              <input type="radio" name="em-viewer-scope-type" value="epic" ${u.viewerScopeType==='epic'?'checked':''} onchange="_emToggleViewerScopeUI()"/>
              <span class="vscope-pill-inner">
                <svg class="vscope-pill-check" viewBox="0 0 10 8" fill="none"><polyline points="1,4 3.5,6.5 9,1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                By Epics
              </span>
            </label>
          </div>
          <div style="font-size:11px;color:#64748b;margin-bottom:2px">Choose whether this Viewer's read-only access is scoped by whole Projects or by specific Epics.</div>
        </div>
        <div id="em-project-access-wrap">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <label style="margin-bottom:0;font-size:11.5px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.07em">Project Access</label>
            <span id="em-proj-count" style="font-size:11px;font-weight:600;color:var(--accent);background:rgba(91,95,199,0.09);border:1px solid rgba(91,95,199,0.14);border-radius:20px;padding:2px 9px">None</span>
          </div>
          ${state.projects.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(175px,1fr));gap:8px">
            ${state.projects.map(p=>`
              <div class="psc-card" data-prefix="em"
                onclick="toggleProjCard(this,'em')"
                style="position:relative;display:flex;align-items:center;gap:10px;
                       padding:10px 12px;border-radius:10px;cursor:pointer;
                       border:1.5px solid rgba(0,0,0,0.08);
                       background:rgba(248,249,252,0.9);
                       transition:border-color 0.15s,background 0.15s,box-shadow 0.15s;
                       user-select:none">
                <input type="checkbox" value="${p.id}" class="em-proj-check" ${(p.memberIds||[]).includes(u.id)?'checked':''} style="display:none"/>
                <div style="width:9px;height:9px;border-radius:50%;background:${p.color};flex-shrink:0;box-shadow:0 0 0 2px ${p.color}28"></div>
                <span style="font-size:12.5px;font-weight:500;color:var(--text-primary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.3">${_escHtml(p.name)}</span>
                <div class="psc-check-circle" style="width:18px;height:18px;border-radius:50%;border:1.5px solid rgba(0,0,0,0.15);flex-shrink:0;display:flex;align-items:center;justify-content:center;background:transparent;transition:background 0.15s,border-color 0.15s">
                  <svg class="psc-check-svg" width="10" height="8" viewBox="0 0 10 8" fill="none" style="opacity:0;transition:opacity 0.15s">
                    <polyline points="1,4 3.5,6.5 9,1" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </div>
              </div>
            `).join('')}
          </div>` : '<div style="color:var(--text-tertiary);font-size:13px;padding:10px 0">No projects yet</div>'}
        </div>
        <div id="em-epic-access-wrap" style="display:none">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <label style="margin-bottom:0;font-size:11.5px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.07em">Epic Access</label>
            <span id="em-epic-count" style="font-size:11px;font-weight:600;color:var(--accent);background:rgba(91,95,199,0.09);border:1px solid rgba(91,95,199,0.14);border-radius:20px;padding:2px 9px">None</span>
          </div>
          ${(state.epics||[]).length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(175px,1fr));gap:8px">
            ${(state.epics||[]).map(e=>`
              <div class="psc-card" data-prefix="em"
                onclick="toggleEpicCard(this,'em')"
                style="position:relative;display:flex;align-items:center;gap:10px;
                       padding:10px 12px;border-radius:10px;cursor:pointer;
                       border:1.5px solid rgba(0,0,0,0.08);
                       background:rgba(248,249,252,0.9);
                       transition:border-color 0.15s,background 0.15s,box-shadow 0.15s;
                       user-select:none">
                <input type="checkbox" value="${e.id}" class="em-epic-check" ${(u.epicIds||[]).includes(e.id)?'checked':''} style="display:none"/>
                <div style="width:9px;height:9px;border-radius:50%;background:${e.color||'#6366f1'};flex-shrink:0;box-shadow:0 0 0 2px ${(e.color||'#6366f1')}28"></div>
                <span style="font-size:12.5px;font-weight:500;color:var(--text-primary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.3">${_escHtml(e.title)}</span>
                <div class="psc-check-circle" style="width:18px;height:18px;border-radius:50%;border:1.5px solid rgba(0,0,0,0.15);flex-shrink:0;display:flex;align-items:center;justify-content:center;background:transparent;transition:background 0.15s,border-color 0.15s">
                  <svg class="psc-check-svg" width="10" height="8" viewBox="0 0 10 8" fill="none" style="opacity:0;transition:opacity 0.15s">
                    <polyline points="1,4 3.5,6.5 9,1" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </div>
              </div>
            `).join('')}
          </div>` : '<div style="color:var(--text-tertiary);font-size:13px;padding:10px 0">No epics yet</div>'}
        </div>
      </div>
      <div class="flex justify-end gap-3 mt-6 pt-4" style="border-top:1px solid rgba(0,0,0,0.05)">
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="saveMember('${u.id}')">Save</button>
      </div>
    </div>
  `);
  // Initialise project access cards after DOM renders
  setTimeout(()=>{ initProjCards('em'); initEpicCards('em'); _emToggleViewerScopeUI(); }, 0);
}

function saveMember(userId){
  const u=getUser(userId);
  if(!u)return;
  const emailRaw=document.getElementById('em-email').value.trim();
  const email=emailRaw.toLowerCase();
  if(!email){showNotif('⚠ Email is required','error');return;}
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){showNotif('⚠ Enter a valid email address','error');return;}
  if(state.users.some(x=>x.id!==userId&&(x.email||'').toLowerCase()===email)){showNotif('⚠ A member with this email already exists','error');return;}
  const name=document.getElementById('em-name').value.trim();
  if(!name){showNotif('⚠ Name required','error');return;}
  // RBAC-safe role validation: only allow known roles
  const rawRole=document.getElementById('em-role').value;
  u.email=email;
  u.name=name;
  const VALID_ROLES_SM=['admin','program_manager','team_member','senior_manager','viewer'];
  u.role=VALID_ROLES_SM.includes(rawRole)?rawRole:'team_member';
  // ── "Can Delete Tasks" toggle: only meaningful for Program Manager / Senior
  // Manager. Persist the checkbox value for those roles; auto-clear it for any
  // other role so a later role change can't silently carry over stale delete rights.
  const cdtEl=document.getElementById('em-can-delete-tasks');
  u.canDeleteTasks=(u.role==='program_manager'||u.role==='senior_manager') ? !!(cdtEl&&cdtEl.checked) : false;
  // ── AI feature access: only meaningful for Program Manager / Senior
  // Manager — auto-clear for any other role so a later role change can't
  // silently carry over stale AI access (same rule as canDeleteTasks above).
  const aiChatEl=document.getElementById('em-ai-chat-enabled');
  const aiWritingEl=document.getElementById('em-ai-writing-enabled');
  const _aiApplies=(u.role==='program_manager'||u.role==='senior_manager');
  u.aiChatEnabled=_aiApplies ? !!(aiChatEl&&aiChatEl.checked) : false;
  u.aiWritingEnabled=_aiApplies ? !!(aiWritingEl&&aiWritingEl.checked) : false;
  u.color=document.getElementById('em-color').value;
  u.initials=initials(name);
  u.updatedAt=_now();
  // ── Viewer scope: admin chooses Project-wise or Epic-wise read-only access ──
  const viewerScopeRadio=document.querySelector('input[name="em-viewer-scope-type"]:checked');
  const viewerScopeType=viewerScopeRadio?viewerScopeRadio.value:'project';
  const isEpicScopedViewer=u.role==='viewer'&&viewerScopeType==='epic';
  if(u.role==='viewer'){
    u.viewerScopeType=viewerScopeType;
    u.epicIds=isEpicScopedViewer?Array.from(document.querySelectorAll('.em-epic-check:checked')).map(el=>el.value):(u.epicIds||[]);
  } else {
    delete u.viewerScopeType;
    delete u.epicIds;
  }
  // Update project mappings (skipped for Epic-scoped Viewers — their access comes from epicIds instead)
  if(!isEpicScopedViewer){
    const checkedProjs=Array.from(document.querySelectorAll('.em-proj-check:checked')).map(el=>el.value);
    state.projects.forEach(p=>{
      if(!p.memberIds)p.memberIds=[];
      if(checkedProjs.includes(p.id)){
        if(!p.memberIds.includes(u.id))p.memberIds.push(u.id);
      }else{
        p.memberIds=p.memberIds.filter(id=>id!==u.id);
      }
    });
  }
  invalidateStateMaps();
  // ── Firebase: persist user entity; queue if unavailable ──
  SyncState.markPending(u.id);
  if(FirebaseDB.isReady()){
    FirebaseDB.saveEntity('users', u).then(ok=>{
      if(ok){ SyncState.markSynced(u.id); }
      else   { SyncState.markFailed(u.id); PendingSyncQueue.saveEntity('users', u); }
    }).catch(()=>{ SyncState.markFailed(u.id); PendingSyncQueue.saveEntity('users', u); });
    // ── Firebase: persist each project whose memberIds may have changed ──
    state.projects.forEach(p=>{
      FirebaseDB.saveEntity('projects', p).catch(e=>console.warn('[saveMember/project] Firebase error:',e));
    });
  } else {
    PendingSyncQueue.saveEntity('users', u);
    state.projects.forEach(p=>PendingSyncQueue.saveEntity('projects', p));
  }
  SaveManager.save();
  closeModal();
  renderTeams();
  showNotif('Member updated ✓');
}

function deleteMember(userId){
  if(!RBAC.isAdmin()){ showNotif('⚠ Admin access required','error'); return; }
  if(!confirm('Remove this member? Their task assignments will be cleared.'))return;
  // ── Referential integrity: clear assignee on all tasks/subtasks ──
  cleanupMemberReferences(userId);
  state.users=state.users.filter(u=>u.id!==userId);
  // Remove from project mappings
  state.projects.forEach(p=>{
    if(p.memberIds) p.memberIds=p.memberIds.filter(id=>id!==userId);
  });
  invalidateStateMaps();
  _invalidateSearchCache();
  // ── Firebase: delete user entity + sync affected projects ──
  if(FirebaseDB.isReady()){
    FirebaseDB.deleteEntity('users', userId).catch(e=>console.warn('[deleteMember] Firebase error:',e));
    state.projects.forEach(p=>{
      FirebaseDB.saveEntity('projects', p).catch(e=>console.warn('[deleteMember/project] Firebase error:',e));
    });
  } else {
    PendingSyncQueue.deleteEntity('users', userId);
    state.projects.forEach(p=>PendingSyncQueue.saveEntity('projects', p));
  }
  SaveManager.save();
  renderTeams();
  showNotif('Member removed');
}

