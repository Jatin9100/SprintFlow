// ══════════════════════════════════════════════════════════════════
//  BULK-SELECT & BULK ACTIONS — v28 (+ Sprint Planning, targeted add)
//  Shared by the Backlog Planner and Sprint Planning pages.
//  Admin + Program Manager + Senior Manager only.
//  Selection keys: "task:{taskId}" | "sub:{taskId}:{subId}"
// ══════════════════════════════════════════════════════════════════
const _bulkSelect = new Set(); // active selection keys

// Other pages (Backlog Planner, Sprint Planning, Release Queue) check
// selection state to decide a checkbox's checked attribute on render. They
// should call this instead of referencing the bare `_bulkSelect` const
// directly — calling a function defined here always resolves against this
// module's own `_bulkSelect`, regardless of how the calling file happens to
// be loaded/scoped, which a direct cross-file `_bulkSelect.has(...)` is not
// guaranteed to do (observed: checkboxes rendering as unchecked immediately
// after a real, verified-correct selection, because the reading file's bare
// reference resolved to a different, empty Set).
function _blIsSelected(key){ return _bulkSelect.has(key); }

// Derive the project a selected key belongs to
function _blKeyProject(key){
  if(key.startsWith('task:')){
    const t=getTask(key.slice(5)); return t?t.project:null;
  }
  if(key.startsWith('sub:')){
    const [,tid]=key.split(':'); const t=getTask(tid); return t?t.project:null;
  }
  return null;
}
// Derive sprint (null = backlog) from a selected key
function _blKeySprint(key){
  if(key.startsWith('task:')){
    const t=getTask(key.slice(5)); return t?(t.sprint||null):null;
  }
  if(key.startsWith('sub:')){
    const [,tid]=key.split(':'); const t=getTask(tid); return t?(t.sprint||null):null;
  }
  return null;
}

// Validation: can we add this key to the current selection?
function _blCanAdd(key){
  if(_bulkSelect.size===0) return {ok:true};
  const proj=_blKeyProject(key);
  const firstProj=_blKeyProject([..._bulkSelect][0]);
  if(proj!==firstProj) return {ok:false, msg:'Bulk actions can only be performed within a single Project.'};
  // The Release Queue only ever selects already-Released tasks to map to a
  // Release — which sprint each one originally came from is irrelevant there,
  // so the backlog/sprint isolation rule below (needed for "Move to Sprint"
  // on Backlog Planner/Sprint Planning) is skipped on the Release Board.
  const onReleasePage = (document.querySelector('.page.active')||{}).id === 'page-releases';
  if(onReleasePage) return {ok:true};
  const sprint=_blKeySprint(key);
  const firstSprint=_blKeySprint([..._bulkSelect][0]);
  // Backlog ↔ Sprint isolation
  if((sprint===null)!==(firstSprint===null)) return {ok:false, msg:'Backlog and Sprint items cannot be bulk-selected together.'};
  // Sprint cross-selection
  if(sprint!==null && firstSprint!==null && sprint!==firstSprint) return {ok:false, msg:'Bulk actions can only be performed within a single Sprint.'};
  return {ok:true};
}

function _blToggleTask(taskId, checkbox){
  const key='task:'+taskId;
  // A task can render in both Backlog and Backlog Planner at once (same underlying
  // item, two views) — sync every matching row via data-task-id, not just the one
  // the click came from, so switching pages never shows a stale checkbox state.
  const rows=document.querySelectorAll('[data-task-id="'+taskId+'"]');
  if(_bulkSelect.has(key)){
    _bulkSelect.delete(key);
    checkbox.checked=false;
    rows.forEach(el=>{ el.classList.remove('bl-selected'); const cb=el.querySelector('.bl-checkbox'); if(cb) cb.checked=false; });
  } else {
    const check=_blCanAdd(key);
    if(!check.ok){ checkbox.checked=false; _blToast(check.msg,'warn'); return; }
    _bulkSelect.add(key);
    checkbox.checked=true;
    rows.forEach(el=>{ el.classList.add('bl-selected'); const cb=el.querySelector('.bl-checkbox'); if(cb) cb.checked=true; });
  }
  _blSyncGroupHeaders();
  _blUpdateBar();
}

function _blToggleSubtask(taskId, subId, checkbox){
  const key='sub:'+taskId+':'+subId;
  if(_bulkSelect.has(key)){
    _bulkSelect.delete(key);
    checkbox.checked=false;
    const el=document.getElementById('bl-item-sub-'+taskId+'-'+subId);
    if(el) el.classList.remove('bl-selected');
  } else {
    const check=_blCanAdd(key);
    if(!check.ok){ checkbox.checked=false; _blToast(check.msg,'warn'); return; }
    _bulkSelect.add(key);
    checkbox.checked=true;
    const el=document.getElementById('bl-item-sub-'+taskId+'-'+subId);
    if(el) el.classList.add('bl-selected');
  }
  _blSyncGroupHeaders();
  _blUpdateBar();
}

function _blClearAll(){
  _bulkSelect.clear();
  // Un-check all visible checkboxes (Backlog Planner + Sprint Planning + Release Queue share this bulk-select feature)
  document.querySelectorAll('#backlog-planner-content .bl-checkbox, #sprint-planning-list .bl-checkbox, #release-queue-list .bl-checkbox, #rq-select-all').forEach(c=>c.checked=false);
  document.querySelectorAll('#backlog-planner-content .bl-selected, #sprint-planning-list .bl-selected, #release-queue-list .bl-selected').forEach(el=>el.classList.remove('bl-selected'));
  _blUpdateBar();
  _blClosePanel();
}

// Keep each group's "select all" checkbox in sync with individual task selections
// (e.g. if every task in a sprint gets checked one-by-one, the header checkbox reflects that).
function _blSyncGroupHeaders(){
  // #rq-select-all lives in a sibling wrapper, not inside #release-queue-list
  // itself, so it's addressed directly by id rather than by descendant selector.
  document.querySelectorAll('#backlog-planner-content .bl-group-select-all, #sprint-planning-list .bl-group-select-all, #rq-select-all').forEach(cb=>{
    let ids=[];
    try{ ids=JSON.parse(cb.dataset.ids||'[]'); }catch(e){ ids=[]; }
    cb.checked = ids.length>0 && ids.every(id=>_bulkSelect.has('task:'+id));
  });
}

// Select/deselect all top-level tasks within a single group (one Sprint, or the
// Product Backlog). Respects the same isolation rules as individual selection:
// a single Project at a time, and Sprint items cannot mix with Backlog items or
// with another Sprint's items. Items that would break isolation are skipped
// (with a toast) rather than blocking the whole action.
function _blToggleGroupAll(checkbox){
  let ids=[];
  try{ ids=JSON.parse(checkbox.dataset.ids||'[]'); }catch(e){ ids=[]; }
  if(checkbox.checked){
    let addedAny=false, skipped=0;
    ids.forEach(id=>{
      const key='task:'+id;
      if(_bulkSelect.has(key)){ addedAny=true; return; }
      const check=_blCanAdd(key);
      if(!check.ok){ skipped++; return; }
      _bulkSelect.add(key);
      addedAny=true;
      // Same task can render in both Backlog and Backlog Planner — sync every matching row
      document.querySelectorAll('[data-task-id="'+id+'"]').forEach(el=>{
        el.classList.add('bl-selected');
        const cb=el.querySelector('.bl-checkbox');
        if(cb) cb.checked=true;
      });
    });
    if(skipped>0){
      _blToast(skipped+' item'+(skipped!==1?'s':'')+' skipped — bulk actions can only be performed within a single Project/Sprint.','warn');
    }
    if(!addedAny) checkbox.checked=false;
  } else {
    ids.forEach(id=>{
      const key='task:'+id;
      if(_bulkSelect.has(key)){
        _bulkSelect.delete(key);
        document.querySelectorAll('[data-task-id="'+id+'"]').forEach(el=>{
          el.classList.remove('bl-selected');
          const cb=el.querySelector('.bl-checkbox');
          if(cb) cb.checked=false;
        });
      }
    });
  }
  _blSyncGroupHeaders();
  _blUpdateBar();
}

function _blUpdateBar(){
  // Only the currently-visible page's bulk toolbar needs updating; it re-syncs
  // itself the next time it renders (see renderBacklogPlanner()/renderSprintPlanning(),
  // which both call _blUpdateBar() at the end).
  const bar=document.querySelector('.page.active .bl-bulk-bar');
  if(!bar) return;
  const label=bar.querySelector('.bl-count-label');
  const moveBtn=bar.querySelector('.bl-move-sprint-btn');
  const delBtn=bar.querySelector('.bl-delete-btn');
  if(!label) return;
  const n=_bulkSelect.size;
  if(n===0){ bar.classList.remove('active'); return; }
  bar.classList.add('active');
  label.textContent=n+' Item'+(n!==1?'s':'')+' Selected';
  // "Move to Sprint" only for pure-backlog selections
  if(moveBtn){
    const allBacklog=[..._bulkSelect].every(k=>_blKeySprint(k)===null);
    moveBtn.style.display=allBacklog?'':'none';
  }
  // "Delete" only for Admins, or a Program/Senior Manager with the Teams-page delete toggle enabled
  if(delBtn) delBtn.style.display=RBAC.canDeleteAnyTask()?'':'none';
  // "Epic" only for Admin, Program Manager, and Senior Manager (not Team Member)
  const epicBtn=bar.querySelector('.bl-epic-btn');
  if(epicBtn) epicBtn.style.display=(RBAC.isAdmin()||RBAC.isProgramManager()||RBAC.isSeniorManager())?'':'none';
  // "Map to Release" — Release Queue only ever selects released tasks, so no
  // extra eligibility check is needed beyond the role gate already applied
  // to mapTaskToRelease()/the single-task flow.
  const mapReleaseBtn=bar.querySelector('.bl-map-release-btn');
  if(mapReleaseBtn) mapReleaseBtn.style.display=(RBAC.isAdmin()||RBAC.isProgramManager()||RBAC.isSeniorManager())?'':'none';
}

function _blToast(msg, type='warn'){
  const t=document.createElement('div');
  t.style.cssText=`position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
    z-index:999;padding:9px 18px;border-radius:10px;font-size:12.5px;font-weight:600;
    box-shadow:0 4px 16px rgba(0,0,0,0.16);white-space:nowrap;pointer-events:none;
    background:${type==='warn'?'#fff7ed':'#fef2f2'};color:${type==='warn'?'#92400e':'#b91c1c'};
    border:1px solid ${type==='warn'?'#fde68a':'#fecaca'}`;
  t.textContent=msg;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(),3200);
}

function _blSuccessToast(msg){
  const t=document.createElement('div');
  t.style.cssText=`position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
    z-index:999;padding:9px 18px;border-radius:10px;font-size:12.5px;font-weight:600;
    box-shadow:0 4px 16px rgba(0,0,0,0.12);white-space:nowrap;pointer-events:none;
    background:#f0fdf4;color:#065f46;border:1px solid #a7f3d0`;
  t.textContent=msg;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(),2800);
}

// Subtask row helper — replaces plain subRows reference so checkbox state applies
function _blSubRows(t, subRowsHtml){ return subRowsHtml; }

// ── BULK DROP PANEL ───────────────────────────────────────────────
let _blPanelCleanup=null;
function _blClosePanel(){
  const p=document.getElementById('bl-drop-panel');
  if(p){ p.className='bl-drop-panel'; p.innerHTML=''; }
  if(_blPanelCleanup){ _blPanelCleanup(); _blPanelCleanup=null; }
}
function _blOpenPanel(anchorBtn, htmlContent, onOutside){
  _blClosePanel();
  const p=document.getElementById('bl-drop-panel');
  if(!p) return;
  // Split the label from the items: first bl-drop-label goes to sticky header, rest scrolls
  // We do this by wrapping: caller passes full html, we restructure it
  // Parse out leading bl-drop-label
  const labelMatch=htmlContent.match(/^(\s*<div class="bl-drop-label">[^<]*<\/div>)([\s\S]*)$/);
  if(labelMatch){
    p.innerHTML=`<div class="bl-drop-panel-header"><div class="bl-drop-label" style="padding:0">${labelMatch[1].replace(/<div class="bl-drop-label">/,'').replace(/<\/div>/,'')}</div></div><div class="bl-drop-panel-body">${labelMatch[2]}</div>`;
  } else {
    p.innerHTML=`<div class="bl-drop-panel-body">${htmlContent}</div>`;
  }
  p.className='bl-drop-panel open';
  // Position below anchor — flip upward if not enough space below
  const rect=anchorBtn.getBoundingClientRect();
  const panelH=Math.min(window.innerHeight*0.6, 400); // estimate
  const spaceBelow=window.innerHeight - rect.bottom - 8;
  const spaceAbove=rect.top - 8;
  let top;
  if(spaceBelow >= 160 || spaceBelow >= spaceAbove){
    top=rect.bottom+6;
  } else {
    // flip upward — position bottom of panel at top of anchor
    top=rect.top - Math.min(panelH, spaceAbove) - 6;
  }
  const pw=p.offsetWidth||240;
  let left=rect.left;
  if(left+pw>window.innerWidth-8) left=window.innerWidth-pw-8;
  if(left<8) left=8;
  p.style.left=left+'px';
  p.style.top=Math.max(8,top)+'px';
  // Close on outside click
  const handler=e=>{
    if(!p.contains(e.target)&&e.target!==anchorBtn){
      _blClosePanel();
    }
  };
  setTimeout(()=>document.addEventListener('mousedown',handler),0);
  _blPanelCleanup=()=>document.removeEventListener('mousedown',handler);
}

// ── BULK ACTION DISPATCH ──────────────────────────────────────────
function _blAction(type){
  if(_bulkSelect.size===0) return;
  const anchorMap={assign:'#bl-bulk-bar .bl-action-btn:nth-of-type(1)',status:null};
  // Resolve the button from whichever page (Backlog or Backlog Planner) is currently visible
  const btn=document.querySelector(`.page.active .bl-bulk-bar .bl-action-btn[onclick*="_blAction('${type}')"]`);

  if(type==='assign')   return _blDoAssign(btn);
  if(type==='status')   return _blDoStatus(btn);
  if(type==='products') return _blDoProducts(btn);
  if(type==='tags')     return _blDoTags(btn);
  if(type==='themes')   return _blDoThemes(btn);
  if(type==='epic')     return _blDoEpic(btn);
  if(type==='sprint')   return _blDoSprint(btn);
  if(type==='delete')   return _blDoDelete(btn);
  if(type==='release')  return _blDoReleaseMap(btn);
}

// Resolve selected tasks + subtask objects
function _blResolvedItems(){
  const tasks=[], subs=[];
  _bulkSelect.forEach(key=>{
    if(key.startsWith('task:')){
      const t=getTask(key.slice(5)); if(t) tasks.push(t);
    } else if(key.startsWith('sub:')){
      const [,tid,sid]=key.split(':');
      const t=getTask(tid); if(!t) return;
      const s=(t.subtasks||[]).find(x=>x.id===sid); if(s) subs.push({task:t,sub:s});
    }
  });
  return {tasks, subs};
}

// ── 1. BULK ASSIGN ────────────────────────────────────────────────
function _blDoAssign(btn){
  // Get users scoped to the selected project using proj.memberIds (same as _assigneeOptionsForProject)
  const projId=_blKeyProject([..._bulkSelect][0]);
  const proj=projId ? state.projects.find(p=>p.id===projId) : null;
  const memberIds = proj && Array.isArray(proj.memberIds) && proj.memberIds.length ? proj.memberIds : null;
  // null memberIds = no project restriction (fallback: show all visible users)
  let visUsers = memberIds
    ? state.users.filter(u => memberIds.includes(u.id))
    : RBAC.isAdmin() ? state.users : (state.users||[]).filter(u=>(u.projectIds||[]).includes(projId));

  const opts=visUsers.map(u=>`<div class="bl-drop-item" onclick="_blApplyAssign('${u.id}')">
    ${userAvatar(u.id,20)} <span>${u.name||u.email}</span>
  </div>`).join('');

  const projName = proj ? proj.name : 'this project';
  _blOpenPanel(btn, `
    <div class="bl-drop-label">Assign to — ${_esc(projName)}</div>
    <div class="bl-drop-item" onclick="_blApplyAssign(null)">
      <div class="avatar" style="width:20px;height:20px;background:#f1f5f9;border:1px dashed #cbd5e1"></div>
      <span style="color:var(--text-tertiary)">Unassigned</span>
    </div>
    ${opts||'<div style="padding:8px 10px;font-size:12px;color:var(--text-tertiary)">No members found for this project</div>'}
  `);
}
function _blApplyAssign(userId){
  const {tasks,subs}=_blResolvedItems();
  tasks.forEach(t=>{ t.assignee=userId; });
  subs.forEach(({task,sub})=>{ sub.assignee=userId; });
  _invalidateMaps(); saveState(); _blClosePanel();
  // Persist each affected task (and parent tasks of affected subtasks) to Firebase
  const affectedTasks=new Map();
  tasks.forEach(t=>affectedTasks.set(t.id,t));
  subs.forEach(({task})=>affectedTasks.set(task.id,task));
  if(FirebaseDB.isReady()) affectedTasks.forEach(t=>FirebaseDB.saveEntity('tasks',t).catch(e=>console.warn('[blApplyAssign] Firebase error:',e)));
  _blSuccessToast(`Assigned ${_bulkSelect.size} item${_bulkSelect.size!==1?'s':''}`);
  _blRerenderCurrentView();
}

// ── 2. BULK STATUS UPDATE ─────────────────────────────────────────
function _blDoStatus(btn){
  const statuses=Object.keys(STATUS_META);
  const opts=statuses.map(s=>`<div class="bl-drop-item" onclick="_blApplyStatus('${s}')">
    <span class="badge badge-${statusBadgeClass(s)}" style="font-size:9px">${statusLabel(s)}</span>
  </div>`).join('');
  _blOpenPanel(btn, `<div class="bl-drop-label">Set Status</div>${opts}`);
}
function _blApplyStatus(newStatus){
  const {tasks,subs}=_blResolvedItems();
  let blocked=0;
  tasks.forEach(t=>{
    const chk=canChangeTaskStatus(t,newStatus);
    if(!chk.ok){ blocked++; return; }
    const resolved=resolveRollbackStatus(newStatus);
    const _drPrevBulk=t.status;
    _trackQAReopen(t,resolved);
    t.status=resolved;
    _drStampCompletionDate(t, _drPrevBulk, resolved, s=>DONE_STATUSES.includes(s));
  });
  subs.forEach(({task,sub})=>{
    // Subtasks use lighter rules — same frozen check
    if(LOCKED_TASK_STATUSES.includes(sub.status)){ blocked++; return; }
    // ── Backlog → Released guard (subtasks inherit sprint from parent task) ──
    if(resolveRollbackStatus(newStatus)==='released'){
      const releaseCheck=canReleaseItem(task);
      if(!releaseCheck.ok){ blocked++; return; }
    }
    const resolved=resolveRollbackStatus(newStatus);
    const _drPrevBulkSub=sub.status;
    _trackQAReopen(sub,resolved);
    sub.status=resolved;
    _drStampCompletionDate(sub, _drPrevBulkSub, resolved, s=>DONE_STATUSES.includes(s));
  });
  _invalidateMaps(); saveState(); _blClosePanel();
  // Persist each affected task (and parent tasks of affected subtasks) to Firebase
  const affectedTasks=new Map();
  tasks.forEach(t=>affectedTasks.set(t.id,t));
  subs.forEach(({task})=>affectedTasks.set(task.id,task));
  if(FirebaseDB.isReady()) affectedTasks.forEach(t=>FirebaseDB.saveEntity('tasks',t).catch(e=>console.warn('[blApplyStatus] Firebase error:',e)));
  const applied=_bulkSelect.size-blocked;
  if(blocked>0) _blToast(`${blocked} item${blocked!==1?'s':''} could not be updated (status rules).`,'warn');
  if(applied>0) _blSuccessToast(`Updated ${applied} item${applied!==1?'s':''} to "${statusLabel(newStatus)}"`);
  _blRerenderCurrentView();
}

// ── 3. BULK PRODUCTS UPDATE ───────────────────────────────────────
function _blDoProducts(btn){
  const projId=_blKeyProject([..._bulkSelect][0]);
  // Scope products to the selected project using projectIds[] (same as create/edit task modal)
  const projProducts=(state.products||[]).filter(p=>(p.projectIds||[]).includes(projId));
  const opts=projProducts.map(p=>`<div class="bl-drop-item" onclick="_blApplyProduct('${p.id}','${_esc(p.name)}','${_esc(p.color||'')}')">
    ${p.color?`<span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${p.color};flex-shrink:0"></span>`:''}
    <span>${_esc(p.name)}</span>
  </div>`).join('');
  _blOpenPanel(btn, `
    <div class="bl-drop-label">Set Product</div>
    <div class="bl-drop-item" onclick="_blApplyProduct(null,null,null)">
      <span style="color:var(--text-tertiary)">— Remove Product</span>
    </div>
    ${opts||'<div style="padding:8px 10px;font-size:12px;color:var(--text-tertiary)">No products for this project</div>'}
  `);
}
function _blApplyProduct(productId, productName, productColor){
  const {tasks,subs}=_blResolvedItems();
  tasks.forEach(t=>{
    t.productId=productId||null;
    t.productName=productName||null;
    t.productColor=productColor||null;
    // Also support productIds array format if used
    t.productIds=productId?[productId]:[];
  });
  subs.forEach(({task,sub})=>{
    sub.productId=productId||null;
    sub.productName=productName||null;
    sub.productColor=productColor||null;
    sub.productIds=productId?[productId]:[];
  });
  _invalidateMaps(); saveState(); _blClosePanel();
  // Persist each affected task (and parent tasks of affected subtasks) to Firebase
  const affectedTasksP=new Map();
  tasks.forEach(t=>affectedTasksP.set(t.id,t));
  subs.forEach(({task})=>affectedTasksP.set(task.id,task));
  if(FirebaseDB.isReady()) affectedTasksP.forEach(t=>FirebaseDB.saveEntity('tasks',t).catch(e=>console.warn('[blApplyProduct] Firebase error:',e)));
  _blSuccessToast(`Product updated on ${_bulkSelect.size} item${_bulkSelect.size!==1?'s':''}`);
  _blRerenderCurrentView();
}

// ── 4. BULK TAGS UPDATE ───────────────────────────────────────────
function _blDoTags(btn){
  const projId=_blKeyProject([..._bulkSelect][0]);
  // Scope tags to the selected project using projectIds[] (same as create/edit task modal)
  const projTags=(state.tags||[]).filter(tg=>(tg.projectIds||[]).includes(projId));
  const opts=projTags.map(tg=>`<div class="bl-drop-item" onclick="_blApplyTag('${tg.id}','${_esc(tg.name)}','${_esc(tg.color||'')}')">
    ${tg.color?`<span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${tg.color};flex-shrink:0"></span>`:''}
    <span>${_esc(tg.name)}</span>
  </div>`).join('');
  _blOpenPanel(btn, `
    <div class="bl-drop-label">Set Tag</div>
    <div class="bl-drop-item" onclick="_blApplyTag(null,null,null)">
      <span style="color:var(--text-tertiary)">— Remove Tags</span>
    </div>
    ${opts||'<div style="padding:8px 10px;font-size:12px;color:var(--text-tertiary)">No tags for this project</div>'}
  `);
}
function _blApplyTag(tagId, tagName, tagColor){
  const {tasks,subs}=_blResolvedItems();
  tasks.forEach(t=>{
    t.tagId=tagId||null;
    t.tagName=tagName||null;
    t.tags=tagId?[tagName].filter(Boolean):[];
    t.tagIds=tagId?[tagId]:[];
  });
  subs.forEach(({task,sub})=>{
    sub.tagId=tagId||null;
    sub.tagName=tagName||null;
    sub.tags=tagId?[tagName].filter(Boolean):[];
    sub.tagIds=tagId?[tagId]:[];
  });
  _invalidateMaps(); saveState(); _blClosePanel();
  // Persist each affected task (and parent tasks of affected subtasks) to Firebase
  const affectedTasksT=new Map();
  tasks.forEach(t=>affectedTasksT.set(t.id,t));
  subs.forEach(({task})=>affectedTasksT.set(task.id,task));
  if(FirebaseDB.isReady()) affectedTasksT.forEach(t=>FirebaseDB.saveEntity('tasks',t).catch(e=>console.warn('[blApplyTag] Firebase error:',e)));
  _blSuccessToast(`Tags updated on ${_bulkSelect.size} item${_bulkSelect.size!==1?'s':''}`);
  _blRerenderCurrentView();
}

// ── 5. BULK THEMES UPDATE ─────────────────────────────────────────
function _blDoThemes(btn){
  const projId=_blKeyProject([..._bulkSelect][0]);
  // Scope themes to selected project using projectIds[] (same as create/edit task modal)
  const projThemes=(state.themes||[]).filter(th=>(th.projectIds||[]).includes(projId));
  const opts=projThemes.map(th=>`<div class="bl-drop-item" onclick="_blApplyTheme('${th.id}')">
    <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${th.color||'var(--accent)'};flex-shrink:0"></span>
    <span>${_esc(th.name)}</span>
  </div>`).join('');
  _blOpenPanel(btn, `
    <div class="bl-drop-label">Set Theme</div>
    <div class="bl-drop-item" onclick="_blApplyTheme(null)">
      <span style="color:var(--text-tertiary)">— Remove Theme</span>
    </div>
    ${projThemes.length?opts:'<div style="padding:8px 10px;font-size:12px;color:var(--text-tertiary)">No themes for this project</div>'}
  `);
}
function _blApplyTheme(themeId){
  const th=themeId?(state.themes||[]).find(x=>x.id===themeId):null;
  const {tasks,subs}=_blResolvedItems();
  tasks.forEach(t=>{ t.themeId=themeId||null; t.themeName=th?th.name:null; t.themeColor=th?th.color:null; });
  subs.forEach(({task,sub})=>{ sub.themeId=themeId||null; sub.themeName=th?th.name:null; sub.themeColor=th?th.color:null; });
  _invalidateMaps(); saveState(); _blClosePanel();
  // Persist each affected task (and parent tasks of affected subtasks) to Firebase
  const affectedTasksTh=new Map();
  tasks.forEach(t=>affectedTasksTh.set(t.id,t));
  subs.forEach(({task})=>affectedTasksTh.set(task.id,task));
  if(FirebaseDB.isReady()) affectedTasksTh.forEach(t=>FirebaseDB.saveEntity('tasks',t).catch(e=>console.warn('[blApplyTheme] Firebase error:',e)));
  _blSuccessToast(`Theme updated on ${_bulkSelect.size} item${_bulkSelect.size!==1?'s':''}`);
  _blRerenderCurrentView();
}

// ── 6. BULK EPIC MAPPING ─────────────────────────────────────────
function _blDoEpic(btn){
  // RBAC gate: Admin and Program Manager only
  if(!RBAC.isAdmin() && !RBAC.isProgramManager()){
    _blToast('You do not have permission to map Epics.','warn'); return;
  }
  const projId=_blKeyProject([..._bulkSelect][0]);
  if(!projId){ _blToast('Select items from a single project first.','warn'); return; }

  // Scope epics to selected project only (respects RBAC via getVisibleEpics)
  const visibleEpics=RBAC.getVisibleEpics();
  const projEpics=visibleEpics.filter(e=>{
    const epicProjects=e.projectIds||(e.projectId?[e.projectId]:[]);
    return epicProjects.includes(projId);
  });

  // Build modal HTML
  const proj=(state.projects||[]).find(p=>p.id===projId);
  const projName=proj?proj.name:'this project';
  const n=_bulkSelect.size;

  const epicOptions=projEpics.length
    ? projEpics.map(e=>`<option value="${e.id}">${_esc(e.title)}</option>`).join('')
    : '';

  const overlay=document.createElement('div');
  overlay.id='bl-epic-modal-overlay';
  overlay.style.cssText='position:fixed;inset:0;z-index:400;background:rgba(0,0,0,0.38);display:flex;align-items:center;justify-content:center;padding:16px';
  overlay.innerHTML=`
    <div style="background:#fff;border-radius:14px;padding:24px;width:100%;max-width:380px;box-shadow:0 20px 60px rgba(0,0,0,0.22);font-family:'DM Sans',sans-serif">
      <div style="font-size:14px;font-weight:700;color:#0d0f14;margin-bottom:4px">Map to Epic</div>
      <div style="font-size:12px;color:#9399b0;margin-bottom:18px">Map ${n} selected item${n!==1?'s':''} to an Epic in <strong>${_esc(projName)}</strong></div>
      <label style="font-size:11.5px;font-weight:600;color:#4a5066;display:block;margin-bottom:5px">Select Epic</label>
      ${projEpics.length
        ? `<select id="bl-epic-select" style="width:100%;height:34px;border:1px solid rgba(0,0,0,0.09);border-radius:8px;padding:0 28px 0 12px;font-size:13px;background:#f4f5f9;color:#0d0f14;appearance:none;-webkit-appearance:none;background-image:url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2210%22 height=%226%22 viewBox=%220 0 10 6%22%3E%3Cpath d=%22M1 1l4 4 4-4%22 stroke=%22%23a0a8be%22 stroke-width=%221.5%22 fill=%22none%22 stroke-linecap=%22round%22/%3E%3C/svg%3E');background-repeat:no-repeat;background-position:right 10px center;cursor:pointer">
            <option value="">— Select Epic —</option>
            ${epicOptions}
          </select>`
        : `<div style="font-size:12.5px;color:#9399b0;padding:10px 12px;background:#f4f5f9;border-radius:8px;border:1px solid rgba(0,0,0,0.07)">No Epics available for this Project.</div>`
      }
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px">
        <button onclick="document.getElementById('bl-epic-modal-overlay').remove()" style="height:32px;padding:0 14px;border-radius:8px;border:1px solid rgba(0,0,0,0.1);background:#f4f5f9;color:#4a5066;font-size:12.5px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif">Cancel</button>
        <button id="bl-epic-apply-btn" onclick="_blApplyEpic()" ${projEpics.length?'':'disabled'} style="height:32px;padding:0 14px;border-radius:8px;border:none;background:${projEpics.length?'#5b5fc7':'#c8ccd8'};color:#fff;font-size:12.5px;font-weight:600;cursor:${projEpics.length?'pointer':'not-allowed'};font-family:'DM Sans',sans-serif">Apply</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  // Close on backdrop click
  overlay.addEventListener('mousedown', e=>{ if(e.target===overlay) overlay.remove(); });
}

function _blApplyEpic(){
  const sel=document.getElementById('bl-epic-select');
  if(!sel){ _blToast('Epic modal not found.','warn'); return; }
  const epicId=sel.value;
  if(!epicId){ _blToast('Please select an Epic.','warn'); return; }

  // Validate: epicId must belong to selected project (cross-project guard)
  const projId=_blKeyProject([..._bulkSelect][0]);
  const epic=(state.epics||[]).find(e=>e.id===epicId);
  if(epic){
    const epicProjects=epic.projectIds||(epic.projectId?[epic.projectId]:[]);
    if(projId && !epicProjects.includes(projId)){
      _blToast('Selected items can only be mapped to Epics belonging to the same Project.','warn');
      return;
    }
  }

  const {tasks,subs}=_blResolvedItems();
  // Update tasks
  tasks.forEach(t=>{ t.epicId=epicId; });
  // Update subtasks — set epicId directly (reuses existing single-task pattern)
  subs.forEach(({task,sub})=>{ sub.epicId=epicId; });

  _invalidateMaps(); saveState();
  document.getElementById('bl-epic-modal-overlay')?.remove();
  // Persist each affected task (and parent tasks of affected subtasks) to Firebase
  const affectedTasksE=new Map();
  tasks.forEach(t=>affectedTasksE.set(t.id,t));
  subs.forEach(({task})=>affectedTasksE.set(task.id,task));
  if(FirebaseDB.isReady()) affectedTasksE.forEach(t=>FirebaseDB.saveEntity('tasks',t).catch(e=>console.warn('[blApplyEpic] Firebase error:',e)));
  const epicTitle=epic?epic.title:epicId;
  _blSuccessToast(`Mapped ${_bulkSelect.size} item${_bulkSelect.size!==1?'s':''} to "${_esc(epicTitle)}"`);
  _blRerenderCurrentView();
}

// ── 7. BULK MOVE TO SPRINT ────────────────────────────────────────
function _blDoSprint(btn){
  const projId=_blKeyProject([..._bulkSelect][0]);
  if(!projId){ _blToast('Select items from a single project first.','warn'); return; }
  const sprints=RBAC.getVisibleSprints().filter(s=>s.project===projId&&s.status!=='completed');
  const opts=sprints.map(s=>`<div class="bl-drop-item" onclick="_blApplySprint('${s.id}')">
    <span class="badge badge-${s.status}" style="font-size:9px">${s.status}</span>
    <span>${_esc(s.name)}</span>
  </div>`).join('');
  _blOpenPanel(btn, `
    <div class="bl-drop-label">Move to Sprint</div>
    ${opts||'<div style="padding:8px 10px;font-size:12px;color:var(--text-tertiary)">No active/planned sprints for this project</div>'}
  `);
}
function _blApplySprint(sprintId){
  const {tasks,subs}=_blResolvedItems();
  // Only tasks/subtasks in backlog (sprint===null) may be moved — already enforced by selection validation
  tasks.forEach(t=>{ t.sprint=sprintId; });
  subs.forEach(({task,sub})=>{ /* subtask inherits parent's sprint implicitly */ sub.sprint=sprintId; });
  _invalidateMaps(); saveState(); _blClosePanel();
  // Persist each affected task (and parent tasks of affected subtasks) to Firebase
  const affectedTasksSp=new Map();
  tasks.forEach(t=>affectedTasksSp.set(t.id,t));
  subs.forEach(({task})=>affectedTasksSp.set(task.id,task));
  if(FirebaseDB.isReady()) affectedTasksSp.forEach(t=>FirebaseDB.saveEntity('tasks',t).catch(e=>console.warn('[blApplySprint] Firebase error:',e)));
  const sprint=getSprint(sprintId);
  _blSuccessToast(`Moved ${_bulkSelect.size} item${_bulkSelect.size!==1?'s':''} to "${sprint?sprint.name:sprintId}"`);
  _bulkSelect.clear();
  _blUpdateBar();
  _blRerenderCurrentView();
}

// ── 8. BULK MAP TO RELEASE (Release Queue) ────────────────────────
// Same shared _bulkSelect mechanism as Backlog Planner/Sprint Planning — the
// Release Queue only ever puts already-Released tasks into the selection
// (see renderReleaseQueue() in render-releases.js), so _blResolvedItems()
// here will always yield `tasks` only, never `subs`.
function _blDoReleaseMap(btn){
  if(RBAC.isMember()||RBAC.isViewer()){ _blToast('Only admins, senior managers, and program managers can map tasks to releases.','warn'); return; }
  const projId=_blKeyProject([..._bulkSelect][0]);
  if(!projId){ _blToast('Select items from a single project first.','warn'); return; }
  // Same eligibility rule as the single-task dropdown in renderReleaseQueue():
  // this project's releases, excluding ones already Released (locked).
  const releases=RBAC.getVisibleReleases().filter(r=>r.projectId===projId && (r.status||'').toLowerCase()!=='released');
  const opts=releases.map(r=>`<div class="bl-drop-item" onclick="_blApplyReleaseMap('${r.id}')">
    <span>${_esc(r.name)} (v${_esc(r.version)})</span>
  </div>`).join('');
  _blOpenPanel(btn, `
    <div class="bl-drop-label">Map to Release</div>
    ${opts||'<div style="padding:8px 10px;font-size:12px;color:var(--text-tertiary)">No open releases for this project — create one first</div>'}
  `);
}
function _blApplyReleaseMap(releaseId){
  const release=getRelease(releaseId);
  if(!release){ _blToast('Release not found.','warn'); return; }
  const {tasks}=_blResolvedItems();
  // Defensive — mirrors the single-task mapTaskToRelease() checks, even
  // though the Release Queue should never surface an ineligible task.
  const eligible=tasks.filter(t=>t.status==='released' && (!t.project || !release.projectId || t.project===release.projectId));
  const skipped=tasks.length-eligible.length;
  if(!eligible.length){ _blToast('No eligible tasks in this selection.','warn'); return; }
  const newIds=[...new Set([...(release.taskIds||[]), ...eligible.map(t=>t.id)])];
  updateRelease(releaseId,{taskIds:newIds});
  eligible.forEach(t=>{
    t.releaseId=releaseId;
    if(FirebaseDB.isReady()) FirebaseDB.saveEntity('tasks',t).catch(e=>console.warn('[blApplyReleaseMap] Firebase error:',e));
  });
  SaveManager.save(); SaveManager.saveReleases(); _blClosePanel();
  if(skipped>0) _blToast(`${skipped} item${skipped!==1?'s':''} skipped — not eligible for this release.`,'warn');
  _blSuccessToast(`Mapped ${eligible.length} task${eligible.length!==1?'s':''} to "${_esc(release.name)}"`);
  _bulkSelect.clear();
  _blUpdateBar();
  _blRerenderCurrentView();
}

// ── 7. BULK DELETE ────────────────────────────────────────────────
function _blDoDelete(btn){
  if(!RBAC.canDeleteAnyTask()){ _blToast('You do not have permission to delete tasks.','warn'); return; }
  const n=_bulkSelect.size;
  if(!confirm(`Delete ${n} selected item${n!==1?'s':''}? This cannot be undone.`)) return;
  const {tasks,subs}=_blResolvedItems();

  // Delete standalone tasks (with their subtasks)
  const taskIdsToDelete=new Set(tasks.map(t=>t.id));
  tasks.forEach(t=>{
    // Firebase delete
    SyncState.clear(t.id);
    if(FirebaseDB.isReady()){
      FirebaseDB.deleteEntity('tasks', t.id).catch(()=>PendingSyncQueue.deleteEntity('tasks', t.id));
    } else {
      PendingSyncQueue.deleteEntity('tasks', t.id);
    }
  });

  // Remove selected subtasks from their parent tasks (if parent task is NOT also being deleted)
  subs.forEach(({task,sub})=>{
    if(taskIdsToDelete.has(task.id)) return; // whole task being deleted anyway
    task.subtasks=(task.subtasks||[]).filter(s=>s.id!==sub.id);
  });

  // Remove deleted tasks from state
  state.tasks=state.tasks.filter(t=>!taskIdsToDelete.has(t.id));

  _invalidateMaps();
  if(typeof _invalidateSearchCache==='function') _invalidateSearchCache();
  SaveManager.save();
  _bulkSelect.clear();
  _blUpdateBar();
  _blClosePanel();
  _blSuccessToast(`Deleted ${n} item${n!==1?'s':''}`);
  _blRerenderCurrentView();
}

// ── HELPERS ───────────────────────────────────────────────────────
function _blGetCommonValue(getter){
  const {tasks,subs}=_blResolvedItems();
  const vals=[...tasks.map(getter),...subs.map(({sub})=>getter(sub))];
  const uniq=[...new Set(vals)];
  return uniq.length===1?uniq[0]:'';
}

// Re-render whichever bulk-select-enabled page (Backlog Planner, Sprint
// Planning, or the Release Board) is currently active after a bulk action
// (assign/status/tags/map-to-release/etc.) so the toolbar's action reflects
// immediately.
function _blRerenderCurrentView(){
  const _activePage = document.querySelector('.page.active');
  if(_activePage && _activePage.id === 'page-sprint-planning') renderSprintPlanning();
  else if(_activePage && _activePage.id === 'page-releases') renderReleaseBoard();
  else renderBacklogPlanner();
}

// Clear selection on every navigation — Backlog Planner and Sprint Planning
// show different content, so a selection made on one should not carry its
// bulk-action strip over to the other.
(function _blNavHook(){
  const _origNavigate=typeof navigate==='function'?navigate:null;
  // Hook into existing navigate — clear selection on page change
  window._blOnNavigate=function(page){
    _bulkSelect.clear(); _blUpdateBar(); _blClosePanel();
  };
})();

