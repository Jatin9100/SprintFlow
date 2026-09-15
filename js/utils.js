// ─── MEMOIZATION & DOM CACHE ─────────────────────────────────────
// Lightweight DOM element cache — avoids repeated querySelector calls
const _domCache = new Map();
function $el(id){
  if(!_domCache.has(id)){
    const el = document.getElementById(id);
    if(el) _domCache.set(id, el);
    return el;
  }
  return _domCache.get(id);
}
// Invalidate cache on page transitions (elements may be recreated in modals)
function _clearDomCache(){ _domCache.clear(); }

// Memoized lookups — cleared on state mutations
let _userMap = null, _projectMap = null, _sprintMap = null, _taskMap = null, _epicMap = null;
function _invalidateMaps(){ _userMap=null; _projectMap=null; _sprintMap=null; _taskMap=null; _epicMap=null; }

function getProject(id){
  if(!_projectMap){ _projectMap=new Map(state.projects.map(p=>[p.id,p])); }
  return _projectMap.get(id)||null;
}
function getUser(id){
  if(!_userMap){ _userMap=new Map(state.users.map(u=>[u.id,u])); }
  return _userMap.get(id)||null;
}
function getSprint(id){
  if(!_sprintMap){ _sprintMap=new Map(state.sprints.map(s=>[s.id,s])); }
  return _sprintMap.get(id)||null;
}
function getTask(id){
  if(!_taskMap){ _taskMap=new Map(state.tasks.map(t=>[t.id,t])); }
  return _taskMap.get(id)||null;
}
function getEpic(id){
  if(!_epicMap){ _epicMap=new Map((state.epics||[]).map(e=>[e.id,e])); }
  return _epicMap.get(id)||null;
}
// Call after any state mutation that adds/removes entities
function invalidateStateMaps(){ _invalidateMaps(); }

function uid(){return 't'+Date.now().toString(36)+Math.random().toString(36).substr(2,4);}
function stid(){return 'st'+Date.now().toString(36)+Math.random().toString(36).substr(2,4);}
function spid(){return 's'+Date.now().toString(36);}
function ppid(){return 'p'+Date.now().toString(36);}
function muid(){return 'u'+Date.now().toString(36);}
function epid(){return 'e'+Date.now().toString(36)+Math.random().toString(36).substr(2,3);}

// ─── TIMESTAMP HELPER ────────────────────────────────────────────
function _now(){ return Date.now(); }

function initials(name){
  return name.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
}
function randomColor(){
  const colors=['#6366f1','#0ea5e9','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6'];
  return colors[Math.floor(Math.random()*colors.length)];
}
function priorityColor(p){
  return {critical:'#be185d',high:'#dc2626',medium:'#d97706',low:'#16a34a'}[p]||'#94a3b8';
}
function typeIcon(t){
  return {story:'◈',task:'✦',bug:'⚑'}[t]||'●';
}
function typeColor(t){
  return {story:'#7c3aed',task:'#0369a1',bug:'#dc2626'}[t]||'#64748b';
}
function formatDate(d){
  if(!d)return'—';
  try{return new Date(d).toLocaleDateString('en-IN',{day:'numeric',month:'short'});}catch(e){return d;}
}

function formatDateTime(ts){
  if(!ts)return'—';
  try{return new Date(ts).toLocaleString('en-IN',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});}catch(e){return String(ts);}
}

// Release ID generator
function rlid(){ return 'r' + Date.now().toString(36) + Math.random().toString(36).substr(2,4); }

// ── Highlight helper ──
function highlightMatch(text,q){
  if(!text) return '';
  const escaped = _escHtml(text);
  if(!q) return escaped;
  const safe=q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return escaped.replace(new RegExp('('+safe+')','gi'),'<mark style="background:#fef08a;border-radius:2px;padding:0 1px">$1</mark>');
}

function _prdId(){ return 'PRD' + Date.now().toString(36).toUpperCase(); }
function _tagId(){ return 'TAG' + Date.now().toString(36).toUpperCase(); }

// ── Color helpers: resolve color for a tag/product by name (for task display spots) ──
function _tagColorByName(name){
  const t = (state.tags||[]).find(x=>x.name===name);
  return t && t.color ? t.color : '';
}
function _productColorByName(name){
  const p = (state.products||[]).find(x=>x.name===name);
  return p && p.color ? p.color : '';
}
function _coloredChip(name, color, baseClass){
  const safeName = _escHtml(name);
  if(color){
    return `<span class="${baseClass||'tag'}" style="background:${color}22;color:${color};border-color:${color}55">${safeName}</span>`;
  }
  return `<span class="${baseClass||'tag'}">${safeName}</span>`;
}

function _themeId(){ return 'THM' + Date.now().toString(36).toUpperCase(); }

function _escHtml(str){
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function _escAttr(str){
  return String(str||'').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// v27: cap notification stack to prevent DOM accumulation under high-frequency updates
const _MAX_NOTIFS = 5;
function showNotif(msg,type='default'){
  // Prune excess notifications before adding new one
  const existing = document.querySelectorAll('.notification');
  if(existing.length >= _MAX_NOTIFS){
    // Remove oldest (first in DOM) to keep stack bounded
    existing[0].remove();
  }
  const el=document.createElement('div');
  el.className='notification';
  const icons={default:'✓',error:'⚠',info:'ℹ'};
  el.innerHTML=`<span>${icons[type]||'✓'}</span><span>${_escHtml(msg)}</span>`;
  if(type==='error')el.style.background='#dc2626';
  document.body.appendChild(el);
  setTimeout(()=>{ try{ el.remove(); }catch(e){} },3100);
}

// ── HTML escape helper ──
function _esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

