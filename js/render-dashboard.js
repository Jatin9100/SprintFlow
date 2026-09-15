// ─── DASHBOARD ───────────────────────────────────────────────────
function _populateDashboardFilters(){
  const projSel=document.getElementById('dash-project-filter');
  const sprintSel=document.getElementById('dash-sprint-filter');
  if(projSel){
    const prev=projSel.value||'all';
    const _allProj=RBAC.getVisibleProjects();
    const _activeProj=_allProj.filter(p=>(p.status||'').toLowerCase()==='active');
    const _completedProj=_allProj.filter(p=>(p.status||'').toLowerCase()==='completed');
    let _projHTML=`<option value="all">All Projects</option>`;
    if(_activeProj.length){
      _projHTML+=`<optgroup label="── Active Projects ──">`;
      _projHTML+=_activeProj.map(p=>`<option value="${p.id}"${p.id===prev?' selected':''}>${p.name}</option>`).join('');
      _projHTML+=`</optgroup>`;
    }
    if(_completedProj.length){
      _projHTML+=`<optgroup label="── Completed Projects ──">`;
      _projHTML+=_completedProj.map(p=>`<option value="${p.id}"${p.id===prev?' selected':''}>${p.name}</option>`).join('');
      _projHTML+=`</optgroup>`;
    }
    projSel.innerHTML=_projHTML;
    if(prev!=='all'&&!_allProj.find(p=>p.id===prev)) projSel.value='all';
  }
  if(sprintSel){
    const prev=sprintSel.value||'all';
    const projFilter=projSel?projSel.value:'all';
    const _allSpr=RBAC.getVisibleSprints().filter(s=>projFilter==='all'||s.project===projFilter);
    const _activeSpr=_allSpr.filter(s=>(s.status||'').toLowerCase()==='active');
    const _completedSpr=_allSpr.filter(s=>(s.status||'').toLowerCase()==='completed');

    // Validate prev value; reset if stale
    const _validIds=_activeSpr.concat(_completedSpr).map(s=>s.id);
    const _validGroupValues=['all','active-group','completed-group'];
    if(!_validGroupValues.includes(prev)&&!_validIds.includes(prev)) sprintSel.value='all';

    _sfDropBuild('dash',[
      {groupValue:'active-group',   groupLabel:'Active Sprints',    sprints:_activeSpr},
      {groupValue:'completed-group',groupLabel:'Completed Sprints', sprints:_completedSpr}
    ],'all','All Sprints');

    // Sync button label
    const _cur=sprintSel.value||'all';
    const lbl=document.getElementById('dash-sprint-filter-label');
    if(lbl){
      if(_cur==='all') lbl.textContent='All Sprints';
      else if(_cur==='active-group') lbl.textContent='Active Sprints';
      else if(_cur==='completed-group') lbl.textContent='Completed Sprints';
      else{ const _f=_allSpr.find(s=>s.id===_cur); lbl.textContent=_f?_f.name:'All Sprints'; }
    }
  }
}

// ─── DASHBOARD SPRINT CUSTOM DROPDOWN (uses shared engine) ────────
function _dashSprintGetOrCreateDrop(){ return _sfDropGetOrCreate('dash'); }

function _dashSprintDropToggle(e){ _sfDropToggle('dash',e); }

function _dashSprintSelect(value, label){ _sfDropSelect('dash', value, label); }

function renderDashboard(){
  if(document.hidden) return; // tab hidden — skip expensive render; visibilitychange will refresh on return
  try{
  _populateDashboardFilters();
  let projFilter=(document.getElementById('dash-project-filter')||{}).value||'all';
  let sprintFilter=(document.getElementById('dash-sprint-filter')||{}).value||'all';
  if(!projFilter) projFilter='all';
  if(!sprintFilter) sprintFilter='all';

  // ── Scoped base collections — role-restricted before UI filters ──
  const _scopedData = getRoleScopedAnalyticsData();

  // ── Resolve group-level sprint filter values into sprint ID sets ──
  // 'active-group'    → all active sprint IDs in scope
  // 'completed-group' → all completed sprint IDs in scope
  // single ID         → just that sprint ID
  // 'all'             → no filter (null = unfiltered)
  let _sprintIdSet = null;
  if(sprintFilter==='active-group'){
    const _grpSprints=_scopedData.sprints.filter(s=>(s.status||'').toLowerCase()==='active'&&(projFilter==='all'||s.project===projFilter));
    _sprintIdSet=new Set(_grpSprints.map(s=>s.id));
  } else if(sprintFilter==='completed-group'){
    const _grpSprints=_scopedData.sprints.filter(s=>(s.status||'').toLowerCase()==='completed'&&(projFilter==='all'||s.project===projFilter));
    _sprintIdSet=new Set(_grpSprints.map(s=>s.id));
  } else if(sprintFilter!=='all'){
    _sprintIdSet=new Set([sprintFilter]);
  }

  // Filtered data sets (UI filters applied on top of role-scoped base)
  let _tasks=_scopedData.tasks;
  if(projFilter!=='all') _tasks=_tasks.filter(t=>t.project===projFilter);
  if(_sprintIdSet!==null) _tasks=_tasks.filter(t=>_sprintIdSet.has(t.sprint));

  let _sprints=_scopedData.sprints;
  if(projFilter!=='all') _sprints=_sprints.filter(s=>s.project===projFilter);
  if(_sprintIdSet!==null) _sprints=_sprints.filter(s=>_sprintIdSet.has(s.id));

  let _epics=_scopedData.epics;
  if(projFilter!=='all') _epics=_epics.filter(e=>{
    const epicProjects=e.projectIds||(e.projectId?[e.projectId]:[]);
    return epicProjects.includes(projFilter);
  });

  let _releases=_scopedData.releases;
  if(projFilter!=='all') _releases=_releases.filter(r=>r.projectId===projFilter);
  if(_sprintIdSet!==null) _releases=_releases.filter(r=>_sprintIdSet.has(r.sprintId));

  const totalProjects=projFilter==='all'?_scopedData.projects.length:1;
  const totalTasks=_tasks.length;
  const activeSprints=_sprints.filter(s=>s.status==='active');
  const openTasks=_tasks.filter(t=>t.status==='open').length;
  const devInProgressTasks=_tasks.filter(t=>t.status==='dev-in-progress').length;
  const devCompletedTasks=_tasks.filter(t=>t.status==='dev-completed').length;
  const inQATasks=_tasks.filter(t=>t.status==='in-qa').length;
  const qaInProgressTasks=_tasks.filter(t=>t.status==='qa-in-progress').length;
  const reopenTasks=_tasks.filter(t=>t.status==='reopen').length;
  const pendingClientTasks=_tasks.filter(t=>t.status==='pending-with-client').length;
  const readyForProdTasks=_tasks.filter(t=>t.status==='ready-for-prod').length;
  const releasedTasks=_tasks.filter(t=>t.status==='released').length;
  const allQATasks=inQATasks+qaInProgressTasks;
  // Metric aggregation: include subtasks in total count and done count
  const _dashAllSubs=(_tasks).flatMap(t=>t.subtasks||[]);
  const _dashTotalWithSubs=totalTasks+_dashAllSubs.length;
  const _dashDoneWithSubs=_tasks.filter(t=>t.status==='released').length+_dashAllSubs.filter(s=>s.status==='released').length;

  document.getElementById('stat-total-projects').textContent=totalProjects;
  document.getElementById('stat-projects-sub').textContent=totalProjects===1?'1 active project':`${totalProjects} projects`;
  document.getElementById('stat-total-tasks').textContent=_dashTotalWithSubs;
  document.getElementById('stat-tasks-sub').textContent=`${devInProgressTasks} dev in progress`;
  document.getElementById('stat-active-sprints').textContent=activeSprints.length;
  document.getElementById('stat-sprints-sub').textContent=activeSprints.length?'Currently running':'No active sprints';
  document.getElementById('stat-done-tasks').textContent=_dashDoneWithSubs;
  document.getElementById('stat-done-sub').textContent=_dashTotalWithSubs?`${Math.round((_dashDoneWithSubs/_dashTotalWithSubs)*100)}% done`:'No tasks yet';

  // Subtask stats
  const allSubs=_tasks.flatMap(t=>t.subtasks||[]);
  const totalSubs=allSubs.length;
  const doneSubs=allSubs.filter(s=>DONE_STATUSES.includes(s.status)).length;
  const subPct=totalSubs?Math.round((doneSubs/totalSubs)*100):0;
  document.getElementById('stat-total-subtasks').textContent=totalSubs;
  document.getElementById('stat-done-subtasks').textContent=doneSubs;
  document.getElementById('stat-done-subtasks-sub').textContent=totalSubs?`${subPct}% completed`:'No subtasks yet';
  document.getElementById('stat-subtask-pct').textContent=subPct+'%';
  document.getElementById('stat-subtask-pct-bar').style.width=subPct+'%';

  // Epic stats
  const epics=_epics;
  const activeEpics=epics.filter(e=>e.status==='Active');
  const completedEpics=epics.filter(e=>e.status==='Completed');
  const epicCompPct=epics.length?Math.round((completedEpics.length/epics.length)*100):0;
  document.getElementById('stat-active-epics').textContent=activeEpics.length;
  document.getElementById('stat-active-epics-sub').textContent=epics.length?`${epics.length} total epic${epics.length!==1?'s':''}` :'No epics yet';
  document.getElementById('stat-epic-completion').textContent=epicCompPct+'%';
  document.getElementById('stat-epic-completion-bar').style.width=epicCompPct+'%';
  // Top delayed: epics that are Active + past due date
  const today=new Date();today.setHours(0,0,0,0);
  const delayed=activeEpics.filter(e=>e.dueDate&&new Date(e.dueDate)<today).sort((a,b)=>new Date(a.dueDate)-new Date(b.dueDate)).slice(0,3);
  document.getElementById('stat-delayed-epics').innerHTML=delayed.length
    ?delayed.map(e=>`<div class="flex items-center gap-2">
        <div style="width:8px;height:8px;border-radius:50%;background:${e.color};flex-shrink:0"></div>
        <span class="text-slate-700 font-medium truncate" style="max-width:120px">${_escHtml(e.title)}</span>
        <span class="text-red-500 font-semibold ml-auto">${formatDate(e.dueDate)}</span>
      </div>`).join('')
    :`<div class="text-slate-400">No delayed epics 🎉</div>`;

  // Sprint progress list
  document.getElementById('dashboard-sprints').innerHTML=activeSprints.length
    ?activeSprints.map(s=>{
        const proj=getProject(s.project);
        const sprintTasks=_tasks.filter(t=>t.sprint===s.id);
        const sprintAllSubs=(sprintTasks).flatMap(t=>t.subtasks||[]);
        const sprintTotalWithSubs=sprintTasks.length+sprintAllSubs.length;
        const pct=sprintProgress(s);
        const done=sprintTasks.filter(t=>DONE_STATUSES.includes(t.status)).length+sprintAllSubs.filter(s=>DONE_STATUSES.includes(s.status)).length;
        return `<div class="mb-4 last:mb-0">
          <div class="flex items-center justify-between mb-1">
            <div class="flex items-center gap-2">
              <div class="w-2 h-2 rounded-full" style="background:${proj?proj.color:'#6366f1'}"></div>
              <span class="font-semibold text-sm text-slate-800">${_escHtml(s.name)}</span>
              <span class="text-xs text-slate-500">${proj?_escHtml(proj.name):''}</span>
            </div>
            <span class="text-xs font-semibold text-indigo-600">${pct}%</span>
          </div>
          <div class="progress-bar mb-1">
            <div class="progress-fill" style="width:${pct}%;background:${proj?proj.color:'#6366f1'}"></div>
          </div>
          <div class="flex justify-between text-xs text-slate-500">
            <span>${done}/${sprintTotalWithSubs} tasks · ${sprintDaysLeft(s)}</span>
            <span>${formatDate(s.start)} – ${formatDate(s.end)}</span>
          </div>
        </div>`;
      }).join('')
    :`<div class="empty-state py-8">
        <div class="empty-state-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
        <div class="text-sm">No active sprints</div>
        ${RBAC.isViewer()?'':`<button class="btn btn-secondary text-xs mt-3" onclick="navigate('sprint-planning')">Create a sprint →</button>`}
      </div>`;

  // Recent tasks (last 5 from filtered set)
  const recent=[..._tasks].slice(-5).reverse();
  document.getElementById('dashboard-recent-tasks').innerHTML=recent.length
    ?recent.map(t=>{
        const proj=getProject(t.project);
        return `<div class="backlog-item" onclick="openTaskModal('${t.id}')">
          <span style="color:${typeColor(t.type)};font-size:14px">${typeIcon(t.type)}</span>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium text-slate-800 truncate">${_escHtml(t.title)}</div>
            <div class="text-xs text-slate-500">${proj?proj.key:'?'} · ${t.points}pts</div>
          </div>
          <span class="badge badge-${statusBadgeClass(t.status)}">${statusLabel(t.status)}</span>
        </div>`;
      }).join('')
    :`<div class="empty-state py-6"><div class="text-sm">No tasks yet</div>${RBAC.isViewer()?'':`<button class="btn btn-secondary text-xs mt-2" onclick="openCreateTaskModal()">Create first task →</button>`}</div>`;

  // ── Single dashboard dataset — tasks + subtasks combined ──
  const dashboardSubs = (_tasks).flatMap(t => t.subtasks || []);
  const dashboardItems = [..._tasks, ...dashboardSubs];

  // Status counts from dashboardItems (tasks + subtasks) for accurate chart data
  const di_open            = dashboardItems.filter(x => x.status === 'open').length;
  const di_devInProgress   = dashboardItems.filter(x => x.status === 'dev-in-progress').length;
  const di_devCompleted    = dashboardItems.filter(x => x.status === 'dev-completed').length;
  const di_inQA            = dashboardItems.filter(x => x.status === 'in-qa').length;
  const di_qaInProgress    = dashboardItems.filter(x => x.status === 'qa-in-progress').length;
  const di_reopen          = dashboardItems.filter(x => x.status === 'reopen').length;
  const di_onHold          = dashboardItems.filter(x => x.status === 'on-hold').length;
  const di_pendingClient   = dashboardItems.filter(x => x.status === 'pending-with-client').length;
  const di_readyForProd    = dashboardItems.filter(x => x.status === 'ready-for-prod').length;
  const di_released        = dashboardItems.filter(x => x.status === 'released').length;

  // ── Destroy existing dashboard charts before recreating (prevents duplicate instances) ──
  // v27: fingerprint-guarded — only rebuild if data changed
  const _sprintChartSig = [di_open,di_devInProgress,di_devCompleted,di_inQA,di_qaInProgress,di_reopen,di_onHold,di_pendingClient,di_readyForProd,di_released];
  const _sprintChartChanged = _chartDataChanged('dash_sprintProgress', _sprintChartSig);
  if(_sprintChartChanged){
    ['sprintProgress'].forEach(k=>{ if(charts[k]){try{charts[k].destroy();}catch(e){}delete charts[k];} });
  }

  // ── Sprint Progress Chart — uses dashboardItems counts, no overlapping labels ──
  const spCtx=_getCtx('sprintProgressChart');
  // Build label+data pairs and filter out zero-value statuses
  const _spAllPairs = [
    ['Open',            di_open,          'rgba(148,163,184,0.72)'],
    ['Dev In Progress', di_devInProgress,  'rgba(59,130,246,0.75)'],
    ['Dev Completed',   di_devCompleted,   'rgba(99,102,241,0.75)'],
    ['In QA',           di_inQA,           'rgba(217,119,6,0.75)'],
    ['QA In Progress',  di_qaInProgress,   'rgba(234,88,12,0.75)'],
    ['Reopen',          di_reopen,         'rgba(239,68,68,0.75)'],
    ['On Hold',         di_onHold,         'rgba(154,52,18,0.75)'],
    ['Pending Client',  di_pendingClient,  'rgba(202,138,4,0.75)'],
    ['Ready for Prod',  di_readyForProd,   'rgba(5,150,105,0.75)'],
    ['Released',        di_released,       'rgba(22,163,74,0.75)'],
  ].filter(p => p[1] > 0);
  const chartLabels = _spAllPairs.map(p => p[0]);
  const chartData   = _spAllPairs.map(p => p[1]);
  const chartColors = _spAllPairs.map(p => p[2]);
  if(spCtx && _sprintChartChanged) charts.sprintProgress=new Chart(spCtx,{
    type:'bar',
    data:{
      labels:chartLabels,
      datasets:[{label:'Work Items',data:chartData,backgroundColor:chartColors,borderRadius:6,borderSkipped:false,barPercentage:0.72,categoryPercentage:0.88}]
    },
    options:{
      indexAxis:'y',
      responsive:true,
      maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        datalabels:{
          display:true,
          anchor:'end',
          align:'end',
          color:'#4a5066',
          font:{family:'DM Sans',size:11,weight:'600'},
          formatter:(v)=>v
        },
        tooltip:{backgroundColor:'rgba(14,16,26,0.88)',titleFont:{family:'DM Sans',size:12,weight:'600'},bodyFont:{family:'DM Sans',size:11},padding:{top:9,bottom:9,left:12,right:12},cornerRadius:8,borderColor:'rgba(255,255,255,0.08)',borderWidth:1,titleColor:'#e8eaf4',bodyColor:'#a0a8c8'}
      },
      layout:{padding:{right:28}},
      scales:{
        x:{
          beginAtZero:true,
          grid:{color:'rgba(0,0,0,0.04)',lineWidth:1},
          border:{display:false},
          ticks:{precision:0,font:{family:'DM Sans',size:10},color:'#9399b0'}
        },
        y:{
          grid:{display:false},
          border:{display:false},
          ticks:{font:{family:'DM Sans',size:11},color:'#4a5066'}
        }
      }
    }
  });

  // ── Epic Volume chart — tasks+subtasks mapped per epic (filter-aware) ──
  const _epicVolData = _epics.map(e => {
    const eTasks = _tasks.filter(t => t.epicId === e.id);
    const eSubs  = eTasks.flatMap(t => t.subtasks || []);
    const total  = eTasks.length + eSubs.length;
    const done   = eTasks.filter(t => t.status === 'released').length + eSubs.filter(s => s.status === 'released').length;
    return { id: e.id, title: e.title, color: e.color || '#6366f1', status: e.status || '', total, done };
  }).filter(e => e.total > 0).sort((a,b) => b.total - a.total);

  // Unepicked tasks + their subtasks — shown as a separate footnote instead of
  // a bar in the ranking: it's not a real epic, and its volume tends to dwarf
  // every actual epic, crushing the rest of the chart down to unreadable slivers.
  const _unepickedTasks = _tasks.filter(t => !t.epicId);
  const _unepickedSubs  = _unepickedTasks.flatMap(t => t.subtasks || []);
  const _unepickedCount = _unepickedTasks.length + _unepickedSubs.length;
  const _evNoteEl = document.getElementById('epic-volume-no-epic-note');
  if(_evNoteEl){
    if(_unepickedCount > 0){
      _evNoteEl.style.display = 'block';
      _evNoteEl.textContent = `${_unepickedCount.toLocaleString()} task${_unepickedCount===1?'':'s'} with no epic assigned`;
    } else {
      _evNoteEl.style.display = 'none';
    }
  }

  const _evSig = _epicVolData.map(e => e.total + '_' + e.id);
  const _evChanged = _chartDataChanged('dash_epicVolume', _evSig);
  if(_evChanged){ ['epicVolume'].forEach(k=>{ if(charts[k]){try{charts[k].destroy();}catch(e){}delete charts[k];} }); }
  // Give each epic row a fixed, uniform height to stay readable (matches Sprint
  // Progress's row spacing) — the wrapping div scrolls once there are more
  // epics than fit, instead of squeezing every bar down to fit a fixed height.
  const _evWrapEl = document.getElementById('epic-volume-canvas-wrap');
  if(_evWrapEl) _evWrapEl.style.height = Math.max(260, _epicVolData.length * 32) + 'px';
  // Truncate long epic names to a single line (full name is still in the
  // tooltip) instead of wrapping — multi-line labels have variable heights
  // that don't fit a fixed row height and spill into neighboring rows.
  function _evTruncateLabel(title, maxLen){
    if(!title || title.length <= maxLen) return title;
    return title.slice(0, maxLen - 1).trimEnd() + '…';
  }
  const _evCtx = _getCtx('epicVolumeChart');
  if(_evCtx && _evChanged) charts.epicVolume = new Chart(_evCtx, {
    type: 'bar',
    data: {
      labels: _epicVolData.map(e => _evTruncateLabel(e.title, 18)),
      datasets: [
        {
          label: 'Done',
          data: _epicVolData.map(e => e.done),
          backgroundColor: _epicVolData.map(e => e.color),
          borderRadius: 4,
          borderSkipped: false,
          barPercentage: 0.72,
          categoryPercentage: 0.88,
          datalabels: { display: false } // total is labeled once, on the Remaining segment below
        },
        {
          label: 'Remaining',
          data: _epicVolData.map(e => e.total - e.done),
          backgroundColor: _epicVolData.map(e => e.color + '3a'),
          borderRadius: 4,
          borderSkipped: false,
          barPercentage: 0.72,
          categoryPercentage: 0.88,
        }
      ]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        // One readable total label per bar, outside the bar's end — same
        // treatment as Sprint Progress — instead of white text crammed
        // inside a colored segment that's often too thin to hold it.
        datalabels: {
          display: (ctx) => !!(_epicVolData[ctx.dataIndex] && _epicVolData[ctx.dataIndex].total > 0),
          anchor: 'end', align: 'end',
          color: '#4a5066',
          font: { family: 'DM Sans', size: 11, weight: '600' },
          formatter: (v, ctx) => _epicVolData[ctx.dataIndex] ? _epicVolData[ctx.dataIndex].total : v
        },
        tooltip: {
          backgroundColor: 'rgba(14,16,26,0.88)',
          titleFont: { family: 'DM Sans', size: 12, weight: '600' },
          bodyFont:  { family: 'DM Sans', size: 11 },
          padding: { top:9, bottom:9, left:12, right:12 },
          cornerRadius: 8,
          borderColor: 'rgba(255,255,255,0.08)', borderWidth: 1,
          titleColor: '#e8eaf4', bodyColor: '#a0a8c8',
          callbacks: {
            title: (items) => {
              const e = _epicVolData[items[0].dataIndex];
              return e ? `${e.title} (${e.status||'—'})` : '';
            },
            label: (ctx) => {
              const e = _epicVolData[ctx.dataIndex];
              if(!e) return '';
              const pct = e.total ? Math.round((e.done/e.total)*100) : 0;
              return ` ${e.done}/${e.total} tasks · ${pct}% done`;
            },
            afterLabel: () => ''
          }
        }
      },
      layout: { padding: { right: 28 } },
      scales: {
        x: {
          stacked: true,
          beginAtZero: true,
          grid: { color: 'rgba(0,0,0,0.04)', lineWidth: 1 },
          border: { display: false },
          ticks: { precision: 0, font: { family: 'DM Sans', size: 10 }, color: '#9399b0' }
        },
        y: {
          stacked: true,
          grid: { display: false },
          border: { display: false },
          // Each row already has a fixed height (see epic-volume-canvas-wrap
          // sizing above) and the card scrolls, so there's no need for
          // Chart.js's overlap-avoidance to skip labels — without this it was
          // hiding every other epic name once labels mixed single-line and
          // wrapped multi-line entries.
          ticks: { autoSkip: false, font: { family: 'DM Sans', size: 11 }, color: '#4a5066' }
        }
      }
    }
  });
  }catch(e){console.warn('[Render] renderDashboard error:',e);}
}

