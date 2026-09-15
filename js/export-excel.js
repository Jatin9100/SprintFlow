// ══════════════════════════════════════════════════════════════════════════
//  SPRINTFLOW — ENTERPRISE EXCEL EXPORT ENGINE v2.0
//
//  Architecture:
//    exportReportExcel(mode)  ← main entry point (async)
//    mode: 'visible' | 'full' | 'analytics'
//
//  Workbook sheets:
//    1. Cover         — branding + metadata
//    2. Summary       — KPI executive summary
//    3. Metrics       — deep analytics (velocity, QA, workload…)
//    4. Tasks         — full task list with every available field
//    5. Subtasks      — all subtasks with parent mapping
//    6. Sprints       — sprint details
//    7. Epics         — epic details + progress
//    8. Releases      — release details + task mapping
//    9. Team Members  — member profiles + workload stats
//   10. Projects      — project breakdown
//   11. Comments      — (stub, extensible)
//   12. Audit Log     — state-change history (stub, extensible)
//
//  Performance: async batching, chunked row writes, no UI freeze.
//  RBAC: Admin=full, PM=project-scoped, Member=accessible tasks only.
// ══════════════════════════════════════════════════════════════════════════

// ── EXCEL UX HELPERS ────────────────────────────────────────────────────

/**
 * Shows / hides a lightweight Excel-specific progress overlay.
 * Re-uses the PDF loader infrastructure but with a different ID.
 */
function _xlShowLoader(visible) {
  let overlay = document.getElementById('_xl_loader_overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = '_xl_loader_overlay';
    overlay.innerHTML = `
      <div style="position:fixed;inset:0;z-index:9998;
        background:rgba(8,10,20,0.58);backdrop-filter:blur(10px);
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        font-family:'DM Sans',sans-serif;">
        <div style="background:rgba(255,255,255,0.97);border-radius:20px;padding:34px 44px;
          box-shadow:0 32px 80px rgba(0,0,0,0.24),0 8px 28px rgba(0,0,0,0.1),inset 0 1px 0 #fff;
          display:flex;flex-direction:column;align-items:center;gap:16px;
          border:1px solid rgba(255,255,255,0.9);min-width:270px;">
          <!-- Excel-green spinner ring -->
          <div style="width:40px;height:40px;border-radius:50%;
            border:3.5px solid rgba(16,185,129,0.18);border-top-color:#10b981;
            animation:_xlSpin 0.75s linear infinite;"></div>
          <div>
            <div style="font-size:15px;font-weight:700;color:#0d0f14;text-align:center;margin-bottom:4px"
              id="_xl_loader_title">Building Excel…</div>
            <div id="_xl_loader_msg" style="font-size:12.5px;color:#7a7f9a;text-align:center">Initialising workbook</div>
          </div>
          <div style="width:100%;height:4px;background:#eceef5;border-radius:99px;overflow:hidden">
            <div id="_xl_progress_bar" style="height:100%;background:linear-gradient(90deg,#10b981,#0ea5e9);
              border-radius:99px;width:0%;transition:width 0.35s ease"></div>
          </div>
          <div id="_xl_sheet_counter" style="font-size:10.5px;color:#94a3b8;text-align:center"></div>
        </div>
      </div>`;
    // Keyframe for spinner (may already exist from PDF loader)
    if (!document.getElementById('_xlSpinStyle')) {
      const s = document.createElement('style');
      s.id = '_xlSpinStyle';
      s.textContent = '@keyframes _xlSpin{to{transform:rotate(360deg)}}';
      document.head.appendChild(s);
    }
    document.body.appendChild(overlay);
  }
  overlay.style.display = visible ? 'block' : 'none';
}

/** Update the Excel loader's progress bar and message */
function _xlProgress(pct, msg, sheetInfo) {
  const bar   = document.getElementById('_xl_progress_bar');
  const lbl   = document.getElementById('_xl_loader_msg');
  const sInfo = document.getElementById('_xl_sheet_counter');
  if (bar)   bar.style.width   = Math.min(100, pct) + '%';
  if (lbl && msg)   lbl.textContent   = msg;
  if (sInfo && sheetInfo) sInfo.textContent = sheetInfo;
}

/** Set the loader title (changes between export modes) */
function _xlSetTitle(title) {
  const t = document.getElementById('_xl_loader_title');
  if (t) t.textContent = title;
}

/** Lock / unlock the Export button */
function _xlSetBtnState(disabled) {
  const btn = document.getElementById('rpt-export-btn');
  if (!btn) return;
  btn.disabled  = disabled;
  btn.style.opacity = disabled ? '0.55' : '';
  btn.style.cursor  = disabled ? 'not-allowed' : '';
}

/** Yield control back to the browser event loop */
function _xlYield(ms) {
  return new Promise(r => setTimeout(r, ms || 0));
}

// ── XLSX STYLE HELPERS ──────────────────────────────────────────────────
// SheetJS Community (xlsx) supports basic cell types but not rich styling
// without the Pro license. We encode all formatting via cell metadata
// (t: type, v: value, z: format, c: comments) and use !cols / !rows
// for column widths and row heights.

/**
 * Creates an XLSX cell object.
 * @param {*}      v    Cell value
 * @param {'s'|'n'|'d'|'b'} t    Cell type (string/number/date/bool)
 * @param {string} [z]  Number format string
 */
function _xlCell(v, t, z) {
  const cell = { v, t: t || (typeof v === 'number' ? 'n' : 's') };
  if (z) cell.z = z;
  return cell;
}

/**
 * Converts an array-of-arrays (AOA) to a worksheet with
 * frozen top row, auto-filter on row 1, and computed column widths.
 * @param {Array[]}  aoa          Rows: first row = headers
 * @param {Object}   [opts]
 * @param {boolean}  [opts.freeze]  Freeze first row (default true)
 * @param {boolean}  [opts.filter]  Auto-filter on header row (default true)
 * @param {number[]} [opts.colWidths] Override widths per column (chars)
 */
function _xlBuildSheet(aoa, opts) {
  opts = opts || {};
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // ── Freeze top row ──
  if (opts.freeze !== false) {
    ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' };
  }

  // ── Auto-filter on header row ──
  if (opts.filter !== false && aoa.length > 0) {
    const lastCol = String.fromCharCode(65 + aoa[0].length - 1);
    ws['!autofilter'] = { ref: `A1:${lastCol}1` };
  }

  // ── Column widths ──
  if (opts.colWidths) {
    ws['!cols'] = opts.colWidths.map(w => ({ wch: w }));
  } else {
    // Auto-size: scan first 200 rows for max char length per column
    const colCount = aoa[0] ? aoa[0].length : 0;
    const widths   = new Array(colCount).fill(8);
    const scanRows = Math.min(aoa.length, 200);
    for (let r = 0; r < scanRows; r++) {
      for (let c = 0; c < colCount; c++) {
        const val = aoa[r][c];
        if (val != null) {
          const len = String(val).length;
          if (len > widths[c]) widths[c] = Math.min(len, 60);
        }
      }
    }
    ws['!cols'] = widths.map(w => ({ wch: w + 2 }));
  }

  // ── Row height for header ──
  ws['!rows'] = [{ hpt: 22 }];

  return ws;
}

/**
 * Format a JS Date (or timestamp / ISO string) as YYYY-MM-DD HH:MM.
 * Returns '—' for missing values.
 */
function _xlFmtDate(val) {
  if (!val) return '—';
  try {
    const d = val instanceof Date ? val : new Date(val);
    if (isNaN(d.getTime())) return String(val);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch { return String(val); }
}

/**
 * Safe string — converts null/undefined to '—', arrays to comma-joined.
 */
function _xlStr(v) {
  if (v == null)          return '—';
  if (Array.isArray(v))  return v.join(', ') || '—';
  return String(v) || '—';
}

/**
 * Lookup helpers: resolve IDs → human-readable names from state.
 */
function _xlLookup() {
  const userMap    = new Map((state.users    || []).map(u => [u.id, u]));
  const projMap    = new Map((state.projects || []).map(p => [p.id, p]));
  const sprintMap  = new Map((state.sprints  || []).map(s => [s.id, s]));
  const epicMap    = new Map((state.epics    || []).map(e => [e.id, e]));
  const releaseMap = new Map((state.releases || []).map(r => [r.id, r]));
  const taskMap    = new Map((state.tasks    || []).map(t => [t.id, t]));

  return {
    user:    id => { const u = userMap.get(id); return u ? u.name : (id || '—'); },
    userObj: id => userMap.get(id) || null,
    proj:    id => { const p = projMap.get(id); return p ? p.name : (id || '—'); },
    sprint:  id => { const s = sprintMap.get(id); return s ? s.name : (id || '—'); },
    sprintObj: id => sprintMap.get(id) || null,
    epic:    id => { const e = epicMap.get(id); return e ? e.title : (id || '—'); },
    epicObj: id => epicMap.get(id) || null,
    release: id => { const r = releaseMap.get(id); return r ? r.name : (id || '—'); },
    releaseObj: id => releaseMap.get(id) || null,
    task:    id => { const t = taskMap.get(id); return t ? t.title : (id || '—'); },
    taskObj: id => taskMap.get(id) || null,
  };
}

/**
 * Compute completion % for a task based on its status.
 */
function _xlTaskCompletion(status) {
  const map = {
    'open': 0, 'dev-in-progress': 20, 'dev-completed': 45,
    'in-qa': 55, 'qa-in-progress': 70, 'reopen': 30,
    'on-hold': 75, 'pending-with-client': 80, 'ready-for-prod': 90, 'released': 100,
  };
  return map[status] != null ? map[status] : 0;
}

/**
 * Count how many times a task was re-opened (based on status == 'reopen').
 * We approximate by tracking the reopen field if stored, else 0.
 */
function _xlReopenCount(task) {
  return task.reopenCount || (task.status === 'reopen' ? 1 : 0);
}

/**
 * Determine QA / Dev / Prod status labels from the unified status field.
 */
function _xlDevStatus(status) {
  const dev  = ['dev-in-progress','dev-completed'];
  const qa   = ['in-qa','qa-in-progress','reopen'];
  const prod = ['ready-for-prod','released'];
  if (dev.includes(status))  return 'In Development';
  if (qa.includes(status))   return 'In QA';
  if (prod.includes(status)) return 'Production Ready';
  if (status === 'open')     return 'Not Started';
  return _xlStr(status);
}

function _xlQaStatus(status) {
  if (status === 'in-qa' || status === 'qa-in-progress') return 'In QA';
  if (status === 'reopen') return 'QA Failed / Reopened';
  if (['ready-for-prod','released'].includes(status))    return 'QA Passed';
  return '—';
}

function _xlProdStatus(status) {
  if (status === 'ready-for-prod') return 'Ready';
  if (status === 'released')       return 'Released';
  return '—';
}

// ── FILENAME ────────────────────────────────────────────────────────────
function _xlFilename(mode) {
  const d   = new Date();
  const pad = n => String(n).padStart(2, '0');
  const ts  = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
  const suffix = mode === 'analytics' ? '_Analytics' : mode === 'full' ? '_Full' : '_Visible';
  return `SprintFlow_Report_${ts}${suffix}.xlsx`;
}

// ── RBAC-SCOPED DATA RESOLVER ────────────────────────────────────────────
/**
 * Returns all data arrays respecting the current RBAC role + active filters.
 * mode 'visible' applies Report filters; mode 'full' / 'analytics' uses RBAC only.
 */
function _xlGetData(mode) {
  const isVisible  = (mode === 'visible');
  const isFull     = (mode === 'full');
  const lu         = _xlLookup();

  let tasks, sprints, projects, epics, releases;

  if (isFull) {
    // ── FULL mode: always use live Firebase-backed state — never filtered/cached data ──
    tasks    = state.tasks    || [];
    sprints  = state.sprints  || [];
    projects = state.projects || [];
    epics    = state.epics    || [];
    releases = state.releases || [];
  } else {
    // Start from RBAC-visible base
    tasks    = RBAC.getVisibleTasks(state.tasks || []);
    sprints  = RBAC.getVisibleSprints();
    projects = RBAC.getVisibleProjects();
    epics    = RBAC.getVisibleEpics();
    releases = RBAC.getVisibleReleases();

    // Apply active report filters if mode === 'visible'
    if (isVisible) {
      const fd = _getFilteredReportsData();
      tasks    = fd.tasks;
      sprints  = fd.sprints;
      projects = fd.projects;
      epics    = fd.epics;
      releases = fd.releases;
    }
  }

  // Build flat subtasks array from all tasks
  const subtasks = tasks.flatMap(t =>
    (t.subtasks || []).map(s => ({ ...s, _parentTask: t }))
  );

  return { tasks, subtasks, sprints, projects, epics, releases, users: state.users || [], lu };
}

// ── SHEET BUILDERS ───────────────────────────────────────────────────────

/** Sheet 1: Cover — branding + export metadata */
function _xlSheetCover(mode, data) {
  const now  = new Date();
  const user = (window.getCurrentUser && window.getCurrentUser())
    ? window.getCurrentUser().email : 'SprintFlow User';
  const modeLabel = { visible: 'Visible Data', full: 'Full Database', analytics: 'Analytics Only' }[mode] || mode;
  const role  = RBAC.isAdmin() ? 'Admin' : RBAC.isSeniorManager() ? 'Senior Manager' : RBAC.isProgramManager() ? 'Program Manager' : RBAC.isViewer() ? 'Viewer' : 'Team Member';

  const allWorkItemsCount = data.tasks.length + (data.subtasks ? data.subtasks.length : data.tasks.flatMap(t => t.subtasks || []).length);
  const aoa = [
    ['SprintFlow — Enterprise Analytics Report'],
    [],
    ['Export Mode',         modeLabel],
    ['Generated By',        user],
    ['Role',                role],
    ['Export Date',         _xlFmtDate(now)],
    ['Total Work Items',    allWorkItemsCount],
    ['  → Parent Tasks',   data.tasks.length],
    ['  → Subtasks',       allWorkItemsCount - data.tasks.length],
    ['Total Sprints',       data.sprints.length],
    ['Total Projects',      data.projects.length],
    ['Total Epics',         data.epics.length],
    ['Total Releases',      data.releases.length],
    ['Total Members',       data.users.length],
    [],
    ['CONFIDENTIAL — For internal use only'],
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 22 }, { wch: 44 }];
  return ws;
}

/** Sheet 2: Summary — KPI executive snapshot */
function _xlSheetSummary(data) {
  const { tasks, subtasks, sprints, projects, releases } = data;

  // ── Use one common source array so totals always reconcile ──
  const allWorkItems   = [...tasks, ...subtasks];
  const activeSprints  = sprints.filter(s => s.status === 'active').length;
  const openTasks      = allWorkItems.filter(t => t.status === 'open').length;
  const inProgress     = allWorkItems.filter(t => ['dev-in-progress','dev-completed','in-qa','qa-in-progress'].includes(t.status)).length;
  const releasedTasks  = allWorkItems.filter(t => DONE_STATUSES.includes(t.status)).length;
  const reopenTasks    = allWorkItems.filter(t => t.status === 'reopen').length;
  const readyForProd   = allWorkItems.filter(t => t.status === 'ready-for-prod').length;
  const openBugs       = tasks.filter(t => t.type === 'bug' && !DONE_STATUSES.includes(t.status)).length;
  const critBugs       = tasks.filter(t => t.type === 'bug' && t.priority === 'critical').length;
  const totalPts       = allWorkItems.reduce((a, t) => a + (t.points || 0), 0);
  const donePts        = allWorkItems.filter(t => DONE_STATUSES.includes(t.status)).reduce((a, t) => a + (t.points || 0), 0);
  const totalWithSubs  = allWorkItems.length;
  const sprintComp     = totalWithSubs ? Math.round((releasedTasks / totalWithSubs) * 100) : 0;
  const qaTotal        = allWorkItems.filter(t => ['in-qa','qa-in-progress','reopen'].includes(t.status)).length + allWorkItems.filter(t => DONE_STATUSES.includes(t.status)).length;
  const reopenRate     = qaTotal ? Math.round((reopenTasks / qaTotal) * 100) : 0;
  const relTaskIds     = releases.flatMap(r => r.taskIds || []);
  const relDone        = relTaskIds.filter(id => { const t = tasks.find(x => x.id === id); return t && DONE_STATUSES.includes(t.status); }).length;
  const releaseReady   = relTaskIds.length ? Math.round((relDone / relTaskIds.length) * 100) : 0;

  // Status breakdown — must sum to Total Work Items
  const statusOpen     = allWorkItems.filter(t => t.status === 'open').length;
  const statusInProg   = allWorkItems.filter(t => ['dev-in-progress','dev-completed','in-qa','qa-in-progress'].includes(t.status)).length;
  const statusRFP      = allWorkItems.filter(t => t.status === 'ready-for-prod').length;
  const statusDone     = allWorkItems.filter(t => DONE_STATUSES.includes(t.status)).length;
  const statusOther    = allWorkItems.length - statusOpen - statusInProg - statusRFP - statusDone;

  const headers = ['Category', 'Metric', 'Value', 'Notes'];
  const rows = [
    headers,
    ['Tasks',    'Total Work Items (Tasks + Subtasks)', allWorkItems.length, 'Parent tasks + subtasks combined'],
    ['Tasks',    'Parent Tasks',              tasks.length,      ''],
    ['Tasks',    'Subtasks',                  subtasks.length,   ''],
    ['Tasks',    'Open',                      statusOpen,        `${allWorkItems.length ? Math.round(statusOpen/allWorkItems.length*100) : 0}% of total`],
    ['Tasks',    'In Progress',               statusInProg,      `${allWorkItems.length ? Math.round(statusInProg/allWorkItems.length*100) : 0}% of total`],
    ['Tasks',    'Ready for Prod',            statusRFP,         `${allWorkItems.length ? Math.round(statusRFP/allWorkItems.length*100) : 0}% of total`],
    ['Tasks',    'Released / Done',           statusDone,        `${allWorkItems.length ? Math.round(statusDone/allWorkItems.length*100) : 0}% of total`],
    ['Tasks',    'Other Statuses',            statusOther,       'Reopen, Pending, etc.'],
    ['Tasks',    'Status Total Check',        statusOpen+statusInProg+statusRFP+statusDone+statusOther, 'Must equal Total Work Items'],
    ['Tasks',    'Reopened',                  reopenTasks,       ''],
    ['Tasks',    'Completion %',              sprintComp + '%',  'Released / Total Work Items'],
    ['Bugs',     'Open Bugs',                 openBugs,          ''],
    ['Bugs',     'Critical Bugs',             critBugs,          ''],
    ['Bugs',     'QA Reopen Rate',            reopenRate + '%',  'Reopened / QA-touched'],
    ['Points',   'Total Story Points',        totalPts,          ''],
    ['Points',   'Points Completed',          donePts,           ''],
    ['Sprints',  'Active Sprints',            activeSprints,     ''],
    ['Sprints',  'Total Sprints',             sprints.length,    ''],
    ['Projects', 'Total Projects',            projects.length,   ''],
    ['Releases', 'Total Releases',            releases.length,   ''],
    ['Releases', 'Release Readiness',         releaseReady + '%','Released / Mapped tasks'],
  ];

  return _xlBuildSheet(rows, { colWidths: [14, 36, 14, 34] });
}

/** Sheet 3: Tasks — parent tasks AND subtasks merged, sorted by createdDate asc */
async function _xlSheetTasks(data) {
  const { tasks, lu } = data;

  const headers = [
    'Task ID','Task Key','Title','Type','Parent Task',
    'Project','Sprint','Sprint Start Date','Sprint End Date','Epic','Status','Priority',
    'Assignee','QA Assignee','Story Points','Tags / Labels','Products','Theme',
    'Description',
    'Created Date','Updated Date',
  ];

  // Task Key mirrors the ID shown in the UI (kanban/backlog cards, task modal, and
  // global search) — `${projectKey}-${id.slice(-3).toUpperCase()}`. The plain "Task ID"
  // column above is the raw internal DB id, which users never see/search by.
  const _xlDisplayKey = (proj, rawId) => proj ? (proj.key + '-' + (rawId || '').slice(-3).toUpperCase()) : (rawId || '—');

  // Resolve a sprint's start/end date strings via the sprint object (falls back across field name variants)
  const _sprintDateFmt = (sprintId) => {
    const sp = sprintId ? lu.sprintObj(sprintId) : null;
    if (!sp) return { start: '—', end: '—' };
    const startVal = sp.start || sp.startDate || null;
    const endVal   = sp.end   || sp.endDate   || null;
    return { start: _xlFmtDate(startVal), end: _xlFmtDate(endVal) };
  };

  // Build combined rows: parent tasks first, then their subtasks
  const combinedRows = [];

  const BATCH = 200;

  for (let i = 0; i < tasks.length; i += BATCH) {
    const chunk = tasks.slice(i, i + BATCH);
    for (const t of chunk) {
      // Resolve product names: prefer products array (names); fall back to resolving productIds
      const _tProducts = (t.products||[]).length
        ? t.products
        : (t.productIds||[]).map(pid=>{ const p=(data.products||[]).find(x=>x.id===pid); return p?p.name:pid; });
      // Parent task row
      const _tSprintDates = _sprintDateFmt(t.sprint);
      const _tProjObj = getProject(t.project);
      combinedRows.push({
        id:          _xlStr(t.id),
        taskKey:     _xlStr(_xlDisplayKey(_tProjObj, t.id)),
        title:       _xlStr(t.title),
        type:        'Task',
        parentTask:  '—',
        project:     lu.proj(t.project),
        sprint:      lu.sprint(t.sprint),
        sprintStart: _tSprintDates.start,
        sprintEnd:   _tSprintDates.end,
        epic:        t.epicId ? lu.epic(t.epicId) : '—',
        status:      _xlStr(t.status),
        priority:    _xlStr(t.priority),
        assignee:    lu.user(t.assignee),
        qaAssignee:  t.qaAssigneeName ? _xlStr(t.qaAssigneeName) : (t.qaAssigneeId ? lu.user(t.qaAssigneeId) : '—'),
        points:      t.points != null ? t.points : '—',
        tags:        _xlStr(t.tags),
        products:    _xlStr(_tProducts),
        theme:       t.themeName ? _xlStr(t.themeName) : '',
        description: t.descriptionPreview ? _xlStr(t.descriptionPreview) : '—',
        createdAt:   t.createdAt ? new Date(t.createdAt).getTime() : 0,
        createdFmt:  _xlFmtDate(t.createdAt),
        updatedFmt:  _xlFmtDate(t.updatedAt),
      });
      // Subtask rows — subtasks don't carry products; inherit parent's if needed
      // Apply assignee filter to subtasks if active
      const _filteredSubs = data._activeAssigneeIds
        ? (t.subtasks || []).filter(s => data._activeAssigneeIds.includes(s.assignee))
        : (t.subtasks || []);
      for (const s of _filteredSubs) {
        const _sSprintDates = _sprintDateFmt(t.sprint || s.sprint);
        // Subtask's key uses its own project when set, else falls back to the parent
        // task's project — same fallback rule used in openSubtaskModal / global search.
        const _sProjObj = s.project ? getProject(s.project) : _tProjObj;
        combinedRows.push({
          id:         _xlStr(s.id),
          taskKey:    _xlStr(_xlDisplayKey(_sProjObj, s.id)),
          title:      _xlStr(s.title),
          type:       'Subtask',
          parentTask: _xlStr(t.title),
          project:    lu.proj(t.project),
          sprint:     lu.sprint(t.sprint || s.sprint),
          sprintStart: _sSprintDates.start,
          sprintEnd:   _sSprintDates.end,
          epic:       t.epicId ? lu.epic(t.epicId) : '—',
          status:     _xlStr(s.status),
          priority:   _xlStr(s.priority),
          assignee:   lu.user(s.assignee),
          qaAssignee: s.qaAssigneeName ? _xlStr(s.qaAssigneeName) : (s.qaAssigneeId ? lu.user(s.qaAssigneeId) : '—'),
          points:     s.points != null ? s.points : '—',
          tags:       _xlStr(s.tags),
          products:   '—',
          theme:      s.themeName ? _xlStr(s.themeName) : '',
          description: s.descriptionPreview ? _xlStr(s.descriptionPreview) : '—',
          createdAt:  s.createdAt ? new Date(s.createdAt).getTime() : 0,
          createdFmt: _xlFmtDate(s.createdAt),
          updatedFmt: _xlFmtDate(s.updatedAt),
        });
      }
    }
    await _xlYield();
  }

  // Sort by createdAt ascending
  combinedRows.sort((a, b) => a.createdAt - b.createdAt);

  const rows = [headers];
  for (const r of combinedRows) {
    rows.push([
      r.id, r.taskKey, r.title, r.type, r.parentTask,
      r.project, r.sprint, r.sprintStart, r.sprintEnd, r.epic, r.status, r.priority,
      r.assignee, r.qaAssignee, r.points, r.tags, r.products, r.theme,
      r.description,
      r.createdFmt, r.updatedFmt,
    ]);
  }

  if (rows.length === 1) rows.push(['No tasks in scope']);

  return _xlBuildSheet(rows, {
    colWidths: [14,14,40,10,36, 24,18,20,20,22,20,12, 20,20,10,20,24,22, 40, 22,22]
  });
}

/** Sheet 4: Subtasks — REMOVED: subtasks are now merged into the Tasks sheet */
// async function _xlSheetSubtasks(data) { /* merged into _xlSheetTasks */ }

/** Sheet 5: Sprints */
function _xlSheetSprints(data) {
  const { sprints, tasks, lu } = data;

  const headers = [
    'Sprint ID','Sprint Name','Status','Project',
    'Created Date','Start Date','End Date','Updated Date',
    'Goal',
    'Total Tasks','Done','In Progress','Open','Bugs',
    'Story Points Total','Points Done','Velocity %',
  ];

  const rows = [headers];

  for (const s of sprints) {
    const sTasks   = tasks.filter(t => t.sprint === s.id);
    const done     = sTasks.filter(t => t.status === 'released').length;
    const inProg   = sTasks.filter(t => ['dev-in-progress','in-qa','qa-in-progress','dev-completed'].includes(t.status)).length;
    const open     = sTasks.filter(t => t.status === 'open').length;
    const bugs     = sTasks.filter(t => t.type === 'bug').length;
    const totalPts = sTasks.reduce((a, t) => a + (t.points || 0), 0);
    const donePts  = sTasks.filter(t => t.status === 'released').reduce((a, t) => a + (t.points || 0), 0);
    const velPct   = totalPts ? Math.round((donePts / totalPts) * 100) : 0;

    rows.push([
      _xlStr(s.id),
      _xlStr(s.name),
      _xlStr(s.status),
      lu.proj(s.project),
      s.createdAt  ? new Date(s.createdAt).toLocaleString()  : '—',
      s.start      ? new Date(s.start).toLocaleString()      : (s.startDate ? new Date(s.startDate).toLocaleString() : '—'),
      s.end        ? new Date(s.end).toLocaleString()        : (s.endDate   ? new Date(s.endDate).toLocaleString()   : '—'),
      s.updatedAt  ? new Date(s.updatedAt).toLocaleString()  : '—',
      _xlStr(s.goal),
      sTasks.length,
      done, inProg, open, bugs,
      totalPts, donePts,
      velPct + '%',
    ]);
  }

  if (rows.length === 1) rows.push(['No sprints in scope']);
  return _xlBuildSheet(rows, {
    colWidths: [12,24,12,24, 20,20,20,20, 36,12,10,12,10,10,14,12,12]
  });
}

/** Sheet 6: Epics */
function _xlSheetEpics(data) {
  const { epics, tasks, lu } = data;

  const headers = [
    'Epic ID','Title','Status','Priority','Project','Owner',
    'Due Date','Color',
    'Total Tasks','Done Tasks','Open Tasks','Bugs',
    'Total Points','Done Points','Progress %',
    'Description','Created Date',
  ];

  const rows = [headers];

  for (const e of epics) {
    const eTasks   = tasks.filter(t => t.epicId === e.id);
    const done     = eTasks.filter(t => t.status === 'released').length;
    const openT    = eTasks.filter(t => t.status === 'open').length;
    const bugs     = eTasks.filter(t => t.type === 'bug').length;
    const totalPts = eTasks.reduce((a, t) => a + (t.points || 0), 0);
    const donePts  = eTasks.filter(t => t.status === 'released').reduce((a, t) => a + (t.points || 0), 0);
    const pct      = eTasks.length ? Math.round((done / eTasks.length) * 100) : 0;

    rows.push([
      _xlStr(e.id),
      _xlStr(e.title),
      _xlStr(e.status),
      _xlStr(e.priority),
      lu.proj(e.projectId),
      lu.user(e.ownerId),
      _xlStr(e.dueDate),
      _xlStr(e.color),
      eTasks.length, done, openT, bugs,
      totalPts, donePts,
      pct + '%',
      _xlStr(e.description),
      _xlFmtDate(e.createdAt),
    ]);
  }

  if (rows.length === 1) rows.push(['No epics in scope']);
  return _xlBuildSheet(rows, {
    colWidths: [12,32,14,12,24,20,12,10,12,10,10,10,12,12,12,40,20]
  });
}

/** Sheet 7: Releases */
function _xlSheetReleases(data) {
  const { releases, tasks, lu } = data;

  const headers = [
    'Release ID','Release Name','Version','Status','Project',
    'Sprint','Owner','Release Date',
    'Total Mapped Tasks','Done Tasks','Ready for Prod',
    'Open Bugs','Readiness %',
    'Release Notes','Created Date','Updated Date','Updated By',
  ];

  const rows = [headers];

  for (const r of releases) {
    const taskIds  = r.taskIds || [];
    const rTasks   = taskIds.map(id => tasks.find(t => t.id === id)).filter(Boolean);
    const done     = rTasks.filter(t => t.status === 'released').length;
    const ready    = rTasks.filter(t => t.status === 'ready-for-prod').length;
    const bugs     = rTasks.filter(t => t.type === 'bug' && t.status !== 'released').length;
    const pct      = rTasks.length ? Math.round((done / rTasks.length) * 100) : 0;

    rows.push([
      _xlStr(r.id),
      _xlStr(r.name),
      _xlStr(r.version),
      _xlStr(r.status),
      lu.proj(r.projectId),
      lu.sprint(r.sprintId),
      lu.user(r.ownerId),
      _xlStr(r.releaseDate),
      rTasks.length, done, ready, bugs,
      pct + '%',
      _xlStr(r.releaseNotes),
      _xlFmtDate(r.createdAt),
      r.updatedAt ? _xlFmtDate(r.updatedAt) : '',
      r.updatedBy ? (lu.user(r.updatedBy) || _xlStr(r.updatedBy)) : '',
    ]);
  }

  if (rows.length === 1) rows.push(['No releases in scope']);
  return _xlBuildSheet(rows, {
    colWidths: [12,28,12,14,24,18,20,14,14,10,14,10,12,44,20,20,24]
  });
}

/** Sheet 8: Team Members — ALL roles, ALL assigned work items (tasks + subtasks) */
function _xlSheetTeam(data) {
  const { users, tasks, sprints } = data;

  // Build flat work-items pool (tasks + subtasks) — no role exclusion
  const allWorkItems = [
    ...tasks,
    ...tasks.flatMap(t => (t.subtasks || []).map(s => ({ ...s, project: t.project, sprint: t.sprint || s.sprint })))
  ];

  const headers = [
    'Member ID','Name','Email','Role','Initials','Color',
    'Total Work Items Assigned','Open','In Progress','Released',
    'Total Story Points','Points Done','Reopen Count',
    'Active Sprints','Completion %','Avg Points Per Task',
    'Projects',
  ];

  const rows = [headers];

  for (const u of users) {
    // Match on both .assignee (tasks) and .assigneeId (subtasks may use either)
    // Also include QA Assignee role via _qaItemBelongsTo
    const uItems   = allWorkItems.filter(t => _qaItemBelongsTo(t, u.id));
    const open     = uItems.filter(t => t.status === 'open').length;
    const inProg   = uItems.filter(t => ['dev-in-progress','in-qa','qa-in-progress','dev-completed'].includes(t.status)).length;
    const released = uItems.filter(t => DONE_STATUSES.includes(t.status)).length;
    const totalPts = _qaUserPoints(uItems, u.id);
    const donePts  = _qaUserPoints(uItems.filter(t => DONE_STATUSES.includes(t.status)), u.id);
    const reopens  = uItems.filter(t => t.status === 'reopen').length;
    const actSpr   = sprints.filter(s => s.status === 'active' && uItems.find(t => t.sprint === s.id)).length;
    const pct      = uItems.length ? Math.round((released / uItems.length) * 100) : 0;
    const avgPts   = uItems.length ? Math.round((totalPts / uItems.length) * 10) / 10 : 0;
    const projs    = [...new Set(uItems.map(t => t.project))].map(id => { const p = data.projects.find(x => x.id === id); return p ? p.name : id; }).filter(Boolean).join(', ');

    rows.push([
      _xlStr(u.id),
      _xlStr(u.name),
      _xlStr(u.email),
      _xlStr(u.role),
      _xlStr(u.initials),
      _xlStr(u.color),
      uItems.length, open, inProg, released,
      totalPts, donePts, reopens,
      actSpr,
      pct + '%',
      avgPts,
      projs || '—',
    ]);
  }

  if (rows.length === 1) rows.push(['No members found']);
  return _xlBuildSheet(rows, {
    colWidths: [10,22,30,18,10,10, 18,10,12,10,12,10,12,12,12,14,36]
  });
}

/** Sheet 9: Projects */
function _xlSheetProjects(data) {
  const { projects, tasks, sprints, epics, releases, lu } = data;

  const headers = [
    'Project ID','Project Name','Key','Status','Color','Lead',
    'Members','Active Sprints','Total Sprints',
    'Total Tasks','Done','In Progress','Open','Bugs',
    'Total Points','Done Points','Completion %',
    'Epics','Releases','Description',
    'Created Date','Updated Date',
  ];

  const rows = [headers];

  for (const p of projects) {
    const pTasks   = tasks.filter(t => t.project === p.id);
    const pSprints = sprints.filter(s => s.project === p.id);
    const active   = pSprints.filter(s => s.status === 'active').length;
    const done     = pTasks.filter(t => t.status === 'released').length;
    const inProg   = pTasks.filter(t => ['dev-in-progress','in-qa','qa-in-progress'].includes(t.status)).length;
    const open     = pTasks.filter(t => t.status === 'open').length;
    const bugs     = pTasks.filter(t => t.type === 'bug').length;
    const totalPts = pTasks.reduce((a, t) => a + (t.points || 0), 0);
    const donePts  = pTasks.filter(t => t.status === 'released').reduce((a, t) => a + (t.points || 0), 0);
    const pct      = pTasks.length ? Math.round((done / pTasks.length) * 100) : 0;
    const pEpics   = epics.filter(e => e.projectId === p.id).length;
    const pRels    = releases.filter(r => r.projectId === p.id).length;
    const members  = (p.memberIds || []).map(id => lu.user(id)).join(', ');

    rows.push([
      _xlStr(p.id),
      _xlStr(p.name),
      _xlStr(p.key),
      _xlStr(p.status),
      _xlStr(p.color),
      lu.user(p.lead),
      members || '—',
      active, pSprints.length,
      pTasks.length, done, inProg, open, bugs,
      totalPts, donePts,
      pct + '%',
      pEpics, pRels,
      _xlStr(p.description),
      p.createdAt  ? new Date(p.createdAt).toLocaleString()  : '—',
      p.updatedAt  ? new Date(p.updatedAt).toLocaleString()  : '—',
    ]);
  }

  if (rows.length === 1) rows.push(['No projects in scope']);
  return _xlBuildSheet(rows, {
    colWidths: [12,28,8,12,10,20,36,12,12,12,10,12,10,10,12,12,12,10,10,40,22,22]
  });
}

/** Sheet 10: Metrics — deep analytics */
function _xlSheetMetrics(data) {
  const { tasks, sprints, users, projects, releases } = data;

  // ── Velocity by sprint ──
  const velocitySection = [
    ['SPRINT VELOCITY'],
    ['Sprint', 'Project', 'Status', 'Committed Pts', 'Completed Pts', 'Velocity %', 'Tasks', 'Done', 'Bugs'],
  ];
  for (const s of sprints) {
    const sTasks   = tasks.filter(t => t.sprint === s.id);
    const committed = sTasks.reduce((a, t) => a + (t.points || 0), 0);
    const completed = sTasks.filter(t => t.status === 'released').reduce((a, t) => a + (t.points || 0), 0);
    const vel       = committed ? Math.round((completed / committed) * 100) : 0;
    const proj      = projects.find(p => p.id === s.project);
    velocitySection.push([
      s.name, proj ? proj.name : '—', s.status,
      committed, completed, vel + '%',
      sTasks.length,
      sTasks.filter(t => t.status === 'released').length,
      sTasks.filter(t => t.type === 'bug').length,
    ]);
  }

  // ── Team workload ──
  const workloadSection = [
    [],
    ['TEAM WORKLOAD'],
    ['Member', 'Role', 'Assigned Tasks', 'Done', 'Open', 'Reopen', 'Story Pts Assigned', 'Pts Done', 'Completion %'],
  ];
  for (const u of users) {
    const uTasks = tasks.filter(t => _qaItemBelongsTo(t, u.id));
    const done   = uTasks.filter(t => t.status === 'released').length;
    const open   = uTasks.filter(t => t.status === 'open').length;
    const reopen = uTasks.filter(t => t.status === 'reopen').length;
    const pts    = _qaUserPoints(uTasks, u.id);
    const donePts= _qaUserPoints(uTasks.filter(t => t.status === 'released'), u.id);
    const pct    = uTasks.length ? Math.round((done / uTasks.length) * 100) : 0;
    workloadSection.push([u.name, u.role, uTasks.length, done, open, reopen, pts, donePts, pct + '%']);
  }

  // ── Bug analytics ──
  const bugSection = [
    [],
    ['BUG ANALYTICS'],
    ['Project', 'Total Bugs', 'Critical', 'High', 'Medium', 'Low', 'Open', 'Resolved', 'Reopen Rate %'],
  ];
  for (const p of projects) {
    const pBugs   = tasks.filter(t => t.project === p.id && t.type === 'bug');
    const crit    = pBugs.filter(t => t.priority === 'critical').length;
    const high    = pBugs.filter(t => t.priority === 'high').length;
    const med     = pBugs.filter(t => t.priority === 'medium').length;
    const low     = pBugs.filter(t => t.priority === 'low').length;
    const open    = pBugs.filter(t => t.status !== 'released').length;
    const resolved= pBugs.filter(t => t.status === 'released').length;
    const reopen  = pBugs.filter(t => t.status === 'reopen').length;
    const reopenRate = pBugs.length ? Math.round((reopen / pBugs.length) * 100) : 0;
    bugSection.push([p.name, pBugs.length, crit, high, med, low, open, resolved, reopenRate + '%']);
  }

  // ── Release readiness ──
  const releaseSection = [
    [],
    ['RELEASE READINESS'],
    ['Release', 'Version', 'Status', 'Mapped Tasks', 'Done', 'Ready for Prod', 'Open Bugs', 'Readiness %', 'Target Date'],
  ];
  for (const r of releases) {
    const rTaskIds = r.taskIds || [];
    const rTasks   = rTaskIds.map(id => tasks.find(t => t.id === id)).filter(Boolean);
    const done     = rTasks.filter(t => t.status === 'released').length;
    const ready    = rTasks.filter(t => t.status === 'ready-for-prod').length;
    const bugs     = rTasks.filter(t => t.type === 'bug' && t.status !== 'released').length;
    const pct      = rTasks.length ? Math.round((done / rTasks.length) * 100) : 0;
    releaseSection.push([r.name, r.version || '—', r.status, rTasks.length, done, ready, bugs, pct + '%', r.releaseDate || '—']);
  }

  // ── Status distribution ──
  const statuses  = ['open','dev-in-progress','dev-completed','in-qa','qa-in-progress','reopen','on-hold','pending-with-client','ready-for-prod','released'];
  const statusSection = [
    [],
    ['TASK STATUS DISTRIBUTION'],
    ['Status', 'Count', '% of Total'],
    ...statuses.map(s => [s, tasks.filter(t => t.status === s).length, tasks.length ? Math.round((tasks.filter(t => t.status === s).length / tasks.length) * 100) + '%' : '0%']),
  ];

  // ── Type distribution ──
  const typeSection = [
    [],
    ['TASK TYPE DISTRIBUTION'],
    ['Type', 'Count', '% of Total'],
    ...['story','task','bug'].map(tp => [tp, tasks.filter(t => t.type === tp).length, tasks.length ? Math.round((tasks.filter(t => t.type === tp).length / tasks.length) * 100) + '%' : '0%']),
  ];

  // Combine all sections into one sheet
  const aoa = [
    ...velocitySection,
    ...workloadSection,
    ...bugSection,
    ...releaseSection,
    ...statusSection,
    ...typeSection,
  ];

  return _xlBuildSheet(aoa, { filter: false, colWidths: [28,24,16,14,14,14,12,12,14,14] });
}

/** Sheet 11: Comments — REMOVED per product requirements */
/** Sheet 12: Audit Log — REMOVED per product requirements */
// These tabs have been removed from the export. Use the dedicated Audit Logs export for audit data.

// ══════════════════════════════════════════════════════════════════════════
//  MAIN ENTRY POINT
// ══════════════════════════════════════════════════════════════════════════
async function exportReportExcel(mode, fromDate, toDate, exportFilters) {
  mode = mode || 'analytics';

  // ── Close dropdown ──
  const menu = document.getElementById('rpt-export-menu');
  if (menu) menu.style.display = 'none';

  // ── RBAC guard ──
  if (mode === 'full' && RBAC.isMember()) {
    _rptToast('🔒 Excel export is not available for Members.', 'rgba(220,38,38,0.96)');
    return;
  }

  // ── Program Manager: sprint-only export, hard-scoped to their own projects ──
  if (mode === 'full' && !RBAC.isAdmin() && RBAC.isProgramManager()) {
    const _visibleSprintIds = new Set(RBAC.getVisibleSprints().map(s => s.id));
    const _reqSprintIds = (exportFilters && exportFilters.sprintIds) ? exportFilters.sprintIds : [];
    const _scopedSprintIds = _reqSprintIds.filter(id => _visibleSprintIds.has(id));
    if (!_scopedSprintIds.length) {
      _rptToast('🔒 Program Managers must select at least one sprint from their projects to export.', 'rgba(220,38,38,0.96)');
      return;
    }
    // Force-strip project/assignee filters — PM export is sprint-only
    exportFilters = { projectIds: [], sprintIds: _scopedSprintIds, assigneeIds: [] };
  }

  // ── Offline guard ──
  if (!navigator.onLine) {
    _rptToast('⚠ Offline mode: exporting latest synced data', 'rgba(245,158,11,0.96)');
  }

  // ── Guard ──
  if (!window.XLSX) {
    _rptToast('⚠ Excel library not loaded — please wait and retry.', '#dc2626');
    return;
  }

  // ── Lock UI ──
  _xlSetBtnState(true);
  _xlShowLoader(true);
  const modeLabels = {
    full:      'Building Full Database Export…',
    analytics: 'Building Analytics Export…'
  };
  _xlSetTitle(modeLabels[mode] || 'Building Excel…');
  _xlProgress(5, 'Collecting data…', '');

  let retryCount = 0;
  const MAX_RETRIES = 2;

  async function _doExport() {
    try {
      await _xlYield(60);

      // ── Collect data (filter-aware for 'full' mode) ──
      _xlProgress(10, 'Resolving data…', '');
      const data = (mode === 'full' && exportFilters)
        ? _xlGetDataWithFilters(mode, exportFilters)
        : _xlGetData(mode);
      await _xlYield();

      const wb = XLSX.utils.book_new();

      // ── Analytics-only mode: only Cover + Summary + Metrics ──
      if (mode === 'analytics') {
        _xlProgress(20, 'Building Cover…',   'Sheet 1/3');
        XLSX.utils.book_append_sheet(wb, _xlSheetCover(mode, data), '📋 Cover');
        _xlProgress(40, 'Building Summary…', 'Sheet 2/3');
        XLSX.utils.book_append_sheet(wb, _xlSheetSummary(data),     '📊 Summary');
        await _xlYield();
        _xlProgress(70, 'Building Metrics…', 'Sheet 3/3');
        XLSX.utils.book_append_sheet(wb, _xlSheetMetrics(data),     '📈 Metrics');
        _xlProgress(95, 'Saving…', '');
        await _xlYield(60);
        XLSX.writeFile(wb, _xlFilename(mode));
        _xlProgress(100, 'Done!', '');
        await _xlYield(80);
        _xlShowLoader(false);
        _xlSetBtnState(false);
        _rptToast(
          `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Analytics export saved`,
          'rgba(5,150,105,0.96)'
        );
        return;
      }

      // ── Full Database mode: sheet visibility based on active filters ──
      // Sheet visibility rules per spec:
      //   No filters       → all sheets
      //   Project filter   → all sheets (scoped to selected projects)
      //   Sprint-only      → Tasks, Epics, Releases, Team (no Cover/Summary/Metrics/Sprints/Projects)
      //   Assignee-only    → Tasks only
      //   Combined         → intersection of applicable rules
      const _f = data._exportFilters || {};
      const _fHasProj     = data._hasProj     || false;
      const _fHasSprint   = data._hasSprint   || false;
      const _fHasAssignee = data._hasAssignee || false;
      const _noFilters    = !_fHasProj && !_fHasSprint && !_fHasAssignee;
      const _projOrNone   = _noFilters || _fHasProj; // show project-wide sheets

      // Determine sheet set
      const _showCover    = _projOrNone;
      const _showSummary  = _projOrNone && !_fHasAssignee;
      const _showMetrics  = _projOrNone && !_fHasAssignee;
      const _showTasks    = true; // always
      const _showSprints  = _projOrNone && !_fHasAssignee;
      const _showEpics    = !_fHasAssignee;
      const _showReleases = !_fHasAssignee;
      const _showTeam     = !_fHasAssignee;
      const _showProjects = _projOrNone && !_fHasAssignee;

      // Count sheets to show (for progress)
      const _sheetFlags = [_showCover,_showSummary,_showMetrics,_showTasks,_showSprints,_showEpics,_showReleases,_showTeam,_showProjects];
      const totalSheets = _sheetFlags.filter(Boolean).length;
      let sheetIdx = 0;

      function progress(msg) {
        sheetIdx++;
        _xlProgress(10 + Math.round((sheetIdx / totalSheets) * 82), msg, `Sheet ${sheetIdx}/${totalSheets}`);
      }

      if (_showCover) {
        progress('Cover');
        XLSX.utils.book_append_sheet(wb, _xlSheetCover(mode, data), '📋 Cover');
        await _xlYield();
      }

      if (_showSummary) {
        progress('Summary');
        XLSX.utils.book_append_sheet(wb, _xlSheetSummary(data), '📊 Summary');
        await _xlYield();
      }

      if (_showMetrics) {
        progress('Metrics / Analytics');
        XLSX.utils.book_append_sheet(wb, _xlSheetMetrics(data), '📈 Metrics');
        await _xlYield();
      }

      if (_showTasks) {
        progress('Tasks (tasks + subtasks merged)');
        XLSX.utils.book_append_sheet(wb, await _xlSheetTasks(data), '✅ Tasks');
        await _xlYield();
      }

      if (_showSprints) {
        progress('Sprints');
        XLSX.utils.book_append_sheet(wb, _xlSheetSprints(data), '🏃 Sprints');
        await _xlYield();
      }

      if (_showEpics) {
        progress('Epics');
        XLSX.utils.book_append_sheet(wb, _xlSheetEpics(data), '🗺 Epics');
        await _xlYield();
      }

      if (_showReleases) {
        progress('Releases');
        XLSX.utils.book_append_sheet(wb, _xlSheetReleases(data), '🚀 Releases');
        await _xlYield();
      }

      if (_showTeam) {
        progress('Team Members');
        XLSX.utils.book_append_sheet(wb, _xlSheetTeam(data), '👥 Team');
        await _xlYield();
      }

      if (_showProjects) {
        progress('Projects');
        XLSX.utils.book_append_sheet(wb, _xlSheetProjects(data), '📁 Projects');
        await _xlYield();
      }

      // ── Write file ──
      _xlProgress(96, 'Writing file…', 'Finalising…');
      await _xlYield(80);

      XLSX.writeFile(wb, _xlFilename(mode));

      _xlProgress(100, 'Done!', '');
      await _xlYield(80);

      _xlShowLoader(false);
      _xlSetBtnState(false);

      const sheetCount = wb.SheetNames.length;
      _rptToast(
        `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Excel exported — ${sheetCount} sheets, ${data.tasks.length} tasks`,
        'rgba(5,150,105,0.96)'
      );

    } catch (err) {
      console.error('[SprintFlow Excel] Export error:', err);
      if (retryCount < MAX_RETRIES) {
        retryCount++;
        _xlProgress(0, `Retrying… (attempt ${retryCount + 1}/${MAX_RETRIES + 1})`, '');
        await _xlYield(900);
        return _doExport();
      }
      _xlShowLoader(false);
      _xlSetBtnState(false);
      _rptToast(
        `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> Excel export failed — ${err.message}`,
        'rgba(220,38,38,0.96)'
      );
    }
  }

  await _doExport();
}

const _xlGetData_orig = typeof _xlGetData === 'function' ? _xlGetData : null;

// ══════════════════════════════════════════════════════════════════════════
//  EXPORT FULL DATABASE — PROJECT / SPRINT / ASSIGNEE FILTER
//  Replaces the previous date-range filter.
//  exportFilters: { projectIds: string[], sprintIds: string[], assigneeIds: string[] }
//  Empty arrays = no filter (export all visible data for that dimension).
// ══════════════════════════════════════════════════════════════════════════

function _xlGetDataWithFilters(mode, exportFilters) {
  // Start from RBAC-scoped base (full mode uses raw state but still respects RBAC on filters)
  const data = _xlGetData ? _xlGetData(mode) : { tasks: [], subtasks: [], sprints: [], epics: [], releases: [], users: [], projects: [] };

  if (mode !== 'full' || !exportFilters) return data;

  const { projectIds = [], sprintIds = [], assigneeIds = [] } = exportFilters;
  const hasProj    = projectIds.length > 0;
  const hasSprint  = sprintIds.length > 0;
  const hasAssignee = assigneeIds.length > 0;

  // If no filters selected, return full data as-is
  if (!hasProj && !hasSprint && !hasAssignee) return data;

  // ── Filter tasks ──
  data.tasks = data.tasks.filter(t => {
    if (hasProj    && !projectIds.includes(t.project))  return false;
    if (hasSprint  && !sprintIds.includes(t.sprint))    return false;
    if (hasAssignee && !assigneeIds.includes(t.assignee)) return false;
    return true;
  });

  // ── Rebuild subtasks from filtered tasks, also filtering subtasks by assignee ──
  data.subtasks = data.tasks.flatMap(t =>
    (t.subtasks || [])
      .filter(s => !hasAssignee || assigneeIds.includes(s.assignee))
      .map(s => ({ ...s, _parentTask: t }))
  );

  // ── Store active assignee filter for sheet builders ──
  data._activeAssigneeIds = hasAssignee ? assigneeIds : null;

  // ── Filter sprints ──
  if (hasSprint) {
    data.sprints = data.sprints.filter(s => sprintIds.includes(s.id));
  } else if (hasProj) {
    data.sprints = data.sprints.filter(s => projectIds.includes(s.project));
  }

  // ── Filter epics ──
  // BUG FIX: Epic data model uses `projectId` (and optionally `projectIds`), not `project`.
  if (hasProj) {
    data.epics = data.epics.filter(e => {
      const epicPids = e.projectIds || (e.projectId ? [e.projectId] : []);
      return epicPids.some(pid => projectIds.includes(pid));
    });
  } else if (hasSprint) {
    // Sprint-only: include epics linked to tasks in the exported sprint task set
    const exportedEpicIds = new Set(data.tasks.map(t => t.epicId).filter(Boolean));
    data.epics = data.epics.filter(e => exportedEpicIds.has(e.id));
  }

  // ── Filter releases ──
  if (hasProj) {
    data.releases = data.releases.filter(r => projectIds.includes(r.projectId));
  } else if (hasSprint) {
    // Sprint-only: include releases linked to tasks in the exported sprint task set
    const exportedTaskIds = new Set(data.tasks.map(t => t.id));
    data.releases = data.releases.filter(r =>
      (r.taskIds || []).some(tid => exportedTaskIds.has(tid))
    );
  }

  // ── Filter projects ──
  if (hasProj) {
    data.projects = data.projects.filter(p => projectIds.includes(p.id));
  }

  // ── BUG FIX: Filter users (Team sheet) by project membership ──
  // Previously data.users was never filtered, so Team sheet always exported all members.
  if (hasProj) {
    // Include union of members across all selected projects
    const memberIdSet = new Set();
    data.projects.forEach(p => { (p.memberIds || []).forEach(id => memberIdSet.add(id)); });
    data.users = data.users.filter(u => memberIdSet.has(u.id));
  } else if (hasSprint) {
    // Sprint-only: include members who participated in the exported tasks/subtasks
    const participantIds = new Set();
    data.tasks.forEach(t => {
      if (t.assignee) participantIds.add(t.assignee);
      (t.subtasks || []).forEach(s => { if (s.assignee) participantIds.add(s.assignee); });
    });
    data.users = data.users.filter(u => participantIds.has(u.id));
  }
  // Assignee-only filter: users list not narrowed (Team sheet is suppressed for assignee-only)

  // ── Store filter metadata (for Cover sheet and sheet visibility) ──
  data._exportFilters = exportFilters;
  data._hasProj     = hasProj;
  data._hasSprint   = hasSprint;
  data._hasAssignee = hasAssignee;

  return data;
}

