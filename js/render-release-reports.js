// ═══════════════════════════════════════════════════════════════════
//  RELEASE REPORTS — Project & Sprint based released task reporting
//  NEW functions only — does NOT modify any existing Reports logic.
// ═══════════════════════════════════════════════════════════════════

// ── Internal state ──
let _rrInitialized = false;

// ── Read helpers — delegate to the new multi-select Sets ──
function _rrGetSelectedProjects(){ return [..._rrSelProjs2];   }
function _rrGetSelectedSprints(){  return [..._rrSelSprints2]; }

// ── Populate functions are now no-ops (buttons self-populate on click) ──
function _rrPopulateProjectSel(){}
function _rrPopulateSprintSel(){}

// ── Called when project filter changes ──
function _rrOnProjectChange(){ _debouncedRenderReleaseReports(); }

// ── Debounced render ──
let _rrFilterTimer = null;
function _debouncedRenderReleaseReports(){
  clearTimeout(_rrFilterTimer);
  _rrFilterTimer = setTimeout(() => renderReleaseReports(), 150);
}

// ── Reset filters ──
function _rrResetFilters(){
  _rrSelProjs2.clear();
  _rrSelSprints2.clear();
  const pl = document.getElementById('rr-proj-label'); if(pl) pl.textContent = 'All Projects';
  const sl = document.getElementById('rr-spr-label');  if(sl) sl.textContent = 'All Sprints';
  // Also reset date filter
  _rrClearDateFilter();
}

// ── Date Range filter state ──────────────────────────────────────────
// preset: 'all' | '7' | '30' | 'thismonth' | 'lastmonth' | 'custom'
// rangeStart / rangeEnd: Date objects (midnight) or null when inactive
let _rrDatePreset    = 'all';
let _rrDateRangeStart = null; // Date (start of day)
let _rrDateRangeEnd   = null; // Date (end of day)

// Compute start/end Dates for the current preset
function _rrComputeDateRange(){
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if(_rrDatePreset === '7'){
    _rrDateRangeStart = new Date(today); _rrDateRangeStart.setDate(today.getDate() - 6);
    _rrDateRangeEnd   = new Date(today); _rrDateRangeEnd.setHours(23,59,59,999);
  } else if(_rrDatePreset === '30'){
    _rrDateRangeStart = new Date(today); _rrDateRangeStart.setDate(today.getDate() - 29);
    _rrDateRangeEnd   = new Date(today); _rrDateRangeEnd.setHours(23,59,59,999);
  } else if(_rrDatePreset === 'thismonth'){
    _rrDateRangeStart = new Date(now.getFullYear(), now.getMonth(), 1);
    _rrDateRangeEnd   = new Date(now.getFullYear(), now.getMonth()+1, 0, 23, 59, 59, 999);
  } else if(_rrDatePreset === 'lastmonth'){
    _rrDateRangeStart = new Date(now.getFullYear(), now.getMonth()-1, 1);
    _rrDateRangeEnd   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  } else {
    _rrDateRangeStart = null; _rrDateRangeEnd = null;
  }
}

// Called when preset dropdown changes
function _rrOnDatePreset(){
  const sel = document.getElementById('rr-date-preset');
  if(!sel) return;
  _rrDatePreset = sel.value;
  const customRow = document.getElementById('rr-custom-dates');
  if(_rrDatePreset === 'custom'){
    if(customRow) customRow.style.display = 'inline-flex';
    // Don't re-render yet — wait for both dates
    _rrUpdateDateChip();
    return;
  }
  if(customRow) customRow.style.display = 'none';
  if(_rrDatePreset !== 'custom'){
    _rrDateRangeStart = null; _rrDateRangeEnd = null;
  }
  _rrComputeDateRange();
  _rrUpdateDateChip();
  _debouncedRenderReleaseReports();
}

// Called when custom date inputs change
function _rrOnCustomDate(){
  const fromEl = document.getElementById('rr-date-from');
  const toEl   = document.getElementById('rr-date-to');
  if(!fromEl || !toEl) return;
  if(fromEl.value && toEl.value){
    _rrDateRangeStart = new Date(fromEl.value + 'T00:00:00');
    _rrDateRangeEnd   = new Date(toEl.value   + 'T23:59:59');
    _rrUpdateDateChip();
    _debouncedRenderReleaseReports();
  }
}

// Update the active chip + clear button visibility
function _rrUpdateDateChip(){
  const chip    = document.getElementById('rr-date-active-chip');
  const clearBtn= document.getElementById('rr-date-clear-btn');
  if(!chip || !clearBtn) return;
  const labels  = { '7':'Last 7 Days', '30':'Last 30 Days', 'thismonth':'This Month', 'lastmonth':'Last Month' };
  if(_rrDatePreset === 'all'){
    chip.style.display = 'none'; clearBtn.style.display = 'none';
  } else if(_rrDatePreset === 'custom'){
    const fromEl = document.getElementById('rr-date-from');
    const toEl   = document.getElementById('rr-date-to');
    if(fromEl && toEl && fromEl.value && toEl.value){
      chip.innerHTML = `<span class="rr-date-active-chip">📅 ${fromEl.value} → ${toEl.value}</span>`;
      chip.style.display = 'inline'; clearBtn.style.display = 'inline';
    } else {
      chip.style.display = 'none'; clearBtn.style.display = 'none';
    }
  } else {
    chip.innerHTML = `<span class="rr-date-active-chip">📅 ${labels[_rrDatePreset]||''}</span>`;
    chip.style.display = 'inline'; clearBtn.style.display = 'inline';
  }
}

// Clear date filter back to All Time
function _rrClearDateFilter(){
  _rrDatePreset = 'all';
  _rrDateRangeStart = null;
  _rrDateRangeEnd   = null;
  const sel = document.getElementById('rr-date-preset'); if(sel) sel.value = 'all';
  const customRow = document.getElementById('rr-custom-dates'); if(customRow) customRow.style.display = 'none';
  const fromEl = document.getElementById('rr-date-from'); if(fromEl) fromEl.value = '';
  const toEl   = document.getElementById('rr-date-to');   if(toEl)   toEl.value   = '';
  _rrUpdateDateChip();
  _debouncedRenderReleaseReports();
}

// ── Get filtered released tasks (with subtask sprint inheritance) ──
function _getReleaseReportsData(){
  const selectedProjectIds = _rrGetSelectedProjects();
  const selectedSprintIds  = _rrGetSelectedSprints();

  // RBAC-gated — released parent tasks only
  let tasks = RBAC.getVisibleTasks(state.tasks).filter(t => (t.status || '') === 'released');

  // Subtask sprint inheritance: if a task has no sprint, inherit from its parent
  const _parentSprintMap = {};
  state.tasks.forEach(parent => {
    if(parent.sprint && Array.isArray(parent.subtasks)){
      parent.subtasks.forEach(sub => {
        if(!_parentSprintMap[sub.id]) _parentSprintMap[sub.id] = parent.sprint;
      });
    }
  });
  tasks = tasks.map(t => (!t.sprint && _parentSprintMap[t.id])
    ? { ...t, sprint: _parentSprintMap[t.id] } : t);

  // Project filter — empty = All
  if(selectedProjectIds.length > 0){
    tasks = tasks.filter(t => selectedProjectIds.includes(t.project));
  }
  // Sprint filter — empty = All
  if(selectedSprintIds.length > 0){
    tasks = tasks.filter(t => selectedSprintIds.includes(t.sprint));
  }

  // ── Date Range filter — based on sprint end date ──────────────────
  // Approach: a task belongs to a date range if its sprint's END date
  // falls within the selected range. This requires no schema changes —
  // sprint.end already exists on every sprint.
  if(_rrDateRangeStart && _rrDateRangeEnd){
    // Build a lookup: sprintId → end Date (parsed once)
    const _sprintEndMap = {};
    (state.sprints || []).forEach(s => {
      if(s.end) _sprintEndMap[s.id] = new Date(s.end + 'T23:59:59');
    });
    tasks = tasks.filter(t => {
      if(!t.sprint) return false; // task with no sprint cannot be date-matched
      const sprintEnd = _sprintEndMap[t.sprint];
      if(!sprintEnd) return false;
      return sprintEnd >= _rrDateRangeStart && sprintEnd <= _rrDateRangeEnd;
    });
  }
  // ─────────────────────────────────────────────────────────────────

  const involvedProjectIds = [...new Set(tasks.map(t => t.project).filter(Boolean))];
  const involvedSprintIds  = [...new Set(tasks.map(t => t.sprint).filter(Boolean))];

  return { tasks, involvedProjectIds, involvedSprintIds, selectedProjectIds, selectedSprintIds };
}

// ── Sprint spillover + delivery metrics for Release Reports ─────────────────
// REUSES the spillover snapshot already generated by SprintFlow at sprint
// completion (sprint.spilloverTasks / spilloverSubtasks / spilloverPoints /
// committedPoints). Does NOT introduce a new spillover calculation model.
//
// Delivery % is derived from a MIX of story points and tasks so it is accurate
// even for sprints completed before the points snapshot existed (those carry a
// spillover *task* count but spilloverPoints = 0). Pure points alone would read
// 100% for such sprints despite real spillover.
//
//   deliveredUnits = released story points + released task count   (in scope)
//   spilloverUnits = spillover points      + spillover task count  (snapshot)
//   committedUnits = deliveredUnits + spilloverUnits
//   delivery%      = deliveredUnits / committedUnits * 100
//
// committed (story-point figure) prefers the snapshot; else delivered + spillover pts.
function _rrSprintSpillover(sprintId, deliveredPoints, deliveredTasks){
  const s = getSprint(sprintId);
  deliveredTasks = deliveredTasks || 0;
  const spilloverTasks  = s ? ((s.spilloverTasks||0) + (s.spilloverSubtasks||0)) : 0;
  const spilloverPoints = s ? (s.spilloverPoints||0) : 0;

  // Story-point committed (for display): prefer snapshot; else delivered + spillover pts.
  let committed = (s && s.committedPoints != null) ? s.committedPoints
                                                   : (deliveredPoints + spilloverPoints);
  if(committed <= 0) committed = deliveredPoints;

  // Delivery %: blend points + tasks so spillover tasks lower the % even when
  // spilloverPoints is 0 (legacy sprints without the points snapshot).
  const deliveredUnits = deliveredPoints + deliveredTasks;
  const spilloverUnits = spilloverPoints + spilloverTasks;
  const committedUnits = deliveredUnits + spilloverUnits;
  const deliveryPct = committedUnits > 0
    ? Math.round((deliveredUnits / committedUnits) * 100) : 100;

  return { committed, delivered: deliveredPoints, spilloverPoints, spilloverTasks, deliveryPct };
}

// ── Main render function ──
function renderReleaseReports(){
  // Scope subtitle
  const subEl = document.getElementById('rr-scope-subtitle');
  if(subEl){
    const _rrDateLabel = _rrDatePreset === 'all' ? '' :
      _rrDatePreset === '7' ? ' · Last 7 Days' :
      _rrDatePreset === '30' ? ' · Last 30 Days' :
      _rrDatePreset === 'thismonth' ? ' · This Month' :
      _rrDatePreset === 'lastmonth' ? ' · Last Month' :
      (_rrDateRangeStart && _rrDateRangeEnd) ? ` · ${_rrDateRangeStart.toLocaleDateString()} – ${_rrDateRangeEnd.toLocaleDateString()}` : '';
    subEl.textContent = ((RBAC.isAdmin()||RBAC.isSeniorManager())
      ? 'Project & Sprint based released task reporting — All Projects'
      : 'Project & Sprint based released task reporting — Your Projects Only') + _rrDateLabel;
  }

  // Filters are driven by the multi-select button dropdowns — no populate needed here.
  _rrInitialized = true;

  const { tasks, involvedProjectIds, involvedSprintIds } = _getReleaseReportsData();

  // KPI cards
  const _setEl = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
  _setEl('rr-kpi-tasks',    tasks.length);
  _setEl('rr-kpi-points',   tasks.reduce((a, t) => a + (t.points || 0), 0));
  _setEl('rr-kpi-projects', involvedProjectIds.length);
  _setEl('rr-kpi-sprints',  involvedSprintIds.length);

  // Empty state toggle
  const emptyEl   = document.getElementById('rr-empty-state');
  const contentEl = document.getElementById('rr-content');
  if(!tasks.length){
    if(emptyEl)   emptyEl.style.display   = '';
    if(contentEl) contentEl.style.display = 'none';
    // Update empty message to hint at date filter if active
    const emptyMsg = document.getElementById('rr-empty-msg');
    if(emptyMsg){
      emptyMsg.textContent = _rrDatePreset !== 'all'
        ? 'No released tasks found for the selected date range. Try a wider range or All Time.'
        : 'No released tasks found for selected Projects/Sprints.';
    }
    // Clear theme section too
    const thEmptyEl   = document.getElementById('rr-theme-empty');
    const thContentEl = document.getElementById('rr-theme-content');
    if(thEmptyEl)   thEmptyEl.style.display   = '';
    if(thContentEl) thContentEl.style.display = 'none';
    ['rr-th-count','rr-th-items','rr-th-points'].forEach(id => { const el = document.getElementById(id); if(el) el.textContent = '0'; });
    const topEl = document.getElementById('rr-th-top'); if(topEl) topEl.textContent = '—';
    return;
  }
  if(emptyEl)   emptyEl.style.display   = 'none';
  if(contentEl) contentEl.style.display = '';

  // ── Project Release Breakdown ──
  const projTbody = document.getElementById('rr-project-tbody');
  if(projTbody){
    const projMap = {};
    tasks.forEach(t => {
      if(!t.project) return;
      if(!projMap[t.project]) projMap[t.project] = { count: 0, points: 0 };
      projMap[t.project].count++;
      projMap[t.project].points += (t.points || 0);
    });
    projTbody.innerHTML = Object.entries(projMap).map(([pid, data], idx) => {
      const proj = getProject(pid);
      const bg   = idx % 2 !== 0 ? 'background:rgba(0,0,0,0.018)' : '';
      return `<tr style="${bg};border-bottom:1px solid rgba(0,0,0,0.05)">
        <td style="padding:10px 14px;color:var(--text-primary);font-weight:500">${_escHtml(proj ? proj.name : pid)}</td>
        <td style="padding:10px 14px;text-align:right;font-variant-numeric:tabular-nums">${data.count}</td>
        <td style="padding:10px 14px;text-align:right;font-variant-numeric:tabular-nums">${data.points}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="3" style="padding:14px;text-align:center;color:var(--text-tertiary);font-size:13px">No project data</td></tr>';
  }

  // ── Sprint Release Breakdown ──
  const sprintTbody = document.getElementById('rr-sprint-tbody');
  if(sprintTbody){
    const sprintMap = {};
    tasks.forEach(t => {
      if(!t.sprint) return;
      const key = (t.sprint || '') + '|' + (t.project || '');
      if(!sprintMap[key]) sprintMap[key] = { sprintId: t.sprint, projectId: t.project, count: 0, points: 0 };
      sprintMap[key].count++;
      sprintMap[key].points += (t.points || 0);
    });
    sprintTbody.innerHTML = Object.values(sprintMap).map((data, idx) => {
      const sprint = getSprint(data.sprintId);
      const proj   = getProject(data.projectId);
      const bg     = idx % 2 !== 0 ? 'background:rgba(0,0,0,0.018)' : '';
      const m = _rrSprintSpillover(data.sprintId, data.points, data.count);
      const pctColor = m.deliveryPct >= 100 ? '#10b981' : (m.deliveryPct >= 70 ? '#d97706' : '#ef4444');
      return `<tr style="${bg};border-bottom:1px solid rgba(0,0,0,0.05)">
        <td style="padding:10px 14px;color:var(--text-primary);font-weight:500">${_escHtml(sprint ? sprint.name : data.sprintId)}</td>
        <td style="padding:10px 14px;color:var(--text-secondary)">${_escHtml(proj ? proj.name : (data.projectId || '\u2014'))}</td>
        <td style="padding:10px 14px;text-align:right;font-variant-numeric:tabular-nums">${data.count}</td>
        <td style="padding:10px 14px;text-align:right;font-variant-numeric:tabular-nums">${data.points}</td>
        <td style="padding:10px 14px;text-align:right;font-variant-numeric:tabular-nums">${m.spilloverTasks}</td>
        <td style="padding:10px 14px;text-align:right;font-variant-numeric:tabular-nums">${m.spilloverPoints}</td>
        <td style="padding:10px 14px;text-align:right;font-variant-numeric:tabular-nums;font-weight:700;color:${pctColor}">${m.deliveryPct}%</td>
      </tr>`;
    }).join('') || '<tr><td colspan="7" style="padding:14px;text-align:center;color:var(--text-tertiary);font-size:13px">No sprint data</td></tr>';
  }

  // ── Released Task Details ──
  const taskTbody = document.getElementById('rr-task-tbody');
  if(taskTbody){
    const priorityBadge = p => {
      const cls = { critical:'badge-critical', high:'badge-high', medium:'badge-medium', low:'badge-low' };
      return `<span class="badge ${cls[(p||'').toLowerCase()] || 'badge-open'}">${_escHtml(p || '\u2014')}</span>`;
    };
    taskTbody.innerHTML = tasks.map((t, idx) => {
      const proj   = getProject(t.project);
      const sprint = getSprint(t.sprint);
      const epic   = t.epicId ? getEpic(t.epicId) : null;
      const bg     = idx % 2 !== 0 ? 'background:rgba(0,0,0,0.018)' : '';
      const taskKey = proj ? (proj.key + '-' + (t.id || '').slice(-4).toUpperCase()) : (t.id || '\u2014');
      return `<tr style="${bg};border-bottom:1px solid rgba(0,0,0,0.04)">
        <td style="padding:9px 12px;font-family:'DM Mono',monospace;font-size:11.5px;color:var(--text-tertiary);white-space:nowrap">${_escHtml(taskKey)}</td>
        <td style="padding:9px 12px;color:var(--text-primary);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${_escHtml(t.title || '')}">${_escHtml(t.title || '\u2014')}</td>
        <td style="padding:9px 12px;color:var(--text-secondary)">${_escHtml(proj ? proj.name : '\u2014')}</td>
        <td style="padding:9px 12px;color:var(--text-secondary)">${_escHtml(sprint ? sprint.name : '\u2014')}</td>
        <td style="padding:9px 12px;color:var(--text-secondary)">${_escHtml(epic ? epic.title : '\u2014')}</td>
        <td style="padding:9px 12px">${priorityBadge(t.priority)}</td>
        <td style="padding:9px 12px;text-align:right;font-variant-numeric:tabular-nums">${t.points || 0}</td>
        <td style="padding:9px 12px"><span class="badge badge-released">Released</span></td>
      </tr>`;
    }).join('');
  }

  // ── Theme Release Analysis ──
  _renderRRThemeAnalysis(tasks);

  // ── Release Notes Summary ──
  _renderRRReleaseNotes();
}

// ── Theme Release Analysis ──────────────────────────────────────────────────
function _renderRRThemeAnalysis(tasks){
  // Visible themes filtered by RBAC (same pattern as dashboard theme analytics)
  const _visibleThemes = (state.themes || []).filter(th => {
    if(RBAC.isAdmin()) return true;
    const vpIds = new Set(RBAC.getVisibleProjects().map(p => p.id));
    return (th.projectIds || []).some(pid => vpIds.has(pid));
  });

  // Build per-theme map: themeId -> { name, color, projectIds, releasedTasks[], releasedSubtasks[], points }
  const themeMap = {};
  _visibleThemes.forEach(th => {
    themeMap[th.id] = {
      name: th.name,
      color: th.color || '#8b5cf6',
      projectIds: th.projectIds || [],
      releasedTasks: [],
      releasedSubtasks: [],
      points: 0
    };
  });

  // Walk filtered (already RBAC + project + sprint filtered) released parent tasks
  tasks.forEach(t => {
    const tid = t.themeId;
    if(tid && themeMap[tid]){
      themeMap[tid].releasedTasks.push(t);
      themeMap[tid].points += (t.points || 0);
      // Count released subtasks; subtask inherits parent themeId if no own themeId
      (t.subtasks || []).forEach(st => {
        if((st.status || '') === 'released'){
          const resolvedTid = st.themeId || tid;
          if(resolvedTid === tid){
            themeMap[tid].releasedSubtasks.push(st);
            themeMap[tid].points += (st.points || 0);
          }
        }
      });
    }
  });

  // Filter to themes with at least one released work item
  const entries = Object.entries(themeMap)
    .map(([id, d]) => ({ id, ...d, totalItems: d.releasedTasks.length + d.releasedSubtasks.length }))
    .filter(e => e.totalItems > 0)
    .sort((a, b) => b.totalItems - a.totalItems);

  const emptyEl   = document.getElementById('rr-theme-empty');
  const contentEl = document.getElementById('rr-theme-content');

  if(!entries.length){
    if(emptyEl)   emptyEl.style.display   = '';
    if(contentEl) contentEl.style.display = 'none';
    // Zero out summary cards
    ['rr-th-count','rr-th-items','rr-th-points'].forEach(id => {
      const el = document.getElementById(id); if(el) el.textContent = '0';
    });
    const topEl = document.getElementById('rr-th-top'); if(topEl) topEl.textContent = '—';
    return;
  }
  if(emptyEl)   emptyEl.style.display   = 'none';
  if(contentEl) contentEl.style.display = '';

  const totalItems  = entries.reduce((a, e) => a + e.totalItems, 0);
  const totalPoints = entries.reduce((a, e) => a + e.points, 0);
  const topTheme    = entries[0];

  // Summary cards
  const _s = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
  _s('rr-th-count',  entries.length);
  _s('rr-th-top',    topTheme ? topTheme.name : '—');
  _s('rr-th-items',  totalItems);
  _s('rr-th-points', totalPoints);

  // ── Work Items Chart (horizontal bar: Tasks + Subtasks stacked) ──
  if(charts.rrThemeItems){ try{ charts.rrThemeItems.destroy(); }catch(e){} delete charts.rrThemeItems; }
  const wiCtx = _getCtx('rrThemeItemsChart');
  if(wiCtx){
    const labels   = entries.map(e => e.name.length > 18 ? e.name.slice(0, 17) + '…' : e.name);
    const taskData = entries.map(e => e.releasedTasks.length);
    const subData  = entries.map(e => e.releasedSubtasks.length);
    const colors   = entries.map(e => (e.color || '#8b5cf6') + 'BF');
    const subClrs  = entries.map(e => (e.color || '#8b5cf6') + '66');
    const wiOpts = _chartOpts({ indexAxis:'y', plugins:{ legend:{ display:true, position:'top' } }, scales:{
      x:{ stacked:true, grid:{ color:'rgba(0,0,0,0.04)', lineWidth:1 }, ticks:{ font:{ family:'DM Sans', size:11 }, stepSize:1 } },
      y:{ stacked:true, grid:{ display:false }, ticks:{ font:{ family:'DM Sans', size:11 } } }
    }});
    wiOpts.plugins.datalabels = { display: ctx => ctx.dataset.data[ctx.dataIndex] > 0, anchor:'center', align:'center', clamp:true, color:'#fff', font:{ size:9, weight:'700' }, formatter: v => v };
    wiOpts.layout = { padding:{ right:28 } };
    charts.rrThemeItems = new Chart(wiCtx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label:'Tasks',    data: taskData, backgroundColor: colors,  borderRadius: 0 },
          { label:'Subtasks', data: subData,  backgroundColor: subClrs, borderRadius: [0,5,5,0] }
        ]
      },
      options: wiOpts
    });
  }

  // ── Story Points Chart (horizontal bar) ──
  if(charts.rrThemePoints){ try{ charts.rrThemePoints.destroy(); }catch(e){} delete charts.rrThemePoints; }
  const spCtx = _getCtx('rrThemePointsChart');
  if(spCtx){
    const labels   = entries.map(e => e.name.length > 18 ? e.name.slice(0, 17) + '…' : e.name);
    const ptData   = entries.map(e => e.points);
    const ptColors = entries.map(e => (e.color || '#8b5cf6') + 'CC');
    const spOpts = _chartOpts({ indexAxis:'y', plugins:{ legend:{ display:false } }, scales:{
      x:{ grid:{ color:'rgba(0,0,0,0.04)', lineWidth:1 }, ticks:{ font:{ family:'DM Sans', size:11 } } },
      y:{ grid:{ display:false }, ticks:{ font:{ family:'DM Sans', size:11 } } }
    }});
    spOpts.plugins.datalabels = { display: ctx => ctx.dataset.data[ctx.dataIndex] > 0, anchor:'end', align:'right', clamp:true, color:'var(--text-secondary)', font:{ size:9, weight:'700' }, formatter: v => v };
    spOpts.layout = { padding:{ right:36 } };
    charts.rrThemePoints = new Chart(spCtx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label:'Story Points', data: ptData, backgroundColor: ptColors, borderRadius: 5 }
        ]
      },
      options: spOpts
    });
  }

  // ── Theme Breakdown Table ──
  const tbody = document.getElementById('rr-theme-tbody');
  if(tbody){
    tbody.innerHTML = entries.map((e, idx) => {
      const bg = idx % 2 !== 0 ? 'background:rgba(0,0,0,0.018)' : '';
      // Resolve project names for this theme
      const projNames = (e.projectIds || [])
        .map(pid => { const p = getProject(pid); return p ? _escHtml(p.name) : null; })
        .filter(Boolean).join(', ') || '—';
      // Color swatch
      const swatch = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${_escHtml(e.color)};margin-right:6px;flex-shrink:0;vertical-align:middle"></span>`;
      return `<tr style="${bg};border-bottom:1px solid rgba(0,0,0,0.05)">
        <td style="padding:10px 14px;color:var(--text-primary);font-weight:600;white-space:nowrap">${swatch}${_escHtml(e.name)}</td>
        <td style="padding:10px 14px;color:var(--text-secondary);font-size:12px">${projNames}</td>
        <td style="padding:10px 14px;text-align:right;font-variant-numeric:tabular-nums">${e.releasedTasks.length}</td>
        <td style="padding:10px 14px;text-align:right;font-variant-numeric:tabular-nums">${e.releasedSubtasks.length}</td>
        <td style="padding:10px 14px;text-align:right;font-variant-numeric:tabular-nums;font-weight:600;color:var(--accent)">${e.totalItems}</td>
        <td style="padding:10px 14px;text-align:right;font-variant-numeric:tabular-nums">${e.points}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="6" style="padding:14px;text-align:center;color:var(--text-tertiary);font-size:13px">No theme data</td></tr>';
  }
}

// ── Release Notes Summary ───────────────────────────────────────────────────
// Surfaces existing Release entity data (name, version, releaseDate, releaseNotes)
// mapped to sprints. REUSES existing fields only — no new field, no migration.
// Honors the same Project / Sprint / Date Range filters as the rest of the report.
function _renderRRReleaseNotes(){
  const tbody = document.getElementById('rr-relnotes-tbody');
  if(!tbody) return;

  const selectedProjectIds = _rrGetSelectedProjects();
  const selectedSprintIds  = _rrGetSelectedSprints();

  // RBAC-gated releases (same visibility helper used elsewhere)
  let releases = RBAC.isAdmin()
    ? (state.releases || [])
    : (state.releases || []).filter(r => {
        const vpIds = new Set(RBAC.getVisibleProjects().map(p => p.id));
        return vpIds.has(r.projectId);
      });

  // Project filter — empty = All
  if(selectedProjectIds.length > 0){
    releases = releases.filter(r => selectedProjectIds.includes(r.projectId));
  }
  // Sprint filter — empty = All
  if(selectedSprintIds.length > 0){
    releases = releases.filter(r => selectedSprintIds.includes(r.sprintId));
  }
  // Date Range filter — based on sprint end date (same approach as task filter)
  if(_rrDateRangeStart && _rrDateRangeEnd){
    const _sprintEndMap = {};
    (state.sprints || []).forEach(s => { if(s.end) _sprintEndMap[s.id] = new Date(s.end + 'T23:59:59'); });
    releases = releases.filter(r => {
      const end = _sprintEndMap[r.sprintId];
      if(!end) return false;
      return end >= _rrDateRangeStart && end <= _rrDateRangeEnd;
    });
  }

  // Sort by sprint then release date for stable, auditable ordering
  releases = releases.slice().sort((a, b) => {
    const sa = (getSprint(a.sprintId) || {}).name || '';
    const sb = (getSprint(b.sprintId) || {}).name || '';
    if(sa !== sb) return sa.localeCompare(sb);
    return (a.releaseDate || '').localeCompare(b.releaseDate || '');
  });

  if(!releases.length){
    tbody.innerHTML = '<tr><td colspan="6" style="padding:14px;text-align:center;color:var(--text-tertiary);font-size:13px">No releases found for selected Projects/Sprints/Date Range.</td></tr>';
    return;
  }

  // One row per release (multi-release sprints show all rows)
  tbody.innerHTML = releases.map((r, idx) => {
    const sprint = getSprint(r.sprintId);
    const proj   = getProject(r.projectId);
    const bg     = idx % 2 !== 0 ? 'background:rgba(0,0,0,0.018)' : '';
    const hasNotes = r.releaseNotes && r.releaseNotes.trim();
    const notesCell = hasNotes
      ? `<span style="color:var(--text-primary)">${_escHtml(r.releaseNotes.trim())}</span>`
      : `<span style="color:var(--text-tertiary);font-style:italic">No release notes provided</span>`;
    return `<tr style="${bg};border-bottom:1px solid rgba(0,0,0,0.05);vertical-align:top">
      <td style="padding:10px 14px;color:var(--text-primary);font-weight:500;white-space:nowrap">${_escHtml(sprint ? sprint.name : (r.sprintId || '\u2014'))}</td>
      <td style="padding:10px 14px;color:var(--text-secondary);white-space:nowrap">${_escHtml(proj ? proj.name : (r.projectId || '\u2014'))}</td>
      <td style="padding:10px 14px;color:var(--text-primary)">${_escHtml(r.name || '\u2014')}</td>
      <td style="padding:10px 14px;font-family:'DM Mono',monospace;font-size:11.5px;color:var(--text-tertiary);white-space:nowrap">v${_escHtml(r.version || '\u2014')}</td>
      <td style="padding:10px 14px;color:var(--text-secondary);white-space:nowrap">${r.releaseDate ? _escHtml(formatDate(r.releaseDate)) : '\u2014'}</td>
      <td style="padding:10px 14px;max-width:360px">${notesCell}</td>
    </tr>`;
  }).join('');
}

// ── Export Release Reports to PDF ──
function exportReleaseReportsPDF(){
  if(typeof window.jspdf === 'undefined'){
    showNotif('PDF library not loaded', 'error'); return;
  }
  const { jsPDF } = window.jspdf;

  const { tasks, involvedProjectIds, involvedSprintIds, selectedProjectIds, selectedSprintIds } = _getReleaseReportsData();

  const visProjects = RBAC.getVisibleProjects();
  const visSprints  = RBAC.getVisibleSprints();

  const selProjNames   = selectedProjectIds.length   ? selectedProjectIds.map(id => { const p = visProjects.find(x => x.id === id); return p ? p.name : id; })   : ['All Projects'];
  const selSprintNames = selectedSprintIds.length    ? selectedSprintIds.map(id => { const s = visSprints.find(x => x.id === id);  return s ? s.name : id; })    : ['All Sprints'];

  const totalPoints = tasks.reduce((a, t) => a + (t.points || 0), 0);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });

  const _rrDatePdfLabel = _rrDatePreset === 'all' ? 'All Time' :
    _rrDatePreset === '7' ? 'Last 7 Days' :
    _rrDatePreset === '30' ? 'Last 30 Days' :
    _rrDatePreset === 'thismonth' ? 'This Month' :
    _rrDatePreset === 'lastmonth' ? 'Last Month' :
    (_rrDateRangeStart && _rrDateRangeEnd) ? `${_rrDateRangeStart.toLocaleDateString()} – ${_rrDateRangeEnd.toLocaleDateString()}` : 'All Time';

  const meta = {
    date: new Date().toLocaleDateString(),
    user: state.currentUser ? (state.currentUser.name || state.currentUser.email || '') : '',
    filters: 'Projects: ' + selProjNames.slice(0, 3).join(', ') + (selProjNames.length > 3 ? '…' : '') +
             '  |  Sprints: ' + selSprintNames.slice(0, 3).join(', ') + (selSprintNames.length > 3 ? '…' : '') +
             '  |  Date Range: ' + _rrDatePdfLabel
  };

  // Rough total page count estimate (1 summary + 1 breakdown + task pages)
  const estTaskPages = Math.max(1, Math.ceil(tasks.length / 28));
  const estTotal     = 2 + estTaskPages;

  // ── PAGE 1: Release Summary ──
  _pdfDrawHeader(doc, meta, 'Release Reports');
  const ca = _pdfContentArea(doc);
  let y = ca.y + 8;

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...PDF_TEXT_DARK);
  doc.text('Release Summary', ca.x, y + 14);
  y += 32;

  // 4-stat boxes
  const boxW = (ca.w - 9) / 4;
  [
    { label: 'Released Tasks',   value: String(tasks.length) },
    { label: 'Story Points',     value: String(totalPoints)  },
    { label: 'Projects',         value: String(involvedProjectIds.length) },
    { label: 'Sprints',          value: String(involvedSprintIds.length)  }
  ].forEach((s, i) => {
    const bx = ca.x + i * (boxW + 3);
    doc.setFillColor(245, 247, 252);
    doc.roundedRect(bx, y, boxW, 52, 6, 6, 'F');
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...PDF_ACCENT);
    doc.text(s.value, bx + boxW / 2, y + 28, { align: 'center' });
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...PDF_TEXT_LIGHT);
    doc.text(s.label, bx + boxW / 2, y + 44, { align: 'center' });
  });
  y += 68;

  // Selected Projects list
  y = _pdfSectionBand(doc, 'Selected Projects', y);
  selProjNames.forEach(name => {
    doc.setFontSize(11); doc.setFont('helvetica', 'normal'); doc.setTextColor(...PDF_TEXT_MID);
    doc.text('\u2022 ' + name, ca.x + 8, y);
    y += 17;
  });
  y += 8;

  // Selected Sprints list
  y = _pdfSectionBand(doc, 'Selected Sprints', y);
  selSprintNames.forEach(name => {
    doc.setFontSize(11); doc.setFont('helvetica', 'normal'); doc.setTextColor(...PDF_TEXT_MID);
    doc.text('\u2022 ' + name, ca.x + 8, y);
    y += 17;
  });

  _pdfDrawFooter(doc, 1, estTotal, tasks.length);

  // ── PAGE 2: Project & Sprint Breakdown ──
  doc.addPage();
  _pdfDrawHeader(doc, meta, 'Release Reports');
  y = ca.y + 8;

  y = _pdfSectionBand(doc, 'Project Release Breakdown', y);
  const projMap = {};
  tasks.forEach(t => {
    if(!t.project) return;
    if(!projMap[t.project]) projMap[t.project] = { count: 0, points: 0 };
    projMap[t.project].count++;
    projMap[t.project].points += (t.points || 0);
  });
  if(typeof doc.autoTable === 'function'){
    doc.autoTable({
      startY: y,
      margin: { left: ca.x, right: PDF_MARGIN },
      head: [['Project', 'Released Tasks', 'Released Story Points']],
      body: Object.entries(projMap).map(([pid, d]) => { const p = getProject(pid); return [p ? p.name : pid, d.count, d.points]; }),
      headStyles: { fillColor: PDF_ACCENT, textColor: 255, fontStyle: 'bold', fontSize: 9 },
      bodyStyles: { fontSize: 10, textColor: PDF_TEXT_MID },
      alternateRowStyles: { fillColor: [248, 249, 252] },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
      theme: 'grid'
    });
    y = doc.lastAutoTable.finalY + 20;
  }

  y = _pdfSectionBand(doc, 'Sprint Release Breakdown', y);
  const sprintMap2 = {};
  tasks.forEach(t => {
    if(!t.sprint) return;
    const key = (t.sprint || '') + '|' + (t.project || '');
    if(!sprintMap2[key]) sprintMap2[key] = { sprintId: t.sprint, projectId: t.project, count: 0, points: 0 };
    sprintMap2[key].count++;
    sprintMap2[key].points += (t.points || 0);
  });
  if(typeof doc.autoTable === 'function'){
    doc.autoTable({
      startY: y,
      margin: { left: ca.x, right: PDF_MARGIN },
      head: [['Sprint', 'Project', 'Released Tasks', 'Released Story Points', 'Spillover Tasks', 'Spillover Points', 'Delivery %']],
      body: Object.values(sprintMap2).map(d => {
        const s = getSprint(d.sprintId); const p = getProject(d.projectId);
        const m = _rrSprintSpillover(d.sprintId, d.points, d.count);
        return [s ? s.name : d.sprintId, p ? p.name : (d.projectId || '\u2014'), d.count, d.points,
                m.spilloverTasks, m.spilloverPoints, m.deliveryPct + '%'];
      }),
      headStyles: { fillColor: PDF_ACCENT, textColor: 255, fontStyle: 'bold', fontSize: 9 },
      bodyStyles: { fontSize: 10, textColor: PDF_TEXT_MID },
      alternateRowStyles: { fillColor: [248, 249, 252] },
      columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
      theme: 'grid'
    });
  }
  _pdfDrawFooter(doc, 2, estTotal, tasks.length);

  // ── PAGE 3+: Released Task Details ──
  doc.addPage();
  _pdfDrawHeader(doc, meta, 'Release Reports');
  y = ca.y + 8;
  y = _pdfSectionBand(doc, 'Released Task Details', y);

  if(typeof doc.autoTable === 'function'){
    doc.autoTable({
      startY: y + 4,
      margin: { left: ca.x, right: PDF_MARGIN },
      head: [['Task ID', 'Title', 'Project', 'Sprint', 'Epic', 'Priority', 'Pts', 'Status']],
      body: tasks.map(t => {
        const proj   = getProject(t.project);
        const sprint = getSprint(t.sprint);
        const epic   = t.epicId ? getEpic(t.epicId) : null;
        const key    = proj ? proj.key + '-' + (t.id || '').slice(-4).toUpperCase() : (t.id || '\u2014');
        return [key, t.title || '\u2014', proj ? proj.name : '\u2014', sprint ? sprint.name : '\u2014',
                epic ? epic.title : '\u2014', t.priority || '\u2014', t.points || 0, 'Released'];
      }),
      headStyles: { fillColor: PDF_ACCENT, textColor: 255, fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 8.5, textColor: PDF_TEXT_MID },
      alternateRowStyles: { fillColor: [248, 249, 252] },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 46 },
        1: { cellWidth: 120 },
        6: { halign: 'right', cellWidth: 24 },
        7: { cellWidth: 46 }
      },
      theme: 'grid',
      didDrawPage: function(data) {
        _pdfDrawHeader(doc, meta, 'Release Reports');
      }
    });
  }

  // ── Release Notes Summary (reuses existing Release entity data + same filters) ──
  if(typeof doc.autoTable === 'function'){
    const selProjIds = selectedProjectIds;
    const selSprIds  = selectedSprintIds;
    let releases = RBAC.isAdmin()
      ? (state.releases || [])
      : (state.releases || []).filter(r => {
          const vpIds = new Set(RBAC.getVisibleProjects().map(p => p.id));
          return vpIds.has(r.projectId);
        });
    if(selProjIds.length > 0) releases = releases.filter(r => selProjIds.includes(r.projectId));
    if(selSprIds.length  > 0) releases = releases.filter(r => selSprIds.includes(r.sprintId));
    if(_rrDateRangeStart && _rrDateRangeEnd){
      const _endMap = {};
      (state.sprints || []).forEach(s => { if(s.end) _endMap[s.id] = new Date(s.end + 'T23:59:59'); });
      releases = releases.filter(r => { const e = _endMap[r.sprintId]; return e && e >= _rrDateRangeStart && e <= _rrDateRangeEnd; });
    }
    releases = releases.slice().sort((a, b) => {
      const sa = (getSprint(a.sprintId) || {}).name || '';
      const sb = (getSprint(b.sprintId) || {}).name || '';
      if(sa !== sb) return sa.localeCompare(sb);
      return (a.releaseDate || '').localeCompare(b.releaseDate || '');
    });

    doc.addPage();
    _pdfDrawHeader(doc, meta, 'Release Reports');
    let yn = ca.y + 8;
    yn = _pdfSectionBand(doc, 'Release Notes Summary', yn);
    doc.autoTable({
      startY: yn + 4,
      margin: { left: ca.x, right: PDF_MARGIN },
      head: [['Sprint', 'Project', 'Release', 'Version', 'Release Date', 'Release Notes']],
      body: releases.length ? releases.map(r => {
        const s = getSprint(r.sprintId); const p = getProject(r.projectId);
        const notes = (r.releaseNotes && r.releaseNotes.trim()) ? r.releaseNotes.trim() : 'No release notes provided';
        return [s ? s.name : (r.sprintId || '\u2014'), p ? p.name : (r.projectId || '\u2014'),
                r.name || '\u2014', 'v' + (r.version || '\u2014'),
                r.releaseDate ? formatDate(r.releaseDate) : '\u2014', notes];
      }) : [['\u2014','\u2014','\u2014','\u2014','\u2014','No releases found for selected filters']],
      headStyles: { fillColor: PDF_ACCENT, textColor: 255, fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 8.5, textColor: PDF_TEXT_MID },
      alternateRowStyles: { fillColor: [248, 249, 252] },
      columnStyles: { 0:{cellWidth:70}, 3:{cellWidth:44}, 4:{cellWidth:60}, 5:{cellWidth:160} },
      theme: 'grid',
      didDrawPage: function(){ _pdfDrawHeader(doc, meta, 'Release Reports'); }
    });
  }

  // Draw footer on all pages
  const totalPages = doc.internal.getNumberOfPages();
  for(let pg = 1; pg <= totalPages; pg++){
    doc.setPage(pg);
    _pdfDrawFooter(doc, pg, totalPages, tasks.length);
  }

  doc.save('SprintFlow-ReleaseReport-' + new Date().toISOString().slice(0, 10) + '.pdf');
  showNotif('Release Report PDF exported \u2713');
}
// ── END RELEASE REPORTS ──────────────────────────────────────────────────────

// ══════════════════════════════════════════════════════════════════
//  RELEASE REPORTS PAGE — multi-select filter state + helpers
// ══════════════════════════════════════════════════════════════════
const _rrSelProjs2   = new Set(); // selected project IDs; empty = All
const _rrSelSprints2 = new Set(); // selected sprint IDs;  empty = All

// Open project dropdown for Release Reports
function _rrToggleProjDrop(e){
  const p = document.getElementById('sf-msdrop-panel');
  if(p && p.style.display !== 'none' && _rrToggleProjDrop._open){
    _sfMsDrop.apply(); _rrToggleProjDrop._open = false; return;
  }
  const allProj = RBAC.getVisibleProjects();
  const active    = allProj.filter(p => (p.status||'').toLowerCase() === 'active');
  const completed = allProj.filter(p => (p.status||'').toLowerCase() === 'completed');
  const items = [
    ...active.map(p    => ({ id: p.id, name: p.name, group: active.length    ? 'Active'    : '' })),
    ...completed.map(p => ({ id: p.id, name: p.name, group: completed.length ? 'Completed' : '' }))
  ];
  _sfMsDrop.open(
    document.getElementById('rr-proj-btn'),
    items,
    _rrSelProjs2,
    sel => { _rrSelProjs2.clear(); sel.forEach(id => _rrSelProjs2.add(id)); _rrOnProjApply2(); },
    document.getElementById('rr-proj-label')
  );
  document.getElementById('rr-proj-label').dataset.allLabel = 'All Projects';
  _rrToggleProjDrop._open = true;
}
_rrToggleProjDrop._open = false;

// Open sprint dropdown for Release Reports
function _rrToggleSprintDrop(e){
  const p = document.getElementById('sf-msdrop-panel');
  if(p && p.style.display !== 'none' && _rrToggleSprintDrop._open){
    _sfMsDrop.apply(); _rrToggleSprintDrop._open = false; return;
  }
  const selPids = [..._rrSelProjs2];
  let allSpr = RBAC.getVisibleSprints();
  if(selPids.length) allSpr = allSpr.filter(s => selPids.includes(s.project));
  const active    = allSpr.filter(s => (s.status||'').toLowerCase() === 'active');
  const completed = allSpr.filter(s => (s.status||'').toLowerCase() === 'completed');
  const items = [
    ...active.map(s    => ({ id: s.id, name: s.name, group: active.length    ? 'Active'    : '' })),
    ...completed.map(s => ({ id: s.id, name: s.name, group: completed.length ? 'Completed' : '' }))
  ];
  _sfMsDrop.open(
    document.getElementById('rr-spr-btn'),
    items,
    _rrSelSprints2,
    sel => { _rrSelSprints2.clear(); sel.forEach(id => _rrSelSprints2.add(id)); _debouncedRenderReleaseReports(); },
    document.getElementById('rr-spr-label')
  );
  document.getElementById('rr-spr-label').dataset.allLabel = 'All Sprints';
  _rrToggleSprintDrop._open = true;
}
_rrToggleSprintDrop._open = false;

function _rrOnProjApply2(){
  // Prune sprint selections no longer in scope
  const selPids = [..._rrSelProjs2];
  if(selPids.length){
    [..._rrSelSprints2].forEach(sid => {
      const s = RBAC.getVisibleSprints().find(x => x.id === sid);
      if(!s || !selPids.includes(s.project)) _rrSelSprints2.delete(sid);
    });
    const sprLbl = document.getElementById('rr-spr-label');
    if(sprLbl){
      if(_rrSelSprints2.size === 0) sprLbl.textContent = 'All Sprints';
      else if(_rrSelSprints2.size === 1){
        const s = RBAC.getVisibleSprints().find(x => x.id === [..._rrSelSprints2][0]);
        sprLbl.textContent = s ? s.name : '1 selected';
      } else sprLbl.textContent = _rrSelSprints2.size + ' selected';
    }
  }
  _debouncedRenderReleaseReports();
}
// ── END SHARED MULTI-SELECT SYSTEM ───────────────────────────────────────────

