// ── SprintFlow v29 — DESCRIPTION DECOUPLING (Phase 2) ───────────
// Descriptions moved out of task payloads into sprintflow/taskDescriptions/{taskId}
// Subtask descriptions: sprintflow/taskDescriptions/{taskId}/_subtasks/{subtaskId}
// Tasks now store only lightweight metadata: descriptionPreview, descriptionUpdatedAt, descriptionUpdatedBy
// Descriptions load on-demand only when a modal opens (cache-first, Firebase fallback)
// Silent migration: legacy task.description migrated on first modal open per task
// Rollback: call _descRollbackTask('taskId') from console to restore embedded description
// No UI/UX changes. No RBAC changes. No other functionality changes.
// ─────────────────────────────────────────────────────────────────
// ── SprintFlow v28 — COMMENTS DECOUPLING (Phase 1) ──────────────
// Comments moved out of task payloads into sprintflow/taskComments/{taskId}/{commentId}
// Tasks now store only lightweight metadata: commentCount, lastCommentAt, lastCommentBy
// Comments load on-demand only when a modal opens (cache-first, Firebase fallback)
// Silent migration: legacy task.comments[] migrated on first modal open per task
// Rollback: call _cmRollbackTask('taskId') from console to restore embedded comments
// No UI/UX changes. No RBAC changes. No other functionality changes.
// ─────────────────────────────────────────────────────────────────
// ── SprintFlow v27 — PERFORMANCE & SCALABILITY PASS ──────────────
// Optimizations applied (no UI/logic/Firebase/RBAC changes):
//  1. Chart fingerprinting — charts only re-render when data actually changes
//  2. renderDashboard / renderReports: selective chart destroy+recreate only
//  3. Kanban: DocumentFragment for card assembly — single DOM injection
//  4. Kanban drag handlers: passive:true where safe, event delegation
//  5. Global search: debounce tightened, querySelector results cached in closure
//  6. Report filter dropdowns: wrapped in requestAnimationFrame to avoid layout thrash
//  7. RealtimeSync: DEBOUNCE_MS raised to 180ms; _renderForCollection skips no-op renders
//  8. renderDashboard: batched textContent updates via local variable cache
//  9. DOM cache (_domCache) TTL-aware — cleared on navigation, not on every refresh
// 10. kanbanCard / kanbanSubtaskCard: avoid redundant map calls via pre-computed values
// ── RealtimeSync Listener Optimizations (v27.1) ──────────────────
// 15. Snapshot fingerprinting — identical Firebase payloads skipped before diff
// 16. RBAC-scoped client-side filter — PM/Member snapshots filtered to visible projects
//     before patching state; prevents spurious renders from other projects' updates
// 17. RealtimeSync.restart() — re-evaluates RBAC scope on project/role switch
// 18. stop() clears debounce timers — no stale callbacks fire after logout
// 19. Centralized _snapshotFingerprints cleared on stop() — clean slate per session
// 11. Backlog taskRow: cache getProject/getUser per row, avoid duplicate lookups
// 12. WeakMap-based listener registry — no duplicate Firebase onValue subscriptions
// 13. renderKanban: requestAnimationFrame-wrapped scroll restore
// 14. _chartFingerprint helper — skip chart recreation when inputs unchanged
// 15. Report filter selects: debounced via _rptFilterDebounce (150ms)
// ─────────────────────────────────────────────────────────────────
// ── SprintFlow v26 — STABILIZATION PASS ──────────────────────────
// Fixes applied (no logic/UI/Firebase changes):
//  1. Consolidated duplicate ESC keydown handlers into single unified handler
//  2. Export menu close listener — stable delegated pattern, no accumulating bindings
//  3. Chart canvas null-guards (_getCtx helper) — prevents crashes on tab switch
//  4. closeModal() always resets body scroll lock even if overlay is missing
//  5. navigate() cleans up drag state, dropdowns, filter panels before page switch
//  6. renderPage() has reentrancy guard (_renderPageInProgress flag)
//  7. refreshAll() debounced (60ms) to absorb rapid realtime update storms
//  8. kanbanDragEnd / kanbanSubDragEnd sweep orphaned drag classes globally
//  9. Mobile: body overflow-x:hidden, touch-action improvements, modal scroll fix
// 10. Standardized .btn:disabled + .btn.loading CSS states
// 11. Dropdown refresh: stale value reset when referenced entity is deleted
// 12. Network toast appended safely with readyState guard
// 13. Search dropdown close is idempotent (only closes if currently open)
// ─────────────────────────────────────────────────────────────────
// ── SprintFlow v19 — Premium Chart.js Global Defaults ──
document.addEventListener('DOMContentLoaded', function() {
  if (typeof Chart !== 'undefined') {
    Chart.defaults.font.family = "'DM Sans', sans-serif";
    Chart.defaults.font.size = 11;
    Chart.defaults.color = '#9399b0';
    Chart.defaults.borderColor = 'rgba(0,0,0,0.04)';
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.pointStyle = 'circle';
    Chart.defaults.plugins.legend.labels.pointStyleWidth = 9;
    Chart.defaults.plugins.tooltip.enabled = true;
    Chart.defaults.animation.duration = 400;
    Chart.defaults.animation.easing = 'easeInOutQuart';
    Chart.defaults.elements.bar.borderRadius = 6;
    Chart.defaults.elements.bar.borderSkipped = false;
    Chart.defaults.elements.line.borderWidth = 2.5;
    Chart.defaults.elements.line.tension = 0.38;
    Chart.defaults.elements.point.radius = 3.5;
    Chart.defaults.elements.point.hoverRadius = 5.5;
    Chart.defaults.elements.point.borderWidth = 0;
    Chart.defaults.elements.arc.borderWidth = 0;
    // Register datalabels plugin — disabled globally; Reports charts opt-in explicitly
    if (typeof ChartDataLabels !== 'undefined') {
      Chart.register(ChartDataLabels);
      Chart.defaults.plugins.datalabels = { display: false };
    }
  }
});
