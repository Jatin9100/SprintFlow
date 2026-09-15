const FirebaseDB = (function(){
  // Internal reference to the Firebase db instance (set after Firebase init)
  let _db = null;
  let _ready = false;
  let _readyCallbacks = [];

  // Firebase SDK references (set after module script loads)
  let _ref = null;
  let _set = null;
  let _update = null;
  let _remove = null;
  let _get = null;
  let _onValue = null;   // injected by RealtimeSync

  // ── Initializer called by the Firebase module script below ──
  function init(db, sdkFns){
    try {
      _db = db;
      _ref    = sdkFns.ref;
      _set    = sdkFns.set;
      _update = sdkFns.update;
      _remove = sdkFns.remove;
      _get    = sdkFns.get;
      if(sdkFns.onValue) _onValue = sdkFns.onValue;
      _ready  = true;
      console.log('[FirebaseDB] Core layer ready');
      _readyCallbacks.forEach(fn => { try{ fn(); }catch(e){} });
      _readyCallbacks = [];
    } catch(e) {
      console.warn('[FirebaseDB] init failed:', e);
    }
  }

  // ── Called by RealtimeSync to inject onValue after module import ──
  function setOnValue(fn){ _onValue = fn; }
  function getRef(){ return _ref; }
  function getDb(){ return _db; }

  function onReady(fn){
    if(_ready) { try{ fn(); }catch(e){} }
    else _readyCallbacks.push(fn);
  }

  function isReady(){ return _ready && _db !== null; }

  // ── Internal: safe Firebase reference ──
  function _safeRef(path){
    if(!isReady()) throw new Error('[FirebaseDB] Firebase not ready');
    if(!path || typeof path !== 'string') throw new Error('[FirebaseDB] Invalid path: '+path);
    return _ref(_db, path);
  }

  // ── normalize entity collection name ──
  function _col(collection){
    const map = {
      projects:'projects', users:'users', sprints:'sprints',
      tasks:'tasks', epics:'epics', releases:'releases', subtasks:'subtasks',
      products:'products', tags:'tags', themes:'themes',
      retrospectives:'retrospectives', retrospectiveEntries:'retrospectiveEntries' // FIX: missing entries caused all retro Firebase writes to throw and silently fall back to localStorage only
    };
    if(!map[collection]) throw new Error('[FirebaseDB] Unknown collection: '+collection);
    return map[collection];
  }

  // ─────────────────────────────────────────────────────────────────
  // loadAppData()
  // Loads ALL app data from Firebase and merges it into the in-memory
  // state object. Falls back to the existing in-memory state on error.
  // Returns a Promise that resolves when state is populated.
  // Production Hardened: safe snapshot.val(), full try/catch, array guards
  // ─────────────────────────────────────────────────────────────────
  async function loadAppData(){
    if(!isReady()){
      console.warn('[FirebaseDB] loadAppData: Firebase unavailable, using in-memory state');
      return state;
    }
    try {
      // ── Determine RBAC scope for load (RBAC not yet init'd — use raw state) ──
      // Admin or first load (no users yet): fetch all collections from root.
      // Non-admin: fetch project-scoped collections in parallel per visible project,
      // then merge into a single array before the existing normalisation logic.
      const _currentUserEmail = (window.auth && window.auth.currentUser)
        ? window.auth.currentUser.email : null;
      const _userRecord = _currentUserEmail
        ? (state.users || []).find(u => u.email === _currentUserEmail) : null;
      const _isAdmin = !_userRecord || _userRecord.role === 'admin' || _userRecord.role === 'senior_manager';

      // Project-scoped collections — these support orderByChild('projectId') / orderByChild('project')
      const PROJECT_KEYED = {
        tasks    : 'project',
        sprints  : 'project',
        epics    : 'projectId',
        releases : 'projectId',
      };

      // Resolve visible project IDs for non-admin (fallback: all)
      let _scopedProjectIds = null;
      if(!_isAdmin && _userRecord){
        const _allProjects = state.projects || [];
        const _memberProjects = _allProjects.filter(p =>
          p.memberIds && p.memberIds.includes(_userRecord.id)
        );
        if(_memberProjects.length) _scopedProjectIds = _memberProjects.map(p => p.id);
      }

      // Helper: fetch one collection, scoped or full
      async function _fetchCollection(colName){
        const colRef = _safeRef(`sprintflow/${colName}`);
        // users and projects always fetched in full (needed for RBAC + sidebar)
        if(!_scopedProjectIds || !(colName in PROJECT_KEYED)){
          return _get(colRef);
        }
        // Non-admin: one query per visible project, merged client-side
        const field = PROJECT_KEYED[colName];
        const snaps = await Promise.all(
          _scopedProjectIds.map(pid =>
            _get(
              (window._rtQuery || (r => r))(
                colRef,
                (window._rtOrderByChild || (()=>null))(field),
                (window._rtEqualTo     || (()=>null))(pid)
              )
            )
          )
        );
        // Merge multi-snap results into a single pseudo-snapshot
        const merged = {};
        snaps.forEach(s => { if(s.exists()) Object.assign(merged, s.val() || {}); });
        // Return a lightweight object matching the snapshot API used below
        return {
          exists : () => Object.keys(merged).length > 0,
          val    : () => Object.keys(merged).length ? merged : null,
        };
      }

      const [
        tasksSnap,
        projectsSnap,
        sprintsSnap,
        epicsSnap,
        usersSnap,
        releasesSnap,
        retrospectivesSnap,       // FIX(Issue 2)
        retroEntriesSnap,         // FIX(Issue 2)
        productsSnap,
        tagsSnap,
        themesSnap
      ] = await Promise.all([
        _fetchCollection('tasks'),
        _fetchCollection('projects'),
        _fetchCollection('sprints'),
        _fetchCollection('epics'),
        _fetchCollection('users'),
        _fetchCollection('releases'),
        _fetchCollection('retrospectives'),        // FIX(Issue 2)
        _fetchCollection('retrospectiveEntries'),  // FIX(Issue 2)
        _get(_safeRef('sprintflow/products')),
        _get(_safeRef('sprintflow/tags')),
        _get(_safeRef('sprintflow/themes')),
      ]);
      // If every collection is empty the database has not been seeded yet
      const anyExists = tasksSnap.exists()    || projectsSnap.exists() || sprintsSnap.exists()
                     || epicsSnap.exists()    || usersSnap.exists()    || releasesSnap.exists();
      if(!anyExists){
        console.info('[FirebaseDB] No data in Firebase — seeding with DEFAULT_DATA');
        await syncAppState();   // push defaults up
        return state;
      }
      // Merge Firebase data → state (preserve shape, migrate legacy statuses)
      const statusMap={'todo':'open','in-progress':'dev-in-progress','qa':'in-qa','done':'released'};
      function _mergeArr(fbObj, fallback){
        if(!fbObj) return fallback || [];
        // Firebase stores arrays as objects keyed by id or numeric index.
        // Some records were written without their own `id` field — fall back
        // to the RTDB key so every record stays individually addressable
        // (missing ids otherwise collide as a single `undefined` id and can't
        // be opened, edited, or deleted).
        if(Array.isArray(fbObj)) return fbObj.filter(Boolean);
        return Object.entries(fbObj).filter(([,v])=>Boolean(v)).map(([k,v])=>v.id?v:{...v,id:k});
      }
      const merged = {
        projects             : _mergeArr(projectsSnap.val(), state.projects),
        users                : _mergeArr(usersSnap.val(),    state.users),
        sprints              : _mergeArr(sprintsSnap.val(),  state.sprints),
        epics                : _mergeArr(epicsSnap.val(),     state.epics),
        tasks                : _mergeArr(tasksSnap.val(),     state.tasks),
        releases             : _mergeArr(releasesSnap.val(),  state.releases),
        retrospectives       : _mergeArr(retrospectivesSnap.val(), state.retrospectives),    // FIX(Issue 2)
        retrospectiveEntries : _mergeArr(retroEntriesSnap.val(),   state.retrospectiveEntries), // FIX(Issue 2)
        products             : _mergeArr(productsSnap && productsSnap.exists() ? productsSnap.val() : null, state.products),
        tags                 : _mergeArr(tagsSnap     && tagsSnap.exists()     ? tagsSnap.val()     : null, state.tags),
        themes               : _mergeArr(themesSnap   && themesSnap.exists()   ? themesSnap.val()   : null, state.themes),
      };
      // Normalise projects
      merged.projects.forEach(p=>{ if(!p.memberIds) p.memberIds=[]; });
      // Normalise tasks
      merged.tasks.forEach(t=>{
        if(statusMap[t.status]) t.status = statusMap[t.status];
        // FIX: Firebase RTDB serialises sparse/non-contiguous arrays as objects,
        // not arrays. A prior truthy-only check (!t.subtasks) let such objects
        // through, and t.subtasks.forEach() then threw "not a function" —
        // aborting the ENTIRE loadAppData() call (Promise chain, all-or-nothing)
        // and silently falling back to cached/local state for the whole app.
        // Admins hit this reliably because they load every task unscoped;
        // project-scoped users often never touch the one bad record.
        if(!Array.isArray(t.subtasks)){
          t.subtasks = t.subtasks ? Object.values(t.subtasks).filter(Boolean) : [];
        }
        if(t.epicId    === undefined) t.epicId    = null;
        if(t.releaseId === undefined) t.releaseId = null;
        t.subtasks.forEach(s=>{
          if(statusMap[s.status]) s.status = statusMap[s.status];
          if(!s.status) s.status = 'open';
        });
      });
      // Re-stamp releaseId on tasks from taskIds arrays
      merged.releases.forEach(r=>{
        if(!r||!r.id) return;
        (r.taskIds||[]).forEach(tid=>{
          if(!tid) return;
          const t = merged.tasks.find(x=>x&&x.id===tid);
          if(t) t.releaseId = r.id;
        });
      });
      // Auto-migrate legacy role 'member' → 'team_member'
      merged.users.forEach(u=>{ if(u.role==='member') u.role='team_member'; });
      // Apply to global state (keep reference stable so all closures see changes)
      Object.assign(state, merged);
      // Production Hardened: re-ensure all arrays defined after merge
      state.tasks                = state.tasks                || [];
      state.projects             = state.projects             || [];
      state.sprints              = state.sprints              || [];
      state.users                = state.users                || [];
      state.releases             = state.releases             || [];
      state.epics                = state.epics                || [];
      state.comments             = state.comments             || [];
      state.products             = state.products             || [];
      state.tags                 = state.tags                 || [];
      state.themes               = state.themes               || [];
      state.retrospectives       = state.retrospectives       || []; // FIX(Issue 2)
      state.retrospectiveEntries = state.retrospectiveEntries || []; // FIX(Issue 2)
      invalidateStateMaps();
      return state;
    } catch(e) {
      console.error('[FirebaseDB] loadAppData error:', e.message || e);
      // Gracefully fall through — keep whatever is already in state
      return state;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // saveEntity(collection, entity)
  // Writes a single entity to Firebase at sprintflow/{collection}/{entity.id}
  // Also keeps module-specific localStorage in sync via SaveManager.
  // ─────────────────────────────────────────────────────────────────
  async function saveEntity(collection, entity){
    if(!entity || !entity.id){
      console.warn('[FirebaseDB] saveEntity: entity missing id', collection, entity);
      return false;
    }
    // Always keep SaveManager (localStorage) in sync for non-migrated modules
    SaveManager.save();
    SaveManager.saveReleases();
    if(!isReady()){
      console.warn('[FirebaseDB] saveEntity: Firebase unavailable, localStorage only');
      return false;
    }
    try {
      const col = _col(collection);
      // Strip transient sync metadata — never persist to Firebase
      const clean = Object.assign({}, entity);
      delete clean._syncState;
      const path = `sprintflow/${col}/${clean.id}`;
      await _set(_safeRef(path), clean);
      if(typeof SyncState !== 'undefined') SyncState.markSynced(entity.id);
      return true;
    } catch(e) {
      console.error('[FirebaseDB] saveEntity error:', collection, entity.id, e.message || e);
      if(typeof SyncState !== 'undefined') SyncState.markFailed(entity.id);
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // updateEntity(collection, id, patch)
  // Merges a partial patch into an existing entity in Firebase.
  // ─────────────────────────────────────────────────────────────────
  async function updateEntity(collection, id, patch){
    if(!id || !patch || typeof patch !== 'object'){
      console.warn('[FirebaseDB] updateEntity: invalid args', collection, id, patch);
      return false;
    }
    SaveManager.save();
    SaveManager.saveReleases();
    if(!isReady()){
      console.warn('[FirebaseDB] updateEntity: Firebase unavailable, localStorage only');
      return false;
    }
    try {
      const col = _col(collection);
      // Strip transient sync metadata
      const cleanPatch = Object.assign({}, patch);
      delete cleanPatch._syncState;
      const path = `sprintflow/${col}/${id}`;
      await _update(_safeRef(path), cleanPatch);
      if(typeof SyncState !== 'undefined') SyncState.markSynced(id);
      return true;
    } catch(e) {
      console.error('[FirebaseDB] updateEntity error:', collection, id, e.message || e);
      if(typeof SyncState !== 'undefined') SyncState.markFailed(id);
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // deleteEntity(collection, id)
  // Removes an entity from Firebase.
  // ─────────────────────────────────────────────────────────────────
  async function deleteEntity(collection, id){
    if(!id){
      console.warn('[FirebaseDB] deleteEntity: missing id', collection);
      return false;
    }
    SaveManager.save();
    SaveManager.saveReleases();
    if(!isReady()){
      console.warn('[FirebaseDB] deleteEntity: Firebase unavailable, localStorage only');
      return false;
    }
    try {
      const col = _col(collection);
      const path = `sprintflow/${col}/${id}`;
      await _remove(_safeRef(path));
      return true;
    } catch(e) {
      console.error('[FirebaseDB] deleteEntity error:', collection, id, e.message || e);
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // syncAppState()
  // Writes the ENTIRE in-memory state to Firebase in one atomic push.
  // Use sparingly (e.g. on reset, seed, or full migration).
  // ─────────────────────────────────────────────────────────────────
  async function syncAppState(){
    if(
      !window._isSeedingMode
      &&
      !RBAC.isAdmin()
    ){
      console.warn('[FirebaseDB] sync blocked');
      return false;
    }
    SaveManager.save();
    SaveManager.saveReleases();
    if(!isReady()){
      console.warn('[FirebaseDB] syncAppState: Firebase unavailable, localStorage only');
      return false;
    }
    try {
      // Convert arrays → objects keyed by id for Firebase best-practice storage
      function _toObj(arr){
        if(!Array.isArray(arr)) return {};
        return arr.filter(x=>x&&x.id).reduce((acc,x)=>{ acc[x.id]=x; return acc; }, {});
      }
      const payload = {
        projects : _toObj(state.projects),
        users    : _toObj(state.users),
        sprints  : _toObj(state.sprints),
        epics    : _toObj(state.epics),
        tasks    : _toObj(state.tasks),
        releases : _toObj(state.releases),
        products : _toObj(state.products),
        tags     : _toObj(state.tags),
        themes   : _toObj(state.themes),
      };
      await _set(_safeRef('sprintflow'), payload);
      console.info('[FirebaseDB] syncAppState: full state pushed to Firebase');
      return true;
    } catch(e) {
      console.error('[FirebaseDB] syncAppState error:', e.message || e);
      return false;
    }
  }

  // Expose public API
  return { init, onReady, isReady, loadAppData, saveEntity, updateEntity, deleteEntity, _seedOnly_syncAppState:syncAppState, setOnValue, getRef, getDb };
})();
