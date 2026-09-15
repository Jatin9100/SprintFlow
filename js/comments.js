// ══════════════════════════════════════════════════════════════════
//  COMMENTS SYSTEM — Task & Subtask  (Phase 1: Comments Decoupled)
//  Storage: sprintflow/taskComments/{taskId}/{commentId}   ← task comments
//           sprintflow/taskComments/{taskId}/_subtasks/{subtaskId}/{commentId} ← subtask comments
//  Tasks store ONLY metadata: commentCount, lastCommentAt, lastCommentBy
//  Comments are loaded ON-DEMAND only when a modal opens.
//  Session cache (_cmCache) prevents repeat Firebase reads in the same session.
//  Silent migration: legacy task.comments[] is migrated on first modal open.
//  RBAC: Admin ✓ | PM (visible project) ✓ | Assignee ✓ | others: view-only
// ══════════════════════════════════════════════════════════════════

// ── Session comment cache ─────────────────────────────────────────
// Structure: _cmCache[taskId] = { _task: Comment[], _sub_<subtaskId>: Comment[] }
// Invalidated on add / edit / delete.
const _cmCache = {};

// ── Firebase path helpers ─────────────────────────────────────────
// Task comments:    sprintflow/taskComments/{taskId}/{commentId}
// Subtask comments: sprintflow/taskComments/{taskId}/_subtasks/{subtaskId}/{commentId}
function _cmTaskFbPath(taskId){ return `sprintflow/taskComments/${taskId}`; }
function _cmSubFbPath(taskId, subtaskId){ return `sprintflow/taskComments/${taskId}/_subtasks/${subtaskId}`; }
function _cmFbPath(taskId, subtaskId){ return subtaskId ? _cmSubFbPath(taskId, subtaskId) : _cmTaskFbPath(taskId); }

// ── Cache key helpers ─────────────────────────────────────────────
function _cmCacheKey(subtaskId){ return subtaskId ? `_sub_${subtaskId}` : '_task'; }

// ── Low-level Firebase read — returns sorted Comment[] ────────────
async function _cmFirebaseRead(taskId, subtaskId){
  try {
    if(!FirebaseDB.isReady()) return [];
    const _get = window._rtGet;
    const refFn = FirebaseDB.getRef();
    const db    = FirebaseDB.getDb();
    if(!_get || !refFn || !db) return [];
    const snap = await _get(refFn(db, _cmFbPath(taskId, subtaskId)));
    if(!snap || !snap.exists()) return [];
    const val = snap.val();
    if(!val) return [];
    // Filter out the _subtasks sub-key at the task level; convert object → array
    return Object.entries(val)
      .filter(([k])=> k !== '_subtasks')
      .map(([,v])=>v)
      .filter(Boolean);
  } catch(e){
    console.warn('[Comments] Firebase read error:', e);
    return [];
  }
}

// ── Load comments: cache-first, Firebase fallback ─────────────────
// Also runs silent migration of legacy task.comments[] on first load.
async function _cmLoad(taskId, subtaskId){
  if(!taskId) return [];
  const bucket = _cmCache[taskId] || (_cmCache[taskId] = {});
  const key = _cmCacheKey(subtaskId);

  // ── Cache hit ──
  if(bucket[key]) return bucket[key];

  // ── Firebase read ──
  let comments = await _cmFirebaseRead(taskId, subtaskId);

  // ── Silent migration: if no Firebase comments, check legacy task.comments[] ──
  if(!comments.length){
    const task = getTask(taskId);
    if(task){
      let legacyComments = [];
      if(!subtaskId){
        legacyComments = Array.isArray(task.comments) ? task.comments : [];
      } else {
        const sub = (task.subtasks||[]).find(s=>s.id===subtaskId);
        legacyComments = sub && Array.isArray(sub.comments) ? sub.comments : [];
      }
      if(legacyComments.length){
        // Write legacy comments to new path (idempotent — we only arrive here if path was empty)
        await _cmMigrateLegacy(taskId, subtaskId, task, legacyComments);
        comments = legacyComments;
      }
    }
  }

  // Sort descending by createdAt, cache, return
  comments = comments.slice().sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  bucket[key] = comments;
  return comments;
}

// ── Silent migration: write legacy embedded comments → taskComments ─
// Idempotent: only called when taskComments path is empty.
async function _cmMigrateLegacy(taskId, subtaskId, task, legacyComments){
  try {
    if(!FirebaseDB.isReady()) return;
    const refFn = FirebaseDB.getRef();
    const db    = FirebaseDB.getDb();
    const _get  = window._rtGet;
    const _set  = window._rtSet;
    if(!refFn || !db || !_set) return;

    // Double-check guard: re-read to ensure we're not overwriting existing comments
    const checkSnap = await (_get ? _get(refFn(db, _cmFbPath(taskId, subtaskId))) : Promise.resolve({exists:()=>false}));
    if(checkSnap && checkSnap.exists()) return; // already migrated — bail

    const basePath = _cmFbPath(taskId, subtaskId);
    // Build object map of commentId → comment
    const payload = {};
    legacyComments.forEach(c=>{ if(c && c.id) payload[c.id] = c; });

    await _set(refFn(db, basePath), payload);

    // Update task metadata (commentCount, lastCommentAt, lastCommentBy)
    await _cmUpdateMetadata(taskId, subtaskId, legacyComments);

    // Remove embedded comments from the task document in Firebase (task level only or subtask level)
    if(!subtaskId){
      // Clear task.comments array in Firebase
      if(window._rtUpdate){
        await window._rtUpdate(refFn(db, `sprintflow/tasks/${taskId}`), { comments: null });
      }
      // Also clear in-memory to keep consistent
      if(task.comments) delete task.comments;
    } else {
      // Clear the subtask's comments array
      const sub = (task.subtasks||[]).find(s=>s.id===subtaskId);
      if(sub && sub.comments){
        delete sub.comments;
        // Persist updated task (subtasks are stored inside the task document)
        FirebaseDB.saveEntity('tasks', task).catch(e=>console.warn('[Comments] migrate subtask clear error:', e));
      }
    }
    console.info(`[Comments] Migrated ${legacyComments.length} legacy comment(s) for task ${taskId}${subtaskId?' subtask '+subtaskId:''}`);
  } catch(e){
    console.warn('[Comments] Migration error (non-fatal):', e);
  }
}

// ── Write a single comment to Firebase ───────────────────────────
async function _cmFirebaseWrite(taskId, subtaskId, comment){
  try {
    if(!FirebaseDB.isReady()) return false;
    const refFn = FirebaseDB.getRef();
    const db    = FirebaseDB.getDb();
    const _set  = window._rtSet;
    if(!refFn || !db || !_set) return false;
    // ── Phase 2: compress images in comment content before persistence ──
    const compressedContent = await _compressImagesInHtml(comment.content);
    const commentToSave = compressedContent !== comment.content
      ? Object.assign({}, comment, { content: compressedContent })
      : comment;
    await _set(refFn(db, `${_cmFbPath(taskId, subtaskId)}/${commentToSave.id}`), commentToSave);
    return true;
  } catch(e){
    console.warn('[Comments] Firebase write error:', e);
    return false;
  }
}

// ── Update a single comment in Firebase ──────────────────────────
async function _cmFirebaseUpdate(taskId, subtaskId, commentId, patch){
  try {
    if(!FirebaseDB.isReady()) return false;
    const refFn  = FirebaseDB.getRef();
    const db     = FirebaseDB.getDb();
    const _upd   = window._rtUpdate;
    if(!refFn || !db || !_upd) return false;
    // ── Phase 2: compress images in patch content before persistence ──
    let patchToSave = patch;
    if(patch && typeof patch.content === 'string'){
      const compressedContent = await _compressImagesInHtml(patch.content);
      if(compressedContent !== patch.content){
        patchToSave = Object.assign({}, patch, { content: compressedContent });
      }
    }
    await _upd(refFn(db, `${_cmFbPath(taskId, subtaskId)}/${commentId}`), patchToSave);
    return true;
  } catch(e){
    console.warn('[Comments] Firebase update error:', e);
    return false;
  }
}

// ── Delete a single comment from Firebase ────────────────────────
async function _cmFirebaseDelete(taskId, subtaskId, commentId){
  try {
    if(!FirebaseDB.isReady()) return false;
    const refFn = FirebaseDB.getRef();
    const db    = FirebaseDB.getDb();
    const _rm   = window._rtRemove;
    if(!refFn || !db || !_rm) return false;
    await _rm(refFn(db, `${_cmFbPath(taskId, subtaskId)}/${commentId}`));
    return true;
  } catch(e){
    console.warn('[Comments] Firebase delete error:', e);
    return false;
  }
}

// ── Update lightweight comment metadata on the task document ──────
// commentCount, lastCommentAt, lastCommentBy
async function _cmUpdateMetadata(taskId, subtaskId, comments){
  try {
    const task = getTask(taskId);
    if(!task) return;
    // Only track metadata at the task level (not per-subtask)
    // (subtask comment count could be added in a future phase if needed)
    if(subtaskId) return;
    const sorted = [...comments].sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
    const last   = sorted[0];
    const meta   = {
      commentCount   : comments.length,
      lastCommentAt  : last ? (last.createdAt||0) : 0,
      lastCommentBy  : last ? (last.authorName||'') : '',
    };
    // Update in-memory task
    Object.assign(task, meta);
    // Persist metadata patch to Firebase (lightweight — no full task resave needed)
    FirebaseDB.updateEntity('tasks', taskId, meta).catch(e=>console.warn('[Comments] metadata update error:', e));
  } catch(e){ console.warn('[Comments] _cmUpdateMetadata error:', e); }
}

// ── Invalidate session cache for a task (and optionally subtask) ──
function _cmInvalidate(taskId, subtaskId){
  const bucket = _cmCache[taskId];
  if(!bucket) return;
  const key = _cmCacheKey(subtaskId);
  delete bucket[key];
}

// ── Rollback helper (console-callable for emergency reversal) ─────
// Usage: _cmRollbackTask('task-id') from browser console
async function _cmRollbackTask(taskId){
  try {
    console.info('[Comments] Rolling back task', taskId);
    const task = getTask(taskId);
    if(!task){ console.warn('[Comments] rollback: task not found'); return; }
    const comments = await _cmFirebaseRead(taskId, '');
    if(!comments.length){ console.info('[Comments] rollback: nothing to roll back'); return; }
    task.comments = comments;
    await FirebaseDB.saveEntity('tasks', task);
    console.info('[Comments] rollback complete — embedded comments restored for task', taskId);
  } catch(e){ console.error('[Comments] rollback error:', e); }
}
window._cmRollbackTask = _cmRollbackTask; // expose for console use


// ── ID generator (same style as other IDs in the app) ─────────────
function _cmId(){ return 'c'+Date.now().toString(36)+Math.random().toString(36).substr(2,4); }

// ── Timestamp formatter ───────────────────────────────────────────
function _cmFormatTime(ts){
  if(!ts) return '';
  const d=new Date(ts);
  const pad=n=>String(n).padStart(2,'0');
  const day=pad(d.getDate()), mon=pad(d.getMonth()+1), yr=d.getFullYear();
  let h=d.getHours(), ampm=h>=12?'PM':'AM';
  h=h%12||12;
  return `${day}-${mon}-${yr} ${pad(h)}:${pad(d.getMinutes())} ${ampm}`;
}

// ── RBAC: can current user ADD a comment to this task/subtask? ────
function _cmCanComment(taskOrSub, parentTask){
  const cu = state.currentUser;
  if(!cu) return false;
  if(RBAC.isAdmin()||RBAC.isSeniorManager()) return true;
  const projId = taskOrSub.project || (parentTask && parentTask.project) || null;
  if(RBAC.isProgramManager()){
    const visIds = new Set(RBAC.getVisibleProjects().map(p=>p.id));
    if(projId && visIds.has(projId)) return true;
  }
  if(taskOrSub.assignee && taskOrSub.assignee === cu.id) return true;
  // QA Assignee may comment only on tasks/subtasks where they are marked as QA
  if(taskOrSub.qaAssigneeId && taskOrSub.qaAssigneeId === cu.id) return true;
  return false;
}

// ── RBAC: can user edit a specific comment? ───────────────────────
function _cmCanEdit(comment){
  const cu = state.currentUser;
  if(!cu) return false;
  if(RBAC.isAdmin()) return true;
  if(comment.authorId === cu.id) return true;
  return false;
}

// ── RBAC: can user delete a specific comment? ─────────────────────
function _cmCanDelete(comment){
  const cu = state.currentUser;
  if(!cu) return false;
  if(RBAC.isAdmin()) return true;
  if(comment.authorId === cu.id) return true;
  return false;
}

// ── Role label for display ────────────────────────────────────────
function _cmRoleLabel(role){
  if(role==='admin') return 'Admin';
  if(role==='senior_manager') return 'Senior Manager';
  if(role==='program_manager') return 'Program Manager';
  if(role==='viewer') return 'Viewer';
  return 'Team Member';
}
function _cmRoleBadgeClass(role){
  if(role==='admin') return 'badge-admin';
  if(role==='senior_manager') return 'badge-senior_manager';
  if(role==='program_manager') return 'badge-program_manager';
  if(role==='viewer') return 'badge-viewer';
  return 'badge-team_member';
}

// ── Build comment HTML for a single comment item ─────────────────
function _cmItemHtml(comment, taskId, subtaskId){
  const isOwnOrAdmin = _cmCanEdit(comment);
  const canDel = _cmCanDelete(comment);
  const editId = `cm-edit-${comment.id}`;
  const contentId = `cm-content-${comment.id}`;
  return `<div class="cm-item" id="cm-item-${comment.id}">
    ${userAvatar(comment.authorId, 30)}
    <div class="cm-body">
      <div class="cm-header">
        <span class="cm-author">${_escHtml(comment.authorName||'Unknown')}</span>
        <span class="badge ${_cmRoleBadgeClass(comment.authorRole)}" style="font-size:9px;padding:1px 6px">${_escHtml(_cmRoleLabel(comment.authorRole))}</span>
        <span class="cm-time">${_cmFormatTime(comment.createdAt)}${comment.updatedAt&&comment.updatedAt!==comment.createdAt?' <span style="font-size:10px;color:var(--text-muted)">(edited)</span>':''}</span>
      </div>
      <div class="cm-content" id="${contentId}">${_sanitizeDescHTML(comment.content||'')}</div>
      <div class="cm-edit-wrap" id="${editId}" style="display:none">
        <div class="cm-edit-editor desc-editor" id="${editId}-editor" data-placeholder="Edit comment..."></div>
        <div class="cm-edit-actions">
          <button class="btn btn-secondary" style="height:26px;padding:0 10px;font-size:11px" onclick="_cmCancelEdit('${comment.id}')">Cancel</button>
          <button class="btn btn-primary" style="height:26px;padding:0 10px;font-size:11px" onclick="_cmSaveEdit('${taskId}','${subtaskId||''}','${comment.id}')">Save</button>
        </div>
      </div>
      <div class="cm-actions">
        ${isOwnOrAdmin?`<button class="cm-act-btn" onclick="_cmStartEdit('${comment.id}')">Edit</button>`:''}
        ${canDel?`<button class="cm-act-btn del" onclick="_cmDeleteComment('${taskId}','${subtaskId||''}','${comment.id}')">Delete</button>`:''}
      </div>
    </div>
  </div>`;
}

// ── Build comment section HTML from a pre-loaded comments array ───
// Synchronous — comments must already be in _cmCache before calling.
function _cmSectionHtmlSync(taskId, subtaskId, comments){
  const task = getTask(taskId);
  if(!task) return '';
  let target = task;
  if(subtaskId){
    target = (task.subtasks||[]).find(s=>s.id===subtaskId);
    if(!target) return '';
  }
  const canAdd = _cmCanComment(target, task);
  const cu = state.currentUser;

  const composeHtml = canAdd ? `
    <div class="cm-compose" id="cm-compose-${taskId}-${subtaskId||''}">
      ${cu?userAvatar(cu.id,30):''}
      <div style="flex:1;min-width:0">
        <div class="cm-editor-wrap">
          <div class="cm-editor desc-editor" id="cm-new-editor-${taskId}-${subtaskId||''}" data-placeholder="Add a comment\u2026 (supports rich text, images)"></div>
          <div class="cm-toolbar">
            <button class="cm-tool" title="Bold" onmousedown="event.preventDefault();document.execCommand('bold')"><b>B</b></button>
            <button class="cm-tool" title="Italic" onmousedown="event.preventDefault();document.execCommand('italic')"><i>I</i></button>
            <button class="cm-tool" title="Underline" onmousedown="event.preventDefault();document.execCommand('underline')"><u>U</u></button>
            <button class="cm-tool" title="Bullet list" onmousedown="event.preventDefault();document.execCommand('insertUnorderedList')">\u2022 \u2261</button>
            <button class="cm-tool" title="Numbered list" onmousedown="event.preventDefault();document.execCommand('insertOrderedList')">1 \u2261</button>
          </div>
        </div>
        <div class="cm-submit-row">
          <button class="btn btn-primary" style="height:30px;padding:0 14px;font-size:12px" onclick="_cmSubmit('${taskId}','${subtaskId||''}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:4px"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            Comment
          </button>
        </div>
      </div>
    </div>` : `<div class="cm-readonly-banner">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      You can view comments but cannot add or edit them on this item.
    </div>`;

  const listHtml = comments.length
    ? comments.map(c=>_cmItemHtml(c, taskId, subtaskId||'')).join('')
    : `<div style="text-align:center;padding:16px 0;color:var(--text-muted);font-size:12.5px">No comments yet. ${canAdd?'Be the first to comment.':''}</div>`;

  return `<div class="cm-section" id="cm-section-${taskId}-${subtaskId||''}">
    <div class="cm-section-title">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
      Comments
      ${comments.length?`<span class="cm-count">${comments.length}</span>`:''}
    </div>
    ${composeHtml}
    <div id="cm-list-${taskId}-${subtaskId||''}">${listHtml}</div>
  </div>`;
}


// ── Loading placeholder (injected synchronously into modal HTML) ──
// _cmHydrate() replaces it once Firebase read completes.
function _cmSectionHtml(taskId, subtaskId){
  return `<div class="cm-section" id="cm-section-${taskId}-${subtaskId||''}">
    <div class="cm-section-title">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
      Comments
    </div>
    <div style="text-align:center;padding:18px 0;color:var(--text-muted);font-size:12px">
      Loading comments\u2026
    </div>
  </div>`;
}

// ── Init the compose editor after DOM insertion ───────────────────
function _cmInitEditor(taskId, subtaskId){
  const edId = `cm-new-editor-${taskId}-${subtaskId||''}`;
  _initDescEditor(edId, '', 'Add a comment\u2026 (supports rich text, images)');
}

// ── Load comments and hydrate the placeholder in place ────────────
// Called after modal HTML is in the DOM.
async function _cmHydrate(taskId, subtaskId){
  const comments = await _cmLoad(taskId, subtaskId||'');
  const sectionEl = document.getElementById(`cm-section-${taskId}-${subtaskId||''}`);
  if(!sectionEl) return; // modal closed before load finished
  const newHtml = _cmSectionHtmlSync(taskId, subtaskId||'', comments);
  const tmp = document.createElement('div');
  tmp.innerHTML = newHtml;
  const newSection = tmp.firstElementChild;
  if(newSection) sectionEl.replaceWith(newSection);
  _cmInitEditor(taskId, subtaskId||'');
}

// ── Submit new comment ────────────────────────────────────────────
function _cmSubmit(taskId, subtaskId){
  const cu = state.currentUser;
  if(!cu){ showNotif('\u26a0 You must be logged in to comment','error'); return; }
  const edId = `cm-new-editor-${taskId}-${subtaskId||''}`;
  const content = _getDescValue(edId);
  if(!content || !content.replace(/<[^>]+>/g,'').trim()){
    showNotif('\u26a0 Comment cannot be empty','error'); return;
  }
  const task = getTask(taskId);
  if(!task){ showNotif('\u26a0 Task not found','error'); return; }
  let target = task;
  if(subtaskId){
    target = (task.subtasks||[]).find(s=>s.id===subtaskId);
    if(!target){ showNotif('\u26a0 Subtask not found','error'); return; }
  }
  if(!_cmCanComment(target, task)){ showNotif('\u26a0 You do not have permission to comment on this item','error'); return; }
  const comment = {
    id        : _cmId(),
    authorId  : cu.id,
    authorName: cu.name || cu.email || 'Unknown',
    authorRole: cu.role || 'team_member',
    createdAt : _now(),
    updatedAt : _now(),
    content   : content,
  };

  // Write to taskComments collection (NOT into the task document)
  _cmFirebaseWrite(taskId, subtaskId||'', comment).catch(e=>console.warn('[_cmSubmit] Firebase write error:',e));

  // Update session cache
  const bucket = _cmCache[taskId] || (_cmCache[taskId] = {});
  const key = _cmCacheKey(subtaskId||'');
  if(!bucket[key]) bucket[key] = [];
  bucket[key].unshift(comment); // newest first

  // ── Merged single metadata patch: comment meta + payload meta + updatedAt ──
  // One updateEntity call instead of three — reduces write amplification.
  (async () => {
    try {
      // Comment metadata (only tracked at task level, not per-subtask)
      const mergedPatch = { updatedAt: _now() };
      if(!subtaskId){
        const sorted = [...bucket[key]].sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
        const last   = sorted[0];
        mergedPatch.commentCount  = bucket[key].length;
        mergedPatch.lastCommentAt = last ? (last.createdAt||0) : 0;
        mergedPatch.lastCommentBy = last ? (last.authorName||'') : '';
        // In-memory update (mirrors what _cmUpdateMetadata would do)
        Object.assign(task, {
          commentCount  : mergedPatch.commentCount,
          lastCommentAt : mergedPatch.lastCommentAt,
          lastCommentBy : mergedPatch.lastCommentBy,
        });
      }
      // Payload diagnostic fields (4 scalar fields; no nested objects)
      const payloadMeta = _payloadComputeMeta(taskId);
      if(payloadMeta){
        const { payloadBreakdown: _omit, ...persistPayload } = payloadMeta;
        Object.assign(mergedPatch, persistPayload);
        Object.assign(task, payloadMeta); // keep breakdown in-memory for UI
      }
      task.updatedAt = mergedPatch.updatedAt;
      FirebaseDB.updateEntity('tasks', taskId, mergedPatch)
        .catch(e=>console.warn('[_cmSubmit] merged patch error:', e));
    } catch(e){ console.warn('[_cmSubmit] metadata merge error:', e); }
  })();
  SaveManager.save();

  const edEl = document.getElementById(edId);
  if(edEl) edEl.innerHTML='';
  _cmRefreshSection(taskId, subtaskId||'');
  showNotif('Comment added \u2713','success');
  _cmNotify(task, target, subtaskId||'', comment, 'new');
}

// ── Lightweight comment notification (unchanged) ──────────────────
function _cmNotify(task, target, subtaskId, comment, type){
  try{
    if(typeof NotificationSystem === 'undefined') return;
    const cu = state.currentUser;
    if(!cu) return;
    const assignee = target.assignee || task.assignee;
    if(assignee && assignee !== cu.id){
      NotificationSystem.createNotification({
        type     : 'update',
        category : 'commented',
        userId   : assignee,
        taskId   : task.id,
        subtaskId: subtaskId||'',
        projectId: task.project||'',
        sprintId : task.sprint||'',
        createdBy: cu.id,
        title    : subtaskId ? 'New comment on subtask' : 'New comment on task',
        message  : `${comment.authorName} commented on "${subtaskId?target.title:task.title}": ${String(comment.content).replace(/<[^>]+>/g,'').substring(0,80)}`,
      }).catch(()=>{});
    }
  } catch(e){ /* notification is optional */ }
}

// ── Re-render comment section from cache (no Firebase call) ───────
function _cmRefreshSection(taskId, subtaskId){
  const sectionEl = document.getElementById(`cm-section-${taskId}-${subtaskId||''}`);
  if(!sectionEl) return;
  const bucket = _cmCache[taskId];
  const key = _cmCacheKey(subtaskId||'');
  const comments = (bucket && bucket[key]) ? bucket[key] : [];
  const newHtml = _cmSectionHtmlSync(taskId, subtaskId||'', comments);
  const tmp = document.createElement('div');
  tmp.innerHTML = newHtml;
  const newSection = tmp.firstElementChild;
  if(newSection) sectionEl.replaceWith(newSection);
  _cmInitEditor(taskId, subtaskId||'');
}

// ── Start inline edit of a comment ───────────────────────────────
function _cmStartEdit(commentId){
  const contentEl = document.getElementById(`cm-content-${commentId}`);
  const editWrap  = document.getElementById(`cm-edit-${commentId}`);
  const editEl    = document.getElementById(`cm-edit-${commentId}-editor`);
  if(!contentEl||!editWrap||!editEl) return;
  editEl.innerHTML = contentEl.innerHTML;
  contentEl.style.display='none';
  editWrap.style.display='block';
  _initDescEditor(`cm-edit-${commentId}-editor`, editEl.innerHTML, 'Edit comment...');
  editEl.focus();
  try{
    const range=document.createRange();
    range.selectNodeContents(editEl);
    range.collapse(false);
    const sel=window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }catch(e){}
}

function _cmCancelEdit(commentId){
  const contentEl = document.getElementById(`cm-content-${commentId}`);
  const editWrap  = document.getElementById(`cm-edit-${commentId}`);
  if(!contentEl||!editWrap) return;
  contentEl.style.display='';
  editWrap.style.display='none';
}

// ── Save inline edit ──────────────────────────────────────────────
function _cmSaveEdit(taskId, subtaskId, commentId){
  const editEl = document.getElementById(`cm-edit-${commentId}-editor`);
  if(!editEl) return;
  const newContent = _getDescValue(`cm-edit-${commentId}-editor`);
  if(!newContent || !newContent.replace(/<[^>]+>/g,'').trim()){
    showNotif('\u26a0 Comment cannot be empty','error'); return;
  }
  const task = getTask(taskId);
  if(!task) return;

  const bucket = _cmCache[taskId];
  const key = _cmCacheKey(subtaskId||'');
  const cachedList = (bucket && bucket[key]) ? bucket[key] : [];
  const comment = cachedList.find(c=>c.id===commentId);
  if(!comment){ showNotif('\u26a0 Comment not found','error'); return; }
  if(!_cmCanEdit(comment)){ showNotif('\u26a0 You cannot edit this comment','error'); return; }

  comment.content   = newContent;
  comment.updatedAt = _now();
  task.updatedAt    = _now();

  // Write patch to taskComments path only (not full task resave)
  _cmFirebaseUpdate(taskId, subtaskId||'', commentId, { content: newContent, updatedAt: comment.updatedAt })
    .catch(e=>console.warn('[_cmSaveEdit] Firebase error:',e));

  // ── Merged single metadata patch: updatedAt + payload diagnostic fields ──
  (async () => {
    try {
      const mergedPatch = { updatedAt: task.updatedAt };
      const payloadMeta = _payloadComputeMeta(taskId);
      if(payloadMeta){
        const { payloadBreakdown: _omit, ...persistPayload } = payloadMeta;
        Object.assign(mergedPatch, persistPayload);
        Object.assign(task, payloadMeta); // keep breakdown in-memory for UI
      }
      FirebaseDB.updateEntity('tasks', taskId, mergedPatch)
        .catch(e=>console.warn('[_cmSaveEdit] merged patch error:', e));
    } catch(e){ console.warn('[_cmSaveEdit] metadata merge error:', e); }
  })();
  SaveManager.save();

  _cmRefreshSection(taskId, subtaskId||'');
  showNotif('Comment updated \u2713','success');
}

// ── Delete a comment ──────────────────────────────────────────────
function _cmDeleteComment(taskId, subtaskId, commentId){
  if(!confirm('Delete this comment?')) return;
  const task = getTask(taskId);
  if(!task) return;

  const bucket = _cmCache[taskId];
  const key = _cmCacheKey(subtaskId||'');
  const cachedList = (bucket && bucket[key]) ? bucket[key] : [];
  const comment = cachedList.find(c=>c.id===commentId);
  if(!comment){ showNotif('\u26a0 Comment not found','error'); return; }
  if(!_cmCanDelete(comment)){ showNotif('\u26a0 You cannot delete this comment','error'); return; }

  // Remove from cache
  if(bucket && bucket[key]){
    bucket[key] = bucket[key].filter(c=>c.id!==commentId);
  }

  // Delete from taskComments in Firebase
  _cmFirebaseDelete(taskId, subtaskId||'', commentId)
    .catch(e=>console.warn('[_cmDeleteComment] Firebase error:',e));

  // ── Merged single metadata patch: comment meta + payload meta + updatedAt ──
  // Recalculates payload after cache is updated — fixes stale imageCount/payloadSize on delete.
  const remaining = (bucket && bucket[key]) ? bucket[key] : [];
  task.updatedAt = _now();
  (async () => {
    try {
      const mergedPatch = { updatedAt: task.updatedAt };
      if(!subtaskId){
        const sorted = [...remaining].sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
        const last   = sorted[0];
        mergedPatch.commentCount  = remaining.length;
        mergedPatch.lastCommentAt = last ? (last.createdAt||0) : 0;
        mergedPatch.lastCommentBy = last ? (last.authorName||'') : '';
        Object.assign(task, {
          commentCount  : mergedPatch.commentCount,
          lastCommentAt : mergedPatch.lastCommentAt,
          lastCommentBy : mergedPatch.lastCommentBy,
        });
      }
      // Payload fields — cache already reflects deletion, so this is accurate
      const payloadMeta = _payloadComputeMeta(taskId);
      if(payloadMeta){
        const { payloadBreakdown: _omit, ...persistPayload } = payloadMeta;
        Object.assign(mergedPatch, persistPayload);
        Object.assign(task, payloadMeta);
      }
      FirebaseDB.updateEntity('tasks', taskId, mergedPatch)
        .catch(e=>console.warn('[_cmDeleteComment] merged patch error:', e));
    } catch(e){ console.warn('[_cmDeleteComment] metadata merge error:', e); }
  })();
  SaveManager.save();

  _cmRefreshSection(taskId, subtaskId||'');
  showNotif('Comment deleted');
}

