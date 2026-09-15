// ── v27 PERF: General-purpose debounce factory ──
function _makeDebounce(fn, ms) {
  let t = null;
  return function(...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

// ── v27 PERF: Passive event listener helper ──
function _addPassiveListener(el, type, fn) {
  if (!el) return;
  el.addEventListener(type, fn, { passive: true });
}

// ── v27 PERF: Report filter debounce (150ms) to prevent rapid chart rebuilds ──
let _rptFilterTimer = null;
function _debouncedRenderReports() {
  clearTimeout(_rptFilterTimer);
  _rptFilterTimer = setTimeout(() => renderReports(), 150);
}

// ── v27 PERF: Kanban filter debounce (120ms) ──
let _kanbanFilterTimer = null;
function _debouncedRenderKanban() {
  clearTimeout(_kanbanFilterTimer);
  _kanbanFilterTimer = setTimeout(() => renderKanban(), 120);
}

// ── Backlog Planner filter debounce (100ms) ──
let _backlogPlannerFilterTimer = null;
function _debouncedRenderBacklogPlanner() {
  clearTimeout(_backlogPlannerFilterTimer);
  _backlogPlannerFilterTimer = setTimeout(() => renderBacklogPlanner(), 100);
}

// ── Sprint Planning filter debounce (100ms) ──
let _sprintPlanFilterTimer = null;
function _debouncedRenderSprintPlanning() {
  clearTimeout(_sprintPlanFilterTimer);
  _sprintPlanFilterTimer = setTimeout(() => renderSprintPlanning(), 100);
}

// ── Teams search debounce (150ms) — was calling renderTeams() on every
// keystroke with no debounce, unlike every other filtered page ──
let _teamsFilterTimer = null;
function _debouncedRenderTeams() {
  clearTimeout(_teamsFilterTimer);
  _teamsFilterTimer = setTimeout(() => renderTeams(), 150);
}

let _epicsFilterTimer = null;
function _debouncedRenderEpics() {
  clearTimeout(_epicsFilterTimer);
  _epicsFilterTimer = setTimeout(() => renderEpics(), 100);
}

// ── v27 PERF: Release board filter debounce (100ms) ──
let _releaseBoardTimer = null;
function _debouncedRenderReleaseBoard() {
  clearTimeout(_releaseBoardTimer);
  _releaseBoardTimer = setTimeout(() => { renderReleaseBoard(); renderReleaseQueue(); }, 100);
}

// ─── NAVIGATION ──────────────────────────────────────────────────

// ── Apply RBAC-driven UI gates after every page render ───────────
// Controls visibility of action buttons that live in static HTML.
function applyRbacUI(){
  const isAdmin   = RBAC.isAdmin();
  const isPM      = RBAC.isProgramManager();
  const isMember  = RBAC.isMember();
  const isSM      = RBAC.isSeniorManager();

  // Helper: show/hide an element by id
  function _vis(id, show){
    const el=document.getElementById(id);
    if(el) el.style.display=show?'':'none';
  }

  // Projects page — only admin can create projects
  _vis('btn-new-project', isAdmin);

  // Sprint Planning — admin + PM + Senior Manager can create sprints
  _vis('btn-new-sprint', isAdmin || isPM || isSM);

  // Releases — admin + PM + Senior Manager can create releases
  _vis('btn-new-release', isAdmin || isPM || isSM);

  // Epics — admin + PM + Senior Manager can create epics
  _vis('btn-new-epic', isAdmin || isPM || isSM);

  // Teams — only admin can create members
  _vis('btn-create-member', isAdmin);

  // "New Task" buttons (topbar, Kanban) — hidden for Viewer (no create rights anywhere)
  const isViewer = RBAC.isViewer();
  _vis('btn-new-task-topbar', !isViewer);
  _vis('btn-new-task-kanban', !isViewer);

  // "New Project" card in projects grid (rendered by renderProjects)
  // handled inline in renderProjects() already via RBAC.isAdmin() check

  // Dynamic rendered delete/edit buttons are already gated inside
  // renderTeams(), renderSprintPlanning(), renderReleaseBoard() etc.
}
function navigate(page){
  // Clean up bulk selection when leaving backlog
  if(typeof _blOnNavigate==='function') _blOnNavigate(page);
  // Clean up any in-flight drag state before leaving current page
  if(typeof kanbanDraggedId !== 'undefined') kanbanDraggedId = null;
  if(typeof kanbanDraggedSubtask !== 'undefined') kanbanDraggedSubtask = null;
  if(typeof _lastDragOverCol !== 'undefined') _lastDragOverCol = null; // v27: clear cached drag col ref
  // Remove any lingering drag-over classes from kanban columns
  document.querySelectorAll('.kanban-col.drag-over,.kanban-col.drag-over-sub').forEach(el=>{
    el.classList.remove('drag-over','drag-over-sub');
  });
  // Close any open dropdowns/panels before navigating
  const rptPanel = document.getElementById('rpt-adv-filter-panel');
  if(rptPanel) rptPanel.style.display = 'none';
  const exportMenu = document.getElementById('rpt-export-menu');
  if(exportMenu) exportMenu.style.display = 'none';
  closeSearchDropdown();

  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const pageEl=document.getElementById('page-'+page);
  if(pageEl){pageEl.classList.add('active');currentPage=page;}
  const navEl=document.querySelector(`.nav-item[data-page="${page}"]`);
  if(navEl)navEl.classList.add('active');
  // ── RBAC page guard ──
  if(!RBAC.canAccess(page)){
    if(pageEl) pageEl.innerHTML = RBAC.accessDeniedHTML(page);
    if(window.innerWidth<=768)document.getElementById('sidebar').classList.add('collapsed');
    return;
  }
  renderPage(page);
  // Close sidebar on mobile
  if(window.innerWidth<=768)document.getElementById('sidebar').classList.add('collapsed');
}

let _renderPageInProgress = false;
function renderPage(page){
  // Prevent concurrent renders from stacking (e.g. rapid realtime updates during render)
  if(_renderPageInProgress) return;
  _renderPageInProgress = true;
  destroyCharts();
  _clearDomCache(); // stale IDs after page switch
  _invalidateChartFingerprints(); // v27: reset fingerprints so new page charts always render
  try{
    if(page==='dashboard')renderDashboard();
    else if(page==='projects')renderProjects();
    else if(page==='epics')renderEpics();
    else if(page==='backlog-planner')renderBacklogPlanner();
    else if(page==='sprint-planning')renderSprintPlanning();
    else if(page==='kanban')renderKanban();
    else if(page==='reports')renderReports();
    else if(page==='release-reports')renderReleaseReports();
    else if(page==='epic-reports')renderEpicReports();
    else if(page==='delay-reports')renderDelayReports();
    else if(page==='productivity-report')renderProductivityReport();
    else if(page==='teams')renderTeams();
    else if(page==='releases')renderReleaseBoard();
    else if(page==='settings')renderAdminConfig();
    else if(page==='retrospectives')renderRetrospectives();
  }catch(err){
    console.error('renderPage error on page:',page,err);
  } finally {
    _renderPageInProgress = false;
  }
  // Apply RBAC-driven UI gates after render (safe — idempotent)
  try{ applyRbacUI(); }catch(e){}
}

let _refreshAllTimer = null;
// Production Hardened: debounced to absorb rapid realtime update storms
function refreshAll(){
  invalidateStateMaps();
  // v27: Raised from 60ms to 80ms — absorbs larger update storms at 200+ concurrent users
  // Debounce: if multiple realtime updates arrive in quick succession,
  // only render once after they settle (prevents frozen UI from concurrent renders)
  clearTimeout(_refreshAllTimer);
  _refreshAllTimer = setTimeout(()=>{
    // ── RBAC: if the current page is not accessible for this role (e.g. default
    // landing page 'dashboard' is blocked for Viewer), redirect to a safe page ──
    if(typeof RBAC!=='undefined' && !RBAC.canAccess(currentPage)){
      const _fallbackPage = RBAC.canAccess('backlog-planner') ? 'backlog-planner' : (RBAC.canAccess('kanban') ? 'kanban' : 'dashboard');
      navigate(_fallbackPage);
      updateSidebarProject();
      return;
    }
    renderPage(currentPage);
    updateSidebarProject();
  }, 80);
}

// ── Hidden-tab render optimization ───────────────────────────────
// While the tab is hidden, renderDashboard/renderReports return early
// to avoid expensive chart work. Firebase syncing and state patches
// continue uninterrupted. When the tab becomes visible again, one
// safe refreshAll() brings the UI up to date with any accumulated changes.
if(!window._sfVisibilityListenerAttached){
  document.addEventListener('visibilitychange', ()=>{
    if(!document.hidden){ refreshAll(); }
  });
  window._sfVisibilityListenerAttached = true;
}

document.querySelectorAll('.nav-item').forEach(item=>{
  item.addEventListener('click',()=>navigate(item.dataset.page));
});

// ─── SIDEBAR TOGGLE ──────────────────────────────────────────────
function toggleSidebar(){
  const sb=document.getElementById('sidebar');
  if(!sb)return;
  const icon=document.getElementById('sidebar-toggle-icon');
  const collapsed=sb.classList.toggle('collapsed');
  if(icon){
    if(collapsed){
      icon.innerHTML=`<path d="M13 5l7 7-7 7"/><path d="M5 5l7 7-7 7"/>`;
    }else{
      icon.innerHTML=`<path d="M11 19l-7-7 7-7"/><path d="M19 19l-7-7 7-7"/>`;
    }
  }
}

// TODO(refactor): possible bug — neither 'proj-name-display' nor 'proj-dot' exists
// anywhere in the static HTML (grep finds each id only inside this function's own
// getElementById() call and in selectProject()'s matching lookup). Both lookups here
// are always null, so this function is currently a silent no-op end to end. Pre-existing
// behavior — confirmed not introduced by this refactor, since body markup was never
// touched. Flagging for the team; not fixed here.
function updateSidebarProject(){
  const p=state.projects[0];
  if(p){
    const _nd=document.getElementById('proj-name-display');if(_nd)_nd.textContent=p.name;
    const _dd=document.getElementById('proj-dot');if(_dd)_dd.style.background=p.color;
  }
}

