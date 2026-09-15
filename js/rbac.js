const RBAC = (function(){

  // ── Page access rules by role ──────────────────────────────────
  // admin       → all pages
  // senior_manager → all except settings and teams (same page access as admin, org-wide visibility)
  // program_manager → all except settings and teams
  // team_member → dashboard, backlog-planner, kanban, sprint-planning, releases, reports (filtered), retrospectives (view + add entries only)
  // viewer      → backlog-planner, kanban only — read-only
  const MEMBER_BLOCKED   = new Set(['settings','teams','projects','epics','releases','reports','release-reports','sprint-planning','productivity-report','epic-reports','delay-reports']);
  const PM_BLOCKED       = new Set(['teams','productivity-report','release-reports']);
  const SENIOR_MANAGER_BLOCKED = new Set(['settings','teams']);
  const VIEWER_BLOCKED   = new Set(['dashboard','settings','teams','projects','epics','releases','reports','release-reports','sprint-planning','productivity-report','epic-reports','retrospectives','delay-reports']);
  // NOTE: 'delay-reports' is intentionally NOT added to PM_BLOCKED or SENIOR_MANAGER_BLOCKED —
  // Delay Reports must remain visible to Admin, Senior Manager and Program Manager (per spec),
  // and blocked only for Team Member and Viewer.

  // ── Internal helpers ──────────────────────────────────────────
  function _user(){ return state.currentUser || null; }

  function _role(){
    const u = _user();
    if(!u) return 'admin'; // safe default before auth resolves
    return (u.role || '').toLowerCase();
  }

  // Build the set of project IDs visible to the current user.
  // Admin, Senior Manager → null (means "all"). PM + Member + Viewer →
  // intersection of explicit projectIds list AND projects where user is in memberIds.
  // Epic-scoped Viewer (u.viewerScopeType === 'epic') → projects derived from
  // their assigned epics (u.epicIds) instead of the usual project mapping.
  function _visibleProjectIds(){
    const u = _user();
    if(!u || _role() === 'admin' || _role() === 'senior_manager') return null; // null = all
    if(_role() === 'viewer' && u.viewerScopeType === 'epic'){
      const epicIds = Array.isArray(u.epicIds) ? u.epicIds : [];
      const projSet = new Set();
      (state.epics || []).forEach(e => {
        if(!epicIds.includes(e.id)) return;
        (e.projectIds || (e.projectId ? [e.projectId] : [])).forEach(pid => projSet.add(pid));
      });
      return [...projSet];
    }
    const explicit  = Array.isArray(u.projectIds) ? u.projectIds : [];
    const byMember  = state.projects
      .filter(p => Array.isArray(p.memberIds) && p.memberIds.includes(u.id))
      .map(p => p.id);
    return [...new Set([...explicit, ...byMember])];
  }

  // ── Public role checks ────────────────────────────────────────

  function isAdmin(){ return _role() === 'admin'; }

  function isSeniorManager(){ return _role() === 'senior_manager'; }

  function isProgramManager(){ return _role() === 'program_manager'; }

  function isMember(){
    // "team member" in the execution-level sense (not admin, not PM)
    const r = _role();
    return r === 'team_member' || r === 'member';
  }

  function isViewer(){ return _role() === 'viewer'; }

  // ── Page access guard ─────────────────────────────────────────
  function canAccess(page){
    if(isAdmin()) return true;
    if(isSeniorManager()) return !SENIOR_MANAGER_BLOCKED.has(page);
    if(isProgramManager()) return !PM_BLOCKED.has(page);
    if(isViewer()) return !VIEWER_BLOCKED.has(page);
    // team_member
    return !MEMBER_BLOCKED.has(page);
  }

  // ── Visibility helpers ────────────────────────────────────────
  function getVisibleProjects(){
    if(isAdmin()) return state.projects;
    const ids = _visibleProjectIds();
    if(!ids) return state.projects;
    return state.projects.filter(p => ids.includes(p.id));
  }

  function getVisibleTasks(tasks){
    if(isAdmin()) return tasks;
    const ids = _visibleProjectIds();
    let result = !ids ? tasks : tasks.filter(t => ids.includes(t.project));
    // Epic-scoped Viewer: narrow further to only tasks under their assigned epics
    const u = _user();
    if(_role() === 'viewer' && u && u.viewerScopeType === 'epic'){
      const epicIds = Array.isArray(u.epicIds) ? u.epicIds : [];
      result = result.filter(t => t.epicId && epicIds.includes(t.epicId));
    }
    return result;
  }

  function getVisibleSprints(){
    if(isAdmin()) return state.sprints;
    const ids = _visibleProjectIds();
    if(!ids) return state.sprints;
    return state.sprints.filter(s => ids.includes(s.project));
  }

  function getVisibleReleases(){
    if(isAdmin()) return state.releases || [];
    const ids = _visibleProjectIds();
    if(!ids) return state.releases || [];
    return (state.releases || []).filter(r => ids.includes(r.projectId));
  }

  function getVisibleEpics(){
    if(isAdmin()) return state.epics || [];
    // Epic-scoped Viewer: exactly their assigned epics, not every epic in the resolved projects
    const u = _user();
    if(_role() === 'viewer' && u && u.viewerScopeType === 'epic'){
      const epicIds = Array.isArray(u.epicIds) ? u.epicIds : [];
      return (state.epics || []).filter(e => epicIds.includes(e.id));
    }
    const ids = _visibleProjectIds();
    if(!ids) return state.epics || [];
    return (state.epics || []).filter(e => {
      const epicProjects = e.projectIds || (e.projectId ? [e.projectId] : []);
      return epicProjects.some(pid => ids.includes(pid));
    });
  }

  // Returns true when the current user can create/edit a sprint/release/epic
  // for a given projectId (admin always, PM only if project is mapped).
  function canManageProject(projectId){
    if(isAdmin()) return true;
    if(isSeniorManager()) return true;
    if(isProgramManager()){
      const ids = _visibleProjectIds();
      return !ids || ids.includes(projectId);
    }
    return false; // team_member and viewer cannot create/manage
  }

  // ── Sidebar nav visibility ────────────────────────────────────
  function applyMenuVisibility(){
    let blocked;
    if(isAdmin())           blocked = [];
    else if(isSeniorManager()) blocked = [...SENIOR_MANAGER_BLOCKED];
    else if(isProgramManager()) blocked = [...PM_BLOCKED];
    else if(isViewer())     blocked = [...VIEWER_BLOCKED];
    else                    blocked = [...MEMBER_BLOCKED];

    document.querySelectorAll('.nav-item[data-page]').forEach(el => {
      const page = el.dataset.page;
      el.classList.toggle('rbac-hidden', blocked.includes(page));
    });
    // Hide section labels if every child nav-item under them is hidden
    document.querySelectorAll('.nav-section-label').forEach(label => {
      let next = label.nextElementSibling;
      let allHidden = true;
      while(next && !next.classList.contains('nav-section-label')){
        if(next.classList.contains('nav-item') && !next.classList.contains('rbac-hidden')){
          allHidden = false; break;
        }
        next = next.nextElementSibling;
      }
      label.style.display = allHidden ? 'none' : '';
    });
  }

  // ── Access denied HTML ────────────────────────────────────────
  function accessDeniedHTML(page){
    return `<div class="rbac-access-denied">
      <div class="rbac-denied-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
        </svg>
      </div>
      <div class="rbac-denied-title">Access Restricted</div>
      <div class="rbac-denied-text">
        You don't have permission to view this page. Contact your admin if you need access.
      </div>
      <div class="rbac-denied-badge">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
        Restricted: ${page.charAt(0).toUpperCase() + page.slice(1)}
      </div>
    </div>`;
  }

  // ── Init: resolve Firebase auth → state.currentUser ──────────
  function init(fbUser){
    if(!fbUser){ state.currentUser = null; applyMenuVisibility(); return; }
    const email = (fbUser.email || '').toLowerCase();
    const matched = (state.users || []).find(u => (u.email || '').toLowerCase() === email);
    if(matched){
      // Preserve the stored role — allow all valid roles through
      const r = (matched.role || '').toLowerCase();
      const safeRole = (r === 'admin' || r === 'program_manager' || r === 'senior_manager' || r === 'viewer') ? r : 'team_member';
      state.currentUser = { ...matched, uid: fbUser.uid, email: fbUser.email, role: safeRole };
    } else {
      // Unknown Firebase user → safe fallback
      state.currentUser = {
        uid: fbUser.uid,
        email: fbUser.email,
        name: fbUser.email.split('@')[0],
        initials: fbUser.email.slice(0,2).toUpperCase(),
        role: 'team_member',
        color: '#6366f1',
        projectIds: []
      };
      console.warn('[RBAC] Firebase user not found in users collection — defaulting to team_member:', fbUser.email);
    }
    console.log('[RBAC] Resolved user:', state.currentUser.email, '→ role:', state.currentUser.role);
    applyMenuVisibility();
    updateSidebarUserDisplay();
  }

  // ── Member edit permission: member can only edit tasks assigned to themselves ──
  // Admin and PM can edit any task in their visible projects.
  function canEditTask(task){
    if(!task) return false;
    if(isAdmin()) return true;
    if(isSeniorManager()) return true;
    if(isProgramManager()){
      const ids = _visibleProjectIds();
      return !ids || ids.includes(task.project);
    }
    if(isViewer()) return false;
    // team_member: only if they are the assignee
    const cu = _user();
    return cu && task.assignee === cu.id;
  }

  // ── Member edit permission for subtasks ──
  function canEditSubtask(sub){
    if(!sub) return false;
    if(isAdmin()) return true;
    if(isSeniorManager()) return true;
    if(isProgramManager()) return true;
    if(isViewer()) return false;
    const cu = _user();
    return cu && sub.assignee === cu.id;
  }

  // ── Status-change permission for tasks/subtasks: everything canEditTask/canEditSubtask
  // already allows, PLUS the item's own QA Assignee — so a QA Assignee can move/update the
  // status of any task or subtask they are marked as QA Assignee on, even if they are not
  // the (dev) Assignee. This is intentionally narrower than full edit rights: it only gates
  // the status control (dropdown + drag-drop), not the rest of the Edit modal. ──
  function canEditStatus(item){
    if(!item) return false;
    if(isViewer()) return false; // Viewer: unconditionally no status edits, even as QA Assignee
    if(canEditTask(item)) return true;
    const cu = _user();
    return !!(cu && item.qaAssigneeId === cu.id);
  }

  // ── For assignee dropdowns: members may only assign to themselves ──
  // Returns the single allowed user id, or null if unrestricted.
  function memberSelfOnlyId(){
    if(!isMember()) return null;
    const cu = _user();
    return cu ? cu.id : null;
  }

  // ── QA Assignee edit permission: Admin/PM always; the Assignee of the
  // task/subtask itself may also set/change the QA Assignee on that item ──
  function canEditQaAssignee(item){
    if(isAdmin()||isProgramManager()||isSeniorManager()) return true;
    if(!item) return false;
    if(isViewer()) return false;
    const cu = _user();
    return !!(cu && item.assignee === cu.id);
  }

  // ── Subtask creation permission ──
  // Admin/PM: always (unchanged).
  // Task Assignee: always (unchanged — same condition as canEditTask's team_member branch).
  // NEW: Task QA Assignee may also create Subtasks, but ONLY under that specific
  // Task (not project/org-wide). They get the same Subtask-creation permissions as
  // a Team Member — no Program Manager powers are granted via this path. The
  // Assignee dropdown restriction to self/Unassigned is already enforced separately
  // by memberSelfOnlyId() for any non-admin/PM user, so it applies here unchanged.
  function canCreateSubtask(task){
    if(!task) return false;
    if(isAdmin()||isProgramManager()||isSeniorManager()) return true;
    if(isViewer()) return false;
    const cu = _user();
    if(!cu) return false;
    return task.assignee === cu.id || task.qaAssigneeId === cu.id;
  }

  // ── Task/Subtask delete permission ──
  // Admin: always. Program Manager / Senior Manager: only when their
  // per-member "Can Delete Tasks" toggle (set from the Teams page → Edit
  // Member modal) has been switched on. Everyone else: no delete rights.
  function canDeleteAnyTask(){
    if(isAdmin()) return true;
    const cu = _user();
    return !!(cu && (cu.role === 'program_manager' || cu.role === 'senior_manager') && cu.canDeleteTasks === true);
  }

  return {
    isAdmin, isProgramManager, isMember, isSeniorManager, isViewer,
    canAccess, canManageProject,
    canEditTask, canEditSubtask, canEditStatus, memberSelfOnlyId, canEditQaAssignee, canCreateSubtask,
    canDeleteAnyTask,
    getVisibleProjects, getVisibleTasks,
    getVisibleSprints, getVisibleReleases, getVisibleEpics,
    applyMenuVisibility, accessDeniedHTML, init
  };
})();
// Update sidebar bottom user info after auth resolves
function updateSidebarUserDisplay(){
  const u = state.currentUser;
  if(!u) return;
  const nameEl   = document.getElementById('sidebar-user-name');
  const roleEl   = document.getElementById('sidebar-user-role');
  const avatarEl = document.getElementById('sidebar-user-avatar');
  if(nameEl) nameEl.textContent = u.name || u.email || 'User';
  if(roleEl){
    const roleLabels = { admin:'Admin', senior_manager:'Senior Manager', program_manager:'Prog. Manager', team_member:'Team Member', member:'Team Member', viewer:'Viewer' };
    roleEl.textContent = roleLabels[u.role] || 'Team Member';
  }
  if(avatarEl){
    avatarEl.textContent = u.initials || (u.email||'?').slice(0,2).toUpperCase();
    avatarEl.style.background = u.color || '#6366f1';
  }
}

