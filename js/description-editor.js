// ── AUDIT TRAIL: creation metadata helpers (Created By / Created Date) ──
function _captureCreator(){
  const cu = state.currentUser;
  if(!cu) return { userId:null, name:'Unknown', role:null, roleLabel:'Unknown' };
  const roleLabels = { admin:'Admin', senior_manager:'Senior Manager', program_manager:'Prog. Manager', team_member:'Team Member', member:'Team Member', viewer:'Viewer' };
  return {
    userId: cu.id || cu.uid || null,
    name: cu.name || cu.email || 'Unknown',
    role: cu.role || null,
    roleLabel: roleLabels[cu.role] || 'Team Member'
  };
}
function _createdByLabel(createdBy){
  if(!createdBy) return '—';
  const parts=[];
  if(createdBy.name) parts.push(_esc(createdBy.name));
  if(createdBy.roleLabel) parts.push(`(${_esc(createdBy.roleLabel)})`);
  return parts.length?parts.join(' '):'—';
}

// ── RICH-TEXT DESCRIPTION EDITOR HELPERS ──────────────────────────────────
// Initialises a contenteditable div as a rich-text description editor.
// Call after the element is in the DOM (e.g. right after openModal/replaceModal).
function _initDescEditor(id, htmlContent='', placeholder='Add more context...'){
  const el = document.getElementById(id);
  if(!el) return;
  el.setAttribute('contenteditable','true');
  el.setAttribute('data-placeholder', placeholder);
  el.className = 'desc-editor';
  // Set initial HTML content safely - sanitize even here: this content may
  // have been written to the database directly, bypassing this editor's own
  // paste handler entirely, so the render side can't assume it's already clean.
  el.innerHTML = _sanitizeDescHTML(htmlContent || '');
  // Paste handler: image blobs first, then HTML, then plain text
  el.addEventListener('paste', function(e){
    e.preventDefault();
    const cd = e.clipboardData || window.clipboardData;
    if(!cd) return;

    // ── IMAGE BLOB HANDLING ──────────────────────────────────────────
    // Check clipboard items for image type (covers screenshots, snipping
    // tool, browser image copies, Excel screenshot pastes).
    const items = cd.items ? Array.from(cd.items) : [];
    const imgItem = items.find(it => it.kind === 'file' && it.type.startsWith('image/'));
    if(imgItem){
      const blob = imgItem.getAsFile();
      if(!blob) return;
      // 2 MB guard
      if(blob.size > 2 * 1024 * 1024){
        showNotif('⚠ Image too large — max 2 MB','error');
        return;
      }
      const reader = new FileReader();
      reader.onload = function(ev){
        // Insert inline base64 image at cursor, wrapped in a block so it
        // sits on its own line and surrounding text is undisturbed.
        const src = ev.target.result;
        const imgHtml = `<div><img src="${src}" alt="pasted image" style="max-width:100%;height:auto;border-radius:4px;margin:4px 0;display:block"></div><div><br></div>`;
        // Restore focus to editor before inserting (FileReader is async)
        el.focus();
        document.execCommand('insertHTML', false, imgHtml);
      };
      reader.readAsDataURL(blob);
      return; // image handled — skip text branches below
    }
    // ── END IMAGE HANDLING ───────────────────────────────────────────

    // Prefer HTML from clipboard; fall back to plain text
    let html = cd.getData('text/html');
    if(html){
      // Strip Word/Outlook cruft but keep semantic tags
      html = _sanitizeDescHTML(html);
      document.execCommand('insertHTML', false, html);
    } else {
      const text = cd.getData('text/plain') || '';
      // Convert plain-text line-breaks to <br> so spacing is preserved
      const escaped = text
        .replace(/&/g,'&amp;')
        .replace(/</g,'&lt;')
        .replace(/>/g,'&gt;')
        .replace(/\n/g,'<br>');
      document.execCommand('insertHTML', false, escaped);
    }
  });
}

// Light HTML sanitizer - keeps formatting tags, strips scripts/style/meta.
// Applied both when content is pasted into the editor AND wherever stored
// description/comment HTML is rendered (_descHydrate, _initDescEditor,
// _setDescValue, comment display) - the render side can't assume its input
// was ever sanitized, since the same data can be written directly to the
// database independently of this editor's paste handler.
function _sanitizeDescHTML(html){
  if(!html) return '';
  // Remove <html>, <head>, <body> wrappers that Word/Outlook paste includes
  html = html.replace(/<html[^>]*>|<\/html>/gi,'')
             .replace(/<head[\s\S]*?<\/head>/gi,'')
             .replace(/<body[^>]*>|<\/body>/gi,'')
             .replace(/<meta[^>]*>/gi,'')
             .replace(/<link[^>]*>/gi,'')
             .replace(/<style[\s\S]*?<\/style>/gi,'')
             .replace(/<script[\s\S]*?<\/script>/gi,'')
             .replace(/<!--[\s\S]*?-->/g,'')
             // FIX: remove img tags with no src or non-renderable src (cid:, file:, etc.)
             // These show as "[pasted image]" alt text which is misleading and undesirable.
             // Only keep <img> whose src starts with http/https or data: (inline base64).
             .replace(/<img[^>]*>/gi, m => {
               const srcMatch = m.match(/\bsrc\s*=\s*["']([^"']*)["']/i);
               if(!srcMatch) return ''; // no src - remove
               const src = srcMatch[1].trim();
               if(/^(https?:|data:)/i.test(src)) return m; // valid - keep
               return ''; // cid:, file:, blob: without object URL, etc. - remove
             })
             // FIX (was the XSS hole): any tag OTHER than a/img that isn't on the
             // formatting allowlist used to pass through completely unchanged,
             // attributes included, so <svg onload=...>, <details ontoggle=...>,
             // <iframe>, <form>, <video> etc. survived and could execute. Unsafe
             // tags are now dropped entirely (opening AND closing); their inner
             // text content is left in place, which is harmless.
             .replace(/<\/?((?!a\b|img\b)[a-zA-Z0-9]+)\b[^>]*>/gi, (m,tag)=>{
               const safeTags = /^(b|i|u|strong|em|br|p|ul|ol|li|table|thead|tbody|tr|th|td|h[1-6]|span|div|blockquote|pre|code|sub|sup)$/i;
               if(!safeTags.test(tag)) return ''; // unknown/unsafe tag - drop entirely
               const isClosing = m.charAt(1)==='/';
               return isClosing ? `</${tag}>` : `<${tag}>`; // keep bare, strip all attributes
             })
             .replace(/(<a[^>]*?) (?:class|id|style|on\w+)="[^"]*"/gi,'$1')
             .replace(/(<img[^>]*?) (?:class|id|style|on\w+)="[^"]*"/gi,'$1')
             // FIX: a javascript:/vbscript: URI in <a href> executed on click and
             // was never blocked - neutralise any non-http(s)/mailto/tel scheme.
             // Decode numeric/&amp; entities within the href value first (e.g.
             // "jav&#97;script:") - otherwise the scheme check can be trivially
             // bypassed by HTML-entity-encoding part of the scheme name.
             .replace(/(<a[^>]*?\shref\s*=\s*)(["'])([^"']*)\2/gi, (m,pre,q,val)=>{
               const decoded = val
                 .replace(/&#x([0-9a-f]+);/gi,(_,h)=>String.fromCharCode(parseInt(h,16)))
                 .replace(/&#(\d+);/g,(_,d)=>String.fromCharCode(parseInt(d,10)))
                 .replace(/&amp;/gi,'&')
                 .replace(/[\x00-\x20]+/g,'')
                 .toLowerCase();
               const hasScheme = /^[a-z][a-z0-9+.-]*:/.test(decoded);
               const safe = !hasScheme || /^(https?:|mailto:|tel:)/.test(decoded);
               return safe ? m : (pre+q+'#'+q);
             })
             .trim();
  return html;
}

// Read description value from a desc-editor contenteditable div
function _getDescValue(id){
  const el = document.getElementById(id);
  if(!el) return '';
  // Return innerHTML so formatting is preserved in storage
  const html = el.innerHTML || '';
  // If it's just whitespace / empty divs AND has no embedded media (e.g. images),
  // treat as empty. Stripping tags alone would also wipe out image-only content
  // (e.g. a pasted screenshot with no caption), incorrectly discarding it.
  const hasText = !!html.replace(/<[^>]+>/g,'').trim();
  const hasMedia = /<img[\s>]/i.test(html);
  if(!hasText && !hasMedia) return '';
  // Sanitize on save too (not just on paste) - covers any HTML that reached
  // the editor's DOM by a path other than the paste handler.
  return _sanitizeDescHTML(html);
}

// Set description HTML into a desc-editor after creation (for edit modals)
function _setDescValue(id, html){
  const el = document.getElementById(id);
  if(!el) return;
  el.innerHTML = _sanitizeDescHTML(html || '');
}
// ─────────────────────────────────────────────────────────────────────────────

// ══════════════════════════════════════════════════════════════════
//  DESCRIPTION SYSTEM — Task & Subtask  (Phase 2: Descriptions Decoupled)
//  Storage: sprintflow/taskDescriptions/{taskId}           ← task description
//           sprintflow/taskDescriptions/{taskId}/_subtasks/{subtaskId} ← subtask description
//  Each document: { html, updatedAt, updatedBy }
//  Tasks store ONLY metadata: descriptionPreview, descriptionUpdatedAt, descriptionUpdatedBy
//  Descriptions are loaded ON-DEMAND only when a modal opens.
//  Session cache (_descCache) prevents repeat Firebase reads in the same session.
//  Silent migration: legacy task.description is migrated on first modal open.
//  Rollback: _descRollbackTask(taskId) restores embedded description for a single task.
// ══════════════════════════════════════════════════════════════════

// ── Session description cache ─────────────────────────────────────
// Structure: _descCache[taskId] = { _task: '<html>', _sub_<subtaskId>: '<html>' }
const _descCache = {};

// ── Firebase path helpers ─────────────────────────────────────────
function _descTaskFbPath(taskId){ return `sprintflow/taskDescriptions/${taskId}`; }
function _descSubFbPath(taskId, subtaskId){ return `sprintflow/taskDescriptions/${taskId}/_subtasks/${subtaskId}`; }
function _descFbPath(taskId, subtaskId){ return subtaskId ? _descSubFbPath(taskId, subtaskId) : _descTaskFbPath(taskId); }

// ── Cache key helpers ─────────────────────────────────────────────
function _descCacheKey(subtaskId){ return subtaskId ? `_sub_${subtaskId}` : '_task'; }

// ══════════════════════════════════════════════════════════════════
//  PHASE 2 — IMAGE COMPRESSION
//  Compresses embedded images in HTML at save time only.
//  Never runs during paste / typing / rendering / loading.
//  Kill switch: window._DISABLE_IMG_COMPRESSION = true
// ══════════════════════════════════════════════════════════════════

// Global kill switch — set to true in console for instant rollback
window._DISABLE_IMG_COMPRESSION = false;

// ── Compress a single data-URI image via canvas ───────────────────
// Returns compressed data-URI, or original if compression fails or
// would produce a larger result.
// Skips SVG (vector — canvas rasterisation would destroy quality).
function _compressSingleImage(src){
  return new Promise(function(resolve){
    // Skip SVG — never rasterise vector graphics
    if(src.indexOf('data:image/svg+xml') === 0){ resolve(src); return; }
    // Skip non-data URIs
    if(src.indexOf('data:image/') !== 0){ resolve(src); return; }
    try {
      const img = new Image();
      img.onload = function(){
        try {
          const MAX_W = 1600;
          let w = img.naturalWidth;
          let h = img.naturalHeight;
          // Resize only when wider than 1600px; preserve aspect ratio
          if(w > MAX_W){
            h = Math.round(h * MAX_W / w);
            w = MAX_W;
          }
          const canvas = document.createElement('canvas');
          canvas.width  = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          const compressed = canvas.toDataURL('image/jpeg', 0.8);
          // Never replace with a larger result — keep original if so
          if(compressed.length >= src.length){
            resolve(src);
          } else {
            resolve(compressed);
          }
        } catch(e){
          console.warn('[ImgCompress] canvas error — keeping original:', e);
          resolve(src); // failsafe: keep original
        }
      };
      img.onerror = function(){
        console.warn('[ImgCompress] image load error — keeping original');
        resolve(src); // failsafe: keep original
      };
      img.src = src;
    } catch(e){
      console.warn('[ImgCompress] unexpected error — keeping original:', e);
      resolve(src); // failsafe: keep original
    }
  });
}

// ── Compress all embedded images in an HTML string ────────────────
// Processes images sequentially; any individual failure keeps original.
// Returns original html untouched if kill switch is active.
async function _compressImagesInHtml(html){
  if(!html) return html;
  if(window._DISABLE_IMG_COMPRESSION){ return html; }
  try {
    // Match all src="data:image/..." attributes
    const imgRegex = /(<img[^>]*\ssrc=["'])(data:image\/[^"']+)(["'][^>]*>)/gi;
    // Collect all matches first so we can process in parallel if desired;
    // sequential here for predictable memory use on large payloads.
    const matches = [];
    let m;
    const re = new RegExp(imgRegex.source, 'gi');
    while((m = re.exec(html)) !== null){
      matches.push({ full: m[0], pre: m[1], src: m[2], post: m[3], index: m.index });
    }
    if(!matches.length) return html;

    // Compress each image; build replacement map
    const replacements = new Map();
    for(const match of matches){
      if(replacements.has(match.src)) continue; // deduplicate identical images
      const compressed = await _compressSingleImage(match.src);
      replacements.set(match.src, compressed);
    }

    // Replace in html string
    const result = html.replace(/(<img[^>]*\ssrc=["'])(data:image\/[^"']+)(["'][^>]*>)/gi,
      function(full, pre, src, post){
        const c = replacements.get(src);
        return c ? (pre + c + post) : full;
      }
    );
    return result;
  } catch(e){
    console.warn('[ImgCompress] _compressImagesInHtml error — returning original:', e);
    return html; // failsafe: return original html untouched
  }
}

// ── Generate a short plaintext preview from HTML ─────────────────
function _descGeneratePreview(html, maxLen=120){
  if(!html) return '';
  // Strip tags, collapse whitespace, truncate
  const text = html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
}

// ── Low-level Firebase read → returns html string ('' if missing) ─
async function _descFirebaseRead(taskId, subtaskId){
  try {
    if(!FirebaseDB.isReady()) return '';
    const _get = window._rtGet;
    const refFn = FirebaseDB.getRef();
    const db    = FirebaseDB.getDb();
    if(!_get || !refFn || !db) return '';
    const snap = await _get(refFn(db, _descFbPath(taskId, subtaskId)));
    if(!snap || !snap.exists()) return '';
    const val = snap.val();
    if(!val || typeof val.html !== 'string') return '';
    return val.html;
  } catch(e){
    console.warn('[Desc] Firebase read error:', e);
    return '';
  }
}

// ── Load description: cache-first, Firebase fallback, then migrate ─
async function _descLoad(taskId, subtaskId){
  if(!taskId) return '';
  const bucket = _descCache[taskId] || (_descCache[taskId] = {});
  const key    = _descCacheKey(subtaskId);

  // ── Cache hit ──
  if(key in bucket) return bucket[key];

  // ── Firebase read ──
  let html = await _descFirebaseRead(taskId, subtaskId);

  // ── Silent migration: if no Firebase description, check legacy embedded field ──
  if(!html){
    const task = getTask(taskId);
    if(task){
      let legacyHtml = '';
      if(!subtaskId){
        legacyHtml = task.description || '';
      } else {
        const sub = (task.subtasks||[]).find(s=>s.id===subtaskId);
        legacyHtml = (sub && sub.description) || '';
      }
      if(legacyHtml){
        // Migrate to new path (idempotent — we only arrive here if path was empty)
        await _descMigrateLegacy(taskId, subtaskId, task, legacyHtml);
        html = legacyHtml;
      }
    }
  }

  bucket[key] = html;
  return html;
}

// ── Silent migration: write legacy embedded description → taskDescriptions ─
// Idempotent: only called when taskDescriptions path is empty for this task/subtask.
async function _descMigrateLegacy(taskId, subtaskId, task, legacyHtml){
  try {
    if(!FirebaseDB.isReady()) return;
    const refFn = FirebaseDB.getRef();
    const db    = FirebaseDB.getDb();
    const _get  = window._rtGet;
    const _set  = window._rtSet;
    if(!refFn || !db || !_set) return;

    // Double-check guard: re-read to ensure we're not overwriting existing data
    const checkSnap = await (_get ? _get(refFn(db, _descFbPath(taskId, subtaskId))) : Promise.resolve({exists:()=>false}));
    if(checkSnap && checkSnap.exists()) return; // already migrated — bail

    const cu = state.currentUser;
    const updatedBy = cu ? (cu.name || cu.email || '') : '';
    const payload = { html: legacyHtml, updatedAt: _now(), updatedBy };

    await _set(refFn(db, _descFbPath(taskId, subtaskId)), payload);

    // Update task metadata
    await _descUpdateMetadata(taskId, subtaskId, legacyHtml, updatedBy, _now());

    // Remove embedded description from task/subtask document in Firebase
    if(!subtaskId){
      if(window._rtUpdate){
        await window._rtUpdate(refFn(db, `sprintflow/tasks/${taskId}`), { description: null });
      }
      if(task.description !== undefined) delete task.description;
    } else {
      const sub = (task.subtasks||[]).find(s=>s.id===subtaskId);
      if(sub && sub.description !== undefined){
        delete sub.description;
        FirebaseDB.saveEntity('tasks', task).catch(e=>console.warn('[Desc] migrate subtask clear error:', e));
      }
    }
    console.info(`[Desc] Migrated legacy description for task ${taskId}${subtaskId?' subtask '+subtaskId:''}`);
  } catch(e){
    console.warn('[Desc] Migration error (non-fatal):', e);
  }
}

// ── Save a description to Firebase (taskDescriptions path only) ───
async function _descFirebaseSave(taskId, subtaskId, html, updatedBy){
  try {
    if(!FirebaseDB.isReady()) return false;
    const refFn = FirebaseDB.getRef();
    const db    = FirebaseDB.getDb();
    const _set  = window._rtSet;
    if(!refFn || !db || !_set) return false;
    const payload = { html, updatedAt: _now(), updatedBy };
    await _set(refFn(db, _descFbPath(taskId, subtaskId)), payload);
    return true;
  } catch(e){
    console.warn('[Desc] Firebase save error:', e);
    return false;
  }
}

// ── Save description: called from saveTask / saveSubtask ──────────
// Writes to taskDescriptions; updates task metadata; does NOT resave full task.
async function _descSave(taskId, subtaskId, html){
  if(!taskId) return;
  const cu = state.currentUser;
  const updatedBy = cu ? (cu.name || cu.email || '') : '';
  const ts = _now();

  // ── Phase 2: compress images before persistence (never blocks save) ──
  const htmlToSave = await _compressImagesInHtml(html);

  // Update session cache with compressed html
  const bucket = _descCache[taskId] || (_descCache[taskId] = {});
  bucket[_descCacheKey(subtaskId)] = htmlToSave;

  // Write to Firebase taskDescriptions path (non-blocking)
  _descFirebaseSave(taskId, subtaskId, htmlToSave, updatedBy)
    .catch(e=>console.warn('[Desc] _descSave error:', e));

  // Update lightweight metadata on the task document
  await _descUpdateMetadata(taskId, subtaskId, htmlToSave, updatedBy, ts);

  // ── Phase 3: update payload diagnostics metadata (admin-only, non-blocking) ──
  // Delayed 350ms so this updateEntity patch always fires AFTER DebounceWrite's
  // saveEntity (300ms delay) completes its full document replace — preventing
  // the stale snapshot from overwriting the correct payloadSize/imageCount values.
  setTimeout(()=>_payloadUpdateMetadata(taskId).catch(()=>{}), 350);
}

// ── Update lightweight description metadata on the task document ──
// Patches only: descriptionPreview, descriptionUpdatedAt, descriptionUpdatedBy, updatedAt
async function _descUpdateMetadata(taskId, subtaskId, html, updatedBy, ts){
  try {
    const task = getTask(taskId);
    if(!task) return;
    // Only track metadata at the task level (not per-subtask)
    if(subtaskId) return;
    const preview = _descGeneratePreview(html);
    const meta = {
      descriptionPreview   : preview,
      descriptionUpdatedAt : ts,
      descriptionUpdatedBy : updatedBy,
    };
    Object.assign(task, meta);
    // Persist ONLY the metadata patch — never resave the full task here
    FirebaseDB.updateEntity('tasks', taskId, meta)
      .catch(e=>console.warn('[Desc] metadata update error:', e));
  } catch(e){ console.warn('[Desc] _descUpdateMetadata error:', e); }
}

// ── Invalidate session cache for a task (and optionally subtask) ──
function _descInvalidate(taskId, subtaskId){
  const bucket = _descCache[taskId];
  if(!bucket) return;
  delete bucket[_descCacheKey(subtaskId)];
}

// ── Rollback helper (console-callable for emergency reversal) ─────
// Usage: _descRollbackTask('task-id') from browser console
async function _descRollbackTask(taskId){
  try {
    console.info('[Desc] Rolling back task', taskId);
    const task = getTask(taskId);
    if(!task){ console.warn('[Desc] rollback: task not found'); return; }
    const html = await _descFirebaseRead(taskId, '');
    if(!html){ console.info('[Desc] rollback: no description to roll back'); return; }
    task.description = html;
    // Restore legacy metadata fields removal
    delete task.descriptionPreview;
    delete task.descriptionUpdatedAt;
    delete task.descriptionUpdatedBy;
    await FirebaseDB.saveEntity('tasks', task);
    console.info('[Desc] rollback complete — embedded description restored for task', taskId);
  } catch(e){ console.error('[Desc] rollback error:', e); }
}
window._descRollbackTask = _descRollbackTask; // expose for console use

// ══════════════════════════════════════════════════════════════════
//  PHASE 3 — PAYLOAD DIAGNOSTICS
//  Admin-only. Stores lightweight metadata on the task document.
//  Fields: payloadSize, payloadBreakdown, imageCount,
//          largestImageSize, payloadLastUpdated
//  These fields are NEVER used by Dashboard / Reports / Notifications
//  / Search / Realtime Sync. Diagnostics only.
//  Reads from in-session cache — no extra Firebase reads.
// ══════════════════════════════════════════════════════════════════

// ── Count embedded data-URI images in an HTML string ─────────────
function _payloadCountImages(html){
  if(!html) return 0;
  const m = html.match(/<img[^>]+src=["']data:image\/[^"']+["'][^>]*>/gi);
  return m ? m.length : 0;
}

// ── Find byte-length of the largest embedded data-URI src ─────────
function _payloadLargestImage(html){
  if(!html) return 0;
  let max = 0;
  const re = /src=["'](data:image\/[^"']+)["']/gi;
  let m;
  while((m = re.exec(html)) !== null){
    if(m[1].length > max) max = m[1].length;
  }
  return max;
}

// ── Collect all cached description HTML for a task ────────────────
// Returns { taskDesc, subtaskDescs[] }
function _payloadGetDescHtml(taskId){
  const bucket = _descCache[taskId];
  if(!bucket) return { taskDesc: '', subtaskDescs: [] };
  const taskDesc = bucket['_task'] || '';
  const subtaskDescs = Object.entries(bucket)
    .filter(([k]) => k !== '_task')
    .map(([,v]) => v || '');
  return { taskDesc, subtaskDescs };
}

// ── Collect all cached comment content for a task ─────────────────
// Returns combined string of all comment content
function _payloadGetCommentText(taskId){
  const bucket = _cmCache[taskId];
  if(!bucket) return '';
  return Object.values(bucket)
    .flat()
    .map(c => (c && c.content) ? c.content : '')
    .join('');
}

// ── Compute and persist payload metadata for a single task ────────
// Non-blocking. Called after description or comment saves.
// Uses in-session cache only — never fetches from Firebase.
// ── Compute payload fields from in-session cache (no Firebase reads) ─
// Returns flat meta object. payloadBreakdown is in-memory only — NOT persisted.
// Persisted fields: payloadSize, imageCount, largestImageSize, payloadLastUpdated
// (4 scalar fields; no nested objects ever written to Firebase)
function _payloadComputeMeta(taskId){
  try {
    const task = getTask(taskId);
    if(!task) return null;

    const taskSize = JSON.stringify(task).length;

    const { taskDesc, subtaskDescs } = _payloadGetDescHtml(taskId);
    const allDescHtml = taskDesc + subtaskDescs.join('');
    const descriptionSize = allDescHtml.length;

    const commentText = _payloadGetCommentText(taskId);
    const commentSize = commentText.length;

    const payloadSize = taskSize + descriptionSize + commentSize;

    const allContent = allDescHtml + commentText;
    const imageCount       = _payloadCountImages(allContent);
    const largestImageSize = _payloadLargestImage(allContent);

    // In-memory only — for UI display; never written to Firebase
    const payloadBreakdown = { task: taskSize, description: descriptionSize, comments: commentSize };

    return { payloadSize, imageCount, largestImageSize, payloadLastUpdated: _now(), payloadBreakdown };
  } catch(e){
    console.warn('[Payload] _payloadComputeMeta error:', e);
    return null;
  }
}

// ── Standalone payload metadata write (used by _descSave) ─────────
// _cmSubmit and _cmSaveEdit call _payloadComputeMeta directly and
// merge the payload fields into their own single patch (1 write total).
async function _payloadUpdateMetadata(taskId){
  try {
    const task = getTask(taskId);
    if(!task) return;
    const meta = _payloadComputeMeta(taskId);
    if(!meta) return;
    // Apply all fields in-memory (breakdown included for UI)
    Object.assign(task, meta);
    // Persist only the 4 scalar fields — strip the in-memory breakdown object
    const { payloadBreakdown: _omit, ...persistMeta } = meta;
    FirebaseDB.updateEntity('tasks', taskId, persistMeta)
      .catch(e => console.warn('[Payload] metadata update error:', e));
  } catch(e){ console.warn('[Payload] _payloadUpdateMetadata error:', e); }
}

// ── Format bytes for display ──────────────────────────────────────
function _payloadFmtBytes(bytes){
  if(!bytes || bytes === 0) return '0 B';
  if(bytes < 1024)          return bytes + ' B';
  if(bytes < 1024*1024)     return (bytes/1024).toFixed(1) + ' KB';
  return (bytes/(1024*1024)).toFixed(2) + ' MB';
}

// ── Payload size colour indicator ────────────────────────────────
function _payloadColor(bytes){
  if(bytes < 100*1024)          return '#22c55e'; // green  < 100 KB
  if(bytes < 500*1024)          return '#eab308'; // yellow 100 KB–500 KB
  if(bytes < 1024*1024)         return '#f97316'; // orange 500 KB–1 MB
  return '#ef4444';                               // red    > 1 MB
}

// ── Render Payload Analysis section (Admin only) ──────────────────
function _renderPayloadAnalysis(){
  const el = document.getElementById('payload-analysis-section');
  if(!el) return;
  // Admin only
  if(!RBAC.isAdmin()){ el.style.display='none'; return; }
  el.style.display = 'block';

  const tasks = (state.tasks || []);
  if(!tasks.length){
    el.innerHTML = `<div class="settings-section" style="margin-top:20px">
      <div class="settings-header">📊 Payload Analysis</div>
      <div class="settings-row" style="justify-content:center;color:var(--text-tertiary);font-size:13px">No tasks found.</div>
    </div>`;
    return;
  }

  // Tasks with payload metadata, sorted largest first
  const rows = tasks
    .filter(t => typeof t.payloadSize === 'number')
    .sort((a,b) => (b.payloadSize||0) - (a.payloadSize||0));

  // Summary stats
  const totalAnalysed  = rows.length;
  const over500k       = rows.filter(t => t.payloadSize >= 500*1024).length;
  const over1m         = rows.filter(t => t.payloadSize >= 1024*1024).length;
  const largest        = rows[0] ? rows[0].payloadSize : 0;
  const avg            = totalAnalysed
    ? Math.round(rows.reduce((s,t)=>s+(t.payloadSize||0),0) / totalAnalysed)
    : 0;

  // Summary cards
  const summaryHtml = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:18px">
      ${[
        ['Tasks Analysed',  totalAnalysed, ''],
        ['Tasks > 500 KB',  over500k,      over500k  ? '#f97316':''],
        ['Tasks > 1 MB',    over1m,        over1m    ? '#ef4444':''],
        ['Largest Payload', _payloadFmtBytes(largest), largest >= 1024*1024 ? '#ef4444' : largest >= 500*1024 ? '#f97316':''],
        ['Avg Payload',     _payloadFmtBytes(avg),     ''],
      ].map(([label, val, col])=>`
        <div style="background:var(--bg-card,#fff);border:1px solid rgba(0,0,0,0.07);border-radius:var(--r-lg,8px);padding:12px 14px">
          <div style="font-size:11px;color:var(--text-tertiary);margin-bottom:4px">${label}</div>
          <div style="font-size:17px;font-weight:700;color:${col||'var(--text-primary)'}">${val}</div>
        </div>`).join('')}
    </div>`;

  // Table rows
  const tableRowsHtml = rows.length ? rows.map(t => {
    const proj    = getProject(t.project);
    const projName = proj ? _esc(proj.name) : '—';
    const bd      = t.payloadBreakdown || {};
    const color   = _payloadColor(t.payloadSize);
    const dot     = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px;flex-shrink:0"></span>`;
    const updated = t.payloadLastUpdated
      ? new Date(t.payloadLastUpdated).toLocaleDateString()
      : '—';
    return `<tr>
      <td style="padding:8px 10px;font-size:12.5px;font-weight:600;color:var(--text-primary);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${_esc(t.title)}">${_esc(t.title)}</td>
      <td style="padding:8px 10px;font-size:12px;color:var(--text-secondary)">${projName}</td>
      <td style="padding:8px 10px;font-size:12.5px;font-weight:700;white-space:nowrap">
        <span style="display:inline-flex;align-items:center;color:${color}">${dot}${_payloadFmtBytes(t.payloadSize)}</span>
        <div style="font-size:10.5px;color:var(--text-tertiary);margin-top:2px;display:flex;gap:10px">
          <span>Task: ${_payloadFmtBytes(bd.task||0)}</span>
          <span>Desc: ${_payloadFmtBytes(bd.description||0)}</span>
          <span>Comments: ${_payloadFmtBytes(bd.comments||0)}</span>
        </div>
      </td>
      <td style="padding:8px 10px;font-size:12.5px;text-align:center;color:var(--text-secondary)">${t.imageCount||0}</td>
      <td style="padding:8px 10px;font-size:12.5px;color:var(--text-secondary)">${_payloadFmtBytes(t.largestImageSize||0)}</td>
      <td style="padding:8px 10px;font-size:12px;color:var(--text-tertiary)">${updated}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="6" style="padding:20px;text-align:center;color:var(--text-tertiary);font-size:13px">
    No payload data yet — open and save tasks to populate diagnostics.
  </td></tr>`;

  el.innerHTML = `
    <div class="settings-section" style="margin-top:20px">
      <div class="settings-header" style="margin-bottom:14px">📊 Payload Analysis
        <span style="font-size:11px;font-weight:400;color:var(--text-tertiary);margin-left:8px">Admin only · populated when tasks are saved</span>
      </div>
      ${summaryHtml}
      <div style="overflow:auto;max-height:420px;border:1px solid rgba(0,0,0,0.06);border-radius:var(--r-md,6px)">
        <table style="width:100%;border-collapse:collapse;font-size:12.5px">
          <thead>
            <tr style="border-bottom:1px solid rgba(0,0,0,0.07);position:sticky;top:0;background:var(--bg-card,#fff);z-index:1;box-shadow:0 1px 0 rgba(0,0,0,0.07)">
              <th style="padding:7px 10px;text-align:left;font-size:11px;font-weight:600;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.04em">Task</th>
              <th style="padding:7px 10px;text-align:left;font-size:11px;font-weight:600;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.04em">Project</th>
              <th style="padding:7px 10px;text-align:left;font-size:11px;font-weight:600;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.04em">Payload Size</th>
              <th style="padding:7px 10px;text-align:center;font-size:11px;font-weight:600;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.04em">Images</th>
              <th style="padding:7px 10px;text-align:left;font-size:11px;font-weight:600;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.04em">Largest Image</th>
              <th style="padding:7px 10px;text-align:left;font-size:11px;font-weight:600;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.04em">Last Updated</th>
            </tr>
          </thead>
          <tbody style="divide-y:rgba(0,0,0,0.04)">
            ${tableRowsHtml}
          </tbody>
        </table>
      </div>
      <div style="margin-top:10px;font-size:11px;color:var(--text-tertiary)">
        Payload = task document + description + all comments. Images counted across description and comments.
      </div>
    </div>`;
}

// ── Load description and hydrate the placeholder in place ─────────
// Called after modal HTML is in the DOM (openTaskModal / openSubtaskModal).
async function _descHydrate(taskId, subtaskId){
  const html = await _descLoad(taskId, subtaskId||'');
  // Determine which element id to update
  const elId = subtaskId ? 'subtask-modal-desc-view' : 'task-modal-desc-view';
  const el = document.getElementById(elId);
  if(!el) return; // modal closed before load finished
  el.innerHTML = html ? _sanitizeDescHTML(html) : '<span style="color:var(--text-muted)">No description provided.</span>';
}

