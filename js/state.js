// ─── DEFAULT DATA (minimal clean set) ────────────────────────────
const DEFAULT_DATA = {
  projects:[
    {id:'p1',name:'SprintFlow MVP',key:'SFM',color:'#6366f1',lead:'u1',status:'active',description:'Core sprint planning tool for agile teams',memberIds:['u1','u2']}
  ],
  users:[
    {id:'u1',name:'Admin User',role:'admin',initials:'AU',color:'#6366f1'},
    {id:'u2',name:'Program Manager',role:'program_manager',initials:'PM',color:'#f59e0b',email:''},
    {id:'u3',name:'Team Member',role:'team_member',initials:'TM',color:'#0ea5e9',email:''},
    {id:'u4',name:'Senior Manager',role:'senior_manager',initials:'SM',color:'#e11d48',email:''},
    {id:'u5',name:'Viewer User',role:'viewer',initials:'VU',color:'#64748b',email:''}
  ],
  sprints:[
    {id:'s1',name:'Sprint 1',project:'p1',start:'2026-05-01',end:'2026-05-14',status:'active',goal:'Launch core features of SprintFlow MVP'}
  ],
  epics:[
    {id:'e1',title:'Core Platform',description:'Foundational platform features and architecture.',projectId:'p1',ownerId:'u1',priority:'high',status:'Active',dueDate:'2026-06-30',color:'#6366f1',createdAt:Date.now()}
  ],
  tasks:[
    {id:'t1',title:'Setup project architecture',project:'p1',sprint:'s1',epicId:'e1',releaseId:'r1',status:'open',priority:'high',type:'task',assignee:'u1',points:5,descriptionPreview:'Set up the base folder structure, routing and state management.',descriptionUpdatedAt:Date.now(),descriptionUpdatedBy:'Jatin Chaudhary',tags:['setup','architecture']},
    {id:'t2',title:'Build kanban board UI',project:'p1',sprint:'s1',epicId:'e1',releaseId:null,status:'dev-in-progress',priority:'high',type:'story',assignee:'u2',points:8,descriptionPreview:'Implement drag-and-drop kanban board with column status sync.',descriptionUpdatedAt:Date.now(),descriptionUpdatedBy:'Jatin Chaudhary',tags:['ui','kanban']}
  ],
  releases:[
    {id:'r1',name:'MVP Launch',version:'1.0.0',sprintId:'s1',projectId:'p1',ownerId:'u1',releaseDate:'2026-05-14',status:'Planned',releaseNotes:'Initial release of SprintFlow MVP with core sprint planning, kanban board, and backlog management.',taskIds:['t1'],createdAt:1746057600000}
  ]
};

// ─── LEGACY STATE LOADER (localStorage fallback) ──────────────────
// Retained for initial cold-start before Firebase resolves.
// loadState() is only called once at boot; Firebase will overwrite via loadAppData().
function loadState(){
  try{
    const saved = localStorage.getItem('sprintflow_v2');
    if(saved){
      const parsed = JSON.parse(saved);
      if(parsed.projects){parsed.projects.forEach(p=>{if(!p.memberIds)p.memberIds=[];});}
      if(parsed.users){parsed.users.forEach(u=>{if(u.role==='member') u.role='team_member';});}
      const statusMap={'todo':'open','in-progress':'dev-in-progress','qa':'in-qa','done':'released'};
      if(parsed.tasks){parsed.tasks.forEach(t=>{
        if(statusMap[t.status])t.status=statusMap[t.status];
        // FIX: same guard as loadAppData() — non-array subtasks (e.g. an object
        // from a sparse Firebase array) must be coerced, not just defaulted
        // when falsy, or the .forEach below throws on cold boot.
        if(!Array.isArray(t.subtasks)) t.subtasks = t.subtasks ? Object.values(t.subtasks).filter(Boolean) : [];
        if(!t.epicId)t.epicId=null;
        t.subtasks.forEach(s=>{if(statusMap[s.status])s.status=statusMap[s.status];if(!s.status)s.status='open';});
      });}
      if(!parsed.subtasks)parsed.subtasks=[];
      if(!parsed.epics)parsed.epics=[];
      const savedReleases=loadReleases();
      parsed.releases=savedReleases.length?savedReleases:(parsed.releases||[]);
      if(parsed.tasks){parsed.tasks.forEach(t=>{if(t.releaseId===undefined)t.releaseId=null;});}
      if(parsed.releases){parsed.releases.forEach(r=>{if(!r||!r.id)return;(r.taskIds||[]).forEach(tid=>{if(!tid)return;const t=(parsed.tasks||[]).find(x=>x&&x.id===tid);if(t)t.releaseId=r.id;});});}
      return parsed;
    }
  }catch(e){}
  return JSON.parse(JSON.stringify(DEFAULT_DATA));
}

function resetData(){
  if(!confirm('Reset all data to defaults?'))return;
  localStorage.removeItem('sprintflow_v2');
  localStorage.removeItem('sprintflow_releases');
  location.reload();
}

// ─── STATE ────────────────────────────────────────────────────────
// Production Hardened: state loaded from localStorage with Firebase override on auth
let state = loadState();
// Production Hardened: ensure all state arrays are always defined, never undefined
state.tasks    = state.tasks    || [];
state.projects = state.projects || [];
state.sprints  = state.sprints  || [];
state.users    = state.users    || [];
state.releases = state.releases || [];
state.epics    = state.epics    || [];
state.comments = state.comments || [];
state.products = state.products || [];
state.tags     = state.tags     || [];
state.themes   = state.themes   || [];
state.notifications = state.notifications || {}; // standalone collection — never merged into tasks
state.retrospectives        = state.retrospectives        || [];
state.retrospectiveEntries  = state.retrospectiveEntries  || [];
state.currentUser = null; // set by RBAC.init() after auth
let currentPage = 'dashboard';

let draggedTaskId = null;
let kanbanDraggedId = null;
let kanbanDraggedSubtask = null; // {subId, parentId}
let charts = {};

// ─── INIT ─────────────────────────────────────────────────────────
// Initialize the sync queue — loads persisted items and schedules replay.
// Runs last (this file loads after every other module) since it needs
// `state` to already exist — updateSidebarProject() reads state.projects.
PendingSyncQueue.init();
updateSidebarProject();
