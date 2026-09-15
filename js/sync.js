// ─── REALTIME SYNC ────────────────────────────────────────────────
// Subscribes to Firebase Realtime Database onValue() listeners for
// all collections. Patches in-memory state and rerenders only the
// affected UI sections. Prevents loops via write-lock, debouncing,
// and updatedAt-based conflict rejection.
// ──────────────────────────────────────────────────────────────────
const RealtimeSync = (function(){
  const COLLECTIONS = ['tasks','projects','sprints','epics','releases','users','products','tags','themes','retrospectives','retrospectiveEntries']; // FIX(Issue 2): added retro collections
  // Active unsubscribe functions keyed by listener key (collection or "collection:projectId")
  const _unsubs = {};
  // Tracks IDs the local client has just written (to ignore echo-backs)
  const _localWriteSet = new Set();
  // Debounce timers per collection
  const _debounceTimers = {};
  const DEBOUNCE_MS = 180; // v27: raised from 120ms — absorbs larger update bursts at scale
  // Whether listeners are active
  let _active = false;
  // Snapshot fingerprints per listener key — skip processing identical payloads
  const _snapshotFingerprints = {};

  // ── Register a local write so the incoming snapshot is ignored ──
  function markLocalWrite(id, ttl=3000){
    _localWriteSet.add(id);
    setTimeout(()=>_localWriteSet.delete(id), ttl);
  }

  // ── Lightweight conflict check based on updatedAt ──
  function _isStale(incoming, existing){
    if(!existing) return false;
    const iAt = incoming.updatedAt || incoming.createdAt || 0;
    const eAt = existing.updatedAt || existing.createdAt || 0;
    return iAt < eAt;
  }

  // ── Normalize a Firebase collection snapshot (obj or array) ──
  function _normalize(val){
    if(!val) return [];
    if(Array.isArray(val)) return val.filter(Boolean);
    // Fall back to the RTDB key when a record has no `id` field of its own
    // (see matching fix in firebase.js _mergeArr) — otherwise _patchCollection's
    // `!item.id` guard below silently drops these records from realtime updates.
    return Object.entries(val).filter(([,v])=>Boolean(v)).map(([k,v])=>v.id?v:{...v,id:k});
  }

  // ── Patch state for a collection, return diff info ──
  function _patchCollection(collection, incoming){
    const KEY = collection; // 'tasks', 'projects', etc.
    const current = state[KEY] || [];
    let added=0, updated=0, removed=0, staleSkipped=0, loopSkipped=0;
    const incomingIds = new Set(incoming.map(x=>x.id));

    // Process additions + updates
    incoming.forEach(item=>{
      if(!item || !item.id) return;
      // Self-triggered echo suppression
      if(_localWriteSet.has(item.id)){ loopSkipped++; return; }
      const idx = current.findIndex(x=>x&&x.id===item.id);
      if(idx===-1){
        current.push(item);
        added++;
      } else {
        if(_isStale(item, current[idx])){ staleSkipped++; return; }
        // Detect conflict: remote changed something we didn't just write
        const localAt = current[idx].updatedAt || 0;
        const remoteAt = item.updatedAt || 0;
        if(remoteAt > localAt && !_localWriteSet.has(item.id)){
          // Another user updated — show toast (once per item per cycle)
          if(current[idx]._remoteConflictNotified !== remoteAt){
            current[idx]._remoteConflictNotified = remoteAt;
            // Only show toast if something meaningful changed (not just metadata)
            const prevStr = JSON.stringify({...current[idx], _remoteConflictNotified:undefined});
            const nextStr = JSON.stringify({...item});
            if(prevStr !== nextStr){
              showNotif('This item was updated by another user.','info');
            }
          }
        }
        current[idx] = item;
        updated++;
      }
    });

    // Process removals (entity deleted remotely)
    for(let i=current.length-1; i>=0; i--){
      const item = current[i];
      if(!item || !item.id) continue;
      if(!incomingIds.has(item.id) && !_localWriteSet.has(item.id)){
        current.splice(i,1);
        removed++;
      }
    }

    state[KEY] = current;
    if(KEY==='tasks'){
      // Re-normalise tasks (migrate status, ensure subtasks array)
      const statusMap={'todo':'open','in-progress':'dev-in-progress','qa':'in-qa','done':'released'};
      state.tasks.forEach(t=>{
        if(statusMap[t.status]) t.status=statusMap[t.status];
        // FIX: same guard as loadAppData() — coerce non-array subtasks (object
        // shape from a sparse Firebase array) instead of only checking truthy,
        // so later consumers (e.g. parent.subtasks.forEach in the UI) don't break.
        if(!Array.isArray(t.subtasks)) t.subtasks = t.subtasks ? Object.values(t.subtasks).filter(Boolean) : [];
        if(t.epicId===undefined) t.epicId=null;
        if(t.releaseId===undefined) t.releaseId=null;
      });
    }
    if(KEY==='users'){
      state.users.forEach(u=>{ if(u.role==='member') u.role='team_member'; if(!['admin','program_manager','team_member','senior_manager','viewer'].includes(u.role)) u.role='team_member'; });
    }
    if(KEY==='projects'){
      state.projects.forEach(p=>{ if(!p.memberIds) p.memberIds=[]; });
    }
    return { added, updated, removed, staleSkipped, loopSkipped };
  }

  // ── Map collection → which pages/render functions are affected ──
  function _renderForCollection(collection){
    if(typeof currentPage === 'undefined') return;
    invalidateStateMaps();
    const page = currentPage;
    switch(collection){
      case 'tasks':
        if(page==='kanban')        { if(!_modalOpen) renderKanban(); }
        else if(page==='backlog-planner') { renderBacklogPlanner(); }
        else if(page==='sprints')  { renderSprintPlanning(); }
        else if(page==='releases') { renderReleaseBoard(); renderReleaseQueue(); }
        else if(page==='reports')  { renderReports(); }
        else if(page==='release-reports') { renderReleaseReports(); }
        else if(page==='epic-reports') { renderEpicReports(); }
        else if(page==='delay-reports') { renderDelayReports(); }
        else if(page==='productivity-report') { renderProductivityReport(); }
        else if(page==='dashboard'){ _invalidateChartFingerprints(); renderDashboard(); }
        else if(page==='epics')    { renderEpics(); }
        break;
      case 'projects':
        if(page==='kanban')        { if(!_modalOpen) renderKanban(); }
        else if(page==='backlog-planner') { renderBacklogPlanner(); }
        else if(page==='sprints')  { renderSprintPlanning(); }
        else if(page==='dashboard'){ _invalidateChartFingerprints(); renderDashboard(); }
        else if(page==='epics')    { renderEpics(); }
        updateSidebarProject();
        break;
      case 'sprints':
        if(page==='kanban')        { if(!_modalOpen) renderKanban(); }
        else if(page==='backlog-planner') { renderBacklogPlanner(); }
        else if(page==='sprint-planning')  { renderSprintPlanning(); }
        else if(page==='dashboard'){ _invalidateChartFingerprints(); renderDashboard(); }
        else if(page==='delay-reports') { renderDelayReports(); }
        break;
      case 'epics':
        if(page==='epics')         { renderEpics(); }
        else if(page==='backlog-planner') { renderBacklogPlanner(); }
        else if(page==='kanban')   { if(!_modalOpen) renderKanban(); }
        else if(page==='dashboard'){ _invalidateChartFingerprints(); renderDashboard(); }
        else if(page==='epic-reports') { renderEpicReports(); }
        else if(page==='delay-reports') { renderDelayReports(); }
        break;
      case 'releases':
        if(page==='releases')      { renderReleaseBoard(); renderReleaseQueue(); }
        else if(page==='dashboard'){ _invalidateChartFingerprints(); renderDashboard(); }
        break;
      case 'users':
        // FIX: state.currentUser is a one-time spread copy taken at RBAC.init()
        // (login), not a live reference into state.users — so a per-member AI
        // toggle (aiChatEnabled/aiWritingEnabled) an Admin flips for someone
        // ELSE'S active session previously only took effect after that
        // person's next reload. Re-sync the fields that can change post-login
        // and refresh AI-gated UI immediately.
        if(state.currentUser){
          const _freshMe = state.users.find(u=>u.id===state.currentUser.id);
          if(_freshMe){
            state.currentUser.aiChatEnabled    = _freshMe.aiChatEnabled;
            state.currentUser.aiWritingEnabled = _freshMe.aiWritingEnabled;
            if(typeof _updateAiFeatureVisibility==='function') _updateAiFeatureVisibility();
          }
        }
        if(page==='teams')         { renderTeams(); }
        else if(page==='dashboard'){ _invalidateChartFingerprints(); renderDashboard(); }
        else if(page==='reports')  { renderReports(); }
        break;
      case 'retrospectives':
      case 'retrospectiveEntries':
        if(page==='retrospectives') { renderRetrospectives(); } // FIX(Issue 2)
        break;
      case 'products':
      case 'tags':
      case 'themes':
        if(page==='settings')      { renderAdminConfig(); }
        break;
    }
  }

  // ── RBAC-scoped listener paths ──
  // Admin: listen to entire collection root.
  // PM / Member: listen only to their visible project subtrees for
  //   project-keyed collections; fall back to root for users collection.
  // Returns array of {path, key} objects (key = unique listener registry id).
  //
  // FIX (targeted bandwidth optimization — no UI/RBAC/behavior change):
  // tasks/sprints/epics/releases now return one target PER visible project,
  // tagged with queryField/queryValue, so _listen() can attach a server-side
  // scoped query (orderByChild + equalTo — the exact pattern FirebaseDB
  // .loadAppData already uses for its own initial get()) instead of
  // downloading the full collection root every time a listener attaches.
  // Admin/Senior Manager and every non-project-keyed collection are
  // untouched — they still return the same single root target as before.
  const _PROJECT_KEYED_FIELD = { tasks:'project', sprints:'project', epics:'projectId', releases:'projectId' };
  function _listenTargets(collection){
    // users, products, tags collections are not project-scoped; always root
    if(collection === 'users' || collection === 'products' || collection === 'tags' || collection === 'themes'){
      return [{ path: `sprintflow/${collection}`, key: collection }];
    }
    // Determine RBAC scope — RBAC may not be fully initialised yet (admin default)
    let isAdmin = true;
    let visibleIds = null;
    try{
      isAdmin = RBAC.isAdmin();
      if(!isAdmin){
        const vp = RBAC.getVisibleProjects();
        visibleIds = vp && vp.length ? vp.map(p=>p.id) : null;
      }
    } catch(e){ /* RBAC not ready — default to admin (full) */ }

    // Admin or no visible-project constraint: single root listener
    if(isAdmin || !visibleIds || !visibleIds.length){
      return [{ path: `sprintflow/${collection}`, key: collection }];
    }

    // Non-admin, project-keyed collection (tasks/sprints/epics/releases):
    // one query-scoped listener per visible project. Firebase filters these
    // server-side, so only that project's children are ever sent over the
    // wire — the RBAC-visible result is identical, just far less bandwidth.
    const _pkField = _PROJECT_KEYED_FIELD[collection];
    if(_pkField){
      return visibleIds.map(pid => ({
        path: `sprintflow/${collection}`,
        key: `${collection}:${pid}`,
        scopedIds: new Set(visibleIds),
        queryField: _pkField,
        queryValue: pid
      }));
    }

    // Non-admin, non-project-keyed collection (projects, retrospectives,
    // retrospectiveEntries): unchanged existing behaviour — single root
    // listener, client-side scope filter (no query field to filter on here).
    return [{ path: `sprintflow/${collection}`, key: collection, scopedIds: new Set(visibleIds) }];
  }

  // ── Set up a single collection listener ──
  function _listen(collection, onValueFn, refFn, db){
    // Detach existing listeners before re-attaching to prevent duplicates
    if(_unsubs[collection]) { try{ _unsubs[collection](); }catch(e){} delete _unsubs[collection]; }
    delete _snapshotFingerprints[collection];

    const targets = _listenTargets(collection);
    const { path, key, scopedIds } = targets[0];

    // ── Resolve child-listener SDK functions (preferred) ──
    const _onChildAdded   = window._rtOnChildAdded;
    const _onChildChanged = window._rtOnChildChanged;
    const _onChildRemoved = window._rtOnChildRemoved;
    const useChildListeners = !!(_onChildAdded && _onChildChanged && _onChildRemoved);

    try {
      if(useChildListeners){
        // ── CHILD LISTENERS: only the changed entity is sent over the wire ──
        // Each callback receives a single child snapshot (one entity).
        // targets.length is 1 in every pre-existing case (admin, or a
        // non-project-keyed collection) — the forEach below runs once with
        // the same colRef/key as before, so behavior there is unchanged.
        // targets.length > 1 only for non-admin project-keyed collections,
        // where each target carries its own project-scoped query.
        const _unsubFns = [];

        targets.forEach(target => {
          const tKey       = target.key;
          const tScopedIds = target.scopedIds;
          let colRef = refFn(db, target.path);
          if(target.queryField && window._rtQuery && window._rtOrderByChild && window._rtEqualTo){
            colRef = window._rtQuery(colRef, window._rtOrderByChild(target.queryField), window._rtEqualTo(target.queryValue));
          }

          // Shared handler for add + change: upsert the single item into state
          function _handleUpsert(snapshot){
            try {
              const item = snapshot.val();
              if(!item || !item.id) return;
              // Self-echo suppression
              if(_localWriteSet.has(item.id)) return;
              // RBAC client-side scope filter (redundant once the query is
              // server-side scoped — kept as a harmless safety net)
              if(tScopedIds && tScopedIds.size){
                const projectField = collection === 'releases' ? 'projectId'
                                   : collection === 'epics'    ? 'projectId'
                                   : 'project';
                const pid = item[projectField];
                if(pid && !tScopedIds.has(pid)) return;
              }
              // Debounce per listener target to absorb rapid bursts
              clearTimeout(_debounceTimers[tKey]);
              _debounceTimers[tKey] = setTimeout(()=>{
                try {
                  // Upsert single item into state array
                  const arr = state[collection] || [];
                  const idx = arr.findIndex(x => x && x.id === item.id);
                  if(idx === -1){
                    arr.push(item);
                    state[collection] = arr;
                  } else {
                    if(_isStale(item, arr[idx])) return;
                    // Conflict toast — another user changed this entity
                    const localAt  = arr[idx].updatedAt || 0;
                    const remoteAt = item.updatedAt || 0;
                    if(remoteAt > localAt){
                      if(arr[idx]._remoteConflictNotified !== remoteAt){
                        arr[idx]._remoteConflictNotified = remoteAt;
                        const prevStr = JSON.stringify({...arr[idx], _remoteConflictNotified:undefined});
                        if(prevStr !== JSON.stringify(item)) showNotif('This item was updated by another user.','info');
                      }
                    }
                    arr[idx] = item;
                  }
                  // Run same normalisation as _patchCollection
                  if(collection === 'tasks'){
                    const sm={'todo':'open','in-progress':'dev-in-progress','qa':'in-qa','done':'released'};
                    const t = state.tasks.find(x=>x&&x.id===item.id);
                    if(t){
                      if(sm[t.status]) t.status=sm[t.status];
                      if(!t.subtasks)  t.subtasks=[];
                      if(t.epicId===undefined)    t.epicId=null;
                      if(t.releaseId===undefined) t.releaseId=null;
                    }
                  }
                  if(collection === 'users'){
                    state.users.forEach(u=>{ if(u.role==='member') u.role='team_member'; if(!['admin','program_manager','team_member','senior_manager','viewer'].includes(u.role)) u.role='team_member'; });
                  }
                  if(collection === 'projects'){
                    state.projects.forEach(p=>{ if(!p.memberIds) p.memberIds=[]; });
                  }
                  invalidateStateMaps();
                  _renderForCollection(collection);
                  console.log(`[RealtimeSync] ${collection}: child upsert ${item.id}`);
                } catch(e){ console.warn('[RealtimeSync] upsert error:', collection, e); }
              }, DEBOUNCE_MS);
            } catch(e){ console.warn('[RealtimeSync] handleUpsert error:', collection, e); }
          }

          function _handleRemove(snapshot){
            try {
              const item = snapshot.val();
              const id = (item && item.id) ? item.id : snapshot.key;
              if(!id) return;
              if(_localWriteSet.has(id)) return;
              clearTimeout(_debounceTimers[tKey]);
              _debounceTimers[tKey] = setTimeout(()=>{
                try {
                  const arr = state[collection] || [];
                  const idx = arr.findIndex(x => x && x.id === id);
                  if(idx !== -1){
                    arr.splice(idx, 1);
                    invalidateStateMaps();
                    _renderForCollection(collection);
                    console.log(`[RealtimeSync] ${collection}: child removed ${id}`);
                  }
                } catch(e){ console.warn('[RealtimeSync] remove error:', collection, e); }
              }, DEBOUNCE_MS);
            } catch(e){ console.warn('[RealtimeSync] handleRemove error:', collection, e); }
          }

          // Skip first emission of onChildAdded (already loaded via loadAppData)
          let _addedBootSkip = true;
          setTimeout(()=>{ _addedBootSkip = false; }, 5000); // 5s boot window

          const unsubAdded   = _onChildAdded  (colRef, s=>{ if(!_addedBootSkip) _handleUpsert(s); }, e=>console.warn('[RealtimeSync] childAdded error:',  collection, e));
          const unsubChanged = _onChildChanged(colRef, _handleUpsert,                                  e=>console.warn('[RealtimeSync] childChanged error:', collection, e));
          const unsubRemoved = _onChildRemoved(colRef, _handleRemove,                                  e=>console.warn('[RealtimeSync] childRemoved error:', collection, e));

          _unsubFns.push(()=>{ try{ unsubAdded(); }catch(e){} try{ unsubChanged(); }catch(e){} try{ unsubRemoved(); }catch(e){} });
        });

        // Store a combined unsub across every target (one, or one per project)
        _unsubs[collection] = ()=>{ _unsubFns.forEach(fn=>{ try{ fn(); }catch(e){} }); };

      } else {
        // ── FALLBACK: onValue full-collection (SDK functions not available) ──
        let firstCall = true;
        const unsubscribe = onValueFn(refFn(db, path), (snapshot)=>{
          if(firstCall){ firstCall=false; return; }
          clearTimeout(_debounceTimers[collection]);
          _debounceTimers[collection] = setTimeout(()=>{
            try {
              const val = snapshot.val() || {};
              if(val === null || (typeof val === 'object' && Object.keys(val).length === 0 && !snapshot.exists())){ return; }
              const fingerprint = JSON.stringify(val);
              if(_snapshotFingerprints[collection] === fingerprint){ return; }
              _snapshotFingerprints[collection] = fingerprint;
              const incoming = _normalize(val);
              let filteredIncoming = incoming;
              if(scopedIds && scopedIds.size){
                const projectField = collection === 'releases' ? 'projectId'
                                   : collection === 'epics'    ? 'projectId'
                                   : 'project';
                filteredIncoming = incoming.filter(item=>{ const pid=item[projectField]; return !pid||scopedIds.has(pid); });
              }
              const diff = _patchCollection(collection, filteredIncoming);
              if(diff.added+diff.updated+diff.removed+diff.loopSkipped > 0){
                console.log(`[RealtimeSync] ${collection}: +${diff.added} ~${diff.updated} -${diff.removed}`);
                _renderForCollection(collection);
              }
            } catch(e){ console.warn('[RealtimeSync] handler error:', collection, e); }
          }, DEBOUNCE_MS);
        }, (err)=>{
          console.warn('[RealtimeSync] listener error:', collection, err.message||err);
        });
        _unsubs[collection] = unsubscribe;
      }
    } catch(e){
      console.warn('[RealtimeSync] attach error:', collection, e);
    }
  }

  // ── Attach all listeners. Called once after Firebase auth + loadAppData ──
  // (AI feature access is per-member — aiChatEnabled/aiWritingEnabled on each
  // user record — so it propagates live via the existing 'users' listener
  // below, not a separate one. The Apps Script URL itself is a hardcoded
  // constant in ai-chatbot.js, not stored in Firebase at all.)
  function start(){
    if(_active) return;
    const onValueFn = window._rtOnValue;
    const refFn = FirebaseDB.getRef();
    const db = FirebaseDB.getDb();
    if(!onValueFn || !refFn || !db){
      console.warn('[RealtimeSync] Cannot start — SDK not ready');
      return;
    }
    COLLECTIONS.forEach(col=> _listen(col, onValueFn, refFn, db));
    _active = true;
    console.log('[RealtimeSync] Realtime listeners active for:', COLLECTIONS.join(', '));
  }

  // ── Restart listeners (e.g. after project switch or role change) ──
  // Re-evaluates RBAC scope and re-attaches listeners for any collection
  // whose scope has changed. Does not interrupt unchanged listeners.
  function restart(){
    if(!_active) { start(); return; }
    const onValueFn = window._rtOnValue;
    const refFn = FirebaseDB.getRef();
    const db = FirebaseDB.getDb();
    if(!onValueFn || !refFn || !db) return;
    COLLECTIONS.forEach(col=> _listen(col, onValueFn, refFn, db));
    console.log('[RealtimeSync] Listeners restarted (scope refresh)');
  }

  // ── Detach all listeners (on logout) ──
  // Memory Safe: clears all debounce timers and unsubscribes before logout
  function stop(){
    // Clear all debounce timers to prevent stale callbacks after logout
    Object.keys(_debounceTimers).forEach(k=>{ clearTimeout(_debounceTimers[k]); delete _debounceTimers[k]; });
    Object.values(_unsubs).forEach(fn=>{ try{ fn(); }catch(e){} });
    Object.keys(_unsubs).forEach(k=>delete _unsubs[k]);
    // Clear fingerprints so next login gets fresh snapshots
    Object.keys(_snapshotFingerprints).forEach(k=>delete _snapshotFingerprints[k]);
    _active = false;
    console.log('[RealtimeSync] Listeners detached');
  }

  return { start, stop, restart, markLocalWrite };
})();

// ── Patch all FirebaseDB write functions to mark local writes ──
// This prevents the realtime listener from reprocessing our own saves.
(function(){
  const _origSave   = FirebaseDB.saveEntity.bind(FirebaseDB);
  const _origUpdate = FirebaseDB.updateEntity.bind(FirebaseDB);
  const _origDelete = FirebaseDB.deleteEntity.bind(FirebaseDB);

  FirebaseDB.saveEntity = async function(collection, entity){
    if(entity && entity.id) RealtimeSync.markLocalWrite(entity.id);
    return _origSave(collection, entity);
  };
  FirebaseDB.updateEntity = async function(collection, id, patch){
    if(id) RealtimeSync.markLocalWrite(id);
    return _origUpdate(collection, id, patch);
  };
  FirebaseDB.deleteEntity = async function(collection, id){
    if(id) RealtimeSync.markLocalWrite(id);
    return _origDelete(collection, id);
  };
})();

// ─── PENDING SYNC QUEUE ───────────────────────────────────────────
// Queues failed Firebase writes, persists them in localStorage,
// and replays them on startup or when the browser comes back online.
const PendingSyncQueue = (function(){
  const QUEUE_KEY = 'sprintflow_sync_queue';
  let _queue = [];
  let _replayTimer = null;
  let _replayInProgress = false;

  // ── Persistence ──
  function _load(){
    try{
      const raw = localStorage.getItem(QUEUE_KEY);
      _queue = raw ? JSON.parse(raw) : [];
    }catch(e){ _queue = []; }
  }
  function _persist(){
    try{
      localStorage.setItem(QUEUE_KEY, JSON.stringify(_queue));
    }catch(e){ console.warn('[PendingSyncQueue] persist failed',e); }
  }

  // ── Enqueue ──
  // op: 'saveEntity' | 'updateEntity' | 'deleteEntity'
  function _enqueue(op, collection, idOrEntity, patch){
    const item = { op, collection, id: typeof idOrEntity === 'object' ? idOrEntity.id : idOrEntity, payload: patch || (typeof idOrEntity === 'object' ? idOrEntity : null), ts: Date.now() };
    // De-duplicate: if same op+collection+id already queued, replace payload
    const existIdx = _queue.findIndex(q => q.op === op && q.collection === collection && q.id === item.id);
    if(existIdx !== -1){ _queue[existIdx] = item; }
    else { _queue.push(item); }
    _persist();
  }

  // ── Queue operations (mirror FirebaseDB API) ──
  function saveEntity(collection, entity){
    if(!entity || !entity.id) return;
    SyncState.markPending(entity.id);
    _enqueue('saveEntity', collection, entity);
    _scheduleRetry();
  }
  function updateEntity(collection, id, patch){
    if(!id || !patch) return;
    SyncState.markPending(id);
    _enqueue('updateEntity', collection, id, patch);
    _scheduleRetry();
  }
  function deleteEntity(collection, id){
    if(!id) return;
    _enqueue('deleteEntity', collection, id, null);
    _scheduleRetry();
  }

  // ── Retry scheduling ──
  function _scheduleRetry(delayMs){
    clearTimeout(_replayTimer);
    _replayTimer = setTimeout(replayQueue, delayMs || 4000);
  }

  // ── Replay ──
  async function replayQueue(){
    if(_replayInProgress) return;
    if(!FirebaseDB.isReady()) return;
    if(!_queue.length) return;
    _replayInProgress = true;
    const toReplay = [..._queue];
    for(const item of toReplay){
      try{
        let ok = false;
        if(item.op === 'saveEntity'){
          ok = await FirebaseDB.saveEntity(item.collection, item.payload);
        } else if(item.op === 'updateEntity'){
          ok = await FirebaseDB.updateEntity(item.collection, item.id, item.payload);
        } else if(item.op === 'deleteEntity'){
          ok = await FirebaseDB.deleteEntity(item.collection, item.id);
        }
        if(ok){
          _queue = _queue.filter(q => !(q.op === item.op && q.collection === item.collection && q.id === item.id && q.ts === item.ts));
          SyncState.markSynced(item.id);
          _refreshSyncDotForEntity(item.id);
        } else {
          SyncState.markFailed(item.id);
          _refreshSyncDotForEntity(item.id);
        }
      }catch(e){
        SyncState.markFailed(item.id);
        _refreshSyncDotForEntity(item.id);
        console.warn('[PendingSyncQueue] replay error for', item.collection, item.id, e);
      }
    }
    _persist();
    _replayInProgress = false;
    // If still has items, retry later
    if(_queue.length){ _scheduleRetry(8000); }
  }

  function pendingCount(){ return _queue.length; }
  function hasItem(id){ return _queue.some(q => q.id === id); }

  // Init: load persisted queue and attempt replay after Firebase is ready
  function init(){
    _load();
    if(_queue.length){
      console.info('[PendingSyncQueue] Found', _queue.length, 'queued writes — will replay when Firebase is ready');
      FirebaseDB.onReady(()=>{ replayQueue(); });
    }
  }

  return { init, saveEntity, updateEntity, deleteEntity, replayQueue, pendingCount, hasItem };
})();

// ─── SYNC STATE MANAGER ──────────────────────────────────────────
// Tracks transient per-entity sync metadata (_syncState).
// Never written to Firebase.
const SyncState = (function(){
  const _map = new Map(); // entityId → 'pending'|'synced'|'failed'

  function markPending(id){ if(id){ _map.set(id,'pending'); } }
  function markSynced(id){ if(id){ _map.set(id,'synced'); } }
  function markFailed(id){ if(id){ _map.set(id,'failed'); } }
  function get(id){ return _map.get(id) || 'synced'; }
  function clear(id){ _map.delete(id); }

  return { markPending, markSynced, markFailed, get, clear };
})();

// ─── DEBOUNCE WRITE MANAGER ──────────────────────────────────────
// Per-entity debounced Firebase write to absorb rapid kanban drags / edits.
// Memory Safe: clearTimeout on every reschedule prevents timer accumulation
const DebounceWrite = (function(){
  const _timers = new Map();
  const DELAY = 600; // ms — absorbs rapid drag/edit sequences

  function schedule(collection, entity, delayMs){
    if(!entity || !entity.id) return;
    const key = collection + ':' + entity.id;
    clearTimeout(_timers.get(key));
    SyncState.markPending(entity.id);
    _refreshSyncDotForEntity(entity.id);
    const snapshot = JSON.parse(JSON.stringify(entity)); // clone to avoid stale reference
    _timers.set(key, setTimeout(async ()=>{
      _timers.delete(key);
      if(!FirebaseDB.isReady()){
        PendingSyncQueue.saveEntity(collection, snapshot);
        return;
      }
      try{
        const ok = await FirebaseDB.saveEntity(collection, snapshot);
        if(ok){ SyncState.markSynced(entity.id); }
        else   { SyncState.markFailed(entity.id); PendingSyncQueue.saveEntity(collection, snapshot); }
      }catch(e){
        SyncState.markFailed(entity.id);
        PendingSyncQueue.saveEntity(collection, snapshot);
      }
      _refreshSyncDotForEntity(entity.id);
    }, delayMs || DELAY));
  }

  function cancel(entityId){
    for(const [key] of _timers){
      if(key.endsWith(':'+entityId)){
        clearTimeout(_timers.get(key));
        _timers.delete(key);
      }
    }
  }

  return { schedule, cancel };
})();

// ─── SYNC DOT UI HELPER ──────────────────────────────────────────
// Updates sync indicator dots on kanban cards without full re-render.
function _refreshSyncDotForEntity(id){
  if(!id) return;
  const dotEl = document.getElementById('syncdot-' + id);
  if(!dotEl) return;
  const state_ = SyncState.get(id);
  dotEl.className = 'sync-dot sync-dot-' + (state_ || 'synced');
  if(state_ === 'failed'){
    dotEl.title = 'Sync failed — click to retry';
    dotEl.onclick = function(e){ e.stopPropagation(); _retrySingleEntity(id); };
  } else {
    dotEl.title = state_ === 'pending' ? 'Syncing…' : '';
    dotEl.onclick = null;
  }
}

function _retrySingleEntity(id){
  // Find the entity in state and reschedule
  const task = getTask(id);
  if(task){
    SyncState.markPending(id);
    _refreshSyncDotForEntity(id);
    DebounceWrite.schedule('tasks', task, 0);
    return;
  }
  const proj = getProject(id);
  if(proj){
    SyncState.markPending(id);
    _refreshSyncDotForEntity(id);
    DebounceWrite.schedule('projects', proj, 0);
  }
}

// ─── NETWORK EVENT HANDLING ──────────────────────────────────────
// Listener Protected: guarded by _sfNetworkListenerAttached flag
(function(){
  if(window._sfNetworkListenerAttached) return;
  window._sfNetworkListenerAttached = true;
  let _toastTimer = null;
  const _toastEl = document.createElement('div');
  _toastEl.className = 'network-toast';
  // Guard against race: append immediately if DOM ready, else wait for DOMContentLoaded
  function _appendToast(){
    if(!document.body.contains(_toastEl)) document.body.appendChild(_toastEl);
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', _appendToast);
  } else {
    _appendToast();
  }

  function _showNetworkToast(msg, color){
    _toastEl.innerHTML = msg;
    _toastEl.style.background = color || '#1e293b';
    _toastEl.classList.add('visible');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(()=>{ _toastEl.classList.remove('visible'); }, 3200);
  }

  window.addEventListener('offline', ()=>{
    _showNetworkToast(
      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0119 12.55M5 12.55a10.94 10.94 0 015.17-2.39M10.71 5.05A16 16 0 0122.56 9M1.42 9a15.91 15.91 0 014.7-2.88M8.53 16.11a6 6 0 016.95 0"/><circle cx="12" cy="20" r="1"/></svg> Offline mode enabled`,
      '#475569'
    );
  });

  window.addEventListener('online', ()=>{
    _showNetworkToast(
      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12.55a11 11 0 0114.08 0"/><path d="M1.42 9a16 16 0 0121.16 0"/><path d="M8.53 16.11a6 6 0 016.95 0"/><circle cx="12" cy="20" r="1"/></svg> Sync restored`,
      '#059669'
    );
    // Replay any queued writes now that we're back online
    setTimeout(()=>PendingSyncQueue.replayQueue(), 800);
  });
})();

// ─── CENTRALIZED SAVE MANAGER (throttled) ────────────────────────
// SaveManager continues to keep module-specific localStorage in sync
// for all modules not yet migrated to Firebase.
const SaveManager = (function(){
  let _saveTimer = null;
  let _releaseSaveTimer = null;
  const SAVE_DELAY = 400;

  function _flush(){
    try{
      localStorage.setItem('sprintflow_v2', JSON.stringify(state));
    }catch(e){console.warn('Save failed',e);}
  }
  function _flushReleases(){
    try{
      localStorage.setItem('sprintflow_releases', JSON.stringify(state.releases||[]));
    }catch(e){console.warn('saveReleases failed',e);}
  }
  return {
    save(){
      clearTimeout(_saveTimer);
      _saveTimer = setTimeout(_flush, SAVE_DELAY);
    },
    saveImmediate(){
      clearTimeout(_saveTimer);
      _flush();
    },
    saveReleases(){
      clearTimeout(_releaseSaveTimer);
      _releaseSaveTimer = setTimeout(_flushReleases, SAVE_DELAY);
    },
    saveReleasesImmediate(){
      clearTimeout(_releaseSaveTimer);
      _flushReleases();
    }
  };
})();

// saveState() — preserved for all existing callers.
function saveState(){
  SaveManager.save();
  SaveManager.saveReleases();
}
// Alias for immediate saves (page unload / critical ops)
function saveStateImmediate(){
  SaveManager.saveImmediate();
  SaveManager.saveReleasesImmediate();
}
