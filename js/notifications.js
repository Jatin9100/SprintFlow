// ─── NOTIFICATION SYSTEM (v29 — OPTIMIZED) ───────────────────────────────────
// Firebase active path  : sprintflow/notifications/{userId}/{id}
// Firebase archive path : sprintflow/notifications_archive/{userId}/{id}
// Unread counter shard  : sprintflow/notificationCounts/{userId}/unread
// In-memory store       : state.notifications  (same shape as before)
// All public API identical to v28 — zero behavioral changes.
// ─────────────────────────────────────────────────────────────────────────────

const NotificationSystem = (function () {

  // ── SDK handles ────────────────────────────────────────────────────────────
  let _db = null, _ref = null, _set = null, _update = null, _remove = null;
  let _onChildAdded = null, _onChildChanged = null, _onChildRemoved = null;
  let _unsubAdded = null, _unsubChanged = null, _unsubRemoved = null;
  let _listenerActive = false;
  let _bootSkip = true, _bootSkipTimer = null;
  const _debounceTimers = {};
  const DEBOUNCE_MS = 150;

  // ── Performance counters (debug-only) ─────────────────────────────────────
  const _perf = { loaded: 0, archived: 0, deleted: 0, countUpdates: 0 };
  function _dbg(...args){ if(typeof console!=='undefined') console.debug('[NS]',...args); }

  // ── Config ─────────────────────────────────────────────────────────────────
  const ACTIVE_WINDOW_MS  = 60  * 24 * 60 * 60 * 1000; // 60 days
  const ARCHIVE_TTL_MS    = 180 * 24 * 60 * 60 * 1000; // 180 days
  const LOAD_LIMIT        = 100;  // latest 100 per user
  const UNREAD_COUNT_PATH = 'sprintflow/notificationCounts';
  const ACTIVE_PATH       = 'sprintflow/notifications';
  const ARCHIVE_PATH      = 'sprintflow/notifications_archive';

  // ── Readiness ──────────────────────────────────────────────────────────────
  function _isReady(){ return !!(_db && _ref && _set && _update && _onChildAdded && _onChildChanged && _onChildRemoved); }
  function _safeRef(path){ if(!_isReady()) throw new Error('[NS] Firebase not ready'); return _ref(_db,path); }

  // ── Path helpers (user-scoped) ─────────────────────────────────────────────
  function _uid(){ return state.currentUser ? state.currentUser.id : null; }
  function _notifPath(userId, id){ return ACTIVE_PATH+'/'+userId+'/'+id; }
  function _userColPath(userId){ return ACTIVE_PATH+'/'+userId; }
  function _archivePath(userId, id){ return ARCHIVE_PATH+'/'+userId+'/'+id; }
  function _countPath(userId){ return UNREAD_COUNT_PATH+'/'+userId+'/unread'; }

  // ── In-memory store (backward-compatible flat object keyed by id) ──────────
  function _store(){
    if(!state.notifications||typeof state.notifications!=='object'||Array.isArray(state.notifications))
      state.notifications={};
    return state.notifications;
  }
  function _clean(obj){ const o={}; Object.keys(obj).forEach(k=>{if(obj[k]!==undefined)o[k]=obj[k];}); return o; }

  // ── Per-user state helpers ─────────────────────────────────────────────────
  function _us(notif){
    const uid = _uid();
    if(!uid||!notif) return {};
    return (notif.userState && notif.userState[uid]) || {};
  }
  function _usEnsure(notif){
    const uid = _uid();
    if(!uid||!notif) return null;
    if(!notif.userState) notif.userState = {};
    if(!notif.userState[uid]) notif.userState[uid] = { read:false, muted:false, deleted:false };
    return notif.userState[uid];
  }

  function _upsertLocal(notif){
    if(!notif||!notif.id) return;
    const store=_store();
    const ex=store[notif.id];
    if(ex&&(ex.updatedAt||ex.createdAt||0)>(notif.updatedAt||notif.createdAt||0)) return;
    const merged = Object.assign({},ex||{},notif);
    if(ex&&ex.userState&&notif.userState){
      merged.userState = Object.assign({},ex.userState,notif.userState);
      Object.keys(notif.userState).forEach(uid=>{
        merged.userState[uid] = Object.assign({},ex.userState[uid]||{},notif.userState[uid]);
      });
    }
    store[notif.id]=merged;
  }
  function _removeLocal(id){ if(!id) return; delete _store()[id]; }

  // ── Unread counter shard ───────────────────────────────────────────────────
  // Lightweight counter in notificationCounts/{userId}/unread.
  // Badge reads this first; falls back to count if shard unavailable.
  let _cachedUnreadCount = null;

  async function _syncUnreadCountShard(){
    const uid = _uid();
    if(!uid||!_isReady()) return;
    // Count from in-memory truth
    const count = Object.values(_store()).filter(n=>{
      if(!n||!n.id) return false;
      const us = _us(n);
      if(us.deleted||us.muted) return false;
      if(us.read) return false;
      return n.userId===uid;
    }).length;
    _cachedUnreadCount = count;
    try{
      await _update(_safeRef(UNREAD_COUNT_PATH+'/'+uid),{unread:count});
      _dbg('unread count shard updated:',count);
      _perf.countUpdates++;
    } catch(e){ _dbg('count shard write failed',e.message||e); }
  }

  // Listen to the shard for instant cross-tab badge updates
  function _attachCountListener(uid){
    if(!_isReady()||!uid) return;
    try{
      const countRef = _safeRef(UNREAD_COUNT_PATH+'/'+uid+'/unread');
      // Use onValue if available (Firebase v9+), else no-op — badge degrades to local count
      const _onValue = window._rtOnValue;
      if(typeof _onValue === 'function'){
        _onValue(countRef, snap=>{
          if(snap&&snap.exists()) _cachedUnreadCount = snap.val();
          if(typeof NotificationUI !== 'undefined') NotificationUI.renderNotifications();
        });
      }
    } catch(e){ _dbg('count listener failed',e.message||e); }
  }

  // ── Archive / cleanup ──────────────────────────────────────────────────────
  async function _archiveOldNotifications(){
    const uid = _uid();
    if(!uid||!_isReady()) return;

    // ── Daily execution guard ─────────────────────────────────────────────────
    // Skip entirely if archive already ran within the last 24 hours for this user.
    // lastArchiveRun stored at: sprintflow/notificationMeta/{uid}/lastArchiveRun
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    const archiveMetaPath = 'sprintflow/notificationMeta/'+uid+'/lastArchiveRun';
    try{
      const _getGuard = window._rtGet;
      if(_getGuard){
        const guardSnap = await _getGuard(_safeRef(archiveMetaPath));
        if(guardSnap && guardSnap.exists()){
          const lastRun = guardSnap.val();
          if(typeof lastRun==='number' && (Date.now()-lastRun) < ONE_DAY_MS){
            _dbg('archive already ran within 24h for uid:',uid,'— skipping');
            return;
          }
        }
      }
    } catch(e){ _dbg('archive guard read error (non-fatal):',e.message||e); }

    const now = Date.now();
    const activeCutoff  = now - ACTIVE_WINDOW_MS;
    const archiveCutoff = now - ARCHIVE_TTL_MS;
    const store = _store();

    // 1. Archive active notifications older than 60 days
    const toArchive = Object.values(store).filter(n=>
      n && n.id && n.userId===uid && (n.createdAt||0) < activeCutoff
    );
    for(const notif of toArchive){
      try{
        // Safety: never archive unread notifications
        const us = _us(notif);
        if(!us.read){
          _dbg('skipping archive of unread notif',notif.id);
          continue;
        }
        await _set(_safeRef(_archivePath(uid,notif.id)), _clean(notif));
        await _remove(_safeRef(_notifPath(uid,notif.id)));
        _removeLocal(notif.id);
        _perf.archived++;
        _dbg('archived notif',notif.id);
      } catch(e){ _dbg('archive failed',notif.id,e.message||e); }
    }

    // 2. Delete archived notifications older than 180 days (archive path only)
    try{
      const _get = window._rtGet;
      if(!_get) return;
      const archiveSnap = await _get(_safeRef(ARCHIVE_PATH+'/'+uid));
      if(!archiveSnap||!archiveSnap.exists()) return;
      const archived = archiveSnap.val()||{};
      const toDelete = Object.values(archived).filter(n=>
        n && (n.createdAt||0) < archiveCutoff
      );
      for(const notif of toDelete){
        // Safety: never delete unread (belt+suspenders)
        const us = (notif.userState&&notif.userState[uid])||{};
        if(!us.read){
          _dbg('skipping deletion of unread archived notif',notif.id);
          continue;
        }
        await _remove(_safeRef(_archivePath(uid,notif.id)));
        _perf.deleted++;
        _dbg('deleted archived notif',notif.id);
      }
      if(toDelete.length) _dbg('archive cleanup: deleted',toDelete.length,'notifications older than 180d');
    } catch(e){ _dbg('archive cleanup error',e.message||e); }

    // ── Write lastArchiveRun on successful completion ─────────────────────────
    try{
      await _set(_safeRef(archiveMetaPath), now);
      _dbg('archive lastArchiveRun updated for uid:',uid);
    } catch(e){ _dbg('archive guard write failed (non-fatal):',e.message||e); }
  }

  // ── createNotification ─────────────────────────────────────────────────────
  async function createNotification(fields){
    if(!fields||!fields.type||!fields.userId||!fields.title||!fields.message){
      console.warn('[NS] createNotification: missing required fields',fields); return null;
    }
    const id='notif_'+Date.now()+'_'+Math.random().toString(36).slice(2,8);
    const now=Date.now();
    const VALID_TYPES=['assignment','update','reminder'];
    const VALID_CATS=['assigned','updated','reminder'];
    const notif={
      id,
      type      : VALID_TYPES.includes(fields.type)?fields.type:'update',
      category  : VALID_CATS.includes(fields.category)?fields.category:(fields.type==='assignment'?'assigned':fields.type==='reminder'?'reminder':'updated'),
      userId    : fields.userId||'',
      taskId    : fields.taskId||'',
      subtaskId : fields.subtaskId||'',
      projectId : fields.projectId||'',
      sprintId  : fields.sprintId||'',
      title     : String(fields.title).slice(0,200),
      message   : String(fields.message).slice(0,1000),
      createdBy : fields.createdBy||(state.currentUser?state.currentUser.id:''),
      createdAt : now,
      updatedAt : now,
      userState : {},
    };
    _upsertLocal(notif);
    console.log('[NS] Notification created:', notif);
    if(_isReady()){
      const targetUserId = fields.userId;
      try{
        await _set(_safeRef(_notifPath(targetUserId,id)),_clean(notif));
        console.log('[NS] created',id,'→ user bucket',targetUserId);
      } catch(e){ console.warn('[NS] Firebase write failed',e.message||e); }
      // Update unread count shard for target user if they are current user
      if(targetUserId===_uid()) await _syncUnreadCountShard();
    }
    return notif;
  }

  // ── markNotificationRead ───────────────────────────────────────────────────
  async function markNotificationRead(id){
    if(!id) return false;
    const notif=_store()[id];
    if(!notif){ console.warn('[NS] markNotificationRead: not found',id); return false; }
    const uid = _uid();
    if(!uid) return false;
    const us = _usEnsure(notif);
    if(!us) return false;
    if(us.read) return true;
    us.read = true;
    const now = Date.now();
    notif.updatedAt = now;
    const targetUserId = notif.userId || uid;
    if(_isReady()){
      try{
        await _update(_safeRef(_notifPath(targetUserId,id)+'/userState/'+uid), { read:true });
        await _update(_safeRef(_notifPath(targetUserId,id)), { updatedAt:now });
      } catch(e){ console.warn('[NS] markRead failed',id,e.message||e); }
    }
    await _syncUnreadCountShard();
    _perf.countUpdates++;
    return true;
  }

  // ── markAllNotificationsRead ───────────────────────────────────────────────
  async function markAllNotificationsRead(userId){
    const uid=userId||_uid();
    if(!uid){ console.warn('[NS] markAllNotificationsRead: no userId'); return 0; }
    const targets=getVisibleNotifications(null,{unreadOnly:true,limit:9999});
    if(!targets.length) return 0;
    const now=Date.now();
    await Promise.allSettled(targets.map(async notif=>{
      const us = _usEnsure(notif);
      if(!us) return;
      us.read = true;
      notif.updatedAt = now;
      const targetUserId = notif.userId || uid;
      if(_isReady()){
        try{
          await _update(_safeRef(_notifPath(targetUserId,notif.id)+'/userState/'+uid), { read:true });
          await _update(_safeRef(_notifPath(targetUserId,notif.id)), { updatedAt:now });
        } catch(e){ console.warn('[NS] markAll failed',notif.id,e.message||e); }
      }
    }));
    console.log('[NS] markAllRead:',targets.length,'for',uid);
    await _syncUnreadCountShard();
    return targets.length;
  }

  // ── deleteAllNotifications ─────────────────────────────────────────────────
  async function deleteAllNotifications(){
    if(!RBAC.isAdmin() && !RBAC.isProgramManager()){
      console.warn('[NS] deleteAllNotifications: Team Member cannot delete');
      return false;
    }
    const uid = _uid();
    if(!uid) return false;
    const targets = getVisibleNotifications(null,{limit:9999});
    if(!targets.length) return true;
    const now = Date.now();
    await Promise.allSettled(targets.map(async notif=>{
      const us = _usEnsure(notif);
      if(!us) return;
      us.deleted = true;
      notif.updatedAt = now;
      const targetUserId = notif.userId || uid;
      if(_isReady()){
        try{
          await _update(_safeRef(_notifPath(targetUserId,notif.id)+'/userState/'+uid), { deleted:true });
          await _update(_safeRef(_notifPath(targetUserId,notif.id)), { updatedAt:now });
        } catch(e){ console.warn('[NS] deleteAll failed',notif.id,e.message||e); }
      }
    }));
    console.log('[NS] deleteAll: hidden',targets.length,'for',uid);
    return true;
  }

  // ── getVisibleNotifications — unchanged public API ─────────────────────────
  function getVisibleNotifications(userId, options){
    const opts=options||{};
    const unreadOnly=opts.unreadOnly===true;
    const limit=typeof opts.limit==='number'?opts.limit:100;
    const sortDesc=opts.sortDesc!==false;
    const cu=state.currentUser;

    let results=Object.values(_store()).filter(n=>{
      if(!n||!n.id) return false;
      const us = _us(n);
      if(us.deleted) return false;
      if(us.muted)   return false;
      if(unreadOnly && us.read) return false;
      if(!cu) return false;
      if(RBAC.isAdmin()){
        const ownNotif = n.userId === cu.id;
        if(!ownNotif) return false;
        if(userId && n.userId!==userId) return false;
        return true;
      }
      if(RBAC.isProgramManager()){
        const ownNotif = n.userId === cu.id;
        if(!ownNotif) return false;
        if(userId && n.userId!==userId) return false;
        return true;
      }
      return n.userId===cu.id;
    });

    results.sort((a,b)=>sortDesc?(b.createdAt||0)-(a.createdAt||0):(a.createdAt||0)-(b.createdAt||0));
    const visibleNotifications = results.slice(0,limit);
    console.log('[NS] Current user:', cu);
    console.log('[NS] Visible notifications:', visibleNotifications);
    return visibleNotifications;
  }

  // ── Realtime listeners (user-scoped) ───────────────────────────────────────
  function _attachListeners(){
    if(_listenerActive) return;
    if(!_isReady()){ console.warn('[NS] attachListeners: not ready'); return; }
    const uid = _uid();
    if(!uid){ console.warn('[NS] attachListeners: no current user'); return; }

    // Listen ONLY to this user's notification bucket — not the full collection
    let colRef;
    try{
      // User-scoped path with query constraints (limitToLast 100 by createdAt)
      const baseRef = _safeRef(_userColPath(uid));
      const _q  = window._rtQuery;
      const _ob = window._rtOrderByChild;
      const _ll = window._rtLimitToLast;
      colRef = (_q && _ob && _ll)
        ? _q(baseRef, _ob('createdAt'), _ll(LOAD_LIMIT))
        : baseRef;
    } catch(e){ console.warn('[NS] colRef failed',e.message||e); return; }

    _bootSkip=true;
    clearTimeout(_bootSkipTimer);
    _bootSkipTimer=setTimeout(()=>{ _bootSkip=false; },1500);

    _unsubAdded=_onChildAdded(colRef,(snap)=>{
      if(_bootSkip) return;
      try{
        const item=snap.val(); if(!item||!item.id) return;
        clearTimeout(_debounceTimers[item.id]);
        _debounceTimers[item.id]=setTimeout(()=>{
          _upsertLocal(item);
          _dbg('rt:added',item.id);
          _perf.loaded++;
          if(typeof NotificationUI !== 'undefined') NotificationUI.renderNotifications();
        },DEBOUNCE_MS);
      }catch(e){ console.warn('[NS] onChildAdded error',e); }
    },(e)=>console.warn('[NS] onChildAdded attach error',e));

    _unsubChanged=_onChildChanged(colRef,(snap)=>{
      try{
        const item=snap.val(); if(!item||!item.id) return;
        clearTimeout(_debounceTimers[item.id]);
        _debounceTimers[item.id]=setTimeout(()=>{
          _upsertLocal(item);
          _dbg('rt:changed',item.id);
          if(typeof NotificationUI !== 'undefined') NotificationUI.renderNotifications();
        },DEBOUNCE_MS);
      }catch(e){ console.warn('[NS] onChildChanged error',e); }
    },(e)=>console.warn('[NS] onChildChanged attach error',e));

    _unsubRemoved=_onChildRemoved(colRef,(snap)=>{
      try{
        const item=snap.val(); const id=(item&&item.id)?item.id:snap.key; if(!id) return;
        clearTimeout(_debounceTimers[id]);
        _debounceTimers[id]=setTimeout(()=>{
          _removeLocal(id);
          _dbg('rt:removed',id);
          if(typeof NotificationUI !== 'undefined') NotificationUI.renderNotifications();
        },DEBOUNCE_MS);
      }catch(e){ console.warn('[NS] onChildRemoved error',e); }
    },(e)=>console.warn('[NS] onChildRemoved attach error',e));

    _listenerActive=true;
    console.log('[NS] User-scoped realtime listener active for uid:',uid);
  }

  function _detachListeners(){
    Object.keys(_debounceTimers).forEach(k=>{ clearTimeout(_debounceTimers[k]); delete _debounceTimers[k]; });
    clearTimeout(_bootSkipTimer);
    try{ if(_unsubAdded)   _unsubAdded();   }catch(e){ console.error('Notification pipeline error',e); }
    try{ if(_unsubChanged) _unsubChanged(); }catch(e){ console.error('Notification pipeline error',e); }
    try{ if(_unsubRemoved) _unsubRemoved(); }catch(e){ console.error('Notification pipeline error',e); }
    _unsubAdded=_unsubChanged=_unsubRemoved=null;
    _listenerActive=false;
    console.log('[NS] Realtime listeners detached');
  }

  // ── Initial load (user-scoped, latest 100) ─────────────────────────────────
  async function _loadInitialNotifications(){
    if(!_isReady()) return;
    const uid = _uid();
    if(!uid) return;
    try{
      const _get = window._rtGet;
      if(!_get){ _dbg('_loadInitial: _rtGet not available'); return; }
      const _q  = window._rtQuery;
      const _ob = window._rtOrderByChild;
      const _ll = window._rtLimitToLast;

      // Always user-scoped. Admin/PM load their own bucket too.
      const baseRef = _safeRef(_userColPath(uid));
      const queryRef = (_q && _ob && _ll)
        ? _q(baseRef, _ob('createdAt'), _ll(LOAD_LIMIT))
        : baseRef;

      const snap = await _get(queryRef);
      if(snap && snap.exists()){
        const val = snap.val()||{};
        const items = Array.isArray(val) ? val : Object.values(val);
        items.filter(Boolean).forEach(n=>_upsertLocal(n));
        _perf.loaded += items.length;
        console.log('[NS] initial load:',items.length,'notifications (user-scoped, limit',LOAD_LIMIT,')');
        _dbg('perf after load:',JSON.stringify(_perf));
      }

      // Migrate: also check legacy flat path for backward-compat
      // (old notifications stored at sprintflow/notifications/{id})
      await _migrateLegacyNotifications(uid, _get);

    }catch(e){ console.warn('[NS] _loadInitial error',e.message||e); }
  }

  // ── Migration helper ───────────────────────────────────────────────────────
  // One-time silent migration: reads the legacy flat path, upserts into the
  // new user-scoped path, and leaves the original untouched (no data loss).
  // Guard: sprintflow/userMeta/{uid}/notifMigrated = true skips all reads
  // on every subsequent login/refresh after the first successful migration.
  async function _migrateLegacyNotifications(uid, _get){
    try{
      // ── Check migration flag first ─────────────────────────────────────────
      const metaFlagPath = 'sprintflow/userMeta/'+uid+'/notifMigrated';
      try{
        const flagSnap = await _get(_safeRef(metaFlagPath));
        if(flagSnap && flagSnap.exists() && flagSnap.val()===true){
          _dbg('migration already completed for uid:',uid,'— skipping');
          return;
        }
      } catch(e){ _dbg('migration flag read error (non-fatal):',e.message||e); }

      const _q  = window._rtQuery;
      const _ob = window._rtOrderByChild;
      const _eq = window._rtEqualTo;
      if(!_q||!_ob||!_eq) return;
      const legacyRef = _safeRef('sprintflow/notifications');
      const legacySnap = await _get(_q(legacyRef, _ob('userId'), _eq(uid)));
      if(!legacySnap||!legacySnap.exists()){
        // No legacy records — mark done so this never runs again
        try{ await _set(_safeRef(metaFlagPath), true); } catch(e){}
        return;
      }
      const val = legacySnap.val()||{};
      const items = Array.isArray(val) ? val : Object.values(val);
      const legacyItems = items.filter(n=>n&&n.id&&n.userId===uid);
      if(!legacyItems.length){
        try{ await _set(_safeRef(metaFlagPath), true); } catch(e){}
        return;
      }
      // Load into memory so existing data is immediately visible
      legacyItems.forEach(n=>_upsertLocal(n));
      _dbg('migrating',legacyItems.length,'legacy notifications for uid:',uid);
      // Write into new user-scoped path; set flag only after all writes settle
      if(_isReady()){
        Promise.allSettled(legacyItems.map(async n=>{
          try{ await _set(_safeRef(_notifPath(uid, n.id)), _clean(n)); }
          catch(e){ _dbg('migrate write failed',n.id); }
        })).then(async ()=>{
          _dbg('legacy migration writes done for uid:',uid);
          try{ await _set(_safeRef(metaFlagPath), true); }
          catch(e){ _dbg('migration flag write failed (non-fatal):',e.message||e); }
        });
      }
    } catch(e){ _dbg('migration error (non-fatal):',e.message||e); }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  async function init(db, sdkFns){
    if(!db||!sdkFns){ console.warn('[NS] init: missing args'); return; }
    _db=db; _ref=sdkFns.ref; _set=sdkFns.set; _update=sdkFns.update; _remove=sdkFns.remove||null;
    _onChildAdded   = sdkFns.onChildAdded   || window._rtOnChildAdded   || null;
    _onChildChanged = sdkFns.onChildChanged || window._rtOnChildChanged || null;
    _onChildRemoved = sdkFns.onChildRemoved || window._rtOnChildRemoved || null;
    if(!_isReady()){ console.warn('[NS] init: SDK incomplete — listeners not started'); return; }
    state.notifications = state.notifications || {};
    await _loadInitialNotifications();
    _attachListeners();
    _attachCountListener(_uid());
    // Run archive pass in background — never blocks UI
    setTimeout(()=>_archiveOldNotifications().catch(e=>_dbg('archive pass error',e)), 5000);
    // Run Admin Settings notifications-data auto-cleanup pass — background, notifications only
    setTimeout(()=>{
      if(typeof _maybeRunNotifAutoCleanup==='function') _maybeRunNotifAutoCleanup().catch(e=>_dbg('notif auto-cleanup error',e));
      if(typeof _startNotifAutoCleanupSchedule==='function') _startNotifAutoCleanupSchedule();
      // Run Admin Settings embedded-images auto-cleanup pass — background, images only (no-op for non-admins)
      if(typeof _maybeRunImgAutoCleanup==='function') _maybeRunImgAutoCleanup().catch(e=>_dbg('img auto-cleanup error',e));
      if(typeof _startImgAutoCleanupSchedule==='function') _startImgAutoCleanupSchedule();
    }, 7000);
    if(typeof NotificationUI !== 'undefined') NotificationUI.renderNotifications();
    console.log('[NS] Initialized for user:',(_uid()));
  }

  function stop(){
    _detachListeners();
    state.notifications={};
    _cachedUnreadCount = null;
    _db=_ref=_set=_update=_remove=null;
    _onChildAdded=_onChildChanged=_onChildRemoved=null;
    console.log('[NS] Stopped');
  }

  // ── muteNotification ───────────────────────────────────────────────────────
  async function muteNotification(id){
    if(!id) return false;
    if(!RBAC.isAdmin() && !RBAC.isProgramManager()){
      console.warn('[NS] muteNotification: Team Member cannot mute');
      return false;
    }
    const notif = _store()[id];
    if(!notif){ console.warn('[NS] muteNotification: not found', id); return false; }
    const uid = _uid();
    if(!uid) return false;
    const us = _usEnsure(notif);
    if(!us) return false;
    if(us.muted) return true;
    us.muted = true;
    const now = Date.now();
    notif.updatedAt = now;
    const targetUserId = notif.userId || uid;
    if(_isReady()){
      try{
        await _update(_safeRef(_notifPath(targetUserId,id)+'/userState/'+uid), { muted:true });
        await _update(_safeRef(_notifPath(targetUserId,id)), { updatedAt:now });
      } catch(e){ console.warn('[NS] muteNotification Firebase write failed', id, e.message||e); }
    }
    console.log('[NS] muted for user',uid,':', id);
    return true;
  }

  // ── _batchRemoveUnder — bulk delete many children in as few requests as possible ──
  // Realtime Database deletes a set of children in ONE request when you send a
  // multi-path update() whose values are null. The previous implementation issued
  // a separate await _remove() per record, which on a large collection meant
  // thousands of sequential round trips — minutes of wall time, far beyond any
  // sane UI timeout, which is why large purges never actually completed.
  // relPaths are paths RELATIVE to basePath (may contain '/', e.g. 'uid/notifId').
  async function _batchRemoveUnder(basePath, relPaths){
    if(!relPaths || !relPaths.length) return 0;
    const BATCH = 400;
    let done = 0;
    for(let i=0; i<relPaths.length; i+=BATCH){
      const slice = relPaths.slice(i, i+BATCH);
      const patch = {};
      slice.forEach(rp=>{ patch[rp] = null; });
      try{
        await _update(_safeRef(basePath), patch);
        done += slice.length;
        console.log('[NS] batch delete:',done,'/',relPaths.length,'removed under',basePath);
      }catch(e){
        console.error('[NS] batch delete FAILED under',basePath,'—',e.code||'',e.message||e,'— falling back to per-record removes for this batch');
        for(const rp of slice){
          try{ await _remove(_safeRef(basePath+'/'+rp)); done++; }
          catch(e2){ console.error('[NS] fallback remove FAILED for',basePath+'/'+rp,'—',e2.code||'',e2.message||e2); }
        }
      }
    }
    return done;
  }

  // ── purgeNotifications — hard-delete notification records (Admin Settings cleanup) ──
  // Ground truth for where notification DATA lives, re-derived directly from every
  // write/read in this file (createNotification, markRead, deleteAllNotifications,
  // muteNotification, _archiveOldNotifications, _loadInitialNotifications,
  // _migrateLegacyNotifications all confirm the same thing):
  //   • EVERY write of a notification record goes through _notifPath(userId,id) =
  //     'sprintflow/notifications/{userId}/{id}' — there is no code anywhere in this
  //     app that writes a notification anywhere else.
  //   • The ONLY other place a notification record can exist is the flat pre-migration
  //     layout 'sprintflow/notifications/{id}' (id at the top level, no userId nesting)
  //     — _migrateLegacyNotifications() reads FROM there and copies INTO the per-user
  //     path above, but never deletes the source, so old flat records can persist
  //     indefinitely under that same 'sprintflow/notifications' root node.
  //   • Archived records live at 'sprintflow/notifications_archive/{userId}/{id}'.
  // Rather than assume which of those two shapes a given record uses (an indexed
  // orderByChild('userId') query on the flat layer returned nothing in practice —
  // likely blocked or unsupported for this project), this reads the ENTIRE
  // 'sprintflow/notifications' node ONCE and classifies every child by its actual
  // shape: a child with its own .id/.userId fields IS a flat legacy record; a child
  // keyed by this user's own id is the per-user bucket of nested records. Either way,
  // only records whose userId matches the current user are removed — no other user's
  // notifications, and no other collection, is ever touched.
  // opts.olderThanMs: if provided, only records older than (now - olderThanMs) are removed;
  // if omitted, ALL of the current user's notification data is removed.
  async function purgeNotifications(opts){
    const o = opts||{};
    const uid = _uid();
    if(!uid){ console.warn('[NS] purgeNotifications: no current user'); return { removed:0, ownFound:0 }; }
    if(!RBAC.isAdmin() && !RBAC.isProgramManager()){
      console.warn('[NS] purgeNotifications: Team Member cannot purge');
      return { removed:0, ownFound:0 };
    }
    if(!_isReady()){
      console.warn('[NS] purgeNotifications: Firebase not ready');
      return { removed:0, ownFound:0 };
    }
    const cutoff = typeof o.olderThanMs==='number' ? (Date.now()-o.olderThanMs) : null;
    // Admins clear notifications data for EVERY user (this is the storage-bloat
    // cleanup the Admin Settings panel exists for). Program Managers keep the
    // narrower, existing behaviour of only ever touching their own notifications.
    const scopeAll = RBAC.isAdmin();
    let removed = 0, ownFound = 0;
    const _get = window._rtGet;
    const activeRel = [];   // paths relative to ACTIVE_PATH queued for deletion

    // ════ FAST PATH — Admin clearing EVERYTHING ═══════════════════════════════
    // Delete the notification subtrees outright, one request each. No download of
    // the collection, no per-record round trips.
    //
    // THIS IS THE ROOT-CAUSE FIX. Previously this case fell through to the generic
    // scan-then-delete-each-record path below: it downloaded the entire
    // sprintflow/notifications node (~half this database) and then issued one
    // sequential remove() per record. With thousands of records that is thousands
    // of serial round trips — minutes of wall time — so the UI timeout aborted it
    // and in practice nothing (or almost nothing) was ever actually deleted, even
    // though the call reported success. A whole-node remove is a single operation
    // and completes immediately regardless of how much data is underneath it.
    if(scopeAll && cutoff===null){
      console.log('[NS] purgeNotifications: FAST PATH — wiping notification subtrees in single requests');
      let wipeError = null;
      try{ await _remove(_safeRef(ACTIVE_PATH));       console.log('[NS] wiped',ACTIVE_PATH); }
      catch(e){ wipeError = e; console.error('[NS] wipe FAILED for',ACTIVE_PATH,'—',e.code||'',e.message||e); }
      try{ await _remove(_safeRef(ARCHIVE_PATH));      console.log('[NS] wiped',ARCHIVE_PATH); }
      catch(e){ console.warn('[NS] wipe archive failed —',e.code||'',e.message||e); }
      try{ await _remove(_safeRef(UNREAD_COUNT_PATH)); console.log('[NS] wiped',UNREAD_COUNT_PATH); }
      catch(e){ console.warn('[NS] wipe unread counts failed —',e.code||'',e.message||e); }

      // Verify — instant now, because there is no data left to download.
      let stillPresentFast = 0;
      if(_get){
        try{
          const vs = await _get(_safeRef(ACTIVE_PATH));
          if(vs && vs.exists()){
            const v = vs.val()||{};
            Object.keys(v).forEach(k=>{
              const c = v[k];
              if(!c || typeof c!=='object') return;
              if(c.id && ('userId' in c)) stillPresentFast++;
              else stillPresentFast += Object.keys(c).length;
            });
          }
          console.log('[NS] verify after wipe —',stillPresentFast,'record(s) remain (0 expected)');
        }catch(e){ console.warn('[NS] verify after wipe failed',e.message||e); }
      }
      Object.keys(_store()).forEach(id=>_removeLocal(id));
      _cachedUnreadCount = 0;
      if(typeof NotificationUI !== 'undefined') NotificationUI.renderNotifications();
      return { wipedAll:true, removed:null, ownFound:null, stillPresent:stillPresentFast, scopeAll,
               error: wipeError ? (wipeError.message||String(wipeError)) : null };
    }

    // 1. Full scan of the notifications root — covers both the per-user nested
    //    layout and the flat pre-migration layout in a single read, self-detecting
    //    which shape each child is (see comment above).
    try{
      if(_get){
        const rootSnap = await _get(_safeRef(ACTIVE_PATH));
        if(rootSnap && rootSnap.exists()){
          const rootVal = rootSnap.val()||{};
          console.log('[NS] purgeNotifications: scanning',Object.keys(rootVal).length,'top-level node(s) under',ACTIVE_PATH,'— scopeAll:',scopeAll,'uid:',uid);
          for(const key of Object.keys(rootVal)){
            const child = rootVal[key];
            if(!child || typeof child!=='object') continue;
            if(child.id && ('userId' in child)){
              // Flat legacy record: this child IS the notification object itself.
              if(!scopeAll && child.userId!==uid) continue;
              ownFound++;
              if(cutoff!==null && (child.createdAt||0) >= cutoff) continue;
              activeRel.push(key);
            } else {
              // Per-user bucket: this child is a map of {notifId: notification},
              // keyed by whichever user owns that bucket. Admins purge every
              // bucket found; everyone else only their own (key===uid).
              if(!scopeAll && key!==uid) continue;
              for(const childKey of Object.keys(child)){
                const n = child[childKey];
                if(!n || typeof n!=='object') continue;
                ownFound++;
                if(cutoff!==null && (n.createdAt||0) >= cutoff) continue;
                // Use the record's ACTUAL Firebase key, not its .id field. The old
                // code built the delete path from n.id — if a record's id field ever
                // disagreed with its key (legacy/migrated data), remove() targeted a
                // path that does not exist, resolved successfully, and still counted
                // as removed: a silent no-op reported as success.
                activeRel.push(key+'/'+childKey);
              }
            }
          }
        }
      } else if(cutoff===null && !scopeAll){
        // No live-read capability available — fall back to wiping just this user's
        // known per-user bucket (can't shape-detect the flat layer without a read).
        await _remove(_safeRef(_userColPath(uid)));
      }
    } catch(e){ console.error('[NS] purgeNotifications: root scan failed —',e.code||'',e.message||e); }

    // 1a. Execute the queued deletions in bulk — a handful of requests instead of
    //     one per record (see _batchRemoveUnder).
    if(activeRel.length){
      console.log('[NS] purgeNotifications: deleting',activeRel.length,'record(s) under',ACTIVE_PATH,'in batches');
      removed += await _batchRemoveUnder(ACTIVE_PATH, activeRel);
    }

    // 1b. VERIFY — re-read the same root fresh and check whether every path we just
    //     removed is actually gone server-side. A successful, non-throwing delete
    //     SHOULD mean the data is gone, but this proves it rather than trusting the
    //     promise alone — if the Firebase Console still appears to show old data
    //     afterward, this tells us whether that's a real leftover write or just the
    //     console's own cached/non-realtime snapshot for large collections.
    let stillPresent = 0;
    if(_get && activeRel.length){
      try{
        const verifySnap = await _get(_safeRef(ACTIVE_PATH));
        const verifyVal = (verifySnap && verifySnap.exists()) ? (verifySnap.val()||{}) : {};
        activeRel.forEach(rel=>{
          let cur = verifyVal;
          for(const part of rel.split('/')){
            if(cur && typeof cur==='object' && cur[part]!==undefined) cur = cur[part];
            else { cur = undefined; break; }
          }
          if(cur!==undefined) stillPresent++;
        });
        console.log('[NS] purgeNotifications: verify pass —',stillPresent,'of',activeRel.length,'deleted record(s) still present server-side (0 expected)');
      } catch(e){ console.warn('[NS] purgeNotifications: verify read failed',e.message||e); }
    }

    // 2. Archive bucket(s) — same admin-wide vs own-only scoping as above, and the
    //    same two fixes: whole-node delete when clearing everything, and actual
    //    Firebase keys (never the .id field) when filtering by age.
    const archiveRel = [];
    try{
      if(cutoff===null){
        // Clearing everything for this scope — drop the bucket in one request.
        const wipePath = scopeAll ? ARCHIVE_PATH : (ARCHIVE_PATH+'/'+uid);
        try{ await _remove(_safeRef(wipePath)); console.log('[NS] wiped',wipePath); }
        catch(e){ console.warn('[NS] archive wipe failed for',wipePath,'—',e.code||'',e.message||e); }
      } else if(_get){
        if(scopeAll){
          const archRootSnap = await _get(_safeRef(ARCHIVE_PATH));
          if(archRootSnap && archRootSnap.exists()){
            const archRootVal = archRootSnap.val()||{};
            for(const bucketUid of Object.keys(archRootVal)){
              const bucket = archRootVal[bucketUid]||{};
              for(const k of Object.keys(bucket)){
                const n = bucket[k];
                if(n && typeof n==='object' && (n.createdAt||0) < cutoff) archiveRel.push(bucketUid+'/'+k);
              }
            }
          }
        } else {
          const snap = await _get(_safeRef(ARCHIVE_PATH+'/'+uid));
          if(snap && snap.exists()){
            const bucket = snap.val()||{};
            for(const k of Object.keys(bucket)){
              const n = bucket[k];
              if(n && typeof n==='object' && (n.createdAt||0) < cutoff) archiveRel.push(uid+'/'+k);
            }
          }
        }
      }
    } catch(e){ _dbg('purge archive scan failed',e.message||e); }
    if(archiveRel.length){
      console.log('[NS] purgeNotifications: deleting',archiveRel.length,'archived record(s) in batches');
      await _batchRemoveUnder(ARCHIVE_PATH, archiveRel);
    }

    // Clear any matching entries from the local in-memory store too, so the UI
    // reflects the cleanup immediately (this mirrors the DB state above, it is not
    // the source of truth for what got deleted).
    Object.values(_store()).forEach(n=>{
      if(!n || !n.id) return;
      if(!scopeAll && n.userId!==uid) return;
      if(cutoff===null || (n.createdAt||0) < cutoff) _removeLocal(n.id);
    });
    await _syncUnreadCountShard();
    if(typeof NotificationUI !== 'undefined') NotificationUI.renderNotifications();
    console.log('[NS] purgeNotifications: removed',removed,'of',ownFound,'record(s) — scopeAll:',scopeAll,'— still present after verify:',stillPresent,'(cutoff:',cutoff,')');
    return { removed, ownFound, stillPresent, scopeAll };
  }

  // ── scanNotifications — READ-ONLY count + approximate size ─────────────────
  // Uses the exact same shape-detection as purgeNotifications (flat legacy record
  // vs per-user nested bucket) so the numbers it reports are always a true preview
  // of what a delete would remove — never touches/writes anything.
  async function scanNotifications(){
    const uid = _uid();
    if(!uid) return { ok:false, error:'no current user' };
    if(!RBAC.isAdmin() && !RBAC.isProgramManager()) return { ok:false, error:'permission denied' };
    if(!_isReady()) return { ok:false, error:'Firebase not ready' };
    const _get = window._rtGet;
    if(!_get) return { ok:false, error:'read capability unavailable' };
    const scopeAll = RBAC.isAdmin();
    let flatCount=0, nestedCount=0, flatBytes=0, nestedBytes=0;
    try{
      const rootSnap = await _get(_safeRef(ACTIVE_PATH));
      if(rootSnap && rootSnap.exists()){
        const rootVal = rootSnap.val()||{};
        for(const key of Object.keys(rootVal)){
          const child = rootVal[key];
          if(!child || typeof child!=='object') continue;
          if(child.id && ('userId' in child)){
            if(!scopeAll && child.userId!==uid) continue;
            flatCount++; flatBytes += JSON.stringify(child).length;
          } else {
            if(!scopeAll && key!==uid) continue;
            for(const n of Object.values(child)){
              if(!n || !n.id) continue;
              nestedCount++; nestedBytes += JSON.stringify(n).length;
            }
          }
        }
      }
    } catch(e){ return { ok:false, error: e.message||String(e) }; }

    let archiveCount=0, archiveBytes=0;
    try{
      if(scopeAll){
        const archRootSnap = await _get(_safeRef(ARCHIVE_PATH));
        if(archRootSnap && archRootSnap.exists()){
          const archRootVal = archRootSnap.val()||{};
          for(const bucketUid of Object.keys(archRootVal)){
            for(const n of Object.values(archRootVal[bucketUid]||{})){
              if(!n) continue;
              archiveCount++; archiveBytes += JSON.stringify(n).length;
            }
          }
        }
      } else {
        const snap = await _get(_safeRef(ARCHIVE_PATH+'/'+uid));
        if(snap && snap.exists()){
          for(const n of Object.values(snap.val()||{})){
            if(!n) continue;
            archiveCount++; archiveBytes += JSON.stringify(n).length;
          }
        }
      }
    } catch(e){ _dbg('scanNotifications: archive scan failed (non-fatal)',e.message||e); }

    const result = {
      ok:true, scopeAll, uid,
      flatCount, nestedCount, archiveCount,
      totalCount: flatCount+nestedCount+archiveCount,
      totalBytes: flatBytes+nestedBytes+archiveBytes
    };
    console.log('[NS] scanNotifications:', result);
    return result;
  }

  return { init, stop, createNotification, markNotificationRead, markAllNotificationsRead, deleteAllNotifications, purgeNotifications, scanNotifications, getVisibleNotifications, muteNotification };
})();

window.NotificationSystem = NotificationSystem;

// ─── NOTIFICATION TRIGGERS ───────────────────────────────────────────────────
// Unchanged from v28 — only calls createNotification(). No behavioral changes.
// ─────────────────────────────────────────────────────────────────────────────
const NotificationTriggers = (function(){

  // Guard: skip if NotificationSystem not ready or no current user
  function _ready(){ return !!(state.currentUser && typeof NotificationSystem !== 'undefined'); }

  function _actorId(){ return state.currentUser ? state.currentUser.id : ''; }
  function _actorName(){ return state.currentUser ? (state.currentUser.name || state.currentUser.email || 'Someone') : 'Someone'; }

  function _userName(uid){
    if(!uid) return 'Unassigned';
    const u=(state.users||[]).find(x=>x&&x.id===uid);
    return u ? (u.name||u.email||uid) : uid;
  }

  function _statusLabel(s){
    try{ return statusLabel(s); } catch(e){ return s||''; }
  }

  function _fire(fields){
    if(!_ready()) return;
    if(!fields.userId) return;
    try{
      NotificationSystem.createNotification(fields).catch(e=>console.error('Notification pipeline error',e));
    } catch(e){ console.error('Notification pipeline error',e); }
  }

  function _onTaskSaved(task, prev){
    if(!task||!task.id) return;
    const actor = _actorId();
    const prevAssignee = prev.prevAssignee || null;
    const prevStatus   = prev.prevStatus   || null;
    const base = { taskId:task.id, projectId:task.project||'', sprintId:task.sprint||'', createdBy:actor };

    if(task.assignee && task.assignee !== prevAssignee){
      if(task.assignee !== actor){
        _fire({ ...base, type:'assignment', category:'assigned', userId:task.assignee,
          title:'Task assigned to you',
          message:`"${task.title}" was assigned to you by ${_actorName()}.` });
      }
      _fire({ ...base, type:'assignment', category:'assigned', userId:actor,
        title:'Task assigned',
        message:`You assigned "${task.title}" to ${_userName(task.assignee)}.` });
    }

    if(prevStatus && task.status !== prevStatus && task.assignee){
      _fire({ ...base, type:'update', category:'updated', userId:task.assignee,
        title:'Task status changed',
        message:`"${task.title}" moved from ${_statusLabel(prevStatus)} to ${_statusLabel(task.status)}.` });
    }

    const pureAssignChange = task.assignee !== prevAssignee && task.status === prevStatus;
    const pureStatusChange = task.assignee === prevAssignee && task.status !== prevStatus;
    if(!pureAssignChange && !pureStatusChange && task.assignee && task.assignee !== actor){
      _fire({ ...base, type:'update', category:'updated', userId:task.assignee,
        title:'Task updated',
        message:`"${task.title}" was updated by ${_actorName()}.` });
    }
  }

  function _onTaskStatusChanged(task, prevStatus, newStatus){
    if(!task||!task.id) return;
    if(prevStatus === newStatus) return;
    if(!task.assignee) return;
    _fire({
      type:'update', category:'updated', userId:task.assignee,
      taskId:task.id, projectId:task.project||'', sprintId:task.sprint||'', createdBy:_actorId(),
      title:'Task status changed',
      message:`"${task.title}" moved from ${_statusLabel(prevStatus)} to ${_statusLabel(newStatus)}.`
    });
  }

  function _onSubtaskSaved(subtask, parentTask, prev){
    if(!subtask||!subtask.id||!parentTask) return;
    const actor = _actorId();
    const prevAssignee = prev.prevAssignee || null;
    const prevStatus   = prev.prevStatus   || null;
    const base = { taskId:parentTask.id, subtaskId:subtask.id, projectId:parentTask.project||'', sprintId:parentTask.sprint||'', createdBy:actor };

    if(subtask.assignee && subtask.assignee !== prevAssignee){
      if(subtask.assignee !== actor){
        _fire({ ...base, type:'assignment', category:'assigned', userId:subtask.assignee,
          title:'Subtask assigned to you',
          message:`Subtask "${subtask.title}" (in "${parentTask.title}") was assigned to you by ${_actorName()}.` });
      }
      _fire({ ...base, type:'assignment', category:'assigned', userId:actor,
        title:'Subtask assigned',
        message:`You assigned subtask "${subtask.title}" (in "${parentTask.title}") to ${_userName(subtask.assignee)}.` });
    }

    if(prevStatus && subtask.status !== prevStatus && subtask.assignee){
      _fire({ ...base, type:'update', category:'updated', userId:subtask.assignee,
        title:'Subtask status changed',
        message:`Subtask "${subtask.title}" moved from ${_statusLabel(prevStatus)} to ${_statusLabel(subtask.status)}.` });
    }

    const pureAssign = subtask.assignee !== prevAssignee && subtask.status === prevStatus;
    const pureStatus = subtask.assignee === prevAssignee && subtask.status !== prevStatus;
    if(!pureAssign && !pureStatus && subtask.assignee && subtask.assignee !== actor){
      _fire({ ...base, type:'update', category:'updated', userId:subtask.assignee,
        title:'Subtask updated',
        message:`Subtask "${subtask.title}" (in "${parentTask.title}") was updated by ${_actorName()}.` });
    }
  }

  function _onSubtaskStatusChanged(subtask, parentTask, prevStatus, newStatus){
    if(!subtask||!subtask.id||!parentTask) return;
    if(prevStatus === newStatus) return;
    if(!subtask.assignee) return;
    _fire({
      type:'update', category:'updated', userId:subtask.assignee,
      taskId:parentTask.id, subtaskId:subtask.id, projectId:parentTask.project||'', sprintId:parentTask.sprint||'', createdBy:_actorId(),
      title:'Subtask status changed',
      message:`Subtask "${subtask.title}" moved from ${_statusLabel(prevStatus)} to ${_statusLabel(newStatus)}.`
    });
  }

  function _onSprintSaved(sprint, prev){
    if(!sprint||!sprint.id) return;
    if(!_ready()) return;
    const actor    = _actorId();
    const actorName= _actorName();
    const isNew    = !!(prev && prev.isNew);
    const prevStatus = prev && prev.prevStatus != null ? prev.prevStatus : null;
    const isCompleted = (sprint.status||'').toLowerCase() === 'completed';

    const adminUsers = (state.users||[]).filter(u=>u&&u.role==='admin');
    const pmUsers    = (state.users||[]).filter(u=>u&&u.role==='program_manager');
    const targets = new Set();
    adminUsers.forEach(u=>targets.add(u.id));
    pmUsers.forEach(u=>{
      const mapped = Array.isArray(u.projectIds) ? u.projectIds : (u.projects||[]);
      if(!sprint.project || mapped.includes(sprint.project)) targets.add(u.id);
    });

    const base = { taskId:'', projectId:sprint.project||'', sprintId:sprint.id, createdBy:actor };
    targets.forEach(uid=>{
      if(uid===actor) return;
      if(isNew){
        _fire({ ...base, type:'update', category:'updated', userId:uid,
          title:'Sprint created', message:`Sprint "${sprint.name}" was created by ${actorName}.` });
      } else if(isCompleted && prevStatus && prevStatus!=='completed'){
        _fire({ ...base, type:'update', category:'updated', userId:uid,
          title:'Sprint completed', message:`Sprint "${sprint.name}" was marked completed by ${actorName}.` });
      } else if(!isNew){
        _fire({ ...base, type:'update', category:'updated', userId:uid,
          title:'Sprint updated', message:`Sprint "${sprint.name}" was updated by ${actorName}.` });
      }
    });
  }

  function _onEpicSaved(epic, prev){
    if(!epic||!epic.id) return;
    if(!_ready()) return;
    const actor    = _actorId();
    const actorName= _actorName();
    const isNew    = !!(prev && prev.isNew);
    const isCompleted = (epic.status||'').toLowerCase() === 'completed';
    const epicProjectIds = epic.projectIds || (epic.projectId ? [epic.projectId] : []);

    const adminUsers = (state.users||[]).filter(u=>u&&u.role==='admin');
    const pmUsers    = (state.users||[]).filter(u=>u&&u.role==='program_manager');
    const targets = new Set();
    adminUsers.forEach(u=>targets.add(u.id));
    pmUsers.forEach(u=>{
      const mapped = Array.isArray(u.projectIds) ? u.projectIds : (u.projects||[]);
      const overlaps = !epicProjectIds.length || epicProjectIds.some(pid=>mapped.includes(pid));
      if(overlaps) targets.add(u.id);
    });
    if(epic.ownerId && epic.ownerId !== actor) targets.add(epic.ownerId);

    const base = { taskId:'', projectId:epic.projectId||epicProjectIds[0]||'', sprintId:'', createdBy:actor };
    targets.forEach(uid=>{
      if(uid===actor) return;
      if(isNew){
        _fire({ ...base, type:'update', category:'updated', userId:uid,
          title:'Epic created', message:`Epic "${epic.title}" was created by ${actorName}.` });
      } else if(isCompleted){
        _fire({ ...base, type:'update', category:'updated', userId:uid,
          title:'Epic completed', message:`Epic "${epic.title}" was marked completed by ${actorName}.` });
      } else {
        _fire({ ...base, type:'update', category:'updated', userId:uid,
          title:'Epic updated', message:`Epic "${epic.title}" was updated by ${actorName}.` });
      }
    });
  }

  return { _onTaskSaved, _onTaskStatusChanged, _onSubtaskSaved, _onSubtaskStatusChanged, _onSprintSaved, _onEpicSaved };
})();

window.NotificationTriggers = NotificationTriggers;

