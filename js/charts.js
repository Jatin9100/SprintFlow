// ── v27 PERF: Chart fingerprinting — skip re-render when data unchanged ──
const _chartFingerprints = new Map();
function _chartDataChanged(chartKey, data) {
  const sig = JSON.stringify(data);
  if (_chartFingerprints.get(chartKey) === sig) return false;
  _chartFingerprints.set(chartKey, sig);
  return true;
}
function _invalidateChartFingerprints() { _chartFingerprints.clear(); }

// ─── CHART MANAGEMENT ────────────────────────────────────────────
// Safe canvas context helper — guards against missing/detached canvas elements
// Used by renderDashboard() and renderReports() to prevent crashes on tab switch
function _getCtx(id){
  const el=document.getElementById(id);
  if(!el||!(el instanceof HTMLCanvasElement))return null;
  try{ return el.getContext('2d'); }catch(e){ return null; }
}

// Memory Safe: all chart instances destroyed and registry cleared before recreation
function destroyCharts(){
  Object.values(charts).forEach(c=>{try{c.destroy();}catch(e){}});
  charts={};
}

function _chartOpts(extra){
  const base={
    responsive:true,maintainAspectRatio:false,
    plugins:{
      legend:{position:'top',labels:{font:{family:'DM Sans',size:11},boxWidth:10,boxHeight:10,padding:14,color:'#6b7194'}},
      tooltip:{
        backgroundColor:'rgba(14,16,26,0.88)',
        titleFont:{family:'DM Sans',size:12,weight:'600'},
        bodyFont:{family:'DM Sans',size:11},
        padding:{top:9,bottom:9,left:12,right:12},
        cornerRadius:8,
        borderColor:'rgba(255,255,255,0.08)',
        borderWidth:1,
        caretSize:5,
        displayColors:true,
        boxWidth:9,boxHeight:9,
        titleColor:'#e8eaf4',
        bodyColor:'#a0a8c8'
      }
    },
    scales:{
      x:{
        grid:{display:false},
        border:{display:false},
        ticks:{font:{family:'DM Sans',size:11},color:'#9399b0',padding:6}
      },
      y:{
        grid:{color:'rgba(0,0,0,0.04)',lineWidth:1},
        border:{display:false,dash:[3,3]},
        ticks:{font:{family:'DM Sans',size:11},color:'#9399b0',padding:8}
      }
    }
  };
  return Object.assign(base,extra||{});
}

// ── Display formatter for point values — PRESENTATION ONLY ──────────
// Rounds to 1 decimal, strips trailing .0 so "8.0" shows as "8".
// Never modifies stored values — call only at render time.
function _fmtPts(v){
  const n=Number(v);
  if(isNaN(n)) return v;
  const r=Math.round(n*10)/10;
  return r%1===0?String(Math.round(r)):r.toFixed(1);
}

