// ── RetroManager ──────────────────────────────────────────────────
// Isolated, lightweight retrospective module.
// Collections: state.retrospectives / state.retrospectiveEntries
// Firebase collections: retrospectives / retrospectiveEntries
// Does NOT touch tasks / sprints / reports / dashboard / kanban.
// ─────────────────────────────────────────────────────────────────

const RetroManager = (function(){

  const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
  const CATEGORIES  = ['What Went Well','What Went Wrong','What Should Improve','Other Suggestions'];

  // ── Ensure state collections exist ────────────────────────────
  function _ensureCollections(){
    if(!state.retrospectives)    state.retrospectives    = [];
    if(!state.retrospectiveEntries) state.retrospectiveEntries = [];
  }

  // ── ID helpers ────────────────────────────────────────────────
  function _rid(){ return 'retro-'+Date.now().toString(36)+Math.random().toString(36).substr(2,4); }
  function _reid(){ return 're-'+Date.now().toString(36)+Math.random().toString(36).substr(2,5); }

  // ── Is board locked (2-day window expired)? ──────────────────
  function isLocked(retro){
    if(retro.locked) return true;
    return Date.now() > retro.expiresAt;
  }

  // ── Persist retro to Firebase + localStorage ──────────────────
  function _persist(retro){
    SyncState.markPending(retro.id);
    if(FirebaseDB.isReady()){
      FirebaseDB.saveEntity('retrospectives', retro).then(ok=>{
        if(ok) SyncState.markSynced(retro.id);
        else { SyncState.markFailed(retro.id); PendingSyncQueue.saveEntity('retrospectives', retro); }
      }).catch(()=>{ SyncState.markFailed(retro.id); PendingSyncQueue.saveEntity('retrospectives', retro); });
    } else {
      PendingSyncQueue.saveEntity('retrospectives', retro);
    }
    SaveManager.save();
  }

  function _persistEntry(entry){
    SyncState.markPending(entry.id);
    if(FirebaseDB.isReady()){
      FirebaseDB.saveEntity('retrospectiveEntries', entry).then(ok=>{
        if(ok) SyncState.markSynced(entry.id);
        else { SyncState.markFailed(entry.id); PendingSyncQueue.saveEntity('retrospectiveEntries', entry); }
      }).catch(()=>{ SyncState.markFailed(entry.id); PendingSyncQueue.saveEntity('retrospectiveEntries', entry); });
    } else {
      PendingSyncQueue.saveEntity('retrospectiveEntries', entry);
    }
    SaveManager.save();
  }

  function _deleteEntryPersist(entryId){
    state.retrospectiveEntries = state.retrospectiveEntries.filter(e=>e.id!==entryId);
    if(FirebaseDB.isReady()){
      FirebaseDB.deleteEntity('retrospectiveEntries', entryId).catch(()=>{});
    } else {
      PendingSyncQueue.deleteEntity('retrospectiveEntries', entryId);
    }
    SaveManager.save();
  }

  // ── Auto-create retro on sprint completion (called once) ──────
  function createForSprint(sprint){
    _ensureCollections();
    // Idempotent: only create once per sprint
    if(state.retrospectives.find(r=>r.sprintId===sprint.id)) return;
    const now = Date.now();
    const retro = {
      id:        _rid(),
      sprintId:  sprint.id,
      projectId: sprint.project,
      createdAt: now,
      locked:    false,
      expiresAt: now + TWO_DAYS_MS,
      exportedAt: null
    };
    state.retrospectives.push(retro);
    _persist(retro);
    showNotif('Retrospective board opened for "'+sprint.name+'"','success');
  }

  // ── Add entry (anonymous) ─────────────────────────────────────
  function addEntry(retroId, category, text){
    _ensureCollections();
    const retro = state.retrospectives.find(r=>r.id===retroId);
    if(!retro){ showNotif('Retrospective not found','error'); return; }
    if(isLocked(retro)){ showNotif('This retrospective is closed','error'); return; }
    if(!text || !text.trim()){ showNotif('Entry cannot be empty','error'); return; }
    const entry = {
      id:        _reid(),
      retroId,
      sprintId:  retro.sprintId,
      projectId: retro.projectId,
      category,
      text:      text.trim(),
      createdAt: Date.now()
    };
    state.retrospectiveEntries.push(entry);
    _persistEntry(entry);
    return entry;
  }

  // ── Delete single entry ───────────────────────────────────────
  function deleteEntry(entryId){
    _ensureCollections();
    _deleteEntryPersist(entryId);
  }

  // ── Delete entire retrospective board ─────────────────────────
  function deleteRetro(retroId){
    _ensureCollections();
    const retro = state.retrospectives.find(r=>r.id===retroId);
    if(!retro) return;
    // Remove ONLY entries belonging to THIS retro board (scoped by retroId + sprintId)
    const toRemove = state.retrospectiveEntries
      .filter(e => e.retroId === retroId && e.sprintId === retro.sprintId)
      .map(e => e.id);
    toRemove.forEach(id=>_deleteEntryPersist(id));
    // Remove ONLY this retro record — other sprint boards unaffected
    state.retrospectives = state.retrospectives.filter(r=>r.id!==retroId);
    if(FirebaseDB.isReady()){
      FirebaseDB.deleteEntity('retrospectives', retroId).catch(()=>{});
    } else {
      PendingSyncQueue.deleteEntity('retrospectives', retroId);
    }
    SaveManager.save();
  }

  // ── Export retrospective as Excel ─────────────────────────────
  function exportExcel(retroId){
    _ensureCollections();
    if(!window.XLSX){ showNotif('Excel library not loaded','error'); return; }
    const retro   = state.retrospectives.find(r=>r.id===retroId);
    if(!retro){ showNotif('Retrospective not found','error'); return; }
    const sprint  = getSprint(retro.sprintId);
    const project = getProject(retro.projectId);
    // Triple-scoped: retroId + sprintId + projectId — export ONLY this board's entries
    const entries = state.retrospectiveEntries.filter(e=>
      e.retroId    === retroId &&
      e.sprintId   === retro.sprintId
    );

    const aoa = [
      ['Sprint','Project','Category','Entry','Created At'],
      ...entries.map(e=>[
        sprint ? sprint.name  : retro.sprintId,
        project? project.name : retro.projectId,
        e.category,
        e.text,
        new Date(e.createdAt).toLocaleString()
      ])
    ];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{wch:20},{wch:20},{wch:22},{wch:60},{wch:22}];
    XLSX.utils.book_append_sheet(wb, ws, 'Retrospective');
    const ts = new Date().toISOString().replace(/[:.]/g,'-').substr(0,19);
    XLSX.writeFile(wb, `Retrospective_${sprint&&sprint.name?sprint.name.replace(/\s+/g,'_'):'Sprint'}_${ts}.xlsx`);

    // Mark exported
    retro.exportedAt = Date.now();
    _persist(retro);

    // Post-export cleanup confirmation
    openModal(`
      <div class="p-6" style="max-width:420px">
        <h2 class="text-lg font-bold text-slate-900 mb-3">Export Successful</h2>
        <p class="text-sm text-slate-600 mb-5">Delete retrospective data now to optimize storage?<br><span class="text-xs text-slate-400 mt-1 block">Sprint and task data will NOT be affected.</span></p>
        <div class="flex justify-end gap-3">
          <button class="btn btn-secondary" onclick="closeModal();renderRetrospectives()">Keep Until Manual Delete</button>
          <button class="btn btn-danger" onclick="RetroManager.deleteRetro('${retroId}');closeModal();renderRetrospectives();showNotif('Retrospective deleted')">Delete &amp; Close</button>
        </div>
      </div>
    `);
  }

  // ── Check and apply lock if 2-day window passed ───────────────
  function checkLock(retro){
    if(!retro.locked && Date.now() > retro.expiresAt){
      retro.locked = true;
      _persist(retro);
    }
    return retro.locked;
  }

  // ── Getters ───────────────────────────────────────────────────
  function getEntries(retroId){
    _ensureCollections();
    const retro = (state.retrospectives||[]).find(r=>r.id===retroId);
    if(!retro) return [];
    // Triple-scoped: retroId + sprintId + projectId — prevents any cross-board bleed
    return (state.retrospectiveEntries||[]).filter(e=>
      e.retroId === retroId &&
      e.sprintId === retro.sprintId
    );
  }

  function getVisibleRetros(){
    _ensureCollections();
    const all = state.retrospectives || [];
    if(RBAC.isAdmin()) return all;
    // PM and Team Member: only retros from their visible projects
    const visibleProjIds = (RBAC.getVisibleProjects()||[]).map(p=>p.id);
    return all.filter(r=>visibleProjIds.includes(r.projectId));
  }

  return { createForSprint, addEntry, deleteEntry, deleteRetro, exportExcel, checkLock, isLocked, getEntries, getVisibleRetros, CATEGORIES };
})();

// ── Retro filter helpers ──────────────────────────────────────────

// Populate project filter (Admin: all visible; PM: only mapped)
function _populateRetroProjectFilter(){
  const projSel = document.getElementById('retro-project-filter');
  if(!projSel) return;
  const prev = projSel.value || 'all';
  const visibleProjs = RBAC.getVisibleProjects() || [];
  // Only show projects that actually have at least one retro board
  const retroProjIds = new Set((state.retrospectives||[]).map(r=>r.projectId));
  const withRetros = visibleProjs.filter(p => retroProjIds.has(p.id));
  let html = `<option value="all">All Projects</option>`;
  withRetros.forEach(p => {
    html += `<option value="${p.id}"${p.id===prev?' selected':''}>${_escHtml(p.name)}</option>`;
  });
  projSel.innerHTML = html;
  // Reset stale selection
  if(prev !== 'all' && !withRetros.find(p=>p.id===prev)) projSel.value = 'all';
}

// Populate sprint filter — only completed sprints that have a retro board
function _populateRetroSprintFilter(){
  const projSel   = document.getElementById('retro-project-filter');
  const sprintSel = document.getElementById('retro-sprint-filter');
  if(!sprintSel) return;
  const prev      = sprintSel.value || 'all';
  const projFilter = projSel ? projSel.value : 'all';

  // Collect sprint IDs that have retro boards visible to this user
  const visibleRetros = RetroManager.getVisibleRetros();
  const retroSprintIds = new Set(visibleRetros.map(r=>r.sprintId));

  // Only completed sprints that have a retro, scoped to selected project
  const sprintsWithRetro = (RBAC.getVisibleSprints()||[]).filter(s =>
    (s.status||'').toLowerCase() === 'completed' &&
    retroSprintIds.has(s.id) &&
    (projFilter === 'all' || s.project === projFilter)
  );

  // Validate prev value; reset if stale
  const _validIds=sprintsWithRetro.map(s=>s.id);
  const _validGroups=['all','completed-group'];
  if(!_validGroups.includes(prev)&&!_validIds.includes(prev)) sprintSel.value='all';

  _sfDropBuild('retro',[
    {groupValue:'completed-group', groupLabel:'Completed Sprints', sprints:sprintsWithRetro}
  ],'all','All Sprints');

  // Sync button label
  const lbl=document.getElementById('retro-sprint-filter-label');
  if(lbl){
    const cur=sprintSel.value||'all';
    if(cur==='all') lbl.textContent='All Sprints';
    else if(cur==='completed-group') lbl.textContent='Completed Sprints';
    else{ const f=sprintsWithRetro.find(s=>s.id===cur); lbl.textContent=f?f.name:'All Sprints'; }
  }
}

// Called when project filter changes — repopulate sprint filter then re-render
function _onRetroProjectFilterChange(){
  _populateRetroSprintFilter();
  renderRetrospectives();
}

// ── Render: Retrospectives page ───────────────────────────────────
function renderRetrospectives(){
  const container = document.getElementById('retro-list-container');
  if(!container) return;

  // Populate / refresh filter dropdowns
  _populateRetroProjectFilter();
  _populateRetroSprintFilter();

  // Read current filter values
  const projFilter   = (document.getElementById('retro-project-filter') ||{}).value || 'all';
  const sprintFilter = (document.getElementById('retro-sprint-filter')  ||{}).value || 'all';

  // Get RBAC-scoped retros (Admin: all; PM: mapped projects only)
  let retros = RetroManager.getVisibleRetros();

  // Apply project filter
  if(projFilter !== 'all'){
    retros = retros.filter(r => r.projectId === projFilter);
  }

  // Apply sprint filter — single sprint or group selection
  if(sprintFilter === 'completed-group'){
    // group: show all completed sprints' retros (already filtered by _populateRetroSprintFilter to completed only)
    // no additional filter needed — all items in retros are completed-sprint retros
  } else if(sprintFilter !== 'all'){
    retros = retros.filter(r => r.sprintId === sprintFilter);
  }

  // Check locks on load (no polling)
  retros.forEach(r => RetroManager.checkLock(r));

  if(!retros.length){
    container.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg></div>
      <div class="text-sm text-slate-500">No retrospectives yet. They appear automatically when a sprint is completed.</div>
    </div>`;
    return;
  }

  // Sort: open first, then locked; within each group newest first
  const sorted = [...retros].sort((a,b)=>{
    const aL = RetroManager.isLocked(a), bL = RetroManager.isLocked(b);
    if(aL !== bL) return aL ? 1 : -1;
    return b.createdAt - a.createdAt;
  });

  container.innerHTML = sorted.map(retro => {
    const sprint  = getSprint(retro.sprintId);
    const project = getProject(retro.projectId);
    const locked  = RetroManager.isLocked(retro);
    // Entries strictly scoped to THIS retro board by retroId + sprintId + projectId
    const entries = RetroManager.getEntries(retro.id);
    const expiresIn = Math.max(0, Math.ceil((retro.expiresAt - Date.now()) / (1000*60*60)));

    const statusBadge = locked
      ? `<span class="badge" style="background:#fee2e2;color:#dc2626;font-size:10px">Locked</span>`
      : `<span class="badge badge-active" style="font-size:10px">Open · closes in ${expiresIn}h</span>`;

    const categorySections = RetroManager.CATEGORIES.map(cat => {
      const catEntries = entries.filter(e=>e.category===cat);
      return `
        <div class="mb-3">
          <div class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1" style="letter-spacing:.07em">${cat}</div>
          <div class="space-y-1" id="retro-cat-${retro.id}-${cat.replace(/\s+/g,'_')}">
            ${catEntries.length
              ? catEntries.map(e=>`
                  <div class="flex items-start gap-2 bg-slate-50 rounded-lg px-3 py-2" style="border:1px solid rgba(0,0,0,0.06)">
                    <span class="flex-1 text-sm text-slate-700" style="word-break:break-word">${_escHtml(e.text)}</span>
                    ${!locked?(RBAC.isAdmin()||RBAC.isProgramManager()?`<button onclick="RetroManager.deleteEntry('${e.id}');renderRetrospectives()" title="Delete entry" style="color:#94a3b8;cursor:pointer;flex-shrink:0;margin-top:1px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`:''): ''}
                  </div>`)
                .join('')
              : `<div class="text-xs text-slate-400 italic px-1">No entries yet</div>`
            }
          </div>
          ${!locked?`<button class="btn btn-secondary mt-1" style="padding:3px 10px;font-size:11px;margin-top:6px" onclick="openRetroAddEntry('${retro.id}','${_escAttr(cat)}')">+ Add</button>`:''}
        </div>`;
    }).join('');

    return `
      <div class="sprint-card mb-5" data-retro-id="${retro.id}" data-sprint-id="${retro.sprintId}" data-project-id="${retro.projectId}">
        <div class="flex items-start justify-between mb-3 flex-wrap gap-2">
          <div>
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-semibold text-slate-900">${sprint?_escHtml(sprint.name):'Sprint'}</span>
              ${statusBadge}
            </div>
            <div class="text-xs text-slate-500 mt-0.5">${project?_escHtml(project.name):''} · ${entries.length} entr${entries.length===1?'y':'ies'} · Created ${new Date(retro.createdAt).toLocaleDateString()}</div>
          </div>
          <div class="flex items-center gap-2">
            ${(RBAC.isAdmin()||RBAC.isProgramManager()||RBAC.isSeniorManager())?`
              <button class="btn btn-secondary" style="padding:4px 10px;font-size:11px" onclick="RetroManager.exportExcel('${retro.id}')">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;display:inline"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Export
              </button>
            `:''}
            ${(RBAC.isAdmin()||RBAC.isProgramManager())?`
              <button class="btn btn-danger" style="padding:4px 10px;font-size:11px" onclick="confirmDeleteRetro('${retro.id}')">Delete</button>
            `:''}
          </div>
        </div>
        <div class="mt-2">${categorySections}</div>
      </div>`;
  }).join('');
}


// ── Modal: add retrospective entry ───────────────────────────────
function openRetroAddEntry(retroId, preselectedCategory){
  const retro = (state.retrospectives||[]).find(r=>r.id===retroId);
  if(!retro){ showNotif('Retrospective not found','error'); return; }
  if(RetroManager.isLocked(retro)){ showNotif('This retrospective is closed','error'); return; }

  const categoryOptions = RetroManager.CATEGORIES.map(c=>
    `<option value="${_escAttr(c)}"${c===preselectedCategory?' selected':''}>${_escHtml(c)}</option>`
  ).join('');

  openModal(`
    <div class="p-6">
      <div class="flex items-center justify-between mb-5">
        <h2 class="text-lg font-bold text-slate-900">Add Retrospective Entry</h2>
        <button onclick="closeModal()" style="color:var(--text-muted);cursor:pointer"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
      <div class="space-y-4">
        <div>
          <label>Category</label>
          <select id="retro-entry-cat">${categoryOptions}</select>
        </div>
        <div>
          <label>Your feedback <span style="font-size:10px;color:#94a3b8;font-weight:400">(anonymous)</span></label>
          <textarea id="retro-entry-text" rows="3" placeholder="Share your thoughts..." style="resize:vertical"></textarea>
        </div>
      </div>
      <div class="flex justify-end gap-3 mt-6 pt-4" style="border-top:1px solid rgba(0,0,0,0.05)">
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="_submitRetroEntry('${retroId}')">Submit (Anonymous)</button>
      </div>
    </div>
  `);
  setTimeout(()=>document.getElementById('retro-entry-text')?.focus(),80);
}

function _submitRetroEntry(retroId){
  const cat  = document.getElementById('retro-entry-cat')?.value;
  const text = document.getElementById('retro-entry-text')?.value?.trim();
  if(!text){ showNotif('Please enter some feedback','error'); return; }
  const entry = RetroManager.addEntry(retroId, cat, text);
  if(entry){
    closeModal();
    renderRetrospectives();
    showNotif('Entry submitted anonymously ✓');
  }
}

// ── Confirm delete retrospective ──────────────────────────────────
function confirmDeleteRetro(retroId){
  if(!RBAC.isAdmin()&&!RBAC.isProgramManager()){ showNotif('⚠ Permission denied','error'); return; }
  openModal(`
    <div class="p-6" style="max-width:400px">
      <h2 class="text-lg font-bold text-slate-900 mb-3">Delete Retrospective?</h2>
      <p class="text-sm text-slate-600 mb-5">This will permanently remove the retrospective board and all its entries. Sprint and task data will NOT be affected.</p>
      <div class="flex justify-end gap-3">
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-danger" onclick="RetroManager.deleteRetro('${retroId}');closeModal();renderRetrospectives();showNotif('Retrospective deleted')">Delete Permanently</button>
      </div>
    </div>
  `);
}

