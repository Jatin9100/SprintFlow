// ─── ADMIN CONFIG: PRODUCTS & TAGS ───────────────────────────────
// Admin-only. Manages state.products and state.tags with project mapping.
// CRUD: create, edit, delete. Persisted via SaveManager.
// Does NOT touch tasks, sprints, kanban, dashboard, or RBAC structure.
// ─────────────────────────────────────────────────────────────────


// ── Render Admin Config section (called by renderPage → 'settings') ──
function renderAdminConfig(){
  const section = document.getElementById('admin-config-section');
  if(!section) return;
  // Visible to Admin and Program Manager only
  if(!RBAC.isAdmin() && !RBAC.isProgramManager()){
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';
  _renderProductsList();
  _renderTagsList();
  _renderThemesList();
  // ── Phase 3: Payload Analysis (Admin only) ──
  _renderPayloadAnalysis();
  // ── Notifications Data cleanup status (Admin Settings) ──
  // NOTE: intentionally does NOT auto-scan. Scanning downloads the whole
  // notifications collection, so it stays manual (the "Scan" button) to avoid a
  // large read every single time the Settings page is opened.
  _renderNotifCleanupStatus();

  // ── Embedded Images Cleanup status (Admin Settings — targeted addition) ──
  // Admin only (unlike notifications, which Program Managers can also run for
  // their own data) — this operates across every project's sprints/tasks, not
  // just what a Program Manager can see, so it stays Admin-only. Same
  // manual-scan rationale as notifications above: no auto-read on page open.
  const _imgCleanupSection = document.getElementById('img-cleanup-section');
  if(_imgCleanupSection) _imgCleanupSection.style.display = RBAC.isAdmin() ? 'block' : 'none';
  if(RBAC.isAdmin()) _renderImgCleanupStatus();

  // Program Managers: hide all admin-only Settings sections; show only Products, Tags & Themes
  if(!RBAC.isAdmin() && RBAC.isProgramManager()){
    document.querySelectorAll('#page-settings > .max-w-2xl > .settings-section, #page-settings > .max-w-2xl > .mt-4').forEach(el => {
      el.style.display = 'none';
    });
    // Hide Add Theme button for PM (view-only)
    const addThemeBtn = document.getElementById('btn-add-theme');
    if(addThemeBtn) addThemeBtn.style.display = 'none';
    const subtitle = document.querySelector('#page-settings .page-subtitle');
    if(subtitle) subtitle.textContent = 'Manage products, tags and themes for your projects';
  }
}

// ── Products list ──

function _renderProductsList(){
  const el = document.getElementById('admin-products-list');
  if(!el) return;
  const products = state.products || [];
  if(!products.length){
    el.innerHTML = `<div class="settings-row" style="justify-content:center;color:var(--text-tertiary);font-size:13px">No products yet.</div>`;
    return;
  }
  el.innerHTML = products.map(prd => {
    const mappedNames = (prd.projectIds || []).map(pid => {
      const p = getProject(pid);
      return p ? `<span style="display:inline-flex;align-items:center;padding:2px 8px;background:var(--accent-ghost);color:var(--accent-dark);border-radius:var(--r-pill);font-size:11px;font-weight:600;border:1px solid var(--accent-ring)">${_esc(p.name)}</span>` : '';
    }).filter(Boolean).join(' ');
    const c = prd.color;
    const colorSwatch = c ? `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${_esc(c)};border:1px solid rgba(0,0,0,0.14);flex-shrink:0;margin-right:6px"></span>` : '';
    const nameStyle = c ? `display:inline-flex;align-items:center;padding:2px 9px 2px 7px;border-radius:var(--r-pill);font-size:13px;font-weight:600;background:${_esc(c)}22;color:${_esc(c)};border:1px solid ${_esc(c)}55` : `font-size:13.5px;font-weight:600;color:var(--text-primary)`;
    return `<div class="settings-row">
      <div style="flex:1;min-width:0">
        <div style="${nameStyle}">${colorSwatch}${_esc(prd.name)}</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:5px">${mappedNames || '<span style="font-size:11px;color:var(--text-tertiary)">No projects mapped</span>'}</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button class="btn btn-secondary" style="height:28px;font-size:11.5px;padding:0 10px" onclick="openProductModal('${_esc(prd.id)}')">Edit</button>
        <button class="btn btn-danger" style="height:28px;font-size:11.5px;padding:0 10px" onclick="deleteProduct('${_esc(prd.id)}')">Delete</button>
      </div>
    </div>`;
  }).join('');
}

// ── Tags list ──
function _renderTagsList(){
  const el = document.getElementById('admin-tags-list');
  if(!el) return;
  const tags = state.tags || [];
  if(!tags.length){
    el.innerHTML = `<div class="settings-row" style="justify-content:center;color:var(--text-tertiary);font-size:13px">No tags yet.</div>`;
    return;
  }
  el.innerHTML = tags.map(tag => {
    const mappedNames = (tag.projectIds || []).map(pid => {
      const p = getProject(pid);
      return p ? `<span style="display:inline-flex;align-items:center;padding:2px 8px;background:var(--accent-ghost);color:var(--accent-dark);border-radius:var(--r-pill);font-size:11px;font-weight:600;border:1px solid var(--accent-ring)">${_esc(p.name)}</span>` : '';
    }).filter(Boolean).join(' ');
    const c = tag.color;
    const colorSwatch = c ? `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${_esc(c)};border:1px solid rgba(0,0,0,0.14);flex-shrink:0;margin-right:6px"></span>` : '';
    const nameStyle = c ? `display:inline-flex;align-items:center;padding:2px 9px 2px 7px;border-radius:var(--r-pill);font-size:13px;font-weight:600;background:${_esc(c)}22;color:${_esc(c)};border:1px solid ${_esc(c)}55` : `font-size:13.5px;font-weight:600;color:var(--text-primary)`;
    return `<div class="settings-row">
      <div style="flex:1;min-width:0">
        <div style="${nameStyle}">${colorSwatch}${_esc(tag.name)}</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:5px">${mappedNames || '<span style="font-size:11px;color:var(--text-tertiary)">No projects mapped</span>'}</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button class="btn btn-secondary" style="height:28px;font-size:11.5px;padding:0 10px" onclick="openTagModal('${_esc(tag.id)}')">Edit</button>
        <button class="btn btn-danger" style="height:28px;font-size:11.5px;padding:0 10px" onclick="deleteTag('${_esc(tag.id)}')">Delete</button>
      </div>
    </div>`;
  }).join('');
}

// ── Notifications Data cleanup (Admin Settings — targeted addition) ──────────
// Only touches notification records (via NotificationSystem.purgeNotifications).
// No task/sprint/project/epic/user data or other endpoints are ever read or written here.
const NOTIF_CLEANUP_INTERVAL_KEY = 'sprintflow_notif_cleanup_interval_days';
const NOTIF_CLEANUP_LASTRUN_KEY  = 'sprintflow_notif_cleanup_last_run';

function _getNotifCleanupIntervalDays(){
  const v = parseInt(localStorage.getItem(NOTIF_CLEANUP_INTERVAL_KEY)||'0',10);
  return isNaN(v) ? 0 : v;
}
function _getNotifCleanupLastRun(){
  const v = parseInt(localStorage.getItem(NOTIF_CLEANUP_LASTRUN_KEY)||'0',10);
  return isNaN(v) ? 0 : v;
}
function _setNotifCleanupLastRun(ts){
  try{ localStorage.setItem(NOTIF_CLEANUP_LASTRUN_KEY, String(ts)); }catch(e){}
}
function _renderNotifCleanupStatus(){
  const sel = document.getElementById('notif-cleanup-interval-select');
  if(sel) sel.value = String(_getNotifCleanupIntervalDays());
  const lastEl = document.getElementById('notif-cleanup-last-run');
  if(lastEl){
    const t = _getNotifCleanupLastRun();
    lastEl.textContent = t ? new Date(t).toLocaleString() : 'Never';
  }
}
function _formatNotifBytes(n){
  if(!n) return '0 B';
  if(n < 1024) return n+' B';
  if(n < 1024*1024) return (n/1024).toFixed(1)+' KB';
  return (n/(1024*1024)).toFixed(2)+' MB';
}
// Set the live-count label directly, with no network read — used after a delete so
// the panel reflects what happened without triggering another full download.
function _setNotifScanSummary(text){
  const el = document.getElementById('notif-data-scan-summary');
  if(el) el.textContent = text;
}
// ── Auto-cleanup scheduling ──────────────────────────────────────────────────
// The interval check runs on app start and whenever the interval is changed, but a
// browser tab left open for days would otherwise never re-check. This re-checks
// every 6 hours; the check itself is free (it only reads localStorage and returns
// immediately unless the configured interval has actually elapsed).
let _notifAutoCleanupTimer = null;
function _startNotifAutoCleanupSchedule(){
  if(_notifAutoCleanupTimer) return; // never double-schedule (init can run twice)
  const SIX_HOURS = 6*60*60*1000;
  _notifAutoCleanupTimer = setInterval(()=>{
    if(typeof _maybeRunNotifAutoCleanup==='function'){
      _maybeRunNotifAutoCleanup().catch(e=>console.warn('[NotifCleanup] scheduled run failed',e && e.message));
    }
  }, SIX_HOURS);
  console.log('[NotifCleanup] auto-cleanup re-check scheduled every 6h');
}
// Live, read-only count + size straight from Firebase — this is the ground truth
// the delete button itself relies on (same shape-detection logic), so refreshing
// this before and after a delete is a direct, in-app way to see whether it worked,
// without depending on the Firebase console (which caches large collections).
async function scanNotificationsDataNow(){
  const el = document.getElementById('notif-data-scan-summary');
  if(el) el.textContent = 'Scanning…';
  try{
    if(typeof NotificationSystem === 'undefined' || typeof NotificationSystem.scanNotifications !== 'function'){
      if(el) el.textContent = 'Scan unavailable';
      return;
    }
    const TIMEOUT_MS = 120000;
    const res = await Promise.race([
      NotificationSystem.scanNotifications(),
      new Promise((_,reject)=>setTimeout(()=>reject(new Error('scan timed out after 120s — the collection may be very large')), TIMEOUT_MS))
    ]);
    if(!res || !res.ok){
      if(el) el.textContent = 'Scan failed: '+((res&&res.error)||'unknown error');
      return;
    }
    const scopeLabel = res.scopeAll ? 'all users' : 'your account';
    if(el) el.textContent = `${res.totalCount} record(s), ${scopeLabel} — ~${_formatNotifBytes(res.totalBytes)} (active: ${res.flatCount+res.nestedCount}, archived: ${res.archiveCount})`;
    console.log('[NotifCleanup] scan result:', res);
  }catch(e){
    console.error('[NotifCleanup] scan failed',e);
    if(el) el.textContent = 'Scan failed: '+(e && e.message ? e.message : e);
  }
}
function setNotifCleanupInterval(value){
  if(!RBAC.isAdmin() && !RBAC.isProgramManager()){ showNotif('⚠ Permission denied','error'); return; }
  const days = parseInt(value,10)||0;
  try{ localStorage.setItem(NOTIF_CLEANUP_INTERVAL_KEY, String(days)); }catch(e){}
  showNotif(days>0 ? `Notifications auto-cleanup set to every ${days} days` : 'Notifications auto-cleanup disabled');
  _maybeRunNotifAutoCleanup(true);
}
// Runs in the background (app init) and whenever the interval is changed.
// force=true bypasses the "already ran recently" check (used right after saving a new interval).
async function _maybeRunNotifAutoCleanup(force){
  const days = _getNotifCleanupIntervalDays();
  if(!days) return;
  if(typeof NotificationSystem==='undefined' || !state.currentUser) return;
  if(!RBAC.isAdmin() && !RBAC.isProgramManager()) return;
  const dueMs = days*24*60*60*1000;
  const lastRun = _getNotifCleanupLastRun();
  if(!force && (Date.now()-lastRun) < dueMs) return;
  try{
    const res = await NotificationSystem.purgeNotifications({ olderThanMs: dueMs });
    console.log('[NotifCleanup] auto run: removed',(res&&res.removed)||0,'of',(res&&res.ownFound)||0,'own record(s) older than',days,'day(s)');
    _setNotifCleanupLastRun(Date.now());
    _renderNotifCleanupStatus();
  }catch(e){ console.warn('[NotifCleanup] auto run failed',e.message||e); }
}
function adminDeleteNotificationsNow(){
  // Step 1: show the confirmation. This used to call the browser's native
  // confirm() — but in some embedded/preview browser contexts native
  // confirm()/alert() dialogs are silently blocked or auto-dismissed with no
  // visible sign, which would make this click do nothing at all (no toast, no
  // error, "Last Cleaned" never updates — exactly what was being reported).
  // Using the app's own openModal()/closeModal() system instead — the same
  // mechanism every other dialog in this app already relies on — removes that
  // entire failure mode, since it's plain DOM we fully control.
  try{
    console.log('[NotifCleanup] Delete Notifications Now clicked');
    if(typeof RBAC === 'undefined'){ showNotif('⚠ App not fully loaded yet — try again in a moment','error'); return; }
    if(!RBAC.isAdmin() && !RBAC.isProgramManager()){ showNotif('⚠ Permission denied','error'); return; }
    if(typeof NotificationSystem === 'undefined'){ showNotif('Notification system not ready','error'); return; }
    if(typeof openModal !== 'function'){
      // Modal system unavailable for some reason — last-resort fallback so the
      // action still isn't a dead end.
      console.warn('[NotifCleanup] openModal unavailable, falling back to native confirm()');
      if(confirm('Delete notifications data now? This cannot be undone.')) _runNotifPurgeNow();
      return;
    }
    // Admins clear notifications data for EVERY user; Program Managers can only
    // clear their own (matches the scoping inside NotificationSystem.purgeNotifications).
    const scopeAll = RBAC.isAdmin();
    const confirmMsg = scopeAll
      ? 'Delete ALL notifications data for ALL users? This cannot be undone. Only notification records are affected — no tasks, sprints, or other data.'
      : 'Delete all of your notifications data? This cannot be undone. Only notification records are affected — no tasks, sprints, or other data.';
    openModal(`
      <div style="padding:22px;max-width:420px">
        <div style="font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:10px">Delete notifications data?</div>
        <div style="font-size:13px;color:var(--text-secondary);line-height:1.5;margin-bottom:20px">${_esc(confirmMsg)}</div>
        <div style="display:flex;justify-content:flex-end;gap:8px">
          <button class="btn btn-secondary text-sm" onclick="closeModal()">Cancel</button>
          <button class="btn btn-danger text-sm" onclick="closeModal();_runNotifPurgeNow()">Delete</button>
        </div>
      </div>
    `);
  }catch(e){
    console.error('[NotifCleanup] could not open confirm dialog',e);
    showNotif('Failed to open the delete confirmation — check the browser console','error');
  }
}

// Step 2: the actual purge, run only after the modal's Delete button is clicked.
async function _runNotifPurgeNow(){
  // Immediate feedback the instant this runs — purgeNotifications() does one full
  // read of the entire notifications collection before it can delete anything, and
  // if that collection is large (it can be, per the storage-bloat this feature
  // exists to fix) that read alone can take a while. Without this, the UI looked
  // completely idle during that time — indistinguishable from nothing happening.
  showNotif('Deleting notifications… this can take a moment for a large collection','info');
  console.log('[NotifCleanup] confirmed — running purge (reading full notifications collection first, this can take a while for large datasets)');
  try{
    // Hard timeout so a stalled network request can never leave this hanging
    // silently forever. Raised to 120s: an admin full-clear is now a single
    // whole-node delete (fast regardless of size), but an age-filtered cleanup
    // still has to read the collection once before it can filter by date.
    const TIMEOUT_MS = 120000;
    const res = await Promise.race([
      NotificationSystem.purgeNotifications({}),
      new Promise((_,reject)=>setTimeout(()=>reject(new Error('Delete timed out after 120s — the connection may have stalled. Check your network and try again.')), TIMEOUT_MS))
    ]);
    _setNotifCleanupLastRun(Date.now());
    _renderNotifCleanupStatus();
    const removed = (res && res.removed) || 0;
    const ownFound = (res && res.ownFound) || 0;
    const stillPresent = (res && res.stillPresent) || 0;
    const scope = (res && res.scopeAll) ? 'across all users' : 'of yours';
    // Update the count label WITHOUT another download — scanning stays manual.
    // A verified full wipe is known to be empty, so we can state that directly.
    if(res && res.wipedAll && !res.error && stillPresent === 0){
      _setNotifScanSummary('0 records — all notification data deleted');
    } else {
      _setNotifScanSummary('Changed — click Scan to refresh');
    }
    // Admin full-clear takes the whole-node wipe path, so there is no per-record
    // count to report — verification tells us whether the subtree is actually gone.
    if(res && res.wipedAll){
      if(res.error){
        showNotif('Delete failed: '+res.error+' — check the browser console (F12)','error');
      } else if(stillPresent === 0){
        showNotif('All notifications data deleted ✓ — verified empty in the database. If the Firebase console still shows rows, refresh that page.');
      } else {
        showNotif(`Wipe ran but ${stillPresent} record(s) are still present after verification — check the browser console (F12) for the error.`,'error');
      }
    } else if(removed > 0 && stillPresent === 0){
      // Verified: re-read the database after deleting and confirmed the removed
      // records are actually gone server-side, not just that the delete call
      // resolved. If the Firebase Console still shows old data, refresh that
      // console tab — for large collections it displays a cached, non-realtime
      // snapshot (the console itself warns about this) and will not update
      // automatically.
      showNotif(`Deleted ${removed} notification(s) ${scope} ✓ — confirmed removed from the database. If the Firebase console still shows old rows, refresh that page.`);
    } else if(removed > 0 && stillPresent > 0){
      // The delete call resolved without an error, but a fresh read afterward
      // still shows the data — a genuine server-side problem (most likely a
      // security rule silently rejecting the delete). Not a console caching issue.
      showNotif(`Delete reported success but ${stillPresent} record(s) are still in the database after verification — this points to a Firebase security rule blocking the delete. Check the browser console (F12) for a permission-denied error.`,'error');
    } else if(ownFound > 0){
      // Records were found but every delete call itself failed — check the
      // browser console for the specific Firebase error.
      showNotif(`Found ${ownFound} notification(s) ${scope} but could not delete them — check the browser console (F12) for the error`,'error');
    } else if(scopeAll){
      showNotif('No notifications found in the database for any user.');
    } else {
      // Nothing belonging to the signed-in account exists right now. Any records
      // still visible in the Firebase console belong to OTHER users — a Program
      // Manager can only clear their own notifications (an Admin can clear everyone's).
      showNotif('No notifications found for your account. Records for other users are not affected — sign in as an Admin to clear everyone\'s.');
    }
  }catch(e){
    console.error('[NotifCleanup] manual purge failed',e);
    // Surface the actual error (e.g. the timeout message above, or a Firebase
    // error) instead of a generic line — this is exactly the kind of failure
    // that was previously happening with zero visible feedback.
    showNotif('Failed to delete notifications: '+(e && e.message ? e.message : e),'error');
  }
}


// ── Embedded Images Cleanup (Admin Settings — targeted addition) ─────────────
// Strips base64 <img> tags out of taskDescriptions / taskComments HTML — the
// pasted-screenshot bloat that makes up the bulk of this app's Realtime
// Database storage. Only ever touches the html/content STRING field of an
// already-qualifying task's description or comment (including subtasks).
// No task/sprint/project/user data, and no other field on the description or
// comment record, is ever read or written here.
//
// Eligibility (exactly as specified — nothing broader):
//   - Task status === 'released'
//   - Task's sprint is COMPLETED, and is NOT its project's Active sprint,
//     nor the single sprint immediately before Active (both are always left
//     untouched, per project — computed by sprint start/end date order)
//   - Subtask descriptions/comments under an eligible task are included too
//   - Only <img src="data:...">  tags are removed. Any non-data-URI <img>
//     (e.g. a linked/hosted image) is left alone. All surrounding text and
//     formatting is left exactly as written — no placeholder is inserted.
const IMG_CLEANUP_LASTRUN_KEY = 'sprintflow_img_cleanup_last_run';
const IMG_CLEANUP_INTERVAL_KEY = 'sprintflow_img_cleanup_interval_days';

function _getImgCleanupLastRun(){
  const v = parseInt(localStorage.getItem(IMG_CLEANUP_LASTRUN_KEY)||'0',10);
  return isNaN(v) ? 0 : v;
}
function _setImgCleanupLastRun(ts){
  try{ localStorage.setItem(IMG_CLEANUP_LASTRUN_KEY, String(ts)); }catch(e){}
}
function _getImgCleanupIntervalDays(){
  const v = parseInt(localStorage.getItem(IMG_CLEANUP_INTERVAL_KEY)||'0',10);
  return isNaN(v) ? 0 : v;
}
function _renderImgCleanupStatus(){
  const sel = document.getElementById('img-cleanup-interval-select');
  if(sel) sel.value = String(_getImgCleanupIntervalDays());
  const lastEl = document.getElementById('img-cleanup-last-run');
  if(lastEl){
    const t = _getImgCleanupLastRun();
    lastEl.textContent = t ? new Date(t).toLocaleString() : 'Never';
  }
}
function _formatImgBytes(n){
  if(!n) return '0 B';
  if(n < 1024) return n+' B';
  if(n < 1024*1024) return (n/1024).toFixed(1)+' KB';
  return (n/(1024*1024)).toFixed(2)+' MB';
}
function _setImgScanSummary(text){
  const el = document.getElementById('img-cleanup-scan-summary');
  if(el) el.textContent = text;
}

// Sprints eligible for cleanup: COMPLETED, and — per project, in chronological
// (start/end date) order — neither the Active sprint nor the single sprint
// immediately before it. Handles a project with no Active sprint (nothing to
// guard against) and, defensively, more than one Active sprint at once.
function _imgCleanupEligibleSprintIds(){
  const byProject = {};
  (state.sprints||[]).forEach(s=>{ if(!s||!s.id) return; (byProject[s.project]=byProject[s.project]||[]).push(s); });
  const eligible = new Set();
  Object.values(byProject).forEach(list=>{
    const sorted = list.slice().sort((a,b)=>{
      const ak = a.start || a.end || '';
      const bk = b.start || b.end || '';
      return ak < bk ? -1 : (ak > bk ? 1 : 0);
    });
    const guard = new Set();
    sorted.forEach((s,i)=>{
      if((s.status||'').toLowerCase()==='active'){
        guard.add(s.id);
        if(i>0) guard.add(sorted[i-1].id); // sprint immediately before this Active one
      }
    });
    sorted.forEach(s=>{
      if((s.status||'').toLowerCase()==='completed' && !guard.has(s.id)) eligible.add(s.id);
    });
  });
  return eligible;
}

// Released tasks sitting in an eligible sprint.
function _imgCleanupEligibleTaskIds(){
  const eligibleSprints = _imgCleanupEligibleSprintIds();
  return (state.tasks||[])
    .filter(t => t && t.status==='released' && t.sprint && eligibleSprints.has(t.sprint))
    .map(t => t.id);
}

// Remove <img src="data:...base64,...."> tags only — external/hosted image
// URLs are left untouched. No placeholder is inserted for a removed image.
function _stripDataUriImages(html){
  if(!html || typeof html !== 'string') return { cleaned: html, removed: 0, bytesRemoved: 0 };
  let removed = 0, bytesRemoved = 0;
  const cleaned = html.replace(/<img\b[^>]*\bsrc\s*=\s*(["'])data:[^"']*\1[^>]*>/gi, (m)=>{
    removed++; bytesRemoved += m.length; return '';
  });
  return { cleaned, removed, bytesRemoved };
}

// Walks one taskDescriptions/{taskId} node (+ its _subtasks) and one
// taskComments/{taskId} node (+ its _subtasks), building flat multi-path
// update objects for every field that actually contains an embedded image.
// Read-only — no writes happen here; scan() and the real run share this.
function _imgCleanupPlanForTask(taskId, descNode, commentsNode){
  const descPatch = {};     // relative to sprintflow/taskDescriptions
  const commentPatch = {};  // relative to sprintflow/taskComments
  let removed = 0, bytesRemoved = 0;

  if(descNode){
    if(descNode.html){
      const r = _stripDataUriImages(descNode.html);
      if(r.removed){ descPatch[`${taskId}/html`] = r.cleaned; removed += r.removed; bytesRemoved += r.bytesRemoved; }
    }
    const subs = descNode._subtasks || {};
    Object.keys(subs).forEach(subId=>{
      const sub = subs[subId];
      if(sub && sub.html){
        const r = _stripDataUriImages(sub.html);
        if(r.removed){ descPatch[`${taskId}/_subtasks/${subId}/html`] = r.cleaned; removed += r.removed; bytesRemoved += r.bytesRemoved; }
      }
    });
  }

  if(commentsNode){
    Object.keys(commentsNode).forEach(key=>{
      if(key === '_subtasks') return;
      const c = commentsNode[key];
      if(c && c.content){
        const r = _stripDataUriImages(c.content);
        if(r.removed){ commentPatch[`${taskId}/${key}/content`] = r.cleaned; removed += r.removed; bytesRemoved += r.bytesRemoved; }
      }
    });
    const subs = commentsNode._subtasks || {};
    Object.keys(subs).forEach(subId=>{
      const subComments = subs[subId] || {};
      Object.keys(subComments).forEach(cId=>{
        const c = subComments[cId];
        if(c && c.content){
          const r = _stripDataUriImages(c.content);
          if(r.removed){ commentPatch[`${taskId}/_subtasks/${subId}/${cId}/content`] = r.cleaned; removed += r.removed; bytesRemoved += r.bytesRemoved; }
        }
      });
    });
  }

  return { descPatch, commentPatch, removed, bytesRemoved };
}

// Shared by Scan (doWrite=false, read-only) and Strip Images Now (doWrite=true).
// Reads taskDescriptions + taskComments ONCE in full (same pattern the
// notifications Scan button already uses), filters to eligible task ids
// client-side, and — only when doWrite is true — sends at most two multi-path
// update() calls total (one per collection), regardless of how many records
// are touched, so this never becomes hundreds of sequential round trips.
async function _imgCleanupScanOrRun(doWrite){
  const refFn = FirebaseDB.getRef();
  const db    = FirebaseDB.getDb();
  const _get    = window._rtGet;
  const _update = window._rtUpdate;
  if(!refFn || !db || !_get) return { ok:false, error:'Firebase not ready' };

  const taskIds = new Set(_imgCleanupEligibleTaskIds());
  if(!taskIds.size) return { ok:true, tasksTouched:0, imagesRemoved:0, bytesRemoved:0 };

  const [descSnap, commentsSnap] = await Promise.all([
    _get(refFn(db, 'sprintflow/taskDescriptions')),
    _get(refFn(db, 'sprintflow/taskComments'))
  ]);
  const descAll     = (descSnap     && descSnap.exists())     ? (descSnap.val()||{})     : {};
  const commentsAll  = (commentsSnap && commentsSnap.exists()) ? (commentsSnap.val()||{}) : {};

  const descPatchAll = {}, commentPatchAll = {};
  let tasksTouched = 0, imagesRemoved = 0, bytesRemoved = 0;

  taskIds.forEach(taskId=>{
    const plan = _imgCleanupPlanForTask(taskId, descAll[taskId], commentsAll[taskId]);
    if(plan.removed){
      tasksTouched++;
      imagesRemoved += plan.removed;
      bytesRemoved  += plan.bytesRemoved;
      Object.assign(descPatchAll, plan.descPatch);
      Object.assign(commentPatchAll, plan.commentPatch);
    }
  });

  if(doWrite){
    if(!_update) return { ok:false, error:'Firebase update() unavailable' };
    if(Object.keys(descPatchAll).length)    await _update(refFn(db, 'sprintflow/taskDescriptions'), descPatchAll);
    if(Object.keys(commentPatchAll).length) await _update(refFn(db, 'sprintflow/taskComments'), commentPatchAll);
  }

  return { ok:true, tasksTouched, imagesRemoved, bytesRemoved };
}

// Live, read-only preview — same "Scan before you delete" pattern as the
// notifications panel. No writes.
async function scanImageCleanupNow(){
  const el = document.getElementById('img-cleanup-scan-summary');
  if(el) el.textContent = 'Scanning…';
  try{
    if(typeof FirebaseDB==='undefined' || !FirebaseDB.isReady()){ if(el) el.textContent='Firebase not ready'; return; }
    if(!RBAC.isAdmin()){ if(el) el.textContent='Admin only'; return; }
    const TIMEOUT_MS = 120000;
    const res = await Promise.race([
      _imgCleanupScanOrRun(false),
      new Promise((_,reject)=>setTimeout(()=>reject(new Error('Scan timed out after 120s — the collection may be large')), TIMEOUT_MS))
    ]);
    if(!res || !res.ok){ if(el) el.textContent = 'Scan failed: '+((res&&res.error)||'unknown error'); return; }
    _setImgScanSummary(`${res.imagesRemoved} image(s) across ${res.tasksTouched} task(s) — ~${_formatImgBytes(res.bytesRemoved)} reclaimable`);
    console.log('[ImgCleanup] scan result:', res);
  }catch(e){
    console.error('[ImgCleanup] scan failed', e);
    if(el) el.textContent = 'Scan failed: '+(e && e.message ? e.message : e);
  }
}

// Step 1: confirm via the app's own modal system (native confirm()/alert() can
// be silently blocked in some embedded browser contexts — same reasoning as
// the notifications delete flow above).
function adminStripImagesNow(){
  try{
    console.log('[ImgCleanup] Strip Images Now clicked');
    if(typeof RBAC === 'undefined'){ showNotif('⚠ App not fully loaded yet — try again in a moment','error'); return; }
    if(!RBAC.isAdmin()){ showNotif('⚠ Permission denied — Admin only','error'); return; }
    if(typeof NotificationSystem === 'undefined' && typeof FirebaseDB === 'undefined'){ showNotif('App not ready','error'); return; }
    if(typeof openModal !== 'function'){
      console.warn('[ImgCleanup] openModal unavailable, falling back to native confirm()');
      if(confirm('Strip embedded images from released tasks in old completed sprints? This cannot be undone.')) _runImageStripNow();
      return;
    }
    const confirmMsg = 'Strip embedded images from descriptions and comments (including subtasks) of RELEASED tasks in COMPLETED sprints, across every project — the Active sprint and the sprint right before it are always skipped. Only the images are removed; every other field and all other text stays exactly as written. This cannot be undone.';
    openModal(`
      <div style="padding:22px;max-width:440px">
        <div style="font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:10px">Strip embedded images?</div>
        <div style="font-size:13px;color:var(--text-secondary);line-height:1.5;margin-bottom:20px">${_esc(confirmMsg)}</div>
        <div style="display:flex;justify-content:flex-end;gap:8px">
          <button class="btn btn-secondary text-sm" onclick="closeModal()">Cancel</button>
          <button class="btn btn-danger text-sm" onclick="closeModal();_runImageStripNow()">Strip Images</button>
        </div>
      </div>
    `);
  }catch(e){
    console.error('[ImgCleanup] could not open confirm dialog', e);
    showNotif('Failed to open the strip-images confirmation — check the browser console','error');
  }
}

// Step 2: the actual strip, run only after the modal's "Strip Images" button
// is clicked.
async function _runImageStripNow(){
  showNotif('Stripping embedded images… this can take a moment for a large collection','info');
  console.log('[ImgCleanup] confirmed — reading taskDescriptions + taskComments, then stripping eligible tasks');
  try{
    const TIMEOUT_MS = 120000;
    const res = await Promise.race([
      _imgCleanupScanOrRun(true),
      new Promise((_,reject)=>setTimeout(()=>reject(new Error('Strip timed out after 120s — the connection may have stalled. Check your network and try again.')), TIMEOUT_MS))
    ]);
    _setImgCleanupLastRun(Date.now());
    _renderImgCleanupStatus();
    if(!res || !res.ok){
      showNotif('Strip failed: '+((res&&res.error)||'unknown error')+' — check the browser console (F12)','error');
      return;
    }
    if(res.imagesRemoved > 0){
      _setImgScanSummary('Changed — click Scan to refresh');
      showNotif(`Stripped ${res.imagesRemoved} image(s) across ${res.tasksTouched} task(s) ✓ — ~${_formatImgBytes(res.bytesRemoved)} reclaimed. If the Firebase console still shows old data, refresh that page.`);
    } else {
      showNotif('No embedded images found in eligible tasks — nothing to strip.');
    }
    console.log('[ImgCleanup] strip result:', res);
  }catch(e){
    console.error('[ImgCleanup] strip failed', e);
    showNotif('Strip failed: '+(e && e.message ? e.message : e)+' — check the browser console (F12)','error');
  }
}
// Auto-cleanup interval — Admin only, mirrors the notifications interval
// select exactly. No confirm modal here: turning the interval on IS the
// admin's consent for future unattended runs, same as notifications.
function setImgCleanupInterval(value){
  if(!RBAC.isAdmin()){ showNotif('⚠ Permission denied — Admin only','error'); return; }
  const days = parseInt(value,10)||0;
  try{ localStorage.setItem(IMG_CLEANUP_INTERVAL_KEY, String(days)); }catch(e){}
  showNotif(days>0 ? `Embedded images auto-cleanup set to every ${days} days` : 'Embedded images auto-cleanup disabled');
  _maybeRunImgAutoCleanup(true);
}

// Runs in the background (app init) and whenever the interval is changed.
// force=true bypasses the "already ran recently" check (used right after
// saving a new interval). No confirm dialog — unattended by design.
async function _maybeRunImgAutoCleanup(force){
  const days = _getImgCleanupIntervalDays();
  if(!days) return;
  if(typeof RBAC==='undefined' || !state.currentUser || !RBAC.isAdmin()) return;
  if(typeof FirebaseDB==='undefined' || !FirebaseDB.isReady()) return;
  const dueMs = days*24*60*60*1000;
  const lastRun = _getImgCleanupLastRun();
  if(!force && (Date.now()-lastRun) < dueMs) return;
  try{
    const res = await _imgCleanupScanOrRun(true);
    console.log('[ImgCleanup] auto run:', res && res.ok
      ? `stripped ${res.imagesRemoved} image(s) across ${res.tasksTouched} task(s)`
      : `failed — ${(res&&res.error)||'unknown error'}`);
    _setImgCleanupLastRun(Date.now());
    _renderImgCleanupStatus();
    if(res && res.ok && res.imagesRemoved > 0) _setImgScanSummary('Changed — click Scan to refresh');
  }catch(e){ console.warn('[ImgCleanup] auto run failed', e.message||e); }
}

// The interval check runs on app start and whenever the interval is changed,
// but a browser tab left open for days would otherwise never re-check. This
// re-checks every 6 hours; the check itself is free (it only reads
// localStorage and returns immediately unless the configured interval has
// actually elapsed) — same schedule as the notifications auto-cleanup.
let _imgAutoCleanupTimer = null;
function _startImgAutoCleanupSchedule(){
  if(_imgAutoCleanupTimer) return; // never double-schedule (init can run twice)
  const SIX_HOURS = 6*60*60*1000;
  _imgAutoCleanupTimer = setInterval(()=>{
    if(typeof _maybeRunImgAutoCleanup==='function'){
      _maybeRunImgAutoCleanup().catch(e=>console.warn('[ImgCleanup] scheduled run failed',e && e.message));
    }
  }, SIX_HOURS);
  console.log('[ImgCleanup] auto-cleanup re-check scheduled every 6h');
}

// ── END Embedded Images Cleanup ───────────────────────────────────────────

// ── Project multi-select HTML for modal ──
function _projectMultiSelectHTML(selectedIds, prefix){
  // Admin sees all projects; PM sees only their visible projects
  const projects = RBAC.isAdmin()
    ? (state.projects || [])
    : (RBAC.getVisibleProjects ? RBAC.getVisibleProjects() : (state.projects || []));
  if(!projects.length) return '<div style="font-size:13px;color:var(--text-tertiary)">No projects available.</div>';
  return projects.map(p => {
    const checked = (selectedIds||[]).includes(p.id) ? 'checked' : '';
    return `<label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;font-size:13px;color:var(--text-primary)">
      <input type="checkbox" value="${_esc(p.id)}" ${checked} style="width:16px;height:16px;flex-shrink:0;cursor:pointer;appearance:auto;-webkit-appearance:checkbox;accent-color:var(--accent);border:1px solid #9399b0;padding:0;background:white;border-radius:3px;box-shadow:none;min-height:unset;">
      <span>${_esc(p.name)}</span>
    </label>`;
  }).join('');
}

// ── Collect checked project IDs from modal ──
function _collectCheckedProjects(containerId){
  const container = document.getElementById(containerId);
  if(!container) return [];
  return Array.from(container.querySelectorAll('input[type=checkbox]:checked')).map(cb => cb.value);
}

// ── Save a single product or tag entity to Firebase + localStorage ──
function _saveAdminConfig(){
  SaveManager.save();
}

function _fbSaveProduct(product){
  SaveManager.save();
  if(FirebaseDB.isReady()){
    FirebaseDB.saveEntity('products', product).catch(e => console.warn('[AdminConfig] saveProduct Firebase error:', e));
  }
}

function _fbDeleteProduct(productId){
  SaveManager.save();
  if(FirebaseDB.isReady()){
    FirebaseDB.deleteEntity('products', productId).catch(e => console.warn('[AdminConfig] deleteProduct Firebase error:', e));
  }
}

function _fbSaveTag(tag){
  SaveManager.save();
  if(FirebaseDB.isReady()){
    FirebaseDB.saveEntity('tags', tag).catch(e => console.warn('[AdminConfig] saveTag Firebase error:', e));
  }
}

function _fbDeleteTag(tagId){
  SaveManager.save();
  if(FirebaseDB.isReady()){
    FirebaseDB.deleteEntity('tags', tagId).catch(e => console.warn('[AdminConfig] deleteTag Firebase error:', e));
  }
}

// ─── PRODUCT CRUD ─────────────────────────────────────────────────

function openProductModal(productId){
  if(!RBAC.isAdmin() && !RBAC.isProgramManager()){ showNotif('Permission denied','error'); return; }
  const isEdit = !!productId;
  const prd = isEdit ? (state.products||[]).find(p => p.id === productId) : null;
  const currentColor = (prd && prd.color) ? prd.color : '';
  const PRESET_COLORS = ['#6366f1','#0ea5e9','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#64748b'];
  const presetSwatches = PRESET_COLORS.map(c =>
    `<span onclick="document.getElementById('prd-color-input').value='${c}';document.getElementById('prd-color-preview').style.background='${c}'"
      style="display:inline-block;width:22px;height:22px;border-radius:50%;background:${c};cursor:pointer;border:2px solid ${c===currentColor?'#0d0f14':'transparent'};transition:border-color 0.12s;flex-shrink:0" title="${c}"></span>`
  ).join('');
  const html = `
    <div style="padding:24px 24px 20px">
      <div style="font-size:16px;font-weight:700;color:var(--text-primary);margin-bottom:18px">${isEdit ? 'Edit Product' : 'Add Product'}</div>
      <div style="margin-bottom:14px">
        <label>Product Name</label>
        <input id="prd-name-input" type="text" placeholder="e.g. Claims Portal" value="${isEdit ? _esc(prd.name) : ''}" style="margin-top:4px"/>
      </div>
      <div style="margin-bottom:14px">
        <label>Color <span style="font-size:10px;font-weight:400;color:var(--text-tertiary)">(optional)</span></label>
        <div style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap">
          ${presetSwatches}
          <label style="display:inline-flex;align-items:center;gap:5px;margin:0;cursor:pointer;font-size:12px;color:var(--text-secondary);font-weight:500">
            <span id="prd-color-preview" style="display:inline-block;width:22px;height:22px;border-radius:50%;background:${currentColor||'#e2e8f0'};border:2px solid rgba(0,0,0,0.10);flex-shrink:0;overflow:hidden;position:relative">
              <input type="color" id="prd-color-input" value="${currentColor||'#6366f1'}"
                oninput="document.getElementById('prd-color-preview').style.background=this.value"
                style="position:absolute;inset:-4px;width:calc(100%+8px);height:calc(100%+8px);opacity:0;cursor:pointer;border:none;padding:0"/>
            </span>
            Custom
          </label>
          <button type="button" onclick="document.getElementById('prd-color-input').value='';document.getElementById('prd-color-preview').style.background='#e2e8f0'"
            style="font-size:11px;color:var(--text-tertiary);background:none;border:none;cursor:pointer;padding:2px 4px;text-decoration:underline">Clear</button>
        </div>
      </div>
      <div style="margin-bottom:18px">
        <label style="margin-bottom:8px">Mapped Projects</label>
        <div id="prd-projects-container" style="display:flex;flex-direction:column;gap:2px;padding:8px 12px;background:var(--control-bg);border:1px solid var(--control-border);border-radius:var(--r-md);max-height:220px;overflow-y:auto">
          ${_projectMultiSelectHTML(isEdit ? prd.projectIds : [], 'prd')}
        </div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="saveProduct('${isEdit ? productId : ''}')">
          ${isEdit ? 'Save Changes' : 'Add Product'}
        </button>
      </div>
    </div>`;
  openModal(html);
  // Pre-fill color preview if editing
  if(currentColor){
    setTimeout(()=>{
      const preview = document.getElementById('prd-color-preview');
      if(preview) preview.style.background = currentColor;
    }, 30);
  }
  setTimeout(()=>{ const inp=document.getElementById('prd-name-input'); if(inp) inp.focus(); }, 80);
}

function saveProduct(productId){
  if(!RBAC.isAdmin() && !RBAC.isProgramManager()) return;
  const nameEl = document.getElementById('prd-name-input');
  const name = (nameEl ? nameEl.value.trim() : '');
  if(!name){ showNotif('Product name is required','error'); if(nameEl) nameEl.focus(); return; }
  const projectIds = _collectCheckedProjects('prd-projects-container');
  const colorEl = document.getElementById('prd-color-input');
  const color = (colorEl && colorEl.value && colorEl.value !== '' && colorEl.value !== '#e2e8f0') ? colorEl.value : '';
  state.products = state.products || [];
  let savedProduct;
  if(productId){
    const idx = state.products.findIndex(p => p.id === productId);
    if(idx > -1){
      state.products[idx] = { ...state.products[idx], name, projectIds, color: color||undefined, updatedAt: _now() };
      if(!state.products[idx].color) delete state.products[idx].color;
      savedProduct = state.products[idx];
    }
  } else {
    savedProduct = { id: _prdId(), name, projectIds, ...(color ? {color} : {}), createdAt: _now(), updatedAt: _now() };
    state.products.push(savedProduct);
  }
  if(savedProduct) _fbSaveProduct(savedProduct);
  closeModal();
  _renderProductsList();
  showNotif(productId ? 'Product updated ✓' : 'Product added ✓');
}

function deleteProduct(productId){
  if(!RBAC.isAdmin() && !RBAC.isProgramManager()) return;
  if(!confirm('Delete this product?')) return;
  state.products = (state.products || []).filter(p => p.id !== productId);
  _fbDeleteProduct(productId);
  _renderProductsList();
  showNotif('Product deleted');
}

// ─── TAG CRUD ─────────────────────────────────────────────────────

function openTagModal(tagId){
  if(!RBAC.isAdmin() && !RBAC.isProgramManager()){ showNotif('Permission denied','error'); return; }
  const isEdit = !!tagId;
  const tag = isEdit ? (state.tags||[]).find(t => t.id === tagId) : null;
  const currentColor = (tag && tag.color) ? tag.color : '';
  const PRESET_COLORS = ['#6366f1','#0ea5e9','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#64748b'];
  const presetSwatches = PRESET_COLORS.map(c =>
    `<span onclick="document.getElementById('tag-color-input').value='${c}';document.getElementById('tag-color-preview').style.background='${c}'"
      style="display:inline-block;width:22px;height:22px;border-radius:50%;background:${c};cursor:pointer;border:2px solid ${c===currentColor?'#0d0f14':'transparent'};transition:border-color 0.12s;flex-shrink:0" title="${c}"></span>`
  ).join('');
  const html = `
    <div style="padding:24px 24px 20px">
      <div style="font-size:16px;font-weight:700;color:var(--text-primary);margin-bottom:18px">${isEdit ? 'Edit Tag' : 'Add Tag'}</div>
      <div style="margin-bottom:14px">
        <label>Tag Name</label>
        <input id="tag-name-input" type="text" placeholder="e.g. Critical" value="${isEdit ? _esc(tag.name) : ''}" style="margin-top:4px"/>
      </div>
      <div style="margin-bottom:14px">
        <label>Color <span style="font-size:10px;font-weight:400;color:var(--text-tertiary)">(optional)</span></label>
        <div style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap">
          ${presetSwatches}
          <label style="display:inline-flex;align-items:center;gap:5px;margin:0;cursor:pointer;font-size:12px;color:var(--text-secondary);font-weight:500">
            <span id="tag-color-preview" style="display:inline-block;width:22px;height:22px;border-radius:50%;background:${currentColor||'#e2e8f0'};border:2px solid rgba(0,0,0,0.10);flex-shrink:0;overflow:hidden;position:relative">
              <input type="color" id="tag-color-input" value="${currentColor||'#6366f1'}"
                oninput="document.getElementById('tag-color-preview').style.background=this.value"
                style="position:absolute;inset:-4px;width:calc(100%+8px);height:calc(100%+8px);opacity:0;cursor:pointer;border:none;padding:0"/>
            </span>
            Custom
          </label>
          <button type="button" onclick="document.getElementById('tag-color-input').value='';document.getElementById('tag-color-preview').style.background='#e2e8f0'"
            style="font-size:11px;color:var(--text-tertiary);background:none;border:none;cursor:pointer;padding:2px 4px;text-decoration:underline">Clear</button>
        </div>
      </div>
      <div style="margin-bottom:18px">
        <label style="margin-bottom:8px">Mapped Projects</label>
        <div id="tag-projects-container" style="display:flex;flex-direction:column;gap:2px;padding:8px 12px;background:var(--control-bg);border:1px solid var(--control-border);border-radius:var(--r-md);max-height:220px;overflow-y:auto">
          ${_projectMultiSelectHTML(isEdit ? tag.projectIds : [], 'tag')}
        </div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="saveTag('${isEdit ? tagId : ''}')">
          ${isEdit ? 'Save Changes' : 'Add Tag'}
        </button>
      </div>
    </div>`;
  openModal(html);
  if(currentColor){
    setTimeout(()=>{
      const preview = document.getElementById('tag-color-preview');
      if(preview) preview.style.background = currentColor;
    }, 30);
  }
  setTimeout(()=>{ const inp=document.getElementById('tag-name-input'); if(inp) inp.focus(); }, 80);
}

function saveTag(tagId){
  if(!RBAC.isAdmin() && !RBAC.isProgramManager()) return;
  const nameEl = document.getElementById('tag-name-input');
  const name = (nameEl ? nameEl.value.trim() : '');
  if(!name){ showNotif('Tag name is required','error'); if(nameEl) nameEl.focus(); return; }
  const projectIds = _collectCheckedProjects('tag-projects-container');
  const colorEl = document.getElementById('tag-color-input');
  const color = (colorEl && colorEl.value && colorEl.value !== '' && colorEl.value !== '#e2e8f0') ? colorEl.value : '';
  state.tags = state.tags || [];
  let savedTag;
  if(tagId){
    const idx = state.tags.findIndex(t => t.id === tagId);
    if(idx > -1){
      state.tags[idx] = { ...state.tags[idx], name, projectIds, color: color||undefined, updatedAt: _now() };
      if(!state.tags[idx].color) delete state.tags[idx].color;
      savedTag = state.tags[idx];
    }
  } else {
    savedTag = { id: _tagId(), name, projectIds, ...(color ? {color} : {}), createdAt: _now(), updatedAt: _now() };
    state.tags.push(savedTag);
  }
  if(savedTag) _fbSaveTag(savedTag);
  closeModal();
  _renderTagsList();
  showNotif(tagId ? 'Tag updated ✓' : 'Tag added ✓');
}

function deleteTag(tagId){
  if(!RBAC.isAdmin() && !RBAC.isProgramManager()) return;
  if(!confirm('Delete this tag?')) return;
  state.tags = (state.tags || []).filter(t => t.id !== tagId);
  _fbDeleteTag(tagId);
  _renderTagsList();
  showNotif('Tag deleted');
}
// ─── THEME CRUD ───────────────────────────────────────────────────


function _renderThemesList(){
  const el = document.getElementById('admin-themes-list');
  if(!el) return;
  const themes = state.themes || [];
  if(!themes.length){
    el.innerHTML = `<div class="settings-row" style="justify-content:center;color:var(--text-tertiary);font-size:13px">No themes yet.</div>`;
    return;
  }
  el.innerHTML = themes.map(thm => {
    const mappedNames = (thm.projectIds || []).map(pid => {
      const p = getProject(pid);
      return p ? `<span style="display:inline-flex;align-items:center;padding:2px 8px;background:var(--accent-ghost);color:var(--accent-dark);border-radius:var(--r-pill);font-size:11px;font-weight:600;border:1px solid var(--accent-ring)">${_esc(p.name)}</span>` : '';
    }).filter(Boolean).join(' ');
    const c = thm.color;
    const colorSwatch = c ? `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${_esc(c)};border:1px solid rgba(0,0,0,0.14);flex-shrink:0;margin-right:6px"></span>` : '';
    const nameStyle = c ? `display:inline-flex;align-items:center;padding:2px 9px 2px 7px;border-radius:var(--r-pill);font-size:13px;font-weight:600;background:${_esc(c)}22;color:${_esc(c)};border:1px solid ${_esc(c)}55` : `font-size:13.5px;font-weight:600;color:var(--text-primary)`;
    const isAdmin = RBAC.isAdmin();
    return `<div class="settings-row">
      <div style="flex:1;min-width:0">
        <div style="${nameStyle}">${colorSwatch}${_esc(thm.name)}</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:5px">${mappedNames || '<span style="font-size:11px;color:var(--text-tertiary)">No projects mapped</span>'}</div>
      </div>
      ${isAdmin ? `<div style="display:flex;gap:6px;flex-shrink:0">
        <button class="btn btn-secondary" style="height:28px;font-size:11.5px;padding:0 10px" onclick="openThemeModal('${_esc(thm.id)}')">Edit</button>
        <button class="btn btn-danger" style="height:28px;font-size:11.5px;padding:0 10px" onclick="deleteTheme('${_esc(thm.id)}')">Delete</button>
      </div>` : ''}
    </div>`;
  }).join('');
}

function _fbSaveTheme(theme){
  SaveManager.save();
  if(FirebaseDB.isReady()){
    FirebaseDB.saveEntity('themes', theme).catch(e => console.warn('[AdminConfig] saveTheme Firebase error:', e));
  }
}

function _fbDeleteTheme(themeId){
  SaveManager.save();
  if(FirebaseDB.isReady()){
    FirebaseDB.deleteEntity('themes', themeId).catch(e => console.warn('[AdminConfig] deleteTheme Firebase error:', e));
  }
}

function openThemeModal(themeId){
  if(!RBAC.isAdmin()){ showNotif('Only admins can manage themes','error'); return; }
  const isEdit = !!themeId;
  const thm = isEdit ? (state.themes||[]).find(t => t.id === themeId) : null;
  const currentColor = (thm && thm.color) ? thm.color : '';
  const PRESET_COLORS = ['#6366f1','#8b5cf6','#0ea5e9','#10b981','#f59e0b','#ef4444','#ec4899','#64748b'];
  const presetSwatches = PRESET_COLORS.map(c =>
    `<span onclick="document.getElementById('thm-color-input').value='${c}';document.getElementById('thm-color-preview').style.background='${c}'"
      style="display:inline-block;width:22px;height:22px;border-radius:50%;background:${c};cursor:pointer;border:2px solid ${c===currentColor?'#0d0f14':'transparent'};transition:border-color 0.12s;flex-shrink:0" title="${c}"></span>`
  ).join('');
  const html = `
    <div style="padding:24px 24px 20px">
      <div style="font-size:16px;font-weight:700;color:var(--text-primary);margin-bottom:18px">${isEdit ? 'Edit Theme' : 'Add Theme'}</div>
      <div style="margin-bottom:14px">
        <label>Theme Name</label>
        <input id="thm-name-input" type="text" placeholder="e.g. Claims Modernization" value="${isEdit ? _esc(thm.name) : ''}" style="margin-top:4px"/>
      </div>
      <div style="margin-bottom:14px">
        <label>Color <span style="font-size:10px;font-weight:400;color:var(--text-tertiary)">(optional)</span></label>
        <div style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap">
          ${presetSwatches}
          <label style="display:inline-flex;align-items:center;gap:5px;margin:0;cursor:pointer;font-size:12px;color:var(--text-secondary);font-weight:500">
            <span id="thm-color-preview" style="display:inline-block;width:22px;height:22px;border-radius:50%;background:${currentColor||'#e2e8f0'};border:2px solid rgba(0,0,0,0.10);flex-shrink:0;overflow:hidden;position:relative">
              <input type="color" id="thm-color-input" value="${currentColor||'#8b5cf6'}"
                oninput="document.getElementById('thm-color-preview').style.background=this.value"
                style="position:absolute;inset:-4px;width:calc(100%+8px);height:calc(100%+8px);opacity:0;cursor:pointer;border:none;padding:0"/>
            </span>
            Custom
          </label>
          <button type="button" onclick="document.getElementById('thm-color-input').value='';document.getElementById('thm-color-preview').style.background='#e2e8f0'"
            style="font-size:11px;color:var(--text-tertiary);background:none;border:none;cursor:pointer;padding:2px 4px;text-decoration:underline">Clear</button>
        </div>
      </div>
      <div style="margin-bottom:18px">
        <label style="margin-bottom:8px">Mapped Projects</label>
        <div id="thm-projects-container" style="display:flex;flex-direction:column;gap:2px;padding:8px 12px;background:var(--control-bg);border:1px solid var(--control-border);border-radius:var(--r-md);max-height:220px;overflow-y:auto">
          ${_projectMultiSelectHTML(isEdit ? thm.projectIds : [], 'thm')}
        </div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="saveTheme('${isEdit ? themeId : ''}')">
          ${isEdit ? 'Save Changes' : 'Add Theme'}
        </button>
      </div>
    </div>`;
  openModal(html);
  if(currentColor){
    setTimeout(()=>{
      const preview = document.getElementById('thm-color-preview');
      if(preview) preview.style.background = currentColor;
    }, 30);
  }
  setTimeout(()=>{ const inp=document.getElementById('thm-name-input'); if(inp) inp.focus(); }, 80);
}

function saveTheme(themeId){
  if(!RBAC.isAdmin()){ showNotif('Only admins can manage themes','error'); return; }
  const nameEl = document.getElementById('thm-name-input');
  const name = (nameEl ? nameEl.value.trim() : '');
  if(!name){ showNotif('Theme name is required','error'); if(nameEl) nameEl.focus(); return; }
  const projectIds = _collectCheckedProjects('thm-projects-container');
  const colorEl = document.getElementById('thm-color-input');
  const color = (colorEl && colorEl.value && colorEl.value !== '' && colorEl.value !== '#e2e8f0') ? colorEl.value : '';
  state.themes = state.themes || [];
  let savedTheme;
  if(themeId){
    const idx = state.themes.findIndex(t => t.id === themeId);
    if(idx > -1){
      state.themes[idx] = { ...state.themes[idx], name, projectIds, color: color||undefined, updatedAt: _now() };
      if(!state.themes[idx].color) delete state.themes[idx].color;
      savedTheme = state.themes[idx];
    }
  } else {
    savedTheme = { id: _themeId(), name, projectIds, ...(color ? {color} : {}), createdAt: _now(), updatedAt: _now() };
    state.themes.push(savedTheme);
  }
  if(savedTheme) _fbSaveTheme(savedTheme);
  closeModal();
  _renderThemesList();
  showNotif(themeId ? 'Theme updated ✓' : 'Theme added ✓');
}

function deleteTheme(themeId){
  if(!RBAC.isAdmin()){ showNotif('Only admins can manage themes','error'); return; }
  if(!confirm('Delete this theme?')) return;
  state.themes = (state.themes || []).filter(t => t.id !== themeId);
  _fbDeleteTheme(themeId);
  _renderThemesList();
  showNotif('Theme deleted');
}
// ─── END ADMIN CONFIG ─────────────────────────────────────────────

