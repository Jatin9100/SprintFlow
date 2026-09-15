// ─── MODALS ────────────────────────────────────────────────────────
let _modalOpen = false;
let _modalCloseTimer = null;

function _modalEnsureVisible(overlay, box, html){
  // Cancel any in-flight close animation/timer so we don't hide a freshly opened modal
  if(_modalCloseTimer !== null){
    clearTimeout(_modalCloseTimer);
    _modalCloseTimer = null;
  }
  box.innerHTML = html;
  box.scrollTop = 0; // new content may be shorter than whatever was scrolled before (e.g. Task modal → Subtask modal)
  overlay.style.display = 'flex';
  // Force reflow so CSS transition plays
  overlay.offsetHeight;
  overlay.classList.add('modal-visible');
  document.body.classList.add('modal-open');
  _modalOpen = true;
  // AI features: any freshly-inserted .ai-only button (description "Improve
  // wording", etc.) starts hidden by default in its own markup — re-apply
  // current visibility state now that it actually exists in the DOM.
  if(typeof _updateAiFeatureVisibility==='function') _updateAiFeatureVisibility();
}

function openModal(html){
  const overlay = document.getElementById('modal');
  const box = document.getElementById('modal-box');
  if(!overlay || !box) return;
  // If already open, replace content in-place (no animation stutter)
  if(_modalOpen){
    box.innerHTML = html;
    box.scrollTop = 0;
    if(typeof _updateAiFeatureVisibility==='function') _updateAiFeatureVisibility();
    return;
  }
  _modalEnsureVisible(overlay, box, html);
}

// replaceModal: always swaps content even when another modal is open.
// Use for modal-to-modal navigation (subtask → edit → back).
function replaceModal(html){
  const overlay = document.getElementById('modal');
  const box = document.getElementById('modal-box');
  if(!overlay || !box) return;
  _modalEnsureVisible(overlay, box, html);
}

function closeModal(){
  const overlay = document.getElementById('modal');
  // Always reset scroll lock regardless of overlay state
  document.body.classList.remove('modal-open');
  _modalOpen = false;
  if(!overlay) return;
  overlay.classList.remove('modal-visible');
  // Wait for CSS transition before hiding and clearing content
  const box = document.getElementById('modal-box');
  const delay = window.innerWidth <= 640 ? 240 : 200;
  _modalCloseTimer = setTimeout(()=>{
    _modalCloseTimer = null;
    // Guard: don't wipe content if modal was re-opened during the delay
    if(!_modalOpen){
      overlay.style.display = 'none';
      if(box){ box.innerHTML = ''; box.classList.remove('modal-fullscreen'); }
    }
  }, delay);
}

// ── Modal fullscreen toggle (view-only enhancement for Task/Subtask view modals) ──
// State lives as a class on #modal-box itself, so it survives openModal()/replaceModal()
// content swaps (e.g. Task view → Subtask view → back), since those only replace innerHTML.
function _isModalFullscreen(){
  const box = document.getElementById('modal-box');
  return !!(box && box.classList.contains('modal-fullscreen'));
}
function _modalFullscreenIconHtml(isFull){
  return isFull
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>'
    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
}
function _modalFullscreenBtnHtml(){
  const isFull = _isModalFullscreen();
  return `<button id="modal-fullscreen-btn" onclick="toggleModalFullscreen()" class="text-slate-400 hover:text-slate-700 transition-colors" title="${isFull?'Exit full screen':'Full screen'}" style="margin-right:8px;display:flex;align-items:center;background:none;border:none;cursor:pointer;padding:0">${_modalFullscreenIconHtml(isFull)}</button>`;
}
function toggleModalFullscreen(){
  const box = document.getElementById('modal-box');
  if(!box) return;
  const isFull = box.classList.toggle('modal-fullscreen');
  const btn = document.getElementById('modal-fullscreen-btn');
  if(btn){
    btn.title = isFull ? 'Exit full screen' : 'Full screen';
    btn.innerHTML = _modalFullscreenIconHtml(isFull);
  }
}

// FIX: outside-click-to-close was removed — an accidental click or drag past
// the edge of the modal box (landing on the backdrop) silently closed the
// Task/Subtask create/edit modal and discarded unsaved input, with no
// confirmation. Every modal already has an explicit X button and a Cancel
// button, and Escape still closes it (see the unified keydown handler
// below), so closing is still always one deliberate action away.

// ── UNIFIED ESC HANDLER — single listener, no duplicates ──
// Handles: modal close, search dropdown close, rpt filter panel close
// Listener Protected: guarded by _sfKeydownAttached flag
(function(){
  if(window._sfKeydownAttached) return;
  window._sfKeydownAttached = true;
  function _globalKeydownHandler(e){
    if(e.key !== 'Escape') return;
    // 1. Close modal
    if(_modalOpen){ closeModal(); return; }
    // 2. Close search dropdown
    const dd = document.getElementById('search-dropdown');
    if(dd && dd.style.display !== 'none'){
      const inp = document.getElementById('global-search');
      if(inp){ inp.value = ''; inp.blur(); }
      const clearBtn = document.getElementById('search-clear-btn');
      if(clearBtn) clearBtn.style.display = 'none';
      closeSearchDropdown();
      return;
    }
    // 3. Close rpt advanced filter panel
    const panel = document.getElementById('rpt-adv-filter-panel');
    if(panel && panel.style.display !== 'none'){
      panel.style.display = 'none';
    }
  }
  document.addEventListener('keydown', _globalKeydownHandler);
})();

// ─── TASK MODAL ──────────────────────────────────────────────────

// ── Deep-link sharing ─────────────────────────────────────────────
// Link format:
//   Task:    ?task=<taskId>
//   Subtask: ?subtask=<parentId>:<subtaskId>
function shareTaskLink(taskId){
  const base=location.href.split('?')[0];
  const url=base+'?task='+encodeURIComponent(taskId);
  _copyShareLink(url);
}
function shareSubtaskLink(parentId,subtaskId){
  const base=location.href.split('?')[0];
  const url=base+'?subtask='+encodeURIComponent(parentId)+':'+encodeURIComponent(subtaskId);
  _copyShareLink(url);
}
function _copyShareLink(url){
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(url).then(()=>showNotif('Link copied to clipboard ✓')).catch(()=>_copyShareLinkFallback(url));
  } else {
    _copyShareLinkFallback(url);
  }
}
function _copyShareLinkFallback(url){
  try{
    const ta=document.createElement('textarea');
    ta.value=url; ta.style.position='fixed'; ta.style.opacity='0';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showNotif('Link copied to clipboard ✓');
  }catch(e){ showNotif('Copy failed — link: '+url,'error'); }
}

// ── Deep-link resolution — called after login + data load ─────────
// Reads ?task= or ?subtask= from the URL (or from sessionStorage when
// the user arrived logged-out), validates RBAC, then opens the modal.
const _DEEP_LINK_KEY='sf_pending_deep_link';
function _resolveDeepLink(){
  let search=window.location.search;
  try{
    const stored=sessionStorage.getItem(_DEEP_LINK_KEY);
    if(stored){ search=stored; sessionStorage.removeItem(_DEEP_LINK_KEY); }
  }catch(e){}
  if(!search) return;
  const params=new URLSearchParams(search);

  const taskParam=params.get('task');
  if(taskParam){
    const t=getTask(taskParam);
    if(!t){ showNotif('Access denied or item not found.','error'); _cleanDeepLinkParam(); return; }
    const visibleIds=new Set(RBAC.getVisibleProjects().map(p=>p.id));
    if(!visibleIds.has(t.project)){ showNotif('Access denied or item not found.','error'); _cleanDeepLinkParam(); return; }
    _cleanDeepLinkParam();
    openTaskModal(taskParam);
    return;
  }

  const subParam=params.get('subtask');
  if(subParam){
    const parts=subParam.split(':');
    if(parts.length<2){ _cleanDeepLinkParam(); return; }
    const parentId=decodeURIComponent(parts[0]);
    const subtaskId=decodeURIComponent(parts[1]);
    const parent=getTask(parentId);
    if(!parent){ showNotif('Access denied or item not found.','error'); _cleanDeepLinkParam(); return; }
    const visibleIds=new Set(RBAC.getVisibleProjects().map(p=>p.id));
    if(!visibleIds.has(parent.project)){ showNotif('Access denied or item not found.','error'); _cleanDeepLinkParam(); return; }
    const sub=(parent.subtasks||[]).find(s=>s.id===subtaskId);
    if(!sub){ showNotif('Access denied or item not found.','error'); _cleanDeepLinkParam(); return; }
    _cleanDeepLinkParam();
    openTaskModal(parentId);
    setTimeout(()=>openSubtaskModal(parentId,subtaskId),120);
    return;
  }
}
function _cleanDeepLinkParam(){
  try{
    const url=new URL(window.location.href);
    url.searchParams.delete('task');
    url.searchParams.delete('subtask');
    window.history.replaceState({},'',url.toString());
  }catch(e){}
}
function _stashDeepLinkIfNeeded(){
  if(!window.location.search) return;
  const params=new URLSearchParams(window.location.search);
  if(params.has('task')||params.has('subtask')){
    try{ sessionStorage.setItem(_DEEP_LINK_KEY,window.location.search); }catch(e){}
  }
}
// ── End deep-link sharing ──────────────────────────────────────────

