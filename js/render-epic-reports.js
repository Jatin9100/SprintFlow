// ── Resolve an epic's mapped project id(s), tolerating legacy single-projectId records ──
function _erEpicProjectIds(epic){
  return (epic.projectIds && epic.projectIds.length) ? epic.projectIds : (epic.projectId ? [epic.projectId] : []);
}
function _erEpicProjectNames(epic){
  const ids = _erEpicProjectIds(epic);
  const names = ids.map(id => { const p = getProject(id); return p ? p.name : id; }).filter(Boolean);
  return names.length ? names.join(', ') : '\u2014';
}

// ── RBAC-scoped epic list, narrowed by the Project filter (if any) ──────
function _erGetScopedEpics(){
  const projSel = document.getElementById('er-project-filter');
  const projectId = projSel ? projSel.value : 'all';
  let epics = RBAC.getVisibleEpics();
  if(projectId !== 'all'){
    epics = epics.filter(e => _erEpicProjectIds(e).includes(projectId));
  }
  return epics.slice().sort((a,b) => (a.title||'').localeCompare(b.title||''));
}

// ── Populate Project + Epic dropdowns, preserving a still-valid selection ──
function _erPopulateFilters(){
  const projSel = document.getElementById('er-project-filter');
  const epicSel = document.getElementById('er-epic-filter');
  if(!projSel || !epicSel) return;

  const currentProj  = projSel.value || 'all';
  const visProjects  = RBAC.getVisibleProjects();
  projSel.innerHTML = `<option value="all">All Projects</option>` +
    visProjects.map(p => `<option value="${p.id}"${p.id===currentProj?' selected':''}>${_escHtml(p.name)}</option>`).join('');
  if(currentProj !== 'all' && !visProjects.some(p=>p.id===currentProj)) projSel.value = 'all';

  const currentEpic  = epicSel.value || 'all';
  const scopedEpics  = _erGetScopedEpics();
  epicSel.innerHTML = `<option value="all">All Epics</option>` +
    scopedEpics.map(e => `<option value="${e.id}"${e.id===currentEpic?' selected':''}>${_escHtml(e.title)}</option>`).join('');
  if(currentEpic !== 'all' && !scopedEpics.some(e=>e.id===currentEpic)) epicSel.value = 'all';
}

function _erOnProjectChange(){
  _erPopulateFilters(); // project change may invalidate the current epic selection
  _debouncedRenderEpicReports();
}
function _erOnEpicChange(){
  _debouncedRenderEpicReports();
}
// Row click convenience — jump straight into single-epic view
function _erSelectEpic(epicId){
  const epicSel = document.getElementById('er-epic-filter');
  if(epicSel) epicSel.value = epicId;
  renderEpicReports();
}

let _erFilterTimer = null;
function _debouncedRenderEpicReports(){
  clearTimeout(_erFilterTimer);
  _erFilterTimer = setTimeout(() => renderEpicReports(), 150);
}

// ── Central data resolver — single source of truth for render + PDF + Excel ──
function _getEpicReportsData(){
  const epicSel = document.getElementById('er-epic-filter');
  const selectedEpicId = epicSel ? epicSel.value : 'all';
  const epics = _erGetScopedEpics();
  const selectedEpic = (selectedEpicId !== 'all') ? epics.find(e => e.id === selectedEpicId) : null;
  return { epics, selectedEpicId, selectedEpic };
}

// ── Per-epic metric bundle — reuses the SAME shared helpers the Epics page
//    and Excel export already use, so figures always match elsewhere in the app.
//    "Released" = status === 'released' (matches _xlSheetEpics convention).
function _erEpicMetrics(epic){
  const tasks       = getEpicTasks(epic.id);      // shared helper (Epics page)
  const prog        = getEpicProgress(epic.id);   // shared helper — tasks+subtasks combined %
  const pts         = getEpicStoryPoints(epic.id);// shared helper
  const released    = tasks.filter(t => t.status === 'released').length;
  const releasedPts = tasks.filter(t => t.status === 'released').reduce((a,t)=>a+(t.points||0),0);
  return { tasks, prog, pts, released, releasedPts };
}

// ── CXO-facing charts: comparison across all epics + per-epic progress ────
// Palette mirrors the existing status badge colors (see .badge-* CSS) so
// chart colors stay visually consistent with the tables on this same page.
const _ER_STATUS_COLORS = {
  'open':'#64748b','dev-in-progress':'#2563eb','dev-completed':'#4f46e5',
  'in-qa':'#d97706','qa-in-progress':'#ea580c','reopen':'#dc2626','on-hold':'#9a3412',
  'pending-with-client':'#ca8a04','ready-for-prod':'#059669','released':'#16a34a'
};
function _erStatusColor(s){ return _ER_STATUS_COLORS[s] || '#94a3b8'; }

// Destroy-before-recreate helper (same registry/pattern used app-wide via `charts{}`)
function _erDestroyChart(key){
  if(charts[key]){ try{ charts[key].destroy(); }catch(e){} delete charts[key]; }
}

// ── Overview mode: 3 comparison bar charts (many epics, vertical scroll) + 1 portfolio doughnut ──
function _erRenderOverviewCharts(rows){
  const labels = rows.map(({e}) => (e.title||'').length>16 ? e.title.slice(0,15)+'\u2026' : (e.title||''));
  const colors = rows.map(({e}) => e.color || '#8b5cf6');

  // 1. Progress by Epic — stacked horizontal bar (Completed vs Remaining, tasks+subtasks combined)
  _erDestroyChart('erProgress');
  const pCtx = _getCtx('erProgressChart');
  if(pCtx){
    const done = rows.map(({m}) => m.prog.combinedDone);
    const remaining = rows.map(({m}) => m.prog.combinedTotal - m.prog.combinedDone);
    const pOpts = _chartOpts({
      indexAxis:'y',
      plugins:{ legend:{ display:true, position:'top' } },
      scales:{
        x:{ stacked:true, grid:{ color:'rgba(0,0,0,0.04)', lineWidth:1 }, ticks:{ font:{ family:'DM Sans', size:11 }, stepSize:1 } },
        y:{ stacked:true, grid:{ display:false }, ticks:{ font:{ family:'DM Sans', size:11 } } }
      }
    });
    pOpts.plugins.datalabels = { display: ctx=>ctx.dataset.data[ctx.dataIndex]>0, anchor:'center', align:'center', clamp:true, color:'#fff', font:{ size:9, weight:'700' }, formatter:v=>v };
    const pIn = document.getElementById('erProgressChart-inner');
    if(pIn) pIn.style.height = Math.max(240, (rows.length||1)*34) + 'px';
    charts.erProgress = new Chart(pCtx, {
      type:'bar',
      data:{ labels: labels.length?labels:['No Epics'], datasets:[
        { label:'Completed', data: done.length?done:[0], backgroundColor: colors.map(c=>c+'cc'), borderRadius:4 },
        { label:'Remaining', data: remaining.length?remaining:[0], backgroundColor:'#e2e8f0', borderRadius:4 }
      ]},
      options: pOpts
    });
  }

  // 2. Completion % Ranking — single horizontal bar, sorted desc, health-coded colors
  _erDestroyChart('erCompletionRank');
  const rCtx = _getCtx('erCompletionRankChart');
  if(rCtx){
    const ranked = rows.slice().sort((a,b) => b.m.prog.pct - a.m.prog.pct);
    const rLabels = ranked.map(({e}) => (e.title||'').length>16 ? e.title.slice(0,15)+'\u2026' : (e.title||''));
    const rData   = ranked.map(({m}) => m.prog.pct);
    const rColors = rData.map(p => p>=80 ? '#16a34a' : (p>=50 ? '#d97706' : '#dc2626'));
    const rOpts = _chartOpts({
      indexAxis:'y',
      plugins:{ legend:{ display:false } },
      scales:{
        x:{ max:100, grid:{ color:'rgba(0,0,0,0.04)', lineWidth:1 }, ticks:{ font:{ family:'DM Sans', size:11 }, callback:v=>v+'%' } },
        y:{ grid:{ display:false }, ticks:{ font:{ family:'DM Sans', size:11 } } }
      }
    });
    rOpts.plugins.datalabels = { display:true, anchor:'end', align:'right', offset:4, clamp:true, clip:false, color:'#4a5066', font:{ size:10, weight:'700' }, formatter:v=>v+'%' };
    rOpts.layout = { padding:{ right:30 } };
    const rIn = document.getElementById('erCompletionRankChart-inner');
    if(rIn) rIn.style.height = Math.max(240, (ranked.length||1)*34) + 'px';
    charts.erCompletionRank = new Chart(rCtx, {
      type:'bar',
      data:{ labels: rLabels.length?rLabels:['No Epics'], datasets:[
        { label:'Completion %', data: rData.length?rData:[0], backgroundColor: rColors.length?rColors:['#e2e8f0'], borderRadius:5 }
      ]},
      options: rOpts
    });
  }

  // 3. Story Points by Epic — stacked horizontal bar (Released vs Remaining points)
  _erDestroyChart('erPoints');
  const spCtx = _getCtx('erPointsChart');
  if(spCtx){
    const relPts = rows.map(({m}) => m.releasedPts);
    const remPts = rows.map(({m}) => m.pts.total - m.releasedPts);
    const spOpts = _chartOpts({
      indexAxis:'y',
      plugins:{ legend:{ display:true, position:'top' } },
      scales:{
        x:{ stacked:true, grid:{ color:'rgba(0,0,0,0.04)', lineWidth:1 }, ticks:{ font:{ family:'DM Sans', size:11 }, stepSize:1 } },
        y:{ stacked:true, grid:{ display:false }, ticks:{ font:{ family:'DM Sans', size:11 } } }
      }
    });
    spOpts.plugins.datalabels = { display: ctx=>ctx.dataset.data[ctx.dataIndex]>0, anchor:'center', align:'center', clamp:true, color:'#fff', font:{ size:9, weight:'700' }, formatter:v=>v };
    const spIn = document.getElementById('erPointsChart-inner');
    if(spIn) spIn.style.height = Math.max(240, (rows.length||1)*34) + 'px';
    charts.erPoints = new Chart(spCtx, {
      type:'bar',
      data:{ labels: labels.length?labels:['No Epics'], datasets:[
        { label:'Released Points', data: relPts.length?relPts:[0], backgroundColor:'rgba(16,185,129,0.8)', borderRadius:4 },
        { label:'Remaining Points', data: remPts.length?remPts:[0], backgroundColor:'rgba(226,232,240,1)', borderRadius:4 }
      ]},
      options: spOpts
    });
  }

  // 4. Portfolio Task Status — doughnut aggregating every mapped task's status across scoped epics
  _erDestroyChart('erStatusDoughnut');
  const dCtx = _getCtx('erStatusDoughnutChart');
  if(dCtx){
    const byStatus = {};
    rows.forEach(({m}) => m.tasks.forEach(t => { const s=t.status||'open'; byStatus[s]=(byStatus[s]||0)+1; }));
    const order = Object.keys(STATUS_META).filter(s => s!=='rollback' && byStatus[s]);
    const dLabels = order.map(s => statusLabel(s));
    const dData   = order.map(s => byStatus[s]);
    const dColors = order.map(s => _erStatusColor(s));
    const dOpts = {
      responsive:true, maintainAspectRatio:false, cutout:'62%',
      plugins:{
        legend:{ display:true, position:'right', labels:{ boxWidth:10, padding:12, font:{ size:11, family:'DM Sans' }, color:'#4a5066' } },
        tooltip:{ backgroundColor:'rgba(14,16,26,0.88)', titleFont:{ family:'DM Sans', size:12, weight:'600' }, bodyFont:{ family:'DM Sans', size:11 }, padding:{ top:9, bottom:9, left:12, right:12 }, cornerRadius:8 },
        datalabels:{ display: ctx => { const data=ctx.dataset.data; const total=data.reduce((a,b)=>a+b,0); const val=data[ctx.dataIndex]; return total>0 && ((val/total)*100)>=5; }, color:'#fff', font:{ size:10, weight:'700' }, formatter:(v,ctx)=>{ const total=ctx.dataset.data.reduce((a,b)=>a+b,0); return Math.round((v/total)*100)+'%'; } }
      },
      animation:{ duration:400, easing:'easeInOutQuart' }
    };
    charts.erStatusDoughnut = new Chart(dCtx, {
      type:'doughnut',
      data:{ labels: dLabels.length?dLabels:['No Tasks'], datasets:[{ data: dData.length?dData:[1], backgroundColor: dColors.length?dColors:['#e2e8f0'], borderWidth:2, borderColor:'#fff' }] },
      options: dOpts
    });
  }
}

// ── Single-epic mode: status distribution + points progress doughnuts ─────
function _erRenderEpicDetailCharts(epic, m){
  const doughnutOpts = (labels, data, colors) => ({
    responsive:true, maintainAspectRatio:false, cutout:'62%',
    plugins:{
      legend:{ display:true, position:'right', labels:{ boxWidth:10, padding:12, font:{ size:11, family:'DM Sans' }, color:'#4a5066' } },
      tooltip:{ backgroundColor:'rgba(14,16,26,0.88)', titleFont:{ family:'DM Sans', size:12, weight:'600' }, bodyFont:{ family:'DM Sans', size:11 }, padding:{ top:9, bottom:9, left:12, right:12 }, cornerRadius:8 },
      datalabels:{ display: ctx => { const total=data.reduce((a,b)=>a+b,0); return total>0 && ((data[ctx.dataIndex]/total)*100)>=5; }, color:'#fff', font:{ size:10, weight:'700' }, formatter:(v)=>{ const total=data.reduce((a,b)=>a+b,0); return total?Math.round((v/total)*100)+'%':'0%'; } }
    },
    animation:{ duration:400, easing:'easeInOutQuart' }
  });

  // Status distribution
  _erDestroyChart('erEpicStatusDoughnut');
  const sCtx = _getCtx('erEpicStatusDoughnut');
  if(sCtx){
    const byStatus = {};
    m.tasks.forEach(t => { const s=t.status||'open'; byStatus[s]=(byStatus[s]||0)+1; });
    const order  = Object.keys(STATUS_META).filter(s => s!=='rollback' && byStatus[s]);
    const labels = order.map(s => statusLabel(s));
    const data   = order.map(s => byStatus[s]);
    const colors = order.map(s => _erStatusColor(s));
    charts.erEpicStatusDoughnut = new Chart(sCtx, {
      type:'doughnut',
      data:{ labels: labels.length?labels:['No Tasks'], datasets:[{ data: data.length?data:[1], backgroundColor: colors.length?colors:['#e2e8f0'], borderWidth:2, borderColor:'#fff' }] },
      options: doughnutOpts(labels, data.length?data:[1], colors)
    });
  }

  // Story points progress
  _erDestroyChart('erEpicPointsDoughnut');
  const ppCtx = _getCtx('erEpicPointsDoughnut');
  if(ppCtx){
    const remainingPts = Math.max(0, m.pts.total - m.releasedPts);
    const labels = ['Released', 'Remaining'];
    const data   = [m.releasedPts, remainingPts];
    const colors = ['#16a34a', '#e2e8f0'];
    charts.erEpicPointsDoughnut = new Chart(ppCtx, {
      type:'doughnut',
      data:{ labels, datasets:[{ data: (m.pts.total>0)?data:[0,1], backgroundColor: colors, borderWidth:2, borderColor:'#fff' }] },
      options: doughnutOpts(labels, (m.pts.total>0)?data:[0,1], colors)
    });
  }
}

// ── Main render ──────────────────────────────────────────────────────────
function renderEpicReports(){
  _erPopulateFilters();

  const subEl = document.getElementById('er-scope-subtitle');
  if(subEl){
    subEl.textContent = 'Epic-wise task mapping, release & completion metrics — ' +
      ((RBAC.isAdmin()||RBAC.isSeniorManager()) ? 'All Projects' : 'Your Projects Only');
  }

  const { epics, selectedEpic } = _getEpicReportsData();
  const setEl = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };

  const emptyEl    = document.getElementById('er-empty-state');
  const overviewSec = document.getElementById('er-overview-section');
  const detailSec   = document.getElementById('er-detail-section');

  if(!epics.length){
    if(emptyEl)    emptyEl.style.display = '';
    if(overviewSec) overviewSec.style.display = 'none';
    if(detailSec)   detailSec.style.display = 'none';
    setEl('er-kpi1-label','Total Epics');       setEl('er-kpi1-value','0');
    setEl('er-kpi2-label','Tasks Mapped');      setEl('er-kpi2-value','0');
    setEl('er-kpi3-label','Released Tasks');    setEl('er-kpi3-value','0');
    setEl('er-kpi4-label','Overall Completion');setEl('er-kpi4-value','0%');
    ['erProgress','erCompletionRank','erPoints','erStatusDoughnut','erEpicStatusDoughnut','erEpicPointsDoughnut'].forEach(_erDestroyChart);
    return;
  }
  if(emptyEl) emptyEl.style.display = 'none';

  if(!selectedEpic){
    // ── ALL EPICS MODE — overview table across every epic in scope ──
    if(overviewSec) overviewSec.style.display = '';
    if(detailSec)   detailSec.style.display   = 'none';

    let totalTasks=0, totalReleased=0, totalCombinedDone=0, totalCombined=0;
    const rows = epics.map(e => {
      const m = _erEpicMetrics(e);
      totalTasks        += m.tasks.length;
      totalReleased      += m.released;
      totalCombinedDone += m.prog.combinedDone;
      totalCombined      += m.prog.combinedTotal;
      return { e, m };
    });
    const overallPct = totalCombined ? Math.round((totalCombinedDone/totalCombined)*100) : 0;

    setEl('er-kpi1-label','Total Epics');        setEl('er-kpi1-value', epics.length);
    setEl('er-kpi2-label','Tasks Mapped');       setEl('er-kpi2-value', totalTasks);
    setEl('er-kpi3-label','Released Tasks');     setEl('er-kpi3-value', totalReleased);
    setEl('er-kpi4-label','Overall Completion'); setEl('er-kpi4-value', overallPct+'%');

    const tbody = document.getElementById('er-overview-tbody');
    if(tbody){
      tbody.innerHTML = rows.map(({e,m}, idx) => {
        const owner = getUser(e.ownerId);
        const bg = idx%2!==0 ? 'background:rgba(0,0,0,0.018)' : '';
        return `<tr style="${bg};border-bottom:1px solid rgba(0,0,0,0.05);cursor:pointer" onclick="_erSelectEpic('${e.id}')" title="View epic details">
          <td style="padding:9px 12px;color:var(--text-primary);font-weight:600"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${e.color||'#8b5cf6'};margin-right:7px"></span>${_escHtml(e.title)}</td>
          <td style="padding:9px 12px;color:var(--text-secondary)">${_escHtml(_erEpicProjectNames(e))}</td>
          <td style="padding:9px 12px"><span class="epic-badge badge-epic-${epicStatusBadgeClass(e.status)}">${_escHtml(e.status||'\u2014')}</span></td>
          <td style="padding:9px 12px"><span class="badge badge-${(e.priority||'').toLowerCase()}">${_escHtml(e.priority||'\u2014')}</span></td>
          <td style="padding:9px 12px;color:var(--text-secondary)">${owner?_escHtml(owner.name):'\u2014'}</td>
          <td style="padding:9px 12px;text-align:right;font-variant-numeric:tabular-nums">${m.tasks.length}</td>
          <td style="padding:9px 12px;text-align:right;font-variant-numeric:tabular-nums">${m.prog.subtaskTotal}</td>
          <td style="padding:9px 12px;text-align:right;font-variant-numeric:tabular-nums;font-weight:700;color:#10b981">${m.released}</td>
          <td style="padding:9px 12px;text-align:right;font-variant-numeric:tabular-nums">${m.pts.total}</td>
          <td style="padding:9px 12px;text-align:right;font-variant-numeric:tabular-nums">${m.releasedPts}</td>
          <td style="padding:9px 12px;text-align:right;font-variant-numeric:tabular-nums;font-weight:700">${m.prog.pct}%</td>
          <td style="padding:9px 12px;color:var(--text-secondary)">${e.dueDate?formatDate(e.dueDate):'\u2014'}</td>
        </tr>`;
      }).join('') || `<tr><td colspan="12" style="padding:14px;text-align:center;color:var(--text-tertiary);font-size:13px">No epics found</td></tr>`;
    }

    ['erEpicStatusDoughnut','erEpicPointsDoughnut'].forEach(_erDestroyChart);
    _erRenderOverviewCharts(rows);
  } else {
    // ── SINGLE EPIC MODE — full detail for the selected epic ──
    if(overviewSec) overviewSec.style.display = 'none';
    if(detailSec)   detailSec.style.display   = '';

    const e = selectedEpic;
    const m = _erEpicMetrics(e);
    const owner = getUser(e.ownerId);

    setEl('er-kpi1-label','Tasks Mapped');   setEl('er-kpi1-value', m.tasks.length);
    setEl('er-kpi2-label','Released Tasks'); setEl('er-kpi2-value', m.released);
    setEl('er-kpi3-label','Story Points (Total / Released)'); setEl('er-kpi3-value', m.pts.total+' / '+m.releasedPts);
    setEl('er-kpi4-label','Progress %');     setEl('er-kpi4-value', m.prog.pct+'%');

    const detailCard = document.getElementById('er-detail-card');
    if(detailCard){
      const today = new Date(); today.setHours(0,0,0,0);
      const isDelayed = e.dueDate && new Date(e.dueDate) < today && e.status !== 'Completed';
      detailCard.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${e.color||'#8b5cf6'}"></span>
          <span style="font-size:16px;font-weight:700;color:var(--text-primary)">${_escHtml(e.title)}</span>
          <span class="epic-badge badge-epic-${epicStatusBadgeClass(e.status)}">${_escHtml(e.status||'\u2014')}</span>
          <span class="badge badge-${(e.priority||'').toLowerCase()}">${_escHtml(e.priority||'\u2014')}</span>
          ${isDelayed?`<span class="epic-badge" style="background:#fee2e2;color:#dc2626">\u26A0 Delayed</span>`:''}
        </div>
        ${e.description?`<div style="font-size:12.5px;color:var(--text-secondary);line-height:1.5;margin-bottom:10px;white-space:pre-wrap">${_escHtml(e.description)}</div>`:''}
        <div style="display:flex;gap:20px;flex-wrap:wrap;font-size:12px;color:var(--text-tertiary)">
          <span>Project(s): <strong style="color:var(--text-secondary)">${_escHtml(_erEpicProjectNames(e))}</strong></span>
          <span>Owner: <strong style="color:var(--text-secondary)">${owner?_escHtml(owner.name):'\u2014'}</strong></span>
          <span>Due: <strong style="color:var(--text-secondary)">${e.dueDate?formatDate(e.dueDate):'\u2014'}</strong></span>
          <span>Created: <strong style="color:var(--text-secondary)">${e.createdAt?formatDate(e.createdAt):'\u2014'}</strong></span>
        </div>`;
    }

    // Status breakdown (top-level tasks — same granularity as the Epics page cards)
    const statusTbody = document.getElementById('er-status-tbody');
    if(statusTbody){
      const byStatus = {};
      m.tasks.forEach(t => { const s=t.status||'open'; if(!byStatus[s]) byStatus[s]={count:0,pts:0}; byStatus[s].count++; byStatus[s].pts+=(t.points||0); });
      const order = Object.keys(STATUS_META).filter(s => s !== 'rollback');
      const rows2 = order.filter(s => byStatus[s]).map(s => {
        const d = byStatus[s];
        const pctOfEpic = m.tasks.length ? Math.round((d.count/m.tasks.length)*100) : 0;
        return `<tr style="border-bottom:1px solid rgba(0,0,0,0.05)">
          <td style="padding:9px 14px"><span class="badge badge-${statusBadgeClass(s)}">${statusLabel(s)}</span></td>
          <td style="padding:9px 14px;text-align:right;font-variant-numeric:tabular-nums">${d.count}</td>
          <td style="padding:9px 14px;text-align:right;font-variant-numeric:tabular-nums">${d.pts}</td>
          <td style="padding:9px 14px;text-align:right;font-variant-numeric:tabular-nums">${pctOfEpic}%</td>
        </tr>`;
      }).join('');
      statusTbody.innerHTML = rows2 || `<tr><td colspan="4" style="padding:14px;text-align:center;color:var(--text-tertiary);font-size:13px">No tasks mapped to this epic</td></tr>`;
    }

    // Mapped tasks
    const taskTbody = document.getElementById('er-task-tbody');
    if(taskTbody){
      taskTbody.innerHTML = m.tasks.map((t, idx) => {
        const proj     = getProject(t.project);
        const sprint   = getSprint(t.sprint);
        const release  = t.releaseId ? getRelease(t.releaseId) : null;
        const assignee = getUser(t.assignee);
        const bg = idx%2!==0 ? 'background:rgba(0,0,0,0.018)' : '';
        const taskKey  = proj ? (proj.key + '-' + (t.id||'').slice(-4).toUpperCase()) : (t.id||'\u2014');
        const subs = t.subtasks || [];
        const subReleased = subs.filter(s => s.status === 'released').length;
        return `<tr style="${bg};border-bottom:1px solid rgba(0,0,0,0.04)">
          <td style="padding:9px 12px;font-family:'DM Mono',monospace;font-size:11.5px;color:var(--text-tertiary);white-space:nowrap">${_escHtml(taskKey)}</td>
          <td style="padding:9px 12px;color:var(--text-primary);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${_escHtml(t.title||'')}">${_escHtml(t.title||'\u2014')}</td>
          <td style="padding:9px 12px;color:var(--text-secondary)">${typeIcon(t.type)} ${_escHtml(t.type||'\u2014')}</td>
          <td style="padding:9px 12px;color:var(--text-secondary)">${sprint?_escHtml(sprint.name):'\u2014'}</td>
          <td style="padding:9px 12px;color:var(--text-secondary)">${release?_escHtml(release.name):'\u2014'}</td>
          <td style="padding:9px 12px"><span class="badge badge-${(t.priority||'').toLowerCase()}">${_escHtml(t.priority||'\u2014')}</span></td>
          <td style="padding:9px 12px"><span class="badge badge-${statusBadgeClass(t.status)}">${statusLabel(t.status)}</span></td>
          <td style="padding:9px 12px;text-align:right;font-variant-numeric:tabular-nums">${t.points||0}</td>
          <td style="padding:9px 12px;color:var(--text-secondary)">${assignee?_escHtml(assignee.name):'Unassigned'}</td>
          <td style="padding:9px 12px;text-align:right;font-variant-numeric:tabular-nums">${subs.length?(subReleased+'/'+subs.length):'\u2014'}</td>
        </tr>`;
      }).join('') || `<tr><td colspan="10" style="padding:14px;text-align:center;color:var(--text-tertiary);font-size:13px">No tasks mapped to this epic</td></tr>`;
    }

    ['erProgress','erCompletionRank','erPoints','erStatusDoughnut'].forEach(_erDestroyChart);
    _erRenderEpicDetailCharts(e, m);
  }
}

// ── Export Epic Reports to PDF ────────────────────────────────────────────
function exportEpicReportsPDF(){
  if(typeof window.jspdf === 'undefined'){ showNotif('PDF library not loaded', 'error'); return; }
  const { jsPDF } = window.jspdf;
  const { epics, selectedEpic } = _getEpicReportsData();
  if(!epics.length){ showNotif('No epics to export for the selected filters', 'error'); return; }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const meta = {
    date: new Date().toLocaleDateString(),
    user: state.currentUser ? (state.currentUser.name || state.currentUser.email || '') : '',
    filters: selectedEpic ? ('Epic: ' + selectedEpic.title) : ('Epics: All (' + epics.length + ')')
  };
  const ca = _pdfContentArea(doc);

  if(selectedEpic){
    // ── SINGLE EPIC DETAIL PDF ──
    const e = selectedEpic;
    const m = _erEpicMetrics(e);
    const owner = getUser(e.ownerId);

    _pdfDrawHeader(doc, meta, 'Epic Reports');
    let y = ca.y + 8;
    doc.setFontSize(16); doc.setFont('helvetica','bold'); doc.setTextColor(...PDF_TEXT_DARK);
    doc.text(e.title || 'Epic', ca.x, y+14);
    y += 30;

    doc.setFontSize(9.5); doc.setFont('helvetica','normal'); doc.setTextColor(...PDF_TEXT_MID);
    doc.text(`Status: ${e.status||'\u2014'}   Priority: ${e.priority||'\u2014'}   Project(s): ${_erEpicProjectNames(e)}`, ca.x, y);
    y += 14;
    doc.text(`Owner: ${owner?owner.name:'\u2014'}   Due: ${e.dueDate?formatDate(e.dueDate):'\u2014'}   Created: ${e.createdAt?formatDate(e.createdAt):'\u2014'}`, ca.x, y);
    y += 20;

    if(e.description){
      const lines = doc.splitTextToSize(e.description, ca.w);
      doc.setTextColor(...PDF_TEXT_MID);
      doc.text(lines.slice(0,4), ca.x, y);
      y += Math.min(lines.length,4)*12 + 10;
    }

    const boxW = (ca.w - 9) / 4;
    [
      { label:'Tasks Mapped',   value:String(m.tasks.length) },
      { label:'Released Tasks', value:String(m.released) },
      { label:'Story Points',   value:String(m.pts.total) },
      { label:'Progress %',     value:m.prog.pct+'%' }
    ].forEach((s,i) => {
      const bx = ca.x + i*(boxW+3);
      doc.setFillColor(245,247,252);
      doc.roundedRect(bx, y, boxW, 52, 6, 6, 'F');
      doc.setFontSize(20); doc.setFont('helvetica','bold'); doc.setTextColor(...PDF_ACCENT);
      doc.text(s.value, bx+boxW/2, y+28, { align:'center' });
      doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(...PDF_TEXT_LIGHT);
      doc.text(s.label, bx+boxW/2, y+44, { align:'center' });
    });
    y += 70;

    y = _pdfSectionBand(doc, 'Status Breakdown', y);
    const byStatus = {};
    m.tasks.forEach(t => { const s=t.status||'open'; if(!byStatus[s]) byStatus[s]={count:0,pts:0}; byStatus[s].count++; byStatus[s].pts+=(t.points||0); });
    if(typeof doc.autoTable === 'function'){
      doc.autoTable({
        startY: y, margin: { left: ca.x, right: PDF_MARGIN },
        head: [['Status','Tasks','Story Points','% of Epic']],
        body: Object.keys(STATUS_META).filter(s => s!=='rollback' && byStatus[s]).map(s => {
          const d = byStatus[s];
          const pct = m.tasks.length ? Math.round((d.count/m.tasks.length)*100) : 0;
          return [statusLabel(s), d.count, d.pts, pct+'%'];
        }),
        headStyles: { fillColor: PDF_ACCENT, textColor: 255, fontStyle: 'bold', fontSize: 9 },
        bodyStyles: { fontSize: 10, textColor: PDF_TEXT_MID },
        alternateRowStyles: { fillColor: [248, 249, 252] },
        columnStyles: { 1:{halign:'right'}, 2:{halign:'right'}, 3:{halign:'right'} },
        theme: 'grid'
      });
    }
    _pdfDrawFooter(doc, 1, 2, m.tasks.length);

    doc.addPage();
    _pdfDrawHeader(doc, meta, 'Epic Reports');
    y = ca.y + 8;
    y = _pdfSectionBand(doc, 'Mapped Tasks', y);
    if(typeof doc.autoTable === 'function'){
      doc.autoTable({
        startY: y + 4, margin: { left: ca.x, right: PDF_MARGIN },
        head: [['Task ID','Title','Sprint','Release','Priority','Status','Pts','Assignee']],
        body: m.tasks.map(t => {
          const proj    = getProject(t.project);
          const sprint  = getSprint(t.sprint);
          const release = t.releaseId ? getRelease(t.releaseId) : null;
          const assignee= getUser(t.assignee);
          const key = proj ? (proj.key+'-'+(t.id||'').slice(-4).toUpperCase()) : (t.id||'\u2014');
          return [key, t.title||'\u2014', sprint?sprint.name:'\u2014', release?release.name:'\u2014', t.priority||'\u2014', statusLabel(t.status), t.points||0, assignee?assignee.name:'Unassigned'];
        }),
        headStyles: { fillColor: PDF_ACCENT, textColor: 255, fontStyle: 'bold', fontSize: 8 },
        bodyStyles: { fontSize: 8.5, textColor: PDF_TEXT_MID },
        alternateRowStyles: { fillColor: [248, 249, 252] },
        columnStyles: { 0:{fontStyle:'bold',cellWidth:46}, 1:{cellWidth:110}, 6:{halign:'right',cellWidth:24} },
        theme: 'grid',
        didDrawPage: function(){ _pdfDrawHeader(doc, meta, 'Epic Reports'); }
      });
    }

    const totalPages = doc.internal.getNumberOfPages();
    for(let pg=1; pg<=totalPages; pg++){ doc.setPage(pg); _pdfDrawFooter(doc, pg, totalPages, m.tasks.length); }
    doc.save('SprintFlow-EpicReport-'+(e.title||'Epic').replace(/[^a-z0-9]+/gi,'_')+'-'+new Date().toISOString().slice(0,10)+'.pdf');
    showNotif('Epic Report PDF exported \u2713');
    return;
  }

  // ── ALL EPICS OVERVIEW PDF ──
  let totalTasks=0, totalReleased=0, totalCombinedDone=0, totalCombined=0;
  const rows = epics.map(e => {
    const m = _erEpicMetrics(e);
    totalTasks += m.tasks.length; totalReleased += m.released;
    totalCombinedDone += m.prog.combinedDone; totalCombined += m.prog.combinedTotal;
    return { e, m };
  });
  const overallPct = totalCombined ? Math.round((totalCombinedDone/totalCombined)*100) : 0;

  _pdfDrawHeader(doc, meta, 'Epic Reports');
  let y = ca.y + 8;
  doc.setFontSize(16); doc.setFont('helvetica','bold'); doc.setTextColor(...PDF_TEXT_DARK);
  doc.text('Epic Reports Overview', ca.x, y+14);
  y += 32;

  const boxW = (ca.w - 9) / 4;
  [
    { label:'Total Epics',        value:String(epics.length) },
    { label:'Tasks Mapped',       value:String(totalTasks) },
    { label:'Released Tasks',     value:String(totalReleased) },
    { label:'Overall Completion', value:overallPct+'%' }
  ].forEach((s,i) => {
    const bx = ca.x + i*(boxW+3);
    doc.setFillColor(245,247,252);
    doc.roundedRect(bx, y, boxW, 52, 6, 6, 'F');
    doc.setFontSize(20); doc.setFont('helvetica','bold'); doc.setTextColor(...PDF_ACCENT);
    doc.text(s.value, bx+boxW/2, y+28, { align:'center' });
    doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(...PDF_TEXT_LIGHT);
    doc.text(s.label, bx+boxW/2, y+44, { align:'center' });
  });
  y += 70;

  y = _pdfSectionBand(doc, 'Epic Overview', y);
  if(typeof doc.autoTable === 'function'){
    doc.autoTable({
      startY: y + 4, margin: { left: ca.x, right: PDF_MARGIN },
      head: [['Epic','Project(s)','Status','Priority','Tasks','Released','Points','Progress %']],
      body: rows.map(({e,m}) => [
        e.title||'\u2014', _erEpicProjectNames(e), e.status||'\u2014', e.priority||'\u2014',
        m.tasks.length, m.released, m.pts.total, m.prog.pct+'%'
      ]),
      headStyles: { fillColor: PDF_ACCENT, textColor: 255, fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 8.5, textColor: PDF_TEXT_MID },
      alternateRowStyles: { fillColor: [248, 249, 252] },
      columnStyles: { 4:{halign:'right'}, 5:{halign:'right'}, 6:{halign:'right'}, 7:{halign:'right'} },
      theme: 'grid',
      didDrawPage: function(){ _pdfDrawHeader(doc, meta, 'Epic Reports'); }
    });
  }

  const totalPages = doc.internal.getNumberOfPages();
  for(let pg=1; pg<=totalPages; pg++){ doc.setPage(pg); _pdfDrawFooter(doc, pg, totalPages, epics.length); }
  doc.save('SprintFlow-EpicReportsOverview-'+new Date().toISOString().slice(0,10)+'.pdf');
  showNotif('Epic Reports PDF exported \u2713');
}

// ── Export Epic-wise Tasks to Excel (Epic Summary + Epic-wise Tasks sheets) ──
function exportEpicReportsExcel(){
  if(!window.XLSX){ showNotif('Excel library not loaded', 'error'); return; }
  const { epics, selectedEpic } = _getEpicReportsData();
  if(!epics.length){ showNotif('No epics to export for the selected filters', 'error'); return; }

  const scopeEpics = selectedEpic ? [selectedEpic] : epics;
  const lu = _xlLookup();

  // Sheet 1: Epic Summary
  const summaryHeaders = ['Epic ID','Title','Status','Priority','Project(s)','Owner','Due Date','Tasks Mapped','Subtasks','Released Tasks','Total Points','Released Points','Progress %','Description'];
  const summaryRows = [summaryHeaders];
  scopeEpics.forEach(e => {
    const m = _erEpicMetrics(e);
    summaryRows.push([
      _xlStr(e.id), _xlStr(e.title), _xlStr(e.status), _xlStr(e.priority),
      _xlStr(_erEpicProjectIds(e).map(id => lu.proj(id))),
      lu.user(e.ownerId), _xlStr(e.dueDate),
      m.tasks.length, m.prog.subtaskTotal, m.released,
      m.pts.total, m.releasedPts, m.prog.pct+'%',
      _xlStr(e.description)
    ]);
  });
  if(summaryRows.length === 1) summaryRows.push(['No epics in scope']);
  const wsSummary = _xlBuildSheet(summaryRows, { colWidths:[14,32,14,12,28,20,12,12,10,12,12,14,12,44] });

  // Sheet 2: Epic-wise Tasks — every task, grouped/sorted by epic
  const taskHeaders = ['Epic','Task ID','Title','Type','Project','Sprint','Release','Priority','Status','Points','Assignee','Subtasks Total','Subtasks Released','Start Date','End Date'];
  const taskRows = [taskHeaders];
  scopeEpics.forEach(e => {
    getEpicTasks(e.id).forEach(t => {
      const proj = getProject(t.project);
      const key  = proj ? (proj.key+'-'+(t.id||'').slice(-4).toUpperCase()) : (t.id||'\u2014');
      const subs = t.subtasks || [];
      taskRows.push([
        _xlStr(e.title), _xlStr(key), _xlStr(t.title), _xlStr(t.type),
        lu.proj(t.project), lu.sprint(t.sprint),
        t.releaseId ? lu.release(t.releaseId) : '\u2014',
        _xlStr(t.priority), _xlStr(statusLabel(t.status)),
        t.points||0, lu.user(t.assignee),
        subs.length, subs.filter(s => s.status === 'released').length,
        _xlStr(t.startDate), _xlStr(t.endDate)
      ]);
    });
  });
  if(taskRows.length === 1) taskRows.push(['No tasks mapped for the selected epic(s)']);
  const wsTasks = _xlBuildSheet(taskRows, { colWidths:[28,14,32,10,22,18,22,12,16,10,20,12,14,12,12] });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsSummary, '\uD83D\uDCCA Epic Summary');
  XLSX.utils.book_append_sheet(wb, wsTasks,   '\u2705 Epic-wise Tasks');

  const d = new Date(), pad = n => String(n).padStart(2,'0');
  const ts = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
  const suffix = selectedEpic ? ('_'+(selectedEpic.title||'Epic').replace(/[^a-z0-9]+/gi,'_')) : '_AllEpics';
  XLSX.writeFile(wb, `SprintFlow_EpicReports${suffix}_${ts}.xlsx`);
  showNotif('Epic Reports Excel exported \u2713');
}
// ── END EPIC REPORTS ──────────────────────────────────────────────────────

