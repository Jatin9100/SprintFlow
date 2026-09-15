# SprintFlow — Session Knowledge Transfer
Generated to resume work in a new context window. Paste this file's path or contents at the start of the new session.

## 0. TL;DR current state

- **Prod repo** (`C:\Users\jatin.chaudhary\sprintflow-v1`, git remote `gitlab.mediassist.in/pm-tool/sprintflow-v1.git`): working tree is **clean**, HEAD = `bad54f0`. Contains 5 committed fixes (list in §2). Does **NOT** contain the UI/perf/DB robustness pass or any VAPT (F1–F5) fixes — those were made, then the user deliberately ran a git restore/checkout that discarded all of that from the prod working tree (confirmed intentional by the user).
- **Staging copy** (`C:\Users\jatin.chaudhary\sprintflow-stg`, plain file copy, **no `.git`**): has EVERYTHING — the 5 prod commits' content, PLUS the full UI/perf/DB robustness pass, PLUS all VAPT F1–F5 fixes, PLUS ~50 additional XSS-escaping fixes found via live testing. This is the only place all of today's work currently exists.
- Staging points at a **different Firebase project** (`sprintflow-a069d`) than prod (`sprintflow-9b1be`) — see §1.
- **Nothing has been committed to prod from this session's work yet.** The user has not yet said "commit to prod" — that instruction is still pending. Do not write to `sprintflow-v1` until explicitly told to.
- Firebase Realtime Database **security rules for the STAGING project were updated and live-verified** (see §5). Prod's Firebase project rules are untouched.

## 1. Environment details

| | Prod | Staging |
|---|---|---|
| Directory | `C:\Users\jatin.chaudhary\sprintflow-v1` | `C:\Users\jatin.chaudhary\sprintflow-stg` |
| Git | yes, clean, HEAD `bad54f0` | none (plain copy) |
| Firebase project | `sprintflow-9b1be` | `sprintflow-a069d` |
| `<title>` | `SprintFlow v29 — Sprint Planning` | `[STAGING] SprintFlow v29 — Sprint Planning` |
| How to serve locally | none set up in this session | `python -m http.server 8090` from the stg directory (or use a `.claude/launch.json` config with the Browser tool's `preview_start`) |

Staging Firebase config (in `sprintflow-stg/index.html`):
```
apiKey: "AIzaSyCb4IhpJwllh3ceDhed8ECGD6EB28y_iOc"
authDomain: "sprintflow-a069d.firebaseapp.com"
databaseURL: "https://sprintflow-a069d-default-rtdb.firebaseio.com"
projectId: "sprintflow-a069d"
```

Staging test accounts used this session:
- Admin: `jatin.chaudhary@mediassist.in` (the user's own account)
- Non-admin (team_member): `deepa.tirlotkar@mediassist.in`

**Important process note**: I (Claude) never type passwords into any login form myself — that's a hard rule, not situational. The user logs in themselves via the embedded Browser pane; I only drive the already-authenticated session afterward. Expect to repeat this handshake in the new session if browser-based testing continues.

**Browser cache gotcha hit repeatedly this session**: the Browser-pane tab caches JS files aggressively across `navigate()` calls, even after files change on disk. When verifying a fix, use `fetch('/js/x.js',{cache:'no-store'}).then(r=>r.text())` + `eval(src)` to force-load the fresh version before testing, or open a brand-new tab.

## 2. What's already committed to PROD (5 commits, HEAD `bad54f0`)

1. `52cda01` — Fix Sprint Planning epic filter, Backlog Planner crash, and bulk-select state leak
2. `96ed93b` — Fix global search crashing silently on malformed records
3. `e616a6d` — Redesign dashboard Epic Volume chart for readability
4. `45739da` — Loosen completed-sprint lock to Released tasks only, fix subtask search gap
5. `bad54f0` — Show Released tasks with no sprint in Backlog Planner

## 3. What's in STAGING but NOT yet in prod

### 3a. UI / performance / DB-connectivity robustness pass
- Crash guards (unguarded `.toLowerCase()/.slice()` on possibly-missing fields) fixed in: `render-kanban.js`, `render-reports.js` (6 spots), `ms-dropdown-widget.js`, `tasks-subtasks.js` (2 spots), `render-epic-reports.js`, `render-retrospectives.js`
- Perf: Teams search box debounced (`_debouncedRenderTeams` added to `main.js`, wired in `index.html`); `teams.js` and `render-productivity-report.js` no longer re-scan the full task list per member (grouped once via Map); `render-reports.js` epic charts grouped once instead of re-filtering 5×/epic
- DB connectivity: added a "Connecting to SprintFlow…" banner (`#boot-connecting-banner` in `index.html` + CSS in `styles.css`) shown during initial Firebase load, escalating to a "taking longer than usual" + Retry message after 12s
- Deliberately NOT done: extending the Kanban-only "sync failed" indicator to other entity types; touching the Reports/Delay/Epic-Reports chart destroy-on-every-render pattern (confirmed intentional — a prior caching attempt there caused blank charts)

### 3b. VAPT findings — see full report structure in the security-review artifact published earlier this session (title: "SprintFlow Security Review"). Status of all 7:

| # | Finding | Status |
|---|---|---|
| F1 | Client-only RBAC / self-promotion to Admin | ✅ Fixed + live-verified in staging (see §5) |
| F2 | Stored XSS in task/subtask descriptions & comments | ✅ Fixed + live-verified |
| F3 | Unescaped titles/tags/names rendered via innerHTML | ✅ Fixed + live-verified (~50 sinks across 16 files — see §4) |
| F4 | No Subresource Integrity on CDN scripts | ✅ Fixed (6 pinned libs hashed); Tailwind CDN left as documented accepted risk (dynamic script, can't carry SRI without a build step) |
| F5 | Duplicate `_esc()` helper, one version weaker | ✅ Fixed (dead weaker definition removed) |
| F6 | Importer's `esc()` doesn't cover single quotes | ⏳ Not started — user said the standalone Importer (separate file, `C:\Users\jatin.chaudhary\Downloads\index (1).html`) is being handled separately, "at last" |
| F7 | Google Fonts stylesheet has no SRI | ➖ Recommended to accept as-is, not fix (Google's CSS response varies by UA, breaks SRI by design; near-zero risk, CSS-only) |

### 3c. F2 fix details (`description-editor.js`, `comments.js`)
- Hardened `_sanitizeDescHTML()`: unsafe tags (svg, iframe, details, form, video, etc.) outside a small formatting allowlist are now dropped entirely instead of passing through unchanged with all attributes intact
- Added `javascript:`/`vbscript:` URI blocking on `<a href>`, including decoding of HTML-entity-obfuscated schemes (`jav&#97;script:`) before the scheme check
- Applied the sanitizer at every render point, not just paste: `_descHydrate`, `_initDescEditor`, `_setDescValue`, comment display (`_cmItemHtml` in `comments.js`) — plus on save in `_getDescValue`
- **Bug found and fixed during this work**: an earlier file-corruption-recovery (see §6) had missed re-adding the sanitize call specifically to `_descHydrate` — found via live payload testing, not code review. Lesson: always verify end-to-end, not just that a helper function itself looks right in isolation.

### 3d. F3 fix details — two source-level fixes with broad blast-radius coverage
- **`showNotif()`** (`utils.js`) — every toast notification's message is now escaped; this alone protects dozens of call sites across the whole app that pass dynamic names/titles into notification text
- **`highlightMatch()` / `hl()`** (`utils.js`, used throughout `search.js`) — previously wrapped the matched substring in `<mark>` without ever escaping the surrounding text; now escapes first, then highlights on the escaped string. This one fix covers task/epic/sprint/release/project/subtask titles in every global search result.
- Individual fixes also applied directly in: `render-kanban.js`, `render-backlog-planner.js`, `render-sprint-planning.js` (sprint name — found via live testing, a `<b>` tag rendered for real in a sprint card), `render-releases.js`, `teams.js`, `tasks-subtasks.js`, `render-epics.js`, `render-dashboard.js`, `render-reports.js`, `bulk-select.js`, `multiselect-widget.js`, `notification-ui.js` (notification title/message), `search.js` (project/task key fields not covered by `hl()`), `projects.js`
- **Deliberately left alone**: `<option>` elements populated via `selectEl.innerHTML = ...` — the browser's "in select" HTML parsing mode structurally ignores foreign start tags there, and inserted `<script>` tags never execute via `innerHTML` assignment regardless of context, so these are low/no-risk. `confirm()` dialog text — native browser dialogs render plain text only, no HTML interpretation.
- **To find the exact list of files/lines changed**: since stg has no git, the most reliable way to get a precise diff now is to `diff -rq` or manually compare `sprintflow-v1` (at commit `bad54f0`) against `sprintflow-stg`, OR grep both trees for the same escaping patterns.

## 4. F1 — the real story (read this before touching Firebase rules again)

Original problem: `js/rbac.js`'s role checks are pure client-side JS reading an in-memory object; the actual Firebase write functions (`saveEntity`/`updateEntity`/`deleteEntity` in `firebase.js`) do no server-side role validation at all. Any authenticated user could open devtools and self-promote to Admin by writing directly to their own `sprintflow/users/{id}/role`.

**Data model constraint discovered**: `sprintflow/users/{id}` is keyed by an app-generated id (`muid()`), NOT the Firebase Auth UID. This rules out the "textbook" custom-claims/uid-keyed-lookup-table approach without a bigger migration or a Cloud Functions backend (neither exists in this project — it's pure client + Realtime Database, no backend). The pragmatic fix used instead: gate the sensitive `role`/`canDeleteTasks` fields using the **verified `auth.token.email`** claim directly in the rules (an email allowlist for admin), which needs no data restructuring.

**Two rule-design bugs found and fixed, both the same root cause — Firebase RTDB write rules cascade downward and can NEVER be revoked by a more restrictive child rule:**

1. First attempt kept the original blanket `.write: "auth != null"` at the rules **root**, which grants write to literally every path including `sprintflow/users/{id}/role` — making the nested `role`-specific restriction completely inert. **Fix**: removed the root-level `.write` entirely; every other collection (tasks/projects/sprints/epics/releases/notifications/etc.) already had its own explicit `.write: "auth != null"` so nothing else broke.

2. Second attempt still failed the live exploit test: the `$userId`-level rule itself granted write to the **whole user record** whenever "you're editing your own record" was true (matched by email) — and that grant ALSO cascaded down into `role`, again overriding the nested restriction. **Fix**: the `$userId` rule itself now requires, for the "editing your own record" branch, that `newData.child('role').val() === data.child('role').val()` and same for `canDeleteTasks` (i.e., self-edits are only allowed if role/canDeleteTasks are provably unchanged in that same write). Only the admin-email branch, or the nested `role`/`canDeleteTasks` rules (which only matter for a targeted admin sub-path write), can actually change those fields.

**Final, live-verified rules are published to the `sprintflow-a069d` Firebase project already** (Realtime Database → Rules). The exact JSON is in `sprintflow-stg\firebase-rules-staging.json`. Also note: Firebase RTDB's rule expression language does **not** support the JS `in` operator — use chained `===`/`||` instead (hit this as a publish-time error on the first attempt).

**Live exploit tests performed (as `deepa.tirlotkar@mediassist.in`, a real team_member account) — all blocked**:
- Targeted write to `.../role` → `'admin'` — `PERMISSION_DENIED`
- Whole-object write sneaking `role:'admin'` into an otherwise-normal-looking self-edit — `PERMISSION_DENIED`
- Fabricating a brand-new fake admin user record under a different key — `PERMISSION_DENIED`

**Live legitimate-use tests — all allowed**:
- Self-edit of own name (role/canDeleteTasks unchanged) — allowed
- Admin (as `jatin.chaudhary@mediassist.in`) changing another user's role via targeted write — allowed
- Admin changing role + canDeleteTasks via whole-object write (matches the real Teams UI's save path) — allowed
- Normal task creation (unrelated collection, `auth != null` unchanged) — allowed

All test data/records created during these tests were cleaned up / reverted to original values afterward — verified no residue left in the staging database.

**If extending to more admin emails later**: each `auth.token.email === '...'` check becomes `(auth.token.email === 'a@x.com' || auth.token.email === 'b@x.com')` — remember, no `in` operator.

## 5. Corruption incident (for awareness, already resolved — don't repeat the mistake)

Mid-session, an `Edit` call containing an em-dash character (`—`) corrupted `js/description-editor.js` into a binary file with ~700 null bytes (git showed it as a binary diff). Recovered by: `git show HEAD:js/description-editor.js` to get the last clean version, restored it, then redid all intended edits in smaller increments **using plain hyphens instead of em-dashes**, checking `git diff --stat` after each edit to catch binary-diff corruption immediately if it recurred. It did not recur once em-dashes were avoided in that file. Worth being cautious of if editing this file again, or seeing unexpected binary diffs on any file — check `git diff --stat` (or for stg, byte-diff against a known-good copy) immediately if suspicious, don't accumulate multiple edits before checking.

## 6. Also fixed this session in prod (before the security work, already committed — see §2 for exact commits)
- Backlog Planner: epic filter not scoping the epic dropdown to selected project's epics correctly; "All Projects" not refreshing the list; blank page for Admin/Senior Manager (root cause: `statusBadgeClass()` throwing on a task with missing `status` field, only surfaced for the full org-wide dataset admins/senior managers see); Released-status tasks with no sprint were being hidden entirely
- Sprint Planning: epic filter wasn't scoped to the Unassigned Tasks queue, only sprint cards; empty sprints not hidden when filtering by epic; epic tag color inconsistency in the unassigned queue
- Global search: silently died on the first malformed record in `state.tasks` due to unguarded `.toLowerCase()` calls (a tags-array entry that wasn't a string was the specific trigger found), which meant subtasks (searched later in the same function) never got a chance to match
- Dashboard Epic Volume chart: "No Epic" bucket was dwarfing every real epic on a shared linear scale; redesigned to exclude it from the bar ranking (shown as a footnote instead), added outside-the-bar total labels matching Sprint Progress's style, fixed `autoSkip` hiding alternating labels, switched long-name wrapping to single-line truncation after multi-line wrapping caused row overlap
- Sprint completion spillover logic was already correct (`SPILLOVER_DONE_STATUSES=['released']`) — no fix needed there, just verified
- Completed-sprint lock (blocking moving tasks out) loosened to only apply to Released-status tasks, in `sprintDrop()` and `removeTaskFromSprint()`

## 7. Outstanding decisions / next steps for the user

1. **Prod commit**: nothing from this session (UI/perf/DB pass, or any VAPT fix) is in prod yet. When ready, the new session should diff `sprintflow-v1` against `sprintflow-stg`, apply the same changes to `sprintflow-v1`, and commit (only when the user explicitly says so).
2. **Prod Firebase rules**: the F1 rules fix has ONLY been applied to the staging Firebase project (`sprintflow-a069d`). Prod's Firebase project (`sprintflow-9b1be`) still has its original permissive rules. This needs a separate, deliberate decision/action from the user before prod's actual database is protected.
3. **F6 (Importer)**: explicitly deferred by the user, to be handled separately later.
4. **F7 (Google Fonts SRI)**: recommended to accept as a permanent non-fix, not pending.
5. Consider whether to extend the admin-email allowlist to other admin accounts before relying on this in prod (currently only `jatin.chaudhary@mediassist.in` is allowlisted).
