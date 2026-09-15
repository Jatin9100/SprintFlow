// ─── REPORTS EXPORT HELPERS ────────────────────────────────────────

function _rptToast(msg,color){
  let t=document.getElementById('_rpt_toast_el');
  if(!t){
    t=document.createElement('div');
    t.id='_rpt_toast_el';
    t.className='network-toast';
    document.body.appendChild(t);
  }
  t.innerHTML=msg;
  t.style.background=color||'rgba(16,18,26,0.95)';
  t.classList.add('visible');
  clearTimeout(t._timer);
  t._timer=setTimeout(()=>t.classList.remove('visible'),3200);
}

// ── Export menu: stable delegated close — no accumulating listeners ──
let _rptExportMenuListenerAttached = false;
function toggleRptExportMenu(){
  const menu=document.getElementById('rpt-export-menu');
  if(!menu)return;
  const isOpen=menu.style.display==='block';
  menu.style.display=isOpen?'none':'block';
  if(!isOpen && !_rptExportMenuListenerAttached){
    _rptExportMenuListenerAttached=true;
    document.addEventListener('click',function _closeExportMenu(e){
      const wrap=document.getElementById('rpt-export-wrap');
      if(wrap&&!wrap.contains(e.target)){
        const m=document.getElementById('rpt-export-menu');
        if(m) m.style.display='none';
      }
    });
  }
}

function _getReportExportData(){
  const fd=_getFilteredReportsData();
  const _rt=fd.tasks;
  const _rs=fd.sprints;
  const _rp=fd.projects;
  const _rl=fd.releases;

  // KPI summary
  const activeSprints=_rs.filter(s=>s.status==='active').length;
  const openTasks=_rt.filter(t=>t.status==='open').length;
  const _expAllSubs=(_rt).flatMap(t=>t.subtasks||[]);
  const releasedTasks=_rt.filter(t=>DONE_STATUSES.includes(t.status)).length+_expAllSubs.filter(s=>DONE_STATUSES.includes(s.status)).length;
  const openBugs=_rt.filter(t=>t.type==='bug'&&!DONE_STATUSES.includes(t.status)).length;
  const totalTasks=_rt.length+_expAllSubs.length;
  const sprintComp=totalTasks?Math.round((releasedTasks/totalTasks)*100):0;
  const reopenCount=_rt.filter(t=>t.status==='reopen').length;
  const reopenRate=totalTasks?Math.round((reopenCount/totalTasks)*100):0;
  const readyForProd=_rt.filter(t=>t.status==='ready-for-prod').length+_expAllSubs.filter(s=>s.status==='ready-for-prod').length;
  const releaseReady=totalTasks?Math.round((readyForProd/totalTasks)*100):0;

  // Productivity rows — using QA point-split attribution
  const prodRows=state.users.map(u=>{
    const uTasks=_rt.filter(t=>_qaItemBelongsTo(t,u.id));
    const uSubs=_rt.flatMap(t=>t.subtasks||[]).filter(s=>_qaItemBelongsTo(s,u.id));
    const allItems=[...uTasks,...uSubs];
    const completed=allItems.filter(i=>DONE_STATUSES.includes(i.status)).length;
    const active=allItems.filter(i=>['dev-in-progress','qa-in-progress','in-qa'].includes(i.status)).length;
    const points=allItems.filter(i=>DONE_STATUSES.includes(i.status)).reduce((a,i)=>a+_qaPointsFor(i,u.id),0);
    const totalPts=allItems.reduce((a,i)=>a+_qaPointsFor(i,u.id),0);
    const reopen=uTasks.filter(t=>t.status==='reopen').length;
    const pct=allItems.length?Math.round((completed/allItems.length)*100):0;
    return [u.name,allItems.length,completed,active,points,totalPts,reopen,pct+'%'];
  }).filter(r=>r[1]>0);

  // Project breakdown rows
  const projRows=_rp.map(p=>{
    const pTasks=_rt.filter(t=>t.project===p.id);
    const pAllSubs=(pTasks).flatMap(t=>t.subtasks||[]);
    const done=pTasks.filter(t=>DONE_STATUSES.includes(t.status)).length+pAllSubs.filter(s=>DONE_STATUSES.includes(s.status)).length;
    const bugs=pTasks.filter(t=>t.type==='bug'&&!DONE_STATUSES.includes(t.status)).length;
    const pTotalWithSubs=pTasks.length+pAllSubs.length;
    const pct=pTotalWithSubs?Math.round((done/pTotalWithSubs)*100):0;
    return [p.name,pTotalWithSubs,done,bugs,pct+'%',p.status||'—'];
  });

  // Task list rows — enhanced with Epic, Task Type, Tags, Products, QA Assignee columns
  // Column order: Title | Task Type | Type | Epic | Status | Priority | Assignee | QA Assignee | Project | Sprint | Tags | Products | Pts
  const _re=fd.epics||[];
  const _allTaskRows=[];
  _rt.forEach(t=>{
    const proj=_rp.find(p=>p.id===t.project);
    const sprint=_rs.find(s=>s.id===t.sprint);
    const user=state.users.find(u=>u.id===t.assignee);
    const qaUser=t.qaAssigneeId?state.users.find(u=>u.id===t.qaAssigneeId):null;
    const epic=t.epicId?_re.find(e=>e.id===t.epicId):null;
    const tags=(t.tags||[]).join(', ')||'*';
    const products=(t.products||[]).join(', ')||'*';
    _allTaskRows.push([
      t.title||'—',
      'Task',
      t.type||'task',
      epic?epic.title:'*',
      t.status||'open',
      t.priority||'medium',
      user?user.name:'Unassigned',
      qaUser?qaUser.name:(t.qaAssigneeName||'—'),
      proj?proj.name:'—',
      sprint?sprint.name:'—',
      tags,
      products,
      t.points||0
    ]);
    // Include subtasks as rows
    (t.subtasks||[]).forEach(s=>{
      const sUser=state.users.find(u=>u.id===s.assignee);
      const sQaUser=s.qaAssigneeId?state.users.find(u=>u.id===s.qaAssigneeId):null;
      const sTags=(s.tags||[]).join(', ')||'*';
      const sProducts=(s.products||[]).join(', ')||'*';
      const sEpic=s.epicId?_re.find(e=>e.id===s.epicId):(epic||null);
      _allTaskRows.push([
        s.title||'—',
        'Subtask',
        s.type||'task',
        sEpic?sEpic.title:'*',
        s.status||'open',
        s.priority||'medium',
        sUser?sUser.name:'Unassigned',
        sQaUser?sQaUser.name:(s.qaAssigneeName||'—'),
        proj?proj.name:'—',
        sprint?sprint.name:'—',
        sTags,
        sProducts,
        s.points||0
      ]);
    });
  });
  const _allTaskMeta=[];
  _rt.forEach(t=>{
    const _subCount=(t.subtasks||[]).length;
    _allTaskMeta.push({isSubtask:false, hasSubtasks:_subCount>0});
    (t.subtasks||[]).forEach(()=>_allTaskMeta.push({isSubtask:true, hasSubtasks:true}));
  });
  const taskRows=_allTaskRows.slice(0,200);
  const taskMeta=_allTaskMeta.slice(0,200);

  return {activeSprints,openTasks,releasedTasks,openBugs,totalTasks,sprintComp,reopenRate,releaseReady,prodRows,projRows,taskRows,taskMeta,_rp,_rs};
}

// ══════════════════════════════════════════════════════════════════════════
//  SPRINTFLOW — EXPORT MODAL SYSTEM
//  Used by: Export Full Database + Export Audit Logs
//  Export Full Database: Project / Sprint / Assignee multi-select filters
//  Export Audit Logs: date-range pickers (unchanged)
// ══════════════════════════════════════════════════════════════════════════

// ── Export Full Database: in-modal filter state ──────────────────────────
const _expSelProjs     = new Set();
const _expSelSprints   = new Set();
const _expSelAssignees = new Set();

/** Open the export modal.
 *  @param {'full'|'audit'} exportType
 */
function openExportDateRangeModal(exportType) {
  // Close dropdown first
  const menu = document.getElementById('rpt-export-menu');
  if (menu) menu.style.display = 'none';

  // ── RBAC guard ──
  if (exportType === 'audit' && !RBAC.isAdmin()) {
    _rptToast('🔒 Audit Logs export is restricted to Admins.', 'rgba(220,38,38,0.96)');
    return;
  }
  if (exportType === 'full' && RBAC.isMember()) {
    _rptToast('🔒 Excel export is not available for Members.', 'rgba(220,38,38,0.96)');
    return;
  }

  // ── Route: Audit Logs → legacy date modal; Full DB → new filter modal ──
  if (exportType === 'audit') {
    _openAuditExportModal();
    return;
  }

  // ── Program Manager: restricted to Sprint-only selection (own projects) ──
  const _pmRestricted = !RBAC.isAdmin() && RBAC.isProgramManager();

  // ── Full Database: Project / Sprint / Assignee modal ──────────────────
  _expSelProjs.clear(); _expSelSprints.clear(); _expSelAssignees.clear();

  const modalId = '_export_dr_modal';
  const stale = document.getElementById(modalId);
  if (stale) stale.remove();

  const accentColor = '#6366f1';
  const accentBg    = 'rgba(99,102,241,0.1)';
  const icon        = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>';

  const overlay = document.createElement('div');
  overlay.id = modalId;
  overlay.style.cssText = 'position:fixed;inset:0;z-index:10001;background:rgba(8,10,20,0.54);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);display:flex;align-items:center;justify-content:center;padding:16px;font-family:"DM Sans",sans-serif;opacity:0;transition:opacity 0.2s ease';

  const _modalTitle    = _pmRestricted ? 'Export Sprint Data' : 'Export Full Database';
  const _modalSubtitle = _pmRestricted
    ? 'Select one or more sprints from your projects to export.'
    : 'Filter by project, sprint, or assignee. Leave blank to export all visible data.';

  overlay.innerHTML = `
    <div style="background:rgba(255,255,255,0.98);border:1px solid rgba(255,255,255,0.9);border-radius:20px;width:min(520px,95vw);
      box-shadow:0 36px 90px rgba(0,0,0,0.22),0 10px 36px rgba(0,0,0,0.1),inset 0 1px 0 #fff;
      backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);
      transform:translateY(22px) scale(0.972);opacity:0;
      transition:transform 0.26s cubic-bezier(.34,1.38,.64,1),opacity 0.2s ease" id="_dr_box">
      <!-- Header -->
      <div style="padding:24px 26px 0;display:flex;align-items:flex-start;gap:14px">
        <div style="width:44px;height:44px;border-radius:12px;background:${accentBg};color:${accentColor};display:flex;align-items:center;justify-content:center;flex-shrink:0">${icon}</div>
        <div style="flex:1">
          <div style="font-size:17px;font-weight:700;color:#0d0f14;letter-spacing:-.02em">${_modalTitle}</div>
          <div style="font-size:13px;color:#64748b;margin-top:3px">${_modalSubtitle}</div>
        </div>
        <button onclick="closeExportDateRangeModal()" style="width:32px;height:32px;border:none;background:rgba(0,0,0,0.05);border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background 0.15s" onmouseover="this.style.background='rgba(0,0,0,0.09)'" onmouseout="this.style.background='rgba(0,0,0,0.05)'">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <!-- Filters -->
      <div style="padding:18px 26px 0;display:flex;flex-direction:column;gap:12px">
        ${_pmRestricted ? '' : `
        <!-- Projects -->
        <div>
          <label style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8;display:block;margin-bottom:5px">Projects</label>
          <button id="_exp_proj_btn" onclick="_expToggleProjDrop()" style="width:100%;height:38px;border:1px solid rgba(0,0,0,0.09);border-radius:9px;padding:0 12px;font-size:13px;font-family:'DM Sans',sans-serif;color:#475569;background:#f4f5f9;cursor:pointer;display:flex;align-items:center;justify-content:space-between;transition:border-color 0.15s,box-shadow 0.15s" onmouseover="this.style.borderColor='${accentColor}'" onmouseout="this.style.borderColor='rgba(0,0,0,0.09)'">
            <span id="_exp_proj_label">All Projects</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
        </div>`}
        <!-- Sprints -->
        <div>
          <label style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8;display:block;margin-bottom:5px">Sprints${_pmRestricted ? ' (your projects)' : ''}</label>
          <button id="_exp_spr_btn" onclick="_expToggleSprintDrop()" style="width:100%;height:38px;border:1px solid rgba(0,0,0,0.09);border-radius:9px;padding:0 12px;font-size:13px;font-family:'DM Sans',sans-serif;color:#475569;background:#f4f5f9;cursor:pointer;display:flex;align-items:center;justify-content:space-between;transition:border-color 0.15s,box-shadow 0.15s" onmouseover="this.style.borderColor='${accentColor}'" onmouseout="this.style.borderColor='rgba(0,0,0,0.09)'">
            <span id="_exp_spr_label">${_pmRestricted ? 'Select Sprint(s)' : 'All Sprints'}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
        </div>
        ${_pmRestricted ? '' : `
        <!-- Assignees -->
        <div>
          <label style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8;display:block;margin-bottom:5px">Assignees</label>
          <button id="_exp_asgn_btn" onclick="_expToggleAssigneeDrop()" style="width:100%;height:38px;border:1px solid rgba(0,0,0,0.09);border-radius:9px;padding:0 12px;font-size:13px;font-family:'DM Sans',sans-serif;color:#475569;background:#f4f5f9;cursor:pointer;display:flex;align-items:center;justify-content:space-between;transition:border-color 0.15s,box-shadow 0.15s" onmouseover="this.style.borderColor='${accentColor}'" onmouseout="this.style.borderColor='rgba(0,0,0,0.09)'">
            <span id="_exp_asgn_label">All Assignees</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
        </div>`}
      </div>
      <!-- Info row -->
      <div style="margin:14px 26px 0;background:rgba(248,249,252,0.92);border-radius:9px;padding:11px 14px;font-size:12.5px;color:#475569;display:flex;align-items:center;gap:8px;border:1px solid rgba(0,0,0,0.052)">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span id="_exp_info_text">${_pmRestricted ? 'Select at least one sprint to export.' : 'No filters selected — all visible data will be exported.'}</span>
      </div>
      <!-- Action Buttons -->
      <div style="padding:18px 26px 22px;display:flex;justify-content:flex-end;gap:10px">
        <button onclick="closeExportDateRangeModal()" style="height:38px;padding:0 18px;border:1px solid rgba(0,0,0,0.09);border-radius:9px;background:rgba(255,255,255,0.95);color:#64748b;font-size:13px;font-weight:600;font-family:'DM Sans',sans-serif;cursor:pointer;transition:background 0.14s" onmouseover="this.style.background='#f4f5f9'" onmouseout="this.style.background='rgba(255,255,255,0.95)'">Cancel</button>
        <button onclick="confirmExportDateRange('full')" style="height:38px;padding:0 22px;border:none;border-radius:9px;background:${accentColor};color:#fff;font-size:13px;font-weight:700;font-family:'DM Sans',sans-serif;cursor:pointer;transition:opacity 0.14s,transform 0.12s;box-shadow:0 2px 8px rgba(0,0,0,0.18)" onmouseover="this.style.opacity='0.88'" onmouseout="this.style.opacity='1'" onmousedown="this.style.transform='scale(0.97)'" onmouseup="this.style.transform='scale(1)'">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:5px;vertical-align:-2px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Generate Export
        </button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  requestAnimationFrame(() => {
    overlay.style.opacity = '1';
    const box = document.getElementById('_dr_box');
    if (box) { box.style.transform = 'translateY(0) scale(1)'; box.style.opacity = '1'; }
  });

  overlay.addEventListener('click', e => { if (e.target === overlay) closeExportDateRangeModal(); });
}

// ── Export filter dropdown helpers ───────────────────────────────────────

function _expUpdateInfoText() {
  const el = document.getElementById('_exp_info_text');
  if (!el) return;
  const parts = [];
  if (_expSelProjs.size)     parts.push(_expSelProjs.size     === 1 ? '1 project'    : _expSelProjs.size     + ' projects');
  if (_expSelSprints.size)   parts.push(_expSelSprints.size   === 1 ? '1 sprint'     : _expSelSprints.size   + ' sprints');
  if (_expSelAssignees.size) parts.push(_expSelAssignees.size === 1 ? '1 assignee'   : _expSelAssignees.size + ' assignees');
  el.textContent = parts.length
    ? 'Exporting data matching: ' + parts.join(', ') + '.'
    : 'No filters selected — all visible data will be exported.';
}

function _expToggleProjDrop() {
  const p = document.getElementById('sf-msdrop-panel');
  if (p && p.style.display !== 'none' && _expToggleProjDrop._open) {
    _sfMsDrop.apply(); _expToggleProjDrop._open = false; return;
  }
  const allProj = RBAC.getVisibleProjects();
  const active    = allProj.filter(p => (p.status||'').toLowerCase() === 'active');
  const completed = allProj.filter(p => (p.status||'').toLowerCase() === 'completed');
  const items = [
    ...active.map(p    => ({ id: p.id, name: p.name, group: active.length    ? 'Active'    : '' })),
    ...completed.map(p => ({ id: p.id, name: p.name, group: completed.length ? 'Completed' : '' }))
  ];
  _sfMsDrop.open(
    document.getElementById('_exp_proj_btn'),
    items,
    _expSelProjs,
    sel => {
      _expSelProjs.clear(); sel.forEach(id => _expSelProjs.add(id));
      _expOnProjApply();
    },
    document.getElementById('_exp_proj_label')
  );
  document.getElementById('_exp_proj_label').dataset.allLabel = 'All Projects';
  _expToggleProjDrop._open = true;
}
_expToggleProjDrop._open = false;

function _expOnProjApply() {
  // Prune sprint selections no longer in scope
  const selPids = [..._expSelProjs];
  if (selPids.length) {
    [..._expSelSprints].forEach(sid => {
      const s = RBAC.getVisibleSprints().find(x => x.id === sid);
      if (!s || !selPids.includes(s.project)) _expSelSprints.delete(sid);
    });
    const sprLbl = document.getElementById('_exp_spr_label');
    if (sprLbl) {
      if (_expSelSprints.size === 0) sprLbl.textContent = 'All Sprints';
      else if (_expSelSprints.size === 1) {
        const s = RBAC.getVisibleSprints().find(x => x.id === [..._expSelSprints][0]);
        sprLbl.textContent = s ? s.name : '1 selected';
      } else sprLbl.textContent = _expSelSprints.size + ' selected';
    }
    // Also prune assignees if sprints changed
    _expPruneAssignees();
  }
  _expUpdateInfoText();
}

function _expToggleSprintDrop() {
  const p = document.getElementById('sf-msdrop-panel');
  if (p && p.style.display !== 'none' && _expToggleSprintDrop._open) {
    _sfMsDrop.apply(); _expToggleSprintDrop._open = false; return;
  }
  const selPids = [..._expSelProjs];
  let allSpr = RBAC.getVisibleSprints();
  if (selPids.length) allSpr = allSpr.filter(s => selPids.includes(s.project));
  const active    = allSpr.filter(s => (s.status||'').toLowerCase() === 'active');
  const completed = allSpr.filter(s => (s.status||'').toLowerCase() === 'completed');
  const items = [
    ...active.map(s    => ({ id: s.id, name: s.name, group: active.length    ? 'Active'    : '' })),
    ...completed.map(s => ({ id: s.id, name: s.name, group: completed.length ? 'Completed' : '' }))
  ];
  _sfMsDrop.open(
    document.getElementById('_exp_spr_btn'),
    items,
    _expSelSprints,
    sel => {
      _expSelSprints.clear(); sel.forEach(id => _expSelSprints.add(id));
      _expPruneAssignees();
      _expUpdateInfoText();
    },
    document.getElementById('_exp_spr_label')
  );
  document.getElementById('_exp_spr_label').dataset.allLabel = 'All Sprints';
  _expToggleSprintDrop._open = true;
}
_expToggleSprintDrop._open = false;

function _expPruneAssignees() {
  // Prune assignee selections that no longer match project/sprint scope
  if (!_expSelAssignees.size) return;
  const validIds = new Set(_expGetScopedUsers().map(u => u.id));
  [..._expSelAssignees].forEach(uid => { if (!validIds.has(uid)) _expSelAssignees.delete(uid); });
  const asgnLbl = document.getElementById('_exp_asgn_label');
  if (asgnLbl) {
    if (_expSelAssignees.size === 0) asgnLbl.textContent = 'All Assignees';
    else if (_expSelAssignees.size === 1) {
      const u = (state.users || []).find(x => x.id === [..._expSelAssignees][0]);
      asgnLbl.textContent = u ? (u.name || u.email || '1 selected') : '1 selected';
    } else asgnLbl.textContent = _expSelAssignees.size + ' selected';
  }
}

function _expGetScopedUsers() {
  const selPids = [..._expSelProjs];
  const selSids = [..._expSelSprints];
  // No project/sprint filter selected → show all users (same as every other assignee dropdown)
  if (!selPids.length && !selSids.length) {
    return RBAC.isAdmin()
      ? (state.users || [])
      : RBAC.getVisibleTasks(state.tasks || []).reduce((acc, t) => {
          const ids = new Set(acc.map(u => u.id));
          if (t.assignee && !ids.has(t.assignee)) { const u = (state.users||[]).find(x=>x.id===t.assignee); if(u) acc.push(u); }
          (t.subtasks||[]).forEach(s => { if(s.assignee && !ids.has(s.assignee)){ const u=(state.users||[]).find(x=>x.id===s.assignee); if(u){ acc.push(u); ids.add(u.id); } } });
          return acc;
        }, []);
  }
  // Project/sprint filter active → narrow to assignees within that scope
  let tasks = RBAC.getVisibleTasks(state.tasks || []);
  if (selPids.length) tasks = tasks.filter(t => selPids.includes(t.project));
  if (selSids.length) tasks = tasks.filter(t => selSids.includes(t.sprint));
  const assigneeIds = new Set();
  tasks.forEach(t => {
    if (t.assignee) assigneeIds.add(t.assignee);
    (t.subtasks || []).forEach(s => { if (s.assignee) assigneeIds.add(s.assignee); });
  });
  return (state.users || []).filter(u => assigneeIds.has(u.id));
}

function _expToggleAssigneeDrop() {
  const p = document.getElementById('sf-msdrop-panel');
  if (p && p.style.display !== 'none' && _expToggleAssigneeDrop._open) {
    _sfMsDrop.apply(); _expToggleAssigneeDrop._open = false; return;
  }
  const users = _expGetScopedUsers();
  const items = users.map(u => ({ id: u.id, name: u.name || u.email || u.id, group: '' }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  _sfMsDrop.open(
    document.getElementById('_exp_asgn_btn'),
    items,
    _expSelAssignees,
    sel => {
      _expSelAssignees.clear(); sel.forEach(id => _expSelAssignees.add(id));
      _expUpdateInfoText();
    },
    document.getElementById('_exp_asgn_label')
  );
  document.getElementById('_exp_asgn_label').dataset.allLabel = 'All Assignees';
  _expToggleAssigneeDrop._open = true;
}
_expToggleAssigneeDrop._open = false;

// ── Audit Logs modal (date-range, unchanged logic) ────────────────────────

function _drFmtDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function _openAuditExportModal() {
  const modalId = '_export_dr_modal';
  const stale = document.getElementById(modalId);
  if (stale) stale.remove();

  const now    = new Date();
  const toStr  = _drFmtDate(now);
  const from30 = new Date(now); from30.setDate(from30.getDate() - 30);
  const fromStr = _drFmtDate(from30);

  const overlay = document.createElement('div');
  overlay.id = modalId;
  overlay.style.cssText = 'position:fixed;inset:0;z-index:10001;background:rgba(8,10,20,0.54);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);display:flex;align-items:center;justify-content:center;padding:16px;font-family:"DM Sans",sans-serif;opacity:0;transition:opacity 0.2s ease';

  const accentColor = '#a855f7';
  const accentBg    = 'rgba(168,85,247,0.1)';
  const icon        = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>';

  overlay.innerHTML = `
    <div style="background:rgba(255,255,255,0.98);border:1px solid rgba(255,255,255,0.9);border-radius:20px;width:min(520px,95vw);
      box-shadow:0 36px 90px rgba(0,0,0,0.22),0 10px 36px rgba(0,0,0,0.1),inset 0 1px 0 #fff;
      backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);
      transform:translateY(22px) scale(0.972);opacity:0;
      transition:transform 0.26s cubic-bezier(.34,1.38,.64,1),opacity 0.2s ease" id="_dr_box">
      <div style="padding:24px 26px 0;display:flex;align-items:flex-start;gap:14px">
        <div style="width:44px;height:44px;border-radius:12px;background:${accentBg};color:${accentColor};display:flex;align-items:center;justify-content:center;flex-shrink:0">${icon}</div>
        <div style="flex:1">
          <div style="font-size:17px;font-weight:700;color:#0d0f14;letter-spacing:-.02em">Export Audit Logs</div>
          <div style="font-size:13px;color:#64748b;margin-top:3px">Select a date range to export enterprise audit logs.</div>
        </div>
        <button onclick="closeExportDateRangeModal()" style="width:32px;height:32px;border:none;background:rgba(0,0,0,0.05);border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background 0.15s" onmouseover="this.style.background='rgba(0,0,0,0.09)'" onmouseout="this.style.background='rgba(0,0,0,0.05)'">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div style="padding:16px 26px 0;display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div>
          <label style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8;display:block;margin-bottom:5px">From Date</label>
          <input type="date" id="_dr_from" value="${fromStr}" style="width:100%;height:38px;border:1px solid rgba(0,0,0,0.09);border-radius:9px;padding:0 12px;font-size:13.5px;font-family:'DM Sans',sans-serif;color:#0d0f14;background:#f4f5f9;outline:none;transition:border-color 0.15s,box-shadow 0.15s" onfocus="this.style.borderColor='${accentColor}';this.style.boxShadow='0 0 0 3px rgba(168,85,247,0.14)'" onblur="this.style.borderColor='rgba(0,0,0,0.09)';this.style.boxShadow='none'" onchange="drUpdateEstimate('audit')">
        </div>
        <div>
          <label style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8;display:block;margin-bottom:5px">To Date</label>
          <input type="date" id="_dr_to" value="${toStr}" style="width:100%;height:38px;border:1px solid rgba(0,0,0,0.09);border-radius:9px;padding:0 12px;font-size:13.5px;font-family:'DM Sans',sans-serif;color:#0d0f14;background:#f4f5f9;outline:none;transition:border-color 0.15s,box-shadow 0.15s" onfocus="this.style.borderColor='${accentColor}';this.style.boxShadow='0 0 0 3px rgba(168,85,247,0.14)'" onblur="this.style.borderColor='rgba(0,0,0,0.09)';this.style.boxShadow='none'" onchange="drUpdateEstimate('audit')">
        </div>
      </div>
      <div id="_dr_estimate" style="margin:14px 26px 0;background:rgba(248,249,252,0.92);border-radius:9px;padding:11px 14px;font-size:12.5px;color:#475569;display:flex;align-items:center;gap:8px;border:1px solid rgba(0,0,0,0.052)">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span id="_dr_estimate_text">Calculating estimated records…</span>
      </div>
      <div style="padding:18px 26px 22px;display:flex;justify-content:flex-end;gap:10px">
        <button onclick="closeExportDateRangeModal()" style="height:38px;padding:0 18px;border:1px solid rgba(0,0,0,0.09);border-radius:9px;background:rgba(255,255,255,0.95);color:#64748b;font-size:13px;font-weight:600;font-family:'DM Sans',sans-serif;cursor:pointer;transition:background 0.14s" onmouseover="this.style.background='#f4f5f9'" onmouseout="this.style.background='rgba(255,255,255,0.95)'">Cancel</button>
        <button onclick="confirmExportDateRange('audit')" style="height:38px;padding:0 22px;border:none;border-radius:9px;background:${accentColor};color:#fff;font-size:13px;font-weight:700;font-family:'DM Sans',sans-serif;cursor:pointer;transition:opacity 0.14s,transform 0.12s;box-shadow:0 2px 8px rgba(0,0,0,0.18)" onmouseover="this.style.opacity='0.88'" onmouseout="this.style.opacity='1'" onmousedown="this.style.transform='scale(0.97)'" onmouseup="this.style.transform='scale(1)'">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:5px;vertical-align:-2px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Generate Export
        </button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    overlay.style.opacity = '1';
    const box = document.getElementById('_dr_box');
    if (box) { box.style.transform = 'translateY(0) scale(1)'; box.style.opacity = '1'; }
  });
  overlay.addEventListener('click', e => { if (e.target === overlay) closeExportDateRangeModal(); });
  setTimeout(() => drUpdateEstimate('audit'), 100);
}

function drUpdateEstimate(exportType) {
  // Only used for audit modal
  const fromEl = document.getElementById('_dr_from');
  const toEl   = document.getElementById('_dr_to');
  const estEl  = document.getElementById('_dr_estimate_text');
  if (!fromEl || !toEl || !estEl) return;
  const from = new Date(fromEl.value);
  const to   = new Date(toEl.value);
  if (isNaN(from) || isNaN(to) || from > to) {
    estEl.textContent = 'Invalid date range — please check From / To dates.';
    return;
  }
  const diffDays = Math.round((to - from) / 86400000) + 1;
  const baseEvents = (state.tasks ? state.tasks.length : 0) * 4;
  const estimated  = Math.round(baseEvents * (diffDays / 30));
  estEl.textContent = `Estimated ~${estimated.toLocaleString()} audit events across ${diffDays} days`;
}

function closeExportDateRangeModal() {
  const overlay = document.getElementById('_export_dr_modal');
  if (!overlay) return;
  overlay.style.opacity = '0';
  const box = document.getElementById('_dr_box');
  if (box) { box.style.transform = 'translateY(16px) scale(0.97)'; box.style.opacity = '0'; }
  setTimeout(() => overlay.remove(), 220);
}

function confirmExportDateRange(exportType) {
  if (exportType === 'full') {
    // ── Program Manager: sprint-only, own-projects export — mandatory sprint selection ──
    const _pmRestricted = !RBAC.isAdmin() && RBAC.isProgramManager();
    if (_pmRestricted) {
      if (!_expSelSprints.size) {
        const infoEl = document.getElementById('_exp_info_text');
        if (infoEl) infoEl.textContent = '⚠ Please select at least one sprint before exporting.';
        return;
      }
      closeExportDateRangeModal();
      setTimeout(() => {
        exportReportExcel('full', null, null, {
          projectIds:  [],
          sprintIds:   [..._expSelSprints],
          assigneeIds: []
        });
      }, 260);
      return;
    }
    // Use Project/Sprint/Assignee filter state — no date validation needed
    closeExportDateRangeModal();
    setTimeout(() => {
      exportReportExcel('full', null, null, {
        projectIds:  [..._expSelProjs],
        sprintIds:   [..._expSelSprints],
        assigneeIds: [..._expSelAssignees]
      });
    }, 260);
    return;
  }

  // Audit: date validation
  const fromEl = document.getElementById('_dr_from');
  const toEl   = document.getElementById('_dr_to');
  if (!fromEl || !toEl) return;
  const fromDate = fromEl.value;
  const toDate   = toEl.value;
  if (!fromDate || !toDate || new Date(fromDate) > new Date(toDate)) {
    const est = document.getElementById('_dr_estimate_text');
    if (est) est.textContent = '⚠ Please select a valid date range before exporting.';
    return;
  }
  closeExportDateRangeModal();
  setTimeout(() => { exportAuditLogs(fromDate, toDate); }, 260);
}

// ══════════════════════════════════════════════════════════════════════════
//  SPRINTFLOW — EXPORT AUDIT LOGS ENGINE
//  Generates a multi-sheet XLSX workbook with full activity tracking.
//  All data is derived from state + simulated logs for demo.
// ══════════════════════════════════════════════════════════════════════════

async function exportAuditLogs(fromDate, toDate) {
  if (!RBAC.isAdmin()) {
    _rptToast('🔒 Audit Logs export is restricted to Admins.', 'rgba(220,38,38,0.96)');
    return;
  }

  if (!window.XLSX) {
    _rptToast('⚠ Excel library not loaded — please wait and retry.', '#dc2626');
    return;
  }

  _xlSetBtnState(true);
  _xlShowLoader(true);
  _xlSetTitle('Building Audit Log Export…');
  _xlProgress(5, 'Collecting audit data…', '');

  const MAX_RETRIES = 2;
  let retryCount = 0;

  async function _doAuditExport() {
    try {
      await _xlYield(60);

      const from     = new Date(fromDate);
      const to       = new Date(toDate);
      const user     = (window.getCurrentUser && window.getCurrentUser()) ? window.getCurrentUser().email : 'Admin';
      const now      = new Date();
      const dateStr  = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      const timeStr  = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

      _xlProgress(12, 'Generating activity events…', 'Sheet 1/8');
      const tasks   = state.tasks    || [];
      const sprints = state.sprints  || [];
      const users   = state.users    || [];
      const projects= state.projects || [];

      // ── Helper: generate synthetic audit events ──
      function _makeAuditEvents() {
        const events = [];
        const statuses  = ['open','dev-in-progress','in-qa','ready-for-prod','released','reopen'];
        const actions   = ['Task Created','Status Changed','Assignee Changed','Priority Changed','Sprint Changed','Comment Added','Task Updated','Task Deleted'];
        const modules   = ['Tasks','Sprints','Releases','Epics','Comments','Users','Settings'];
        const devices   = ['Chrome/Windows','Safari/macOS','Chrome/macOS','Firefox/Linux','Mobile/iOS','Mobile/Android'];

        tasks.forEach((t, i) => {
          const tDate = t.createdAt ? new Date(t.createdAt) : new Date(from.getTime() + Math.random() * (to - from));
          if (tDate < from || tDate > to) return;

          const proj = projects.find(p => p.id === t.project);
          const assigneeUser = users.find(u => u.id === t.assignee);
          const sprint = sprints.find(s => s.id === t.sprint);

          // Create event
          events.push({
            timestamp   : tDate.toISOString().replace('T',' ').substring(0,19),
            user        : assigneeUser ? assigneeUser.name : user,
            role        : assigneeUser ? (assigneeUser.role || 'member') : 'admin',
            actionType  : 'Task Created',
            module      : 'Tasks',
            oldValue    : '—',
            newValue    : t.status || 'open',
            taskId      : t.id || ('T-' + (i+1)),
            sprintId    : sprint ? sprint.id : '—',
            project     : proj ? proj.name : '—',
            device      : devices[i % devices.length],
            sessionId   : 'SES-' + Math.random().toString(36).substring(2,10).toUpperCase(),
            syncStatus  : 'Synced',
            remarks     : 'Automatic creation event'
          });

          // Status change event
          if (t.status && t.status !== 'open') {
            const chDate = new Date(tDate.getTime() + 86400000 * (Math.random() * 3 + 1));
            events.push({
              timestamp   : chDate.toISOString().replace('T',' ').substring(0,19),
              user        : assigneeUser ? assigneeUser.name : user,
              role        : assigneeUser ? (assigneeUser.role || 'member') : 'admin',
              actionType  : 'Status Changed',
              module      : 'Tasks',
              oldValue    : 'open',
              newValue    : t.status,
              taskId      : t.id || ('T-' + (i+1)),
              sprintId    : sprint ? sprint.id : '—',
              project     : proj ? proj.name : '—',
              device      : devices[(i+1) % devices.length],
              sessionId   : 'SES-' + Math.random().toString(36).substring(2,10).toUpperCase(),
              syncStatus  : 'Synced',
              remarks     : 'Status transition'
            });
          }
        });

        // Add login events
        users.forEach((u, i) => {
          const lDate = new Date(from.getTime() + Math.random() * (to - from));
          events.push({
            timestamp  : lDate.toISOString().replace('T',' ').substring(0,19),
            user       : u.name || u.email || '—',
            role       : u.role || 'member',
            actionType : 'User Login',
            module     : 'Auth',
            oldValue   : '—',
            newValue   : 'Authenticated',
            taskId     : '—',
            sprintId   : '—',
            project    : '—',
            device     : devices[i % devices.length],
            sessionId  : 'SES-' + Math.random().toString(36).substring(2,10).toUpperCase(),
            syncStatus : 'Synced',
            remarks    : 'Firebase Auth login'
          });
        });

        events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
        return events;
      }

      const auditEvents = _makeAuditEvents();
      await _xlYield();

      // ── SHEET BUILDERS ──

      function _auditHeaderStyle() {
        return { font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 10 }, fill: { fgColor: { rgb: '5B5FC7' } }, alignment: { wrapText: true } };
      }

      function _mkSheet(headers, rows) {
        const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
        ws['!cols'] = headers.map(h => ({ wch: Math.max(h.length + 2, 14) }));
        return ws;
      }

      _xlProgress(20, 'Building Audit Summary…', 'Sheet 1/8');
      // Sheet 1: Audit Summary
      const totalEvents   = auditEvents.length;
      const taskCreated   = auditEvents.filter(e => e.actionType === 'Task Created').length;
      const statusChanged = auditEvents.filter(e => e.actionType === 'Status Changed').length;
      const loginEvents   = auditEvents.filter(e => e.actionType === 'User Login').length;

      const summaryRows = [
        ['Report Title',   'SprintFlow Audit Log Export'],
        ['Generated By',   user],
        ['Generated At',   `${dateStr} at ${timeStr}`],
        ['Date Range',     `${fromDate} to ${toDate}`],
        ['Total Events',   totalEvents],
        ['Task Created',   taskCreated],
        ['Status Changes', statusChanged],
        ['Login Events',   loginEvents],
        ['Users Tracked',  users.length],
        ['Projects',       projects.length],
        ['Export Version', 'SprintFlow v23 Enterprise'],
      ];
      const wsSummary = XLSX.utils.aoa_to_sheet([['Metric', 'Value'], ...summaryRows]);
      wsSummary['!cols'] = [{ wch: 22 }, { wch: 40 }];
      await _xlYield();

      _xlProgress(32, 'Building User Activities…', 'Sheet 2/8');
      // Sheet 2: User Activities
      const userActivityHeaders = ['Timestamp','User','Role','Action Type','Module','Old Value','New Value','Task ID','Sprint ID','Project','Device','Session ID','Sync Status','Remarks'];
      const userActivityRows = auditEvents.filter(e => e.actionType !== 'System').map(e => [
        e.timestamp, e.user, e.role, e.actionType, e.module, e.oldValue, e.newValue,
        e.taskId, e.sprintId, e.project, e.device, e.sessionId, e.syncStatus, e.remarks
      ]);
      const wsUserActs = _mkSheet(userActivityHeaders, userActivityRows);
      await _xlYield();

      _xlProgress(44, 'Building Task Activities…', 'Sheet 3/8');
      // Sheet 3: Task Activities
      const taskActHeaders = ['Timestamp','User','Action Type','Task ID','Old Status','New Status','Project','Sprint ID','Remarks'];
      const taskActRows = auditEvents.filter(e => e.module === 'Tasks').map(e => [
        e.timestamp, e.user, e.actionType, e.taskId, e.oldValue, e.newValue, e.project, e.sprintId, e.remarks
      ]);
      const wsTaskActs = _mkSheet(taskActHeaders, taskActRows);
      await _xlYield();

      _xlProgress(54, 'Building System Events…', 'Sheet 4/8');
      // Sheet 4: System Events (Firebase sync etc.)
      const sysHeaders = ['Timestamp','Event Type','Module','Status','Details'];
      const sysRows = [
        [new Date().toISOString().replace('T',' ').substring(0,19), 'Firebase Sync', 'Database', 'Success', 'Full sync completed'],
        [new Date(Date.now()-3600000).toISOString().replace('T',' ').substring(0,19), 'Cache Invalidate', 'State', 'Success', 'State maps invalidated'],
        [new Date(Date.now()-7200000).toISOString().replace('T',' ').substring(0,19), 'Auth Token Refresh', 'Auth', 'Success', 'Firebase Auth token refreshed'],
        [new Date(Date.now()-14400000).toISOString().replace('T',' ').substring(0,19), 'Realtime Listener', 'Database', 'Active', 'onValue listeners attached'],
      ];
      const wsSysEvents = _mkSheet(sysHeaders, sysRows);
      await _xlYield();

      _xlProgress(62, 'Building Failed Operations…', 'Sheet 5/8');
      // Sheet 5: Failed Operations
      const failHeaders = ['Timestamp','User','Operation','Error Code','Error Message','Module','Retry Attempted','Resolved'];
      const failRows = [
        // Show any simulated failed ops
        [new Date(Date.now()-86400000).toISOString().replace('T',' ').substring(0,19), user, 'Excel Export', 'ERR_TIMEOUT', 'Export timed out on large dataset', 'Reports', 'Yes (retry 1)', 'Yes'],
      ];
      const wsFailOps = _mkSheet(failHeaders, failRows);
      await _xlYield();

      _xlProgress(70, 'Building Login Sessions…', 'Sheet 6/8');
      // Sheet 6: Login Sessions
      const loginHeaders = ['Timestamp','User','Role','Event','Device','Session ID','IP (Masked)','Status'];
      const loginRows = auditEvents.filter(e => e.actionType === 'User Login').map(e => [
        e.timestamp, e.user, e.role, e.actionType, e.device, e.sessionId, '*.*.*.***', 'Success'
      ]);
      const wsLogin = _mkSheet(loginHeaders, loginRows);
      await _xlYield();

      _xlProgress(80, 'Building Sync Logs…', 'Sheet 7/8');
      // Sheet 7: Sync Logs
      const syncHeaders = ['Timestamp','Sync Type','Status','Records Synced','Duration (ms)','Notes'];
      const syncRows = [];
      for (let i = 0; i < 10; i++) {
        const d = new Date(Date.now() - i * 3600000 * 2);
        syncRows.push([
          d.toISOString().replace('T',' ').substring(0,19),
          i % 3 === 0 ? 'Full Sync' : 'Incremental',
          'Success',
          Math.floor(Math.random() * 100 + 10),
          Math.floor(Math.random() * 800 + 120),
          i % 3 === 0 ? 'Triggered on page load' : 'Realtime update'
        ]);
      }
      const wsSyncLogs = _mkSheet(syncHeaders, syncRows);
      await _xlYield();

      _xlProgress(90, 'Building Export History…', 'Sheet 8/8');
      // Sheet 8: Export History
      const expHistHeaders = ['Timestamp','User','Export Type','Format','Records','Status'];
      const expHistRows = [
        [new Date().toISOString().replace('T',' ').substring(0,19), user, 'Audit Logs', 'XLSX', auditEvents.length, 'In Progress'],
        [new Date(Date.now()-86400000).toISOString().replace('T',' ').substring(0,19), user, 'Full Database', 'XLSX', (state.tasks||[]).length, 'Completed'],
        [new Date(Date.now()-172800000).toISOString().replace('T',' ').substring(0,19), user, 'Analytics', 'XLSX', 3, 'Completed'],
        [new Date(Date.now()-259200000).toISOString().replace('T',' ').substring(0,19), user, 'PDF Report', 'PDF', (state.tasks||[]).length, 'Completed'],
      ];
      const wsExpHist = _mkSheet(expHistHeaders, expHistRows);
      await _xlYield();

      // ── Assemble workbook ──
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, wsSummary,    '📋 Audit Summary');
      XLSX.utils.book_append_sheet(wb, wsUserActs,   '👤 User Activities');
      XLSX.utils.book_append_sheet(wb, wsTaskActs,   '✅ Task Activities');
      XLSX.utils.book_append_sheet(wb, wsSysEvents,  '⚙ System Events');
      XLSX.utils.book_append_sheet(wb, wsFailOps,    '❌ Failed Operations');
      XLSX.utils.book_append_sheet(wb, wsLogin,      '🔑 Login Sessions');
      XLSX.utils.book_append_sheet(wb, wsSyncLogs,   '🔄 Sync Logs');
      XLSX.utils.book_append_sheet(wb, wsExpHist,    '📤 Export History');

      _xlProgress(96, 'Writing audit log file…', 'Finalising…');
      await _xlYield(80);

      const pad = n => String(n).padStart(2,'0');
      const d   = new Date();
      const fname = `SprintFlow_AuditLog_${fromDate}_to_${toDate}_${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}.xlsx`;
      XLSX.writeFile(wb, fname);

      _xlProgress(100, 'Done!', '');
      await _xlYield(80);
      _xlShowLoader(false);
      _xlSetBtnState(false);
      _rptToast(
        `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> Audit Log exported — ${auditEvents.length} events, 8 sheets`,
        'rgba(5,150,105,0.96)'
      );

    } catch (err) {
      console.error('[SprintFlow AuditLog] Export error:', err);
      if (retryCount < MAX_RETRIES) {
        retryCount++;
        _xlProgress(0, `Retrying… (attempt ${retryCount + 1}/${MAX_RETRIES + 1})`, '');
        await _xlYield(900);
        return _doAuditExport();
      }
      _xlShowLoader(false);
      _xlSetBtnState(false);
      _rptToast(
        `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> Audit Log export failed — ${err.message}`,
        'rgba(220,38,38,0.96)'
      );
    }
  }

  await _doAuditExport();
}

// ══════════════════════════════════════════════════════════════════════════
//  SPRINTFLOW — RBAC EXPORT MENU VISIBILITY
//  Call after RBAC.init() to show/hide export menu items per role.
// ══════════════════════════════════════════════════════════════════════════

function _applyExportMenuRBAC() {
  if (!RBAC) return;
  const wrap    = document.getElementById("rpt-export-wrap");
  const fullBtn = document.getElementById("rpt-menu-full-btn");
  // Admin: all options visible (Full Database export, unrestricted filters)
  // Senior Manager: same as Admin — full unrestricted export (org-wide visibility)
  // Program Manager: Export PDF visible; Excel export visible but restricted to
  //                  selecting a Sprint (scoped to their own projects) only —
  //                  no Project / Assignee filters, no unfiltered full dump.
  // Team Member: entire export menu hidden
  if (wrap)    wrap.style.display    = (RBAC.isAdmin() || RBAC.isProgramManager() || RBAC.isSeniorManager()) ? "inline-block" : "none";
  if (fullBtn) {
    fullBtn.style.display = (RBAC.isAdmin() || RBAC.isProgramManager() || RBAC.isSeniorManager()) ? "flex" : "none";
    if (!RBAC.isAdmin() && !RBAC.isSeniorManager() && RBAC.isProgramManager()) {
      const titleEl = fullBtn.querySelector('span > span:first-child');
      const subEl   = fullBtn.querySelector('span > span:last-child');
      if (titleEl) titleEl.textContent = 'Export Sprint Data';
      if (subEl)   subEl.textContent   = 'Select a sprint from your projects';
    }
  }
}

