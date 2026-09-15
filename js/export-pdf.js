// ══════════════════════════════════════════════════════════════════════════
//  SPRINTFLOW — ENTERPRISE PDF REPORT ENGINE v3.0
//
//  Architecture: TRUE PAGE-BASED EXPORT — no screenshot slicing.
//  Each PDF page is built programmatically:
//    • Charts captured individually via Chart.js canvas.toDataURL()
//    • Tables rendered via jsPDF AutoTable
//    • KPI cards drawn directly with jsPDF primitives
//    • Intelligent pagination — sections never split mid-element
//    • Every page has consistent header + footer zones
//
//  Page order:
//    1. Cover Page
//    2. Executive Summary (KPIs + Health Strip)
//    3. Sprint Analytics (4 charts)
//    4. Team Productivity (charts + table)
//    5. Member Productivity (table)
//    6. Project Analytics (charts + table)
//    7. Release Analytics (KPIs + charts)
//    8. Epic Analytics (3 charts)
//    9. Executive Summary Tables
//   10. Task List
// ══════════════════════════════════════════════════════════════════════════

// ─── PDF CONSTANTS ────────────────────────────────────────────────────────
const PDF_MARGIN      = 28;       // pt — left/right margin
const PDF_HEADER_H    = 38;       // pt — reserved for page header
const PDF_FOOTER_H    = 26;       // pt — reserved for page footer
const PDF_ACCENT      = [91, 95, 199];
const PDF_BG          = [245, 246, 250];
const PDF_CARD_BG     = [255, 255, 255];
const PDF_TEXT_DARK   = [13, 15, 20];
const PDF_TEXT_MID    = [74, 80, 102];
const PDF_TEXT_LIGHT  = [147, 153, 176];
const PDF_LINE_COLOR  = [220, 223, 234];
// Chart capture scale (higher = sharper but slower)
const PDF_CHART_SCALE = 2;

// ─── UX: Loader overlay ───────────────────────────────────────────────────

function _pdfShowLoader(visible) {
  let overlay = document.getElementById('_pdf_loader_overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = '_pdf_loader_overlay';
    overlay.innerHTML = `
      <div style="position:fixed;inset:0;z-index:9998;background:rgba(8,10,20,0.65);backdrop-filter:blur(12px);display:flex;align-items:center;justify-content:center;font-family:'DM Sans',sans-serif;">
        <div style="background:rgba(255,255,255,0.98);border-radius:20px;padding:36px 44px;box-shadow:0 32px 80px rgba(0,0,0,0.26),0 8px 28px rgba(0,0,0,0.1),inset 0 1px 0 #fff;display:flex;flex-direction:column;align-items:center;gap:18px;border:1px solid rgba(255,255,255,0.9);min-width:280px;max-width:360px;">
          <div id="_pdf_spinner" style="width:40px;height:40px;border-radius:50%;border:3.5px solid rgba(91,95,199,0.18);border-top-color:#5b5fc7;animation:_pdfSpin 0.75s linear infinite;"></div>
          <div style="text-align:center;">
            <div style="font-size:15px;font-weight:700;color:#0d0f14;margin-bottom:4px">Generating Enterprise Report…</div>
            <div id="_pdf_loader_msg" style="font-size:12.5px;color:#7a7f9a;">Initialising export engine</div>
          </div>
          <div style="width:100%;height:5px;background:#eceef5;border-radius:99px;overflow:hidden;">
            <div id="_pdf_progress_bar" style="height:100%;background:linear-gradient(90deg,#5b5fc7,#7b7fd4);border-radius:99px;width:0%;transition:width 0.35s ease;"></div>
          </div>
          <div id="_pdf_stage_label" style="font-size:10.5px;color:#c8ccd8;letter-spacing:.04em;text-transform:uppercase;font-weight:600;">Preparing…</div>
        </div>
      </div>`;
    if (!document.getElementById('_pdfSpinStyle')) {
      const s = document.createElement('style');
      s.id = '_pdfSpinStyle';
      s.textContent = '@keyframes _pdfSpin{to{transform:rotate(360deg)}}';
      document.head.appendChild(s);
    }
    document.body.appendChild(overlay);
  }
  overlay.style.display = visible ? 'flex' : 'none';
}

function _pdfProgress(pct, msg, stage) {
  const bar   = document.getElementById('_pdf_progress_bar');
  const lbl   = document.getElementById('_pdf_loader_msg');
  const stg   = document.getElementById('_pdf_stage_label');
  if (bar) bar.style.width = Math.min(100, pct) + '%';
  if (lbl && msg)   lbl.textContent   = msg;
  if (stg && stage) stg.textContent   = stage;
}

function _pdfSetExportBtnState(disabled) {
  ['rpt-export-btn', 'rpt-menu-pdf-btn'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.disabled = disabled;
    btn.style.opacity = disabled ? '0.5' : '';
    btn.style.pointerEvents = disabled ? 'none' : '';
  });
}

// ─── HELPERS ──────────────────────────────────────────────────────────────

function _pdfFilename() {
  const d = new Date(), p = n => String(n).padStart(2,'0');
  return `SprintFlow_Report_${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}.pdf`;
}

function _pdfGetFilterSummary() {
  const parts = [];
  const pids = _rptGetProjIds();
  const sids = _rptGetSprintIds();
  if(pids.length){
    const names = pids.map(id => { const p = RBAC.getVisibleProjects().find(x=>x.id===id); return p?p.name:id; });
    parts.push('Projects: ' + names.join(', '));
  }
  if(sids.length){
    const names = sids.map(id => { const s = RBAC.getVisibleSprints().find(x=>x.id===id); return s?s.name:id; });
    parts.push('Sprints: ' + names.join(', '));
  }
  const f = (typeof _rptAdvFilters !== 'undefined' && _rptAdvFilters) ? _rptAdvFilters : {};
  if (f.status   && f.status   !== 'all') parts.push('Status: '   + f.status);
  if (f.priority && f.priority !== 'all') parts.push('Priority: ' + f.priority);
  if (f.type     && f.type     !== 'all') parts.push('Type: '     + f.type);
  if (f.assignee && f.assignee !== 'all') {
    const u = (typeof state !== 'undefined') ? state.users?.find(u => u.id === f.assignee) : null;
    parts.push('Assignee: ' + (u ? u.name : f.assignee));
  }
  return parts.length ? parts.join(' | ') : 'None';
}

// ─── PAGE LAYOUT HELPERS ──────────────────────────────────────────────────

/**
 * Returns usable content area dimensions for a given doc.
 */
function _pdfContentArea(doc) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  return {
    pageW, pageH,
    x:  PDF_MARGIN,
    y:  PDF_HEADER_H + 8,           // content starts below header
    w:  pageW - PDF_MARGIN * 2,
    maxY: pageH - PDF_FOOTER_H - 6, // content must end above footer
  };
}

/**
 * Draw the standard page header on the CURRENT page.
 * Call after doc.addPage() or on first content page.
 */
function _pdfDrawHeader(doc, meta, sectionTitle) {
  const { pageW } = _pdfContentArea(doc);
  const accent = PDF_ACCENT;

  // Accent top bar
  doc.setFillColor(...accent);
  doc.rect(0, 0, pageW, 3.5, 'F');

  // Light header background
  doc.setFillColor(250, 250, 252);
  doc.rect(0, 3.5, pageW, PDF_HEADER_H - 3.5, 'F');

  // Separator line
  doc.setDrawColor(...PDF_LINE_COLOR);
  doc.setLineWidth(0.5);
  doc.line(0, PDF_HEADER_H, pageW, PDF_HEADER_H);

  // SF logo box
  doc.setFillColor(...accent);
  doc.roundedRect(PDF_MARGIN, 7, 20, 20, 4, 4, 'F');
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text('SF', PDF_MARGIN + 10, 21, { align: 'center' });

  // Brand name
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...PDF_TEXT_DARK);
  doc.text('SprintFlow', PDF_MARGIN + 26, 16);

  // Section title
  if (sectionTitle) {
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...PDF_TEXT_LIGHT);
    doc.text('/ ' + sectionTitle, PDF_MARGIN + 26, 26);
  }

  // Right: report date + user
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...PDF_TEXT_LIGHT);
  const rightText = meta.date + (meta.user ? '  ·  ' + meta.user : '');
  doc.text(rightText, pageW - PDF_MARGIN, 18, { align: 'right' });
  if (meta.filters && meta.filters !== 'None') {
    doc.setFontSize(6.5);
    doc.text('Filters: ' + meta.filters, pageW - PDF_MARGIN, 28, { align: 'right', maxWidth: 280 });
  }
}

/**
 * Draw the standard page footer on the CURRENT page.
 */
function _pdfDrawFooter(doc, pageNum, totalPages, recordCount) {
  const { pageW, pageH } = _pdfContentArea(doc);
  const fy = pageH - 9;

  // Footer rule
  doc.setDrawColor(...PDF_LINE_COLOR);
  doc.setLineWidth(0.4);
  doc.line(PDF_MARGIN, fy - 8, pageW - PDF_MARGIN, fy - 8);

  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');

  // Left: confidential
  doc.setTextColor(...PDF_TEXT_LIGHT);
  doc.text('SprintFlow Analytics — Confidential', PDF_MARGIN, fy);

  // Centre: record count
  if (recordCount !== null && recordCount !== undefined) {
    doc.setTextColor(...PDF_TEXT_LIGHT);
    doc.text(`${recordCount} records`, pageW / 2, fy, { align: 'center' });
  }

  // Right: page number
  doc.setTextColor(...PDF_ACCENT);
  doc.setFont('helvetica', 'bold');
  doc.text(`${pageNum} / ${totalPages}`, pageW - PDF_MARGIN, fy, { align: 'right' });
}

/**
 * Draw a coloured section title band.
 * Returns the new Y position after the band.
 */
function _pdfSectionBand(doc, title, y) {
  const { pageW, x, w } = _pdfContentArea(doc);

  // Left accent bar
  doc.setFillColor(...PDF_ACCENT);
  doc.rect(x, y - 1, 3, 13, 'F');

  doc.setFontSize(10.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...PDF_TEXT_DARK);
  doc.text(title, x + 8, y + 9);

  // Underline
  doc.setDrawColor(...PDF_LINE_COLOR);
  doc.setLineWidth(0.4);
  doc.line(x + 8, y + 12, x + w, y + 12);

  return y + 22;
}

/**
 * Draw a coloured KPI card primitive at (cx, cy) with given w/h.
 */
function _pdfKpiCard(doc, cx, cy, cw, ch, label, value, sub, accentColor) {
  const ac = accentColor || PDF_ACCENT;

  // Card background + border
  doc.setFillColor(...PDF_CARD_BG);
  doc.roundedRect(cx, cy, cw, ch, 5, 5, 'F');
  doc.setDrawColor(...PDF_LINE_COLOR);
  doc.setLineWidth(0.4);
  doc.roundedRect(cx, cy, cw, ch, 5, 5, 'S');

  // Accent top edge
  doc.setFillColor(...ac);
  doc.rect(cx, cy, cw, 2.5, 'F');

  // Label
  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...PDF_TEXT_LIGHT);
  doc.text(label.toUpperCase(), cx + 8, cy + 12);

  // Value
  doc.setFontSize(17);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...PDF_TEXT_DARK);
  doc.text(String(value), cx + 8, cy + 28);

  // Sub-label
  if (sub) {
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...PDF_TEXT_LIGHT);
    doc.text(String(sub), cx + 8, cy + 38, { maxWidth: cw - 16 });
  }
}

/**
 * Draw a progress KPI card with a visual bar.
 */
function _pdfKpiCardProgress(doc, cx, cy, cw, ch, label, pct, accentColor) {
  const ac = accentColor || PDF_ACCENT;

  doc.setFillColor(...PDF_CARD_BG);
  doc.roundedRect(cx, cy, cw, ch, 5, 5, 'F');
  doc.setDrawColor(...PDF_LINE_COLOR);
  doc.setLineWidth(0.4);
  doc.roundedRect(cx, cy, cw, ch, 5, 5, 'S');

  doc.setFillColor(...ac);
  doc.rect(cx, cy, cw, 2.5, 'F');

  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...PDF_TEXT_LIGHT);
  doc.text(label.toUpperCase(), cx + 8, cy + 12);

  doc.setFontSize(17);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...PDF_TEXT_DARK);
  doc.text(pct + '%', cx + 8, cy + 28);

  // Progress bar track
  const barX = cx + 8;
  const barY = cy + 35;
  const barW = cw - 16;
  const barH = 4;
  doc.setFillColor(230, 232, 240);
  doc.roundedRect(barX, barY, barW, barH, 2, 2, 'F');
  // Progress fill
  const fillW = Math.max(2, barW * (Math.min(100, Math.max(0, pct)) / 100));
  doc.setFillColor(...ac);
  doc.roundedRect(barX, barY, fillW, barH, 2, 2, 'F');
}

/**
 * Capture a Chart.js canvas as a PNG dataURL.
 * Stops animation first for a clean frame.
 */
async function _pdfCaptureChart(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  try {
    const inst = (typeof Chart !== 'undefined' && Chart.getChart) ? Chart.getChart(canvas) : null;
    if (inst) { inst.stop(); inst.render(); }
    // Give one frame to settle
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 60)));
    return canvas.toDataURL('image/png', 1.0);
  } catch (e) {
    console.warn('[SprintFlow PDF] Chart capture failed:', canvasId, e);
    return null;
  }
}

/**
 * Insert a chart image into the PDF at the given position.
 * Preserves aspect ratio. Returns the height consumed (in pt).
 */
function _pdfInsertChart(doc, dataURL, x, y, maxW, maxH) {
  if (!dataURL) return 0;
  // Parse natural dimensions from data URL via an Image element trick is
  // unavailable in jsPDF context, so use maxW/maxH directly.
  const ratio = 1.8; // typical landscape chart aspect ratio
  let w = maxW;
  let h = Math.min(maxH, w / ratio);
  doc.addImage(dataURL, 'PNG', x, y, w, h, undefined, 'FAST');
  return h;
}

/**
 * Ensure there is enough vertical space on the current page.
 * If not, adds a new page, draws header, and returns the reset Y.
 */
function _pdfEnsureSpace(doc, currentY, neededH, meta, sectionTitle) {
  const { maxY, y: startY } = _pdfContentArea(doc);
  if (currentY + neededH > maxY) {
    doc.addPage();
    _pdfDrawHeader(doc, meta, sectionTitle);
    return startY;
  }
  return currentY;
}

// ─── COVER PAGE ────────────────────────────────────────────────────────────

function _pdfBuildCoverPage(doc, meta) {
  const { pageW, pageH } = _pdfContentArea(doc);

  // Dark background
  doc.setFillColor(13, 15, 26);
  doc.rect(0, 0, pageW, pageH, 'F');

  // Accent left bar
  doc.setFillColor(...PDF_ACCENT);
  doc.rect(0, 0, 6, pageH, 'F');

  // Large logo box
  doc.setFillColor(...PDF_ACCENT);
  doc.roundedRect(48, 52, 56, 56, 12, 12, 'F');
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text('SF', 76, 88, { align: 'center' });

  // Report title block
  doc.setFontSize(30);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(232, 234, 244);
  doc.text('SprintFlow', 48, 140);

  doc.setFontSize(14);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(122, 127, 154);
  doc.text('Enterprise Analytics Report', 48, 160);

  // Divider
  doc.setDrawColor(...PDF_ACCENT);
  doc.setLineWidth(1.5);
  doc.line(48, 175, 320, 175);

  // Metadata grid
  const items = [
    ['Report Date',    meta.date],
    ['Generated By',   meta.user || 'SprintFlow User'],
    ['Filters',        meta.filters !== 'None' ? meta.filters : 'No filters applied'],
    ['Total Records',  String(meta.recordCount)],
  ];
  let my = 202;
  items.forEach(([label, value]) => {
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...PDF_ACCENT);
    doc.text(label, 48, my);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(180, 185, 210);
    doc.text(value, 220, my, { maxWidth: pageW - 240 });
    my += 22;
  });

  // Section index
  const sections = [
    'Executive Summary',
    'Sprint Analytics',
    'Team Productivity',
    'Member Productivity',
    'Project Analytics',
    'Release Analytics',
    'Epic Analytics',
    'Summary Tables',
    'Task List',
  ];
  const colX = pageW * 0.56;
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(91, 95, 199);
  doc.text('REPORT CONTENTS', colX, 96);

  doc.setDrawColor(91, 95, 199);
  doc.setLineWidth(0.5);
  doc.line(colX, 100, colX + 160, 100);

  sections.forEach((s, i) => {
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(160, 165, 190);
    doc.text(`${String(i + 2).padStart(2, '0')}  ${s}`, colX, 114 + i * 16);
  });

  // Footer tag
  doc.setFontSize(7.5);
  doc.setTextColor(55, 60, 82);
  doc.text('CONFIDENTIAL — SprintFlow Enterprise Analytics', 48, pageH - 28);
}

// ─── PAGE 2: EXECUTIVE SUMMARY ─────────────────────────────────────────────

function _pdfBuildExecutiveSummary(doc, meta, data) {
  const { x, y: startY, w, maxY, pageW } = _pdfContentArea(doc);

  doc.addPage();
  _pdfDrawHeader(doc, meta, 'Executive Summary');
  let cy = startY;

  cy = _pdfSectionBand(doc, 'Executive Health & KPIs', cy);
  cy += 4;

  // Health strip — read from live DOM
  const healthItems = [
    { id: 'hd-sprint-lbl',    label: 'Sprint Health',   dotId: 'hd-sprint' },
    { id: 'hd-qa-lbl',        label: 'QA Stability',    dotId: 'hd-qa'     },
    { id: 'hd-release-lbl',   label: 'Release Risk',    dotId: 'hd-release'},
    { id: 'hd-capacity-lbl',  label: 'Team Capacity',   dotId: 'hd-capacity'},
  ];
  const dotColorMap = { '#22c55e': [34,197,94], '#f59e0b': [245,158,11], '#ef4444': [239,68,68], '#e2e8f0': [226,232,240] };

  const healthW = w / healthItems.length - 4;
  healthItems.forEach((item, i) => {
    const el    = document.getElementById(item.id);
    const dotEl = document.getElementById(item.dotId);
    const txt   = el ? el.textContent.trim() : '—';
    const dotStyle = dotEl ? dotEl.style.background : '';
    let dotColor = PDF_LINE_COLOR;
    Object.entries(dotColorMap).forEach(([hex, rgb]) => {
      if (dotStyle && dotStyle.includes(hex.slice(1))) dotColor = rgb;
    });

    const hx = x + i * (healthW + 4);
    doc.setFillColor(250, 250, 253);
    doc.roundedRect(hx, cy, healthW, 28, 4, 4, 'F');
    doc.setDrawColor(...PDF_LINE_COLOR);
    doc.setLineWidth(0.4);
    doc.roundedRect(hx, cy, healthW, 28, 4, 4, 'S');
    // Dot
    doc.setFillColor(...dotColor);
    doc.circle(hx + 12, cy + 14, 4, 'F');
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...PDF_TEXT_DARK);
    doc.text(item.label, hx + 20, cy + 12);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...PDF_TEXT_LIGHT);
    doc.text(txt, hx + 20, cy + 22);
  });
  cy += 38;

  // KPI Row 1: 5 cards
  const kpi1 = [
    { id:'rpt-kpi-projects',  sub:'rpt-kpi-projects-sub', label:'Total Projects',  accent:PDF_ACCENT },
    { id:'rpt-kpi-sprints',   sub:'rpt-kpi-sprints-sub',  label:'Active Sprints',  accent:[14,165,233] },
    { id:'rpt-kpi-open',      sub:'rpt-kpi-open-sub',     label:'Open Tasks',      accent:[245,158,11] },
    { id:'rpt-kpi-released',  sub:'rpt-kpi-released-sub', label:'Released Tasks',  accent:[16,185,129] },
    { id:'rpt-kpi-bugs',      sub:'rpt-kpi-bugs-sub',     label:'Open Bugs',       accent:[239,68,68]  },
  ];
  const cardW = (w - 16) / 5;
  const cardH = 52;
  kpi1.forEach((k, i) => {
    const el  = document.getElementById(k.id);
    const sel = document.getElementById(k.sub);
    const val = el  ? el.textContent.trim()  : '—';
    const sub = sel ? sel.textContent.trim() : '';
    _pdfKpiCard(doc, x + i * (cardW + 4), cy, cardW, cardH, k.label, val, sub, k.accent);
  });
  cy += cardH + 8;

  // KPI Row 2: 4 progress + 1 number cards
  const kpi2Progress = [
    { id:'rpt-kpi-sprint-comp',    label:'Sprint Completion',   accent:PDF_ACCENT        },
    { id:'rpt-kpi-release-ready',  label:'Release Readiness',   accent:[16,185,129]      },
  ];
  const kpi2Num = [
    { id:'rpt-kpi-reopen',   sub:'rpt-kpi-reopen-sub',    label:'QA Reopen Rate',      accent:[239,68,68] },
    { id:'rpt-kpi-avg-time', sub:'rpt-kpi-avg-time-sub',  label:'Avg Task Completion',  accent:[139,92,246] },
  ];
  const card2W = (w - 12) / 4;
  const card2H = 52;

  kpi2Progress.forEach((k, i) => {
    const el  = document.getElementById(k.id);
    const raw = el ? el.textContent.trim().replace('%','') : '0';
    const pct = parseInt(raw, 10) || 0;
    _pdfKpiCardProgress(doc, x + i * (card2W + 4), cy, card2W, card2H, k.label, pct, k.accent);
  });
  kpi2Num.forEach((k, i) => {
    const el  = document.getElementById(k.id);
    const sel = document.getElementById(k.sub);
    const val = el  ? el.textContent.trim() : '—';
    const sub = sel ? sel.textContent.trim() : '';
    _pdfKpiCard(doc, x + (2 + i) * (card2W + 4), cy, card2W, card2H, k.label, val, sub, k.accent);
  });
  cy += card2H + 12;

  // Executive summary mini-table
  cy = _pdfSectionBand(doc, 'Summary Metrics', cy);

  const summaryRows = [
    ['Total Projects',      String(data._rp.length),              ''],
    ['Active Sprints',      String(data.activeSprints),           ''],
    ['Total Tasks',         String(data.totalTasks),              ''],
    ['Open Tasks',          String(data.openTasks),               `${data.totalTasks ? Math.round(data.openTasks/data.totalTasks*100) : 0}% of total`],
    ['Released Tasks',      String(data.releasedTasks),           `${data.sprintComp}% completion`],
    ['Open Bugs',           String(data.openBugs),                ''],
    ['Sprint Completion',   data.sprintComp + '%',                ''],
    ['Release Readiness',   data.releaseReady + '%',              ''],
    ['QA Reopen Rate',      data.reopenRate + '%',                ''],
    ['Applied Filters',     data._filters || 'None',             ''],
    ['Generated By',        meta.user || 'SprintFlow User',      ''],
    ['Export Date',         meta.date,                            ''],
  ];

  doc.autoTable({
    startY: cy,
    head: [['Metric', 'Value', 'Note']],
    body: summaryRows,
    theme: 'plain',
    headStyles: {
      fillColor: PDF_ACCENT, textColor: [255,255,255],
      fontStyle: 'bold', fontSize: 8, cellPadding: { top:5, bottom:5, left:8, right:8 },
    },
    bodyStyles: { fontSize: 8, textColor: PDF_TEXT_MID, cellPadding: { top:4, bottom:4, left:8, right:8 } },
    alternateRowStyles: { fillColor: [248, 249, 252] },
    columnStyles: { 0: { fontStyle:'bold', cellWidth:160 }, 1: { cellWidth:120 }, 2: { cellWidth:'auto', textColor:PDF_TEXT_LIGHT } },
    margin: { left: x, right: PDF_MARGIN, top: 6, bottom: PDF_FOOTER_H + 8 },
    tableWidth: 'wrap',
    didDrawPage: (d) => { _pdfDrawHeader(doc, meta, 'Executive Summary'); },
  });
}

// ─── PAGE 3: SPRINT ANALYTICS ──────────────────────────────────────────────

async function _pdfBuildSprintAnalytics(doc, meta, chartImages) {
  const { x, y: startY, w, maxY } = _pdfContentArea(doc);

  doc.addPage();
  _pdfDrawHeader(doc, meta, 'Sprint Analytics');
  let cy = startY;

  cy = _pdfSectionBand(doc, 'Sprint Performance', cy);
  cy += 4;

  const chartH = 140;
  const halfW  = (w - 10) / 2;

  // Row 1: Velocity + Burndown
  const charts1 = ['velocityChart', 'burndownChart'];
  const titles1 = ['Velocity Trend — Committed vs Completed Story Points', 'Sprint Burndown — Remaining vs Ideal (Active Sprint)'];
  for (let i = 0; i < 2; i++) {
    const cx2 = x + i * (halfW + 10);
    // Card background
    doc.setFillColor(...PDF_CARD_BG);
    doc.roundedRect(cx2, cy, halfW, chartH + 24, 6, 6, 'F');
    doc.setDrawColor(...PDF_LINE_COLOR);
    doc.setLineWidth(0.4);
    doc.roundedRect(cx2, cy, halfW, chartH + 24, 6, 6, 'S');
    // Chart title
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...PDF_TEXT_DARK);
    doc.text(titles1[i], cx2 + 8, cy + 14, { maxWidth: halfW - 16 });
    // Chart image
    if (chartImages[charts1[i]]) {
      _pdfInsertChart(doc, chartImages[charts1[i]], cx2 + 6, cy + 18, halfW - 12, chartH);
    } else {
      doc.setFontSize(8); doc.setTextColor(...PDF_TEXT_LIGHT);
      doc.text('Chart data unavailable', cx2 + halfW/2, cy + chartH/2 + 18, { align:'center' });
    }
  }
  cy += chartH + 32;

  // Row 2: Spillover (full width)
  const charts2 = ['spilloverChart'];
  const titles2 = ['Sprint Spillover — Incomplete Tasks Carried Over'];
  {
    const cx2 = x;
    doc.setFillColor(...PDF_CARD_BG);
    doc.roundedRect(cx2, cy, w, chartH + 24, 6, 6, 'F');
    doc.setDrawColor(...PDF_LINE_COLOR);
    doc.setLineWidth(0.4);
    doc.roundedRect(cx2, cy, w, chartH + 24, 6, 6, 'S');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...PDF_TEXT_DARK);
    doc.text(titles2[0], cx2 + 8, cy + 14, { maxWidth: w - 16 });
    if (chartImages[charts2[0]]) {
      _pdfInsertChart(doc, chartImages[charts2[0]], cx2 + 6, cy + 18, w - 12, chartH);
    } else {
      doc.setFontSize(8); doc.setTextColor(...PDF_TEXT_LIGHT);
      doc.text('Chart data unavailable', cx2 + w/2, cy + chartH/2 + 18, { align:'center' });
    }
  }
}

// ─── PAGE 4: TEAM PRODUCTIVITY (charts) ────────────────────────────────────

async function _pdfBuildTeamProductivityCharts(doc, meta, chartImages) {
  const { x, y: startY, w, maxY } = _pdfContentArea(doc);

  doc.addPage();
  _pdfDrawHeader(doc, meta, 'Team Productivity');
  let cy = startY;

  cy = _pdfSectionBand(doc, 'Workload & Task Distribution', cy);
  cy += 4;

  const workloadH = 155;
  const typeH     = 155;
  const workloadW = w * 0.64 - 5;
  const typeW     = w * 0.36 - 5;

  // Workload chart (wide)
  doc.setFillColor(...PDF_CARD_BG);
  doc.roundedRect(x, cy, workloadW, workloadH + 22, 6, 6, 'F');
  doc.setDrawColor(...PDF_LINE_COLOR); doc.setLineWidth(0.4);
  doc.roundedRect(x, cy, workloadW, workloadH + 22, 6, 6, 'S');
  doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(...PDF_TEXT_DARK);
  doc.text('Workload Distribution — Story Points Assigned per Member', x + 8, cy + 13, { maxWidth: workloadW - 16 });
  if (chartImages['workloadChart']) {
    _pdfInsertChart(doc, chartImages['workloadChart'], x + 6, cy + 17, workloadW - 12, workloadH);
  }

  // Type pie (narrow)
  const tpX = x + workloadW + 10;
  doc.setFillColor(...PDF_CARD_BG);
  doc.roundedRect(tpX, cy, typeW, typeH + 22, 6, 6, 'F');
  doc.setDrawColor(...PDF_LINE_COLOR); doc.setLineWidth(0.4);
  doc.roundedRect(tpX, cy, typeW, typeH + 22, 6, 6, 'S');
  doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(...PDF_TEXT_DARK);
  doc.text('Task Type Distribution', tpX + 8, cy + 13, { maxWidth: typeW - 16 });
  if (chartImages['typeChart']) {
    _pdfInsertChart(doc, chartImages['typeChart'], tpX + 6, cy + 17, typeW - 12, typeH);
  }
}

// ─── PAGE 5: MEMBER PRODUCTIVITY TABLE ─────────────────────────────────────

function _pdfBuildMemberProductivityTable(doc, meta, data) {
  const { x, y: startY, w } = _pdfContentArea(doc);

  doc.addPage();
  _pdfDrawHeader(doc, meta, 'Member Productivity');
  let cy = startY;

  cy = _pdfSectionBand(doc, 'Member Productivity Breakdown', cy);
  cy += 4;

  doc.autoTable({
    startY: cy,
    head: [['Member', 'Total Tasks', 'Completed', 'Active', 'Pts Done', 'Total Pts', 'QA Reopens', 'Completion %']],
    body: data.prodRows,
    theme: 'grid',
    headStyles: {
      fillColor: PDF_ACCENT, textColor: [255,255,255],
      fontStyle: 'bold', fontSize: 8, cellPadding: { top:6, bottom:6, left:8, right:6 },
    },
    bodyStyles: { fontSize: 8.5, textColor: PDF_TEXT_MID, cellPadding: { top:5, bottom:5, left:8, right:6 } },
    alternateRowStyles: { fillColor: [248, 249, 252] },
    columnStyles: {
      0: { fontStyle:'bold', cellWidth:120 },
      1: { halign:'right', cellWidth:60 },
      2: { halign:'right', cellWidth:60 },
      3: { halign:'right', cellWidth:50 },
      4: { halign:'right', cellWidth:55 },
      5: { halign:'right', cellWidth:55 },
      6: { halign:'right', cellWidth:65, textColor:[239,68,68] },
      7: { halign:'right', cellWidth:70, fontStyle:'bold' },
    },
    margin: { left: x, right: PDF_MARGIN, top: 6, bottom: PDF_FOOTER_H + 8 },
    showHead: 'everyPage',
    rowPageBreak: 'avoid',
    didDrawPage: () => { _pdfDrawHeader(doc, meta, 'Member Productivity'); },
  });
}

// ─── PAGE 6: PROJECT ANALYTICS ─────────────────────────────────────────────

async function _pdfBuildProjectAnalytics(doc, meta, data, chartImages) {
  const { x, y: startY, w, maxY } = _pdfContentArea(doc);

  doc.addPage();
  _pdfDrawHeader(doc, meta, 'Project Analytics');
  let cy = startY;

  cy = _pdfSectionBand(doc, 'Project Health & Distribution', cy);
  cy += 4;

  const chartH = 140;
  const halfW  = (w - 10) / 2;

  const projCharts = [
    { id: 'projDistChart',    title: 'Task Distribution by Project — Open / In-Progress / Released' },
    { id: 'sprintHealthChart',title: 'Sprint Health per Project — Completion % of Active Sprints' },
  ];
  projCharts.forEach((ch, i) => {
    const cx2 = x + i * (halfW + 10);
    doc.setFillColor(...PDF_CARD_BG);
    doc.roundedRect(cx2, cy, halfW, chartH + 24, 6, 6, 'F');
    doc.setDrawColor(...PDF_LINE_COLOR); doc.setLineWidth(0.4);
    doc.roundedRect(cx2, cy, halfW, chartH + 24, 6, 6, 'S');
    doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(...PDF_TEXT_DARK);
    doc.text(ch.title, cx2 + 8, cy + 14, { maxWidth: halfW - 16 });
    if (chartImages[ch.id]) {
      _pdfInsertChart(doc, chartImages[ch.id], cx2 + 6, cy + 18, halfW - 12, chartH);
    }
  });
  cy += chartH + 34;

  // Project Details table
  cy = _pdfSectionBand(doc, 'Project Details', cy);
  cy += 4;

  doc.autoTable({
    startY: cy,
    head: [['Project', 'Tasks', 'Completed', 'Open Bugs', 'Completion %', 'Status']],
    body: data.projRows,
    theme: 'grid',
    headStyles: {
      fillColor: PDF_ACCENT, textColor: [255,255,255],
      fontStyle: 'bold', fontSize: 8, cellPadding: { top:6, bottom:6, left:8, right:6 },
    },
    bodyStyles: { fontSize: 8.5, textColor: PDF_TEXT_MID, cellPadding: { top:5, bottom:5, left:8, right:6 } },
    alternateRowStyles: { fillColor: [248, 249, 252] },
    columnStyles: {
      0: { fontStyle:'bold', cellWidth:150 },
      1: { halign:'right', cellWidth:55 },
      2: { halign:'right', cellWidth:70 },
      3: { halign:'right', cellWidth:65, textColor:[239,68,68] },
      4: { halign:'right', cellWidth:80, fontStyle:'bold' },
      5: { cellWidth:80 },
    },
    margin: { left: x, right: PDF_MARGIN, top: 6, bottom: PDF_FOOTER_H + 8 },
    showHead: 'everyPage',
    rowPageBreak: 'avoid',
    didDrawPage: () => { _pdfDrawHeader(doc, meta, 'Project Analytics'); },
  });
}

// ─── PAGE 7: RELEASE ANALYTICS ─────────────────────────────────────────────

async function _pdfBuildReleaseAnalytics(doc, meta, chartImages) {
  const { x, y: startY, w, maxY } = _pdfContentArea(doc);

  doc.addPage();
  _pdfDrawHeader(doc, meta, 'Release Analytics');
  let cy = startY;

  cy = _pdfSectionBand(doc, 'Release KPIs', cy);
  cy += 4;

  // Release KPI cards (read from DOM)
  const relKpis = [
    { id:'rpt-rel-comp',        label:'Release Completion',  isProgress:true, accent:PDF_ACCENT },
    { id:'rpt-rel-pending',     sub:'rpt-rel-pending-sub',   label:'Pending Tasks',       accent:[245,158,11] },
    { id:'rpt-rel-throughput',  label:'Release Throughput',  sub_text:'releases total',   accent:[16,185,129] },
    { id:'rpt-rel-blockers',    label:'Release Blockers',    sub:'rpt-rel-blockers-sub',  accent:[239,68,68] },
  ];
  const rkW = (w - 12) / 4;
  const rkH = 52;
  relKpis.forEach((k, i) => {
    const el = document.getElementById(k.id);
    const val = el ? el.textContent.trim() : '—';
    if (k.isProgress) {
      const pct = parseInt(val.replace('%','')) || 0;
      _pdfKpiCardProgress(doc, x + i*(rkW+4), cy, rkW, rkH, k.label, pct, k.accent);
    } else {
      const subEl = k.sub ? document.getElementById(k.sub) : null;
      const sub   = subEl ? subEl.textContent.trim() : (k.sub_text || '');
      _pdfKpiCard(doc, x + i*(rkW+4), cy, rkW, rkH, k.label, val, sub, k.accent);
    }
  });
  cy += rkH + 12;

  cy = _pdfSectionBand(doc, 'Release Charts', cy);
  cy += 4;

  const chartH = 145;
  const halfW  = (w - 10) / 2;

  const relCharts = [
    { id:'relCompChart',  title:'Release Completion % — Task Completion per Release' },
    { id:'relAgingChart', title:'Release Aging — Days Since Creation by Release' },
  ];
  relCharts.forEach((ch, i) => {
    const cx2 = x + i * (halfW + 10);
    doc.setFillColor(...PDF_CARD_BG);
    doc.roundedRect(cx2, cy, halfW, chartH + 24, 6, 6, 'F');
    doc.setDrawColor(...PDF_LINE_COLOR); doc.setLineWidth(0.4);
    doc.roundedRect(cx2, cy, halfW, chartH + 24, 6, 6, 'S');
    doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(...PDF_TEXT_DARK);
    doc.text(ch.title, cx2 + 8, cy + 14, { maxWidth: halfW - 16 });
    if (chartImages[ch.id]) {
      _pdfInsertChart(doc, chartImages[ch.id], cx2 + 6, cy + 18, halfW - 12, chartH);
    }
  });
}

// ─── PAGE 8: EPIC ANALYTICS ────────────────────────────────────────────────

async function _pdfBuildEpicAnalytics(doc, meta, chartImages) {
  const { x, y: startY, w } = _pdfContentArea(doc);

  doc.addPage();
  _pdfDrawHeader(doc, meta, 'Epic Analytics');
  let cy = startY;

  cy = _pdfSectionBand(doc, 'Epic Performance', cy);
  cy += 4;

  // Epic KPIs from DOM
  const epicKpis = [
    { id:'stat-epic-count',      label:'Total Epics',     accent:PDF_ACCENT        },
    { id:'stat-epic-completion', label:'Epic Completion',  isProgress:true, accent:[16,185,129] },
    { id:'stat-epic-active',     label:'Active Epics',    accent:[14,165,233]      },
  ];
  const ekW = (w - 8) / 3;
  const ekH = 52;
  epicKpis.forEach((k, i) => {
    const el  = document.getElementById(k.id);
    const val = el ? el.textContent.trim() : '—';
    if (k.isProgress) {
      const pct = parseInt(val.replace('%','')) || 0;
      _pdfKpiCardProgress(doc, x + i*(ekW+4), cy, ekW, ekH, k.label, pct, k.accent);
    } else {
      _pdfKpiCard(doc, x + i*(ekW+4), cy, ekW, ekH, k.label, val, '', k.accent);
    }
  });
  cy += ekH + 12;

  cy = _pdfSectionBand(doc, 'Epic Charts', cy);
  cy += 4;

  const chartH = 145;
  const thirdW = (w - 16) / 3;

  const epicCharts = [
    { id:'epicCompletionChart', title:'Epic Completion — Completed vs Total Tasks per Epic' },
    { id:'epicWorkloadChart',   title:'Epic Workload — Story Points per Epic'               },
    { id:'epicVelocityChart',   title:'Epic Velocity — Done vs Remaining Points per Epic'   },
  ];
  epicCharts.forEach((ch, i) => {
    const cx2 = x + i * (thirdW + 8);
    doc.setFillColor(...PDF_CARD_BG);
    doc.roundedRect(cx2, cy, thirdW, chartH + 24, 6, 6, 'F');
    doc.setDrawColor(...PDF_LINE_COLOR); doc.setLineWidth(0.4);
    doc.roundedRect(cx2, cy, thirdW, chartH + 24, 6, 6, 'S');
    doc.setFontSize(7.5); doc.setFont('helvetica','bold'); doc.setTextColor(...PDF_TEXT_DARK);
    doc.text(ch.title, cx2 + 8, cy + 13, { maxWidth: thirdW - 16 });
    if (chartImages[ch.id]) {
      // Epic charts are narrower — use a taller aspect ratio
      const h = Math.min(chartH, thirdW * 0.85);
      doc.addImage(chartImages[ch.id], 'PNG', cx2 + 6, cy + 17, thirdW - 12, h, undefined, 'FAST');
    }
  });
}

// ─── PAGE 9: SUMMARY TABLES ────────────────────────────────────────────────

function _pdfBuildSummaryTables(doc, meta, data) {
  const { x } = _pdfContentArea(doc);

  doc.addPage();
  _pdfDrawHeader(doc, meta, 'Summary Tables');
  let cy = _pdfContentArea(doc).y;

  cy = _pdfSectionBand(doc, 'Team Productivity Summary', cy);
  cy += 4;

  if (data.prodRows.length) {
    doc.autoTable({
      startY: cy,
      head: [['Member','Total','Completed','Active','Pts Done','Total Pts','Reopens','Completion %']],
      body: data.prodRows,
      theme: 'striped',
      headStyles: { fillColor: PDF_ACCENT, textColor:[255,255,255], fontStyle:'bold', fontSize:8 },
      bodyStyles: { fontSize: 8.5, textColor: PDF_TEXT_MID },
      alternateRowStyles: { fillColor: [248,249,252] },
      margin: { left: x, right: PDF_MARGIN, top:6, bottom: PDF_FOOTER_H + 8 },
      showHead: 'everyPage',
      rowPageBreak: 'avoid',
      didDrawPage: () => { _pdfDrawHeader(doc, meta, 'Summary Tables'); },
    });
    cy = doc.lastAutoTable.finalY + 16;
  }

  // Project breakdown
  if (doc.lastAutoTable) cy = doc.lastAutoTable.finalY + 16;
  const { maxY } = _pdfContentArea(doc);
  if (cy > maxY - 60) { doc.addPage(); _pdfDrawHeader(doc, meta, 'Summary Tables'); cy = _pdfContentArea(doc).y; }
  cy = _pdfSectionBand(doc, 'Project Breakdown Summary', cy);
  cy += 4;

  if (data.projRows.length) {
    doc.autoTable({
      startY: cy,
      head: [['Project','Tasks','Completed','Open Bugs','Completion %','Status']],
      body: data.projRows,
      theme: 'striped',
      headStyles: { fillColor: PDF_ACCENT, textColor:[255,255,255], fontStyle:'bold', fontSize:8 },
      bodyStyles: { fontSize: 8.5, textColor: PDF_TEXT_MID },
      alternateRowStyles: { fillColor: [248,249,252] },
      columnStyles: { 0:{cellWidth:150}, 1:{halign:'right'}, 2:{halign:'right'}, 3:{halign:'right'}, 4:{halign:'right'} },
      margin: { left: x, right: PDF_MARGIN, top:6, bottom: PDF_FOOTER_H + 8 },
      showHead: 'everyPage',
      rowPageBreak: 'avoid',
      didDrawPage: () => { _pdfDrawHeader(doc, meta, 'Summary Tables'); },
    });
  }
}

// ─── PAGE 10: TASK LIST ────────────────────────────────────────────────────

function _pdfBuildTaskList(doc, meta, data) {
  const { x } = _pdfContentArea(doc);

  doc.addPage();
  _pdfDrawHeader(doc, meta, 'Task List');
  let cy = _pdfContentArea(doc).y;

  cy = _pdfSectionBand(doc, `Full Task List (${Math.min(data.taskRows.length, 200)} tasks)`, cy);
  cy += 4;

  // Column order: Title | Task Type | Type | Epic | Status | Priority | Assignee | QA Assignee | Project | Sprint | Tags | Products | Pts
  // Visual grouping: parent task rows have an indigo-tinted background + bold title;
  // subtask rows are indented, slightly smaller, on a white/soft background with a left accent line.
  const _tm = data.taskMeta || [];

  doc.autoTable({
    startY: cy,
    head: [['Title','Task Type','Type','Epic','Status','Priority','Assignee','QA Assignee','Project','Sprint','Tags','Products','Pts']],
    body: data.taskRows,
    theme: 'plain',
    headStyles: { fillColor: PDF_ACCENT, textColor:[255,255,255], fontStyle:'bold', fontSize:6.5 },
    bodyStyles: { fontSize: 6.5, textColor: PDF_TEXT_MID, lineColor: [225,227,235], lineWidth: 0.3 },
    columnStyles: {
      0:  { cellWidth:90  },
      1:  { cellWidth:28  },
      2:  { cellWidth:28  },
      3:  { cellWidth:52  },
      4:  { cellWidth:52  },
      5:  { cellWidth:38  },
      6:  { cellWidth:52  },
      7:  { cellWidth:52  },
      8:  { cellWidth:50  },
      9:  { cellWidth:50  },
      10: { cellWidth:50  },
      11: { cellWidth:50  },
      12: { cellWidth:22, halign:'right' },
    },
    margin: { left: x, right: PDF_MARGIN, top: PDF_HEADER_H + 6, bottom: PDF_FOOTER_H + 8 },
    showHead: 'everyPage',
    rowPageBreak: 'avoid',
    didParseCell: function(hookData) {
      if (hookData.section !== 'body') return;
      const rowIdx = hookData.row.index;
      const m = _tm[rowIdx] || {};
      if (!m.isSubtask && m.hasSubtasks) {
        // Parent task that HAS subtasks: soft indigo tint + bold title
        hookData.cell.styles.fillColor = [237, 238, 252];
        hookData.cell.styles.textColor = [40, 44, 100];
        if (hookData.column.index === 0) hookData.cell.styles.fontStyle = 'bold';
      } else if (m.isSubtask) {
        // Subtask row: very light grey background, muted text, indented title
        hookData.cell.styles.fillColor = [250, 250, 253];
        hookData.cell.styles.textColor = PDF_TEXT_MID;
        if (hookData.column.index === 0) {
          hookData.cell.text = ['  > ' + (hookData.cell.text[0] || '')];
        }
      }
      // Tasks with NO subtasks: no styling override — renders as plain body row
    },
    willDrawCell: function(hookData) {
      if (hookData.section !== 'body') return;
      const rowIdx = hookData.row.index;
      const m = _tm[rowIdx] || {};
      // Solid indigo accent bar only on parent tasks that have subtasks
      if (!m.isSubtask && m.hasSubtasks && hookData.column.index === 0) {
        doc.setFillColor(91, 95, 199);
        doc.rect(hookData.cell.x, hookData.cell.y, 2.5, hookData.cell.height, 'F');
      }
      // Subtle grey connector line on subtask rows
      if (m.isSubtask && hookData.column.index === 0) {
        doc.setDrawColor(190, 194, 225);
        doc.setLineWidth(0.7);
        doc.line(hookData.cell.x + 3, hookData.cell.y, hookData.cell.x + 3, hookData.cell.y + hookData.cell.height);
      }
    },
    didDrawPage: () => { _pdfDrawHeader(doc, meta, 'Task List'); },
  });
}

// ══════════════════════════════════════════════════════════════════════════
//  MAIN EXPORT FUNCTION
// ══════════════════════════════════════════════════════════════════════════

async function exportReportPDF() {
  // Close export menu
  const menu = document.getElementById('rpt-export-menu');
  if (menu) menu.style.display = 'none';

  // Guard
  if (!window.jspdf) {
    _rptToast('⚠ PDF library not loaded — please wait and retry.', '#dc2626');
    return;
  }

  _pdfSetExportBtnState(true);
  _pdfShowLoader(true);
  _pdfProgress(3, 'Initialising export engine…', 'Starting up');

  // Yield to paint the loader
  await new Promise(r => setTimeout(r, 80));

  let retryCount = 0;
  const MAX_RETRIES = 1;

  async function _doExport() {
    try {
      // ── 1. Collect metadata ──────────────────────────────────────────
      const now = new Date();
      const dateStr = now.toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
      const timeStr = now.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' });
      const userObj = (window.getCurrentUser && window.getCurrentUser()) ? window.getCurrentUser() : null;
      const user    = userObj ? (userObj.displayName || userObj.email || 'SprintFlow User') : 'SprintFlow User';
      const filters = _pdfGetFilterSummary();

      const exportData  = _getReportExportData();
      exportData._filters = filters;
      const recordCount = exportData.totalTasks || 0;

      const meta = { date: dateStr + ' at ' + timeStr, user, filters, recordCount };

      _pdfProgress(8, 'Capturing charts…', 'Chart rendering');

      // ── 2. Capture all charts independently ─────────────────────────
      const chartIds = [
        'velocityChart','burndownChart','spilloverChart',
        'workloadChart','typeChart',
        'projDistChart','sprintHealthChart',
        'relCompChart','relAgingChart',
        'epicCompletionChart','epicWorkloadChart','epicVelocityChart',
      ];

      // Pre-render all charts (stop animations, force final frame)
      const allCanvases = document.querySelectorAll('#page-reports canvas');
      allCanvases.forEach(c => {
        const inst = (typeof Chart !== 'undefined' && Chart.getChart) ? Chart.getChart(c) : null;
        if (inst) { inst.stop(); inst.render(); }
      });
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 120)));

      const chartImages = {};
      let done = 0;
      for (const cid of chartIds) {
        chartImages[cid] = await _pdfCaptureChart(cid);
        done++;
        _pdfProgress(8 + Math.round((done / chartIds.length) * 22), `Capturing ${cid}…`, 'Chart rendering');
      }

      _pdfProgress(32, 'Building PDF structure…', 'Page composition');

      // ── 3. Create jsPDF document ─────────────────────────────────────
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation:'landscape', unit:'pt', format:'a4', compress:true });

      // ── 4. Build each page section ───────────────────────────────────

      // Page 1: Cover
      _pdfProgress(35, 'Rendering cover page…', 'Cover page');
      _pdfBuildCoverPage(doc, meta);

      // Page 2: Executive Summary
      _pdfProgress(40, 'Building executive summary…', 'Executive Summary');
      _pdfBuildExecutiveSummary(doc, meta, exportData);

      // Page 3: Sprint Analytics
      _pdfProgress(50, 'Composing sprint analytics…', 'Sprint Analytics');
      await _pdfBuildSprintAnalytics(doc, meta, chartImages);

      // Page 4: Team Productivity (charts)
      _pdfProgress(58, 'Composing team productivity charts…', 'Team Productivity');
      await _pdfBuildTeamProductivityCharts(doc, meta, chartImages);

      // Page 5: Member Productivity Table
      _pdfProgress(63, 'Building member productivity table…', 'Member Productivity');
      _pdfBuildMemberProductivityTable(doc, meta, exportData);

      // Page 6: Project Analytics
      _pdfProgress(70, 'Composing project analytics…', 'Project Analytics');
      await _pdfBuildProjectAnalytics(doc, meta, exportData, chartImages);

      // Page 7: Release Analytics
      _pdfProgress(78, 'Composing release analytics…', 'Release Analytics');
      await _pdfBuildReleaseAnalytics(doc, meta, chartImages);

      // Page 8: Epic Analytics
      _pdfProgress(84, 'Composing epic analytics…', 'Epic Analytics');
      await _pdfBuildEpicAnalytics(doc, meta, chartImages);

      // Page 9: Summary Tables
      _pdfProgress(89, 'Building summary tables…', 'Summary Tables');
      _pdfBuildSummaryTables(doc, meta, exportData);

      // Page 10: Task List
      _pdfProgress(93, 'Building task list…', 'Task List');
      _pdfBuildTaskList(doc, meta, exportData);

      // ── 5. Stamp headers + footers on every page ─────────────────────
      _pdfProgress(96, 'Finalising pages…', 'Finalising');
      const totalPages = doc.internal.getNumberOfPages();
      // Footers on pages 2+ (page 1 is cover with its own layout)
      for (let i = 2; i <= totalPages; i++) {
        doc.setPage(i);
        _pdfDrawFooter(doc, i, totalPages, recordCount);
      }
      // Cover page: no footer stamp needed (has own design)

      // ── 6. Save ──────────────────────────────────────────────────────
      _pdfProgress(100, 'Saving file…', 'Complete');
      await new Promise(r => setTimeout(r, 60));
      const filename = _pdfFilename();
      doc.save(filename);

      // Cleanup chart image references
      Object.keys(chartImages).forEach(k => { chartImages[k] = null; });

      _rptToast(
        `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> PDF exported — ${filename}`,
        'rgba(5,150,105,0.96)'
      );

    } catch (err) {
      console.error('[SprintFlow PDF v3] Export error:', err);
      if (retryCount < MAX_RETRIES) {
        retryCount++;
        _pdfProgress(0, `Retrying… (attempt ${retryCount + 1})`, 'Retrying');
        await new Promise(r => setTimeout(r, 900));
        return _doExport();
      }
      _rptToast(
        `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> PDF export failed — ${err.message}`,
        'rgba(220,38,38,0.96)'
      );
    } finally {
      _pdfShowLoader(false);
      _pdfSetExportBtnState(false);
    }
  }

  await _doExport();
}

