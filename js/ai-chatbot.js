// ─── AI (Gemini via Apps Script proxy) ──────────────────────────────
// Central client for all AI-assisted features: chatbot, description
// rewriting, and release notes generation. Talks ONLY to the Apps Script
// Web App below — the Gemini API key itself never reaches this code, or
// any other client code, or Firebase. It lives ONLY in that Script's own
// Script Properties (server-side, Google-account-gated), which is the
// actual security boundary. This URL is not a secret in the same sense —
// knowing it alone grants nothing; every request must carry a valid
// SprintFlow session token, which the Script verifies itself (see
// apps-script/Code.gs) before it will call Gemini at all.
const AI_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzZbiO4KCtmGEPw8ihZgDeZP7x9YqzV8BFvd29AoLs-vyoCWaU3nVeH9MHuaGmv6YFT/exec';

// Same role→label mapping used elsewhere (rbac.js, description-editor.js) —
// duplicated here rather than imported since those files don't export it.
const ROLE_LABELS = { admin:'Admin', senior_manager:'Senior Manager', program_manager:'Prog. Manager', team_member:'Team Member', member:'Team Member', viewer:'Viewer' };

// Access is granted PER MEMBER, not by one org-wide switch: Admin always
// has both; a Program Manager or Senior Manager needs the corresponding
// flag (aiChatEnabled / aiWritingEnabled) set on their own user record —
// toggled per-person from that member's Edit Member modal in Teams (see
// teams.js). The two capabilities are independent — a member can have one
// without the other. The Script INDEPENDENTLY re-checks both role and
// these exact flags server-side too (reading sprintflow/users itself), so
// this client-side gate is a UI convenience, not the real enforcement
// boundary — a member the Admin disabled is still rejected even if they
// call the Script directly with their own valid session token.
const AI = (function(){

  // Chatbot access
  function canUseChat(){
    if(RBAC.isAdmin()) return true;
    return (RBAC.isProgramManager()||RBAC.isSeniorManager()) && !!(state.currentUser && state.currentUser.aiChatEnabled);
  }
  // Description-rewrite + release-notes access
  function canUseWriting(){
    if(RBAC.isAdmin()) return true;
    return (RBAC.isProgramManager()||RBAC.isSeniorManager()) && !!(state.currentUser && state.currentUser.aiWritingEnabled);
  }

  // Low-level call to the Apps Script proxy. Callers must do their own
  // canUseChat()/canUseWriting() check first (and pass the matching
  // `feature` string — the Script enforces the same check independently).
  // IMPORTANT: no explicit Content-Type header on the fetch — Apps Script
  // Web Apps don't handle a CORS preflight (OPTIONS) request, and omitting
  // the header keeps this a "simple request" so the browser never sends one.
  // Set as a side effect of every _call(), holding Gemini's own token count
  // for the MOST RECENT call only (not a running total, not a remaining
  // quota — Gemini's API doesn't expose either). Only AI.ask() surfaces this
  // (via its return value) since only the chatbot UI shows a token count;
  // rewriteText()/generateReleaseNotes() ignore it, unchanged.
  let _lastCallUsage = null;
  async function _call(systemInstruction, userContent, feature){
    const authUser = window.auth && window.auth.currentUser;
    if(!authUser) throw new Error('Not signed in.');
    const idToken = await authUser.getIdToken();
    const body = JSON.stringify({ idToken, systemInstruction, userContent, feature });
    // Apps Script Web Apps occasionally flake on a single hit — the redirect hop
    // to script.googleusercontent.com intermittently comes back as a dead/expired
    // page instead of the real response, which the browser surfaces as a network-
    // level "Failed to fetch" (not an HTTP error, so it skips the resp.ok check
    // below entirely). A short pause + a single retry clears this in practice, the
    // same bounded-retry approach Code.gs already uses for Gemini's own 503s.
    let resp;
    try {
      resp = await fetch(AI_SCRIPT_URL, { method: 'POST', body });
    } catch (networkErr) {
      await new Promise(r => setTimeout(r, 900));
      resp = await fetch(AI_SCRIPT_URL, { method: 'POST', body });
    }
    if(!resp.ok) throw new Error('AI service unreachable (HTTP '+resp.status+')');
    const json = await resp.json();
    if(json.error) throw new Error(json.error);
    _lastCallUsage = json.usage || null; // undefined until Code.gs is redeployed with usage forwarding
    return json.text || '';
  }

  // A caught error whose message matches this is the SAME "the browser gave up
  // on the connection" failure the retry above targets — it fires even when the
  // request already finished successfully server-side (Code.gs had already
  // returned, sometimes after logging a real answer to the Q&A sheet) but the
  // response never made it back before something in the network path (proxy,
  // VPN, endpoint security) killed the connection. Both fetch() attempts in
  // _call() throw this exact wording on failure, so it's a reliable signal.
  // Telling the user their question may have gone through is more honest than
  // a bare "Failed to fetch", which reads as "nothing happened."
  function _isNetworkLevelError(e){
    const msg = (e && e.message || '').toLowerCase();
    return msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('load failed');
  }
  function _aiFriendlyErrorText(e){
    if(_isNetworkLevelError(e)){
      return 'Lost connection while waiting for the AI — this happens on slow or complex questions. Your question may have still gone through; wait a moment or try asking again.';
    }
    return e.message || 'Could not reach AI service';
  }

  // Pulls <table>...</table> blocks and standalone <img> tags out of the
  // description HTML and replaces each with a unique placeholder token
  // BEFORE it ever reaches Gemini. Sending large embedded image data (often
  // a full base64 data: URI) or table markup to an LLM and asking it to
  // "preserve it exactly" is unreliable — it can truncate, mangle, or
  // silently drop it, since it's not actually text to improve. Placeholders
  // guarantee the original media comes back byte-for-byte untouched; only
  // the surrounding wording is what the model ever sees or changes.
  // Tables are matched before images since a table can itself contain <img>
  // tags that must move with it as one unit, not be extracted separately.
  function _extractMediaBlocks(html){
    const media = [];
    const placeholder = content => { const token = `[[SFMEDIA_${media.length}]]`; media.push(content); return token; };
    let out = html.replace(/<table[\s\S]*?<\/table>/gi, m => placeholder(m));
    out = out.replace(/<img\b[^>]*>/gi, m => placeholder(m));
    return { placeholderHtml: out, media };
  }
  function _restoreMediaBlocks(html, media){
    return html.replace(/\[\[SFMEDIA_(\d+)\]\]/g, (m, idx) => {
      const i = parseInt(idx, 10);
      return (i>=0 && i<media.length) ? media[i] : m;
    });
  }

  // ── Description "Improve wording" (task/subtask create+edit modals) ──
  async function rewriteText(editorId, btnId){
    if(!canUseWriting()){ showNotif('⚠ AI writing assistance is not enabled for your account','error'); return; }
    const btn = btnId ? document.getElementById(btnId) : null;
    const html = _getDescValue(editorId);
    if(!html || !html.replace(/<[^>]+>/g,'').trim()){
      showNotif('⚠ Nothing to improve — description is empty','error');
      return;
    }
    if(btn){ btn.disabled = true; if(!btn.dataset.origText) btn.dataset.origText = btn.innerHTML; btn.textContent = 'Improving…'; }
    try{
      const { placeholderHtml, media } = _extractMediaBlocks(html);
      const result = await _call(
        'You are a writing assistant embedded in a software project-management tool. Fix grammar and spelling and improve clarity of the following task description text. Preserve the original meaning and length, and preserve any HTML formatting tags exactly as given (bold, italic, lists, etc). The text may be in any language — detect it and write the corrected version in THAT SAME language; never translate it into a different one.\n\n' +
        (media.length ? 'The text contains placeholder tokens like [[SFMEDIA_0]], [[SFMEDIA_1]], etc, standing in for images/tables that were removed before reaching you. Copy each token EXACTLY as it appears, in the exact same position — do not describe, remove, translate, or alter them in any way.\n\n' : '') +
        'Return ONLY the corrected HTML, no explanation, no markdown code fences.',
        placeholderHtml, 'writing'
      );
      if(!result || !result.trim()){ showNotif('⚠ AI returned an empty result','error'); return; }
      // Safety net: if the model dropped a placeholder anyway (ignoring the
      // instruction above), restoring would silently lose that image/table —
      // refuse the rewrite entirely rather than risk that, since the whole
      // point of this feature is that media must never be touched.
      if(media.length && media.some((_, i) => !result.includes(`[[SFMEDIA_${i}]]`))){
        showNotif('⚠ AI response did not preserve an embedded image/table — no changes made to be safe','error');
        return;
      }
      _setDescValue(editorId, _restoreMediaBlocks(result.trim(), media));
    }catch(e){
      console.warn('[AI] rewriteText error:', e);
      showNotif('⚠ '+_aiFriendlyErrorText(e),'error');
    }finally{
      if(btn){ btn.disabled = false; btn.innerHTML = btn.dataset.origText || '✨ Improve wording'; }
    }
  }

  // ── Release notes generation (Release edit modal) ──
  async function generateReleaseNotes(releaseId, textareaId, btnId){
    if(!canUseWriting()){ showNotif('⚠ AI writing assistance is not enabled for your account','error'); return; }
    const release = (state.releases||[]).find(r=>r.id===releaseId);
    if(!release){ showNotif('⚠ Release not found','error'); return; }
    const taskIds = release.taskIds || [];
    if(!taskIds.length){ showNotif('⚠ No tasks mapped to this release yet','error'); return; }

    // Flatten every mapped task AND its subtasks into one list (previously
    // only parent tasks were read, and only title/type/points/status — no
    // description). `descriptionPreview` is the same lightweight ~120-char
    // plaintext summary already sitting in `state` (used by export flows for
    // this exact purpose) — using it means richer, more accurate notes with
    // ZERO additional Firebase reads, rather than fetching each item's full
    // description from the separate taskDescriptions collection.
    // Subtasks inherit their parent's epic when they have none of their own
    // (same fallback rule Epic Reports uses: st.epicId||t.epicId).
    const items = [];
    taskIds.forEach(tid=>{
      const t = getTask(tid);
      if(!t) return;
      items.push({ title:t.title, type:t.type||'task', epicId:t.epicId||null, desc:t.descriptionPreview||'' });
      (t.subtasks||[]).forEach(st=>{
        items.push({ title:st.title, type:st.type||'task', epicId: st.epicId||t.epicId||null, desc: st.descriptionPreview||'' });
      });
    });

    // Bugs get pulled into their own section regardless of epic; everything
    // else is grouped by epic, or falls into General Delivery if unmapped.
    const bugs = items.filter(i=>i.type==='bug');
    const nonBugs = items.filter(i=>i.type!=='bug');
    const byEpic = new Map();
    const general = [];
    nonBugs.forEach(i=>{
      if(i.epicId){
        const epic = getEpic(i.epicId);
        const key = epic ? epic.title : '(Unnamed Epic)';
        if(!byEpic.has(key)) byEpic.set(key, []);
        byEpic.get(key).push(i);
      } else general.push(i);
    });
    const fmt = i => `- [${i.type}] ${i.title}${i.desc?': '+i.desc:''}`;
    let summary = '';
    if(byEpic.size){
      summary += '\nEPIC-WISE DELIVERY:\n';
      byEpic.forEach((its,epicName)=>{ summary += `\n${epicName}:\n` + its.map(fmt).join('\n') + '\n'; });
    }
    if(general.length) summary += '\nGENERAL DELIVERY (no epic):\n' + general.map(fmt).join('\n') + '\n';
    if(bugs.length) summary += '\nBUG FIXES:\n' + bugs.map(fmt).join('\n') + '\n';

    const btn = btnId ? document.getElementById(btnId) : null;
    if(btn){ btn.disabled = true; if(!btn.dataset.origText) btn.dataset.origText = btn.innerHTML; btn.textContent = 'Generating…'; }
    try{
      const result = await _call(
        'You are a release-notes writer for a software project-management tool. Given delivered tasks/subtasks (with type and a short description of what each was) organized into Epic-wise Delivery, General Delivery, and Bug Fixes, write CONCISE, precise release notes for end users and stakeholders.\n\n' +
        'FORMAT (strict): three plain-text sections in this exact order — "Epic-wise Delivery", "General Delivery", "Bug Fixes" — each as a section label on its own line, blank line, then short "-" bullets (one line each, no sub-bullets, no nested lists). Under Epic-wise Delivery, put each epic name on its own line (no special marker) followed by its bullets, then a blank line before the next epic. Omit a section entirely if it has no items — do not write "None" or empty headers.\n\n' +
        'STYLE: One short, precise bullet per item — summarize WHAT changed using the description given, don\'t just restate the title verbatim. Plain business language: no story points, no internal statuses/jargon. Do not invent features not listed, do not add commentary before or after the notes. Prefer fewer words over more.\n\n' +
        'LANGUAGE: The task titles/descriptions below may be in any language, or a mix. Detect the dominant one and write the entire release notes in that same language.',
        summary, 'writing'
      );
      const ta = textareaId ? document.getElementById(textareaId) : null;
      if(ta && result && result.trim()){
        ta.value = result.trim();
        ta.dispatchEvent(new Event('input', {bubbles:true}));
      } else if(!result || !result.trim()){
        showNotif('⚠ AI returned an empty result','error');
      }
    }catch(e){
      console.warn('[AI] generateReleaseNotes error:', e);
      showNotif('⚠ '+_aiFriendlyErrorText(e),'error');
    }finally{
      if(btn){ btn.disabled = false; btn.innerHTML = btn.dataset.origText || '✨ Generate Release Notes'; }
    }
  }

  // ── Chatbot Q&A ──
  // Carries a bounded conversation window (last few Q&A turns) so follow-up
  // questions ("what about last month?") can refer back to what was already
  // asked/answered — the actual _aiChatHistory in js/ai-chatbot.js is NOT
  // cleared each turn (only the reset button clears it); this just caps how
  // much of it gets sent to Gemini each time, to bound the request payload.
  const HISTORY_TURNS = 4;
  async function ask(question){
    if(!canUseChat()) throw new Error('AI chatbot is not enabled for your account');
    const summary = _buildProjectsSummary();
    // _aiChatHistory already has the current question pushed as its last
    // entry by the time this runs (see _sendAiChatMessage) — exclude it here
    // since `question` is passed separately.
    const prior = (typeof _aiChatHistory!=='undefined' ? _aiChatHistory.slice(0,-1) : []).slice(-(HISTORY_TURNS*2));
    const historyBlock = prior.length
      ? 'Previous conversation in this session (use it only to resolve follow-up context, e.g. "what about X" referring back to a prior answer):\n' +
        prior.map(m=>(m.role==='user'?'Q: ':'A: ')+m.text).join('\n') + '\n\n'
      : '';
    return _call(
      'You are SprintFlow\'s project assistant, acting like an experienced portfolio manager who can explain project health, trends, risks, and where delivery is lagging. Answer the user\'s question using ONLY the data provided below and the prior conversation for context — never invent numbers or facts not present in the data; if something isn\'t in the data, say so plainly instead of guessing.\n\n' +
      'FORMAT (strict): Be brief — a short lead-in sentence, then 3-6 "- " bullet points covering the key facts/numbers. Only write more than that if the user explicitly asks for a detailed breakdown or step-by-step plan. Use **bold** only for key numbers/names. NEVER use "#", "##" or "###" headers, never use tables, never use code blocks.\n\n' +
      'You are read-only: you cannot create, edit, or delete anything INSIDE SprintFlow itself — no changing tasks, statuses, dates, or any other record. If asked to perform such an action, decline in one sentence and suggest what to check or do instead — do not write a long explanation.\n\n' +
      'This restriction does NOT apply to drafting text. If asked for release notes, a summary, a recap of what shipped, or a report, WRITE IT using the delivered items and data given below (grouped by epic, or by bug vs. feature, whatever fits the question) — that is a normal answer to give, not a SprintFlow action, so do not decline it. Only say data is missing if the specific numbers/items needed genuinely are not in the DATA below.\n\n' +
      'LANGUAGE: The user may ask their question in any language (Hindi, Spanish, etc.), and may switch languages between messages. Always reply in the SAME language as the New question below, regardless of what language the DATA or prior conversation are in — translate facts/numbers into that language rather than declining or mixing languages.\n\n' +
      'SCOPE CONTINUITY: If the New question does not name a specific project but the prior conversation above was just focused on one project, keep answering about that SAME project — do not silently broaden to the whole portfolio. Only switch to a portfolio-wide answer if the user explicitly asks about "all projects", "the portfolio", "everything", or names a different project.\n\n' +
      'PLANNING / BACKLOG QUESTIONS: Each project below has a "Backlog" list (items not yet mapped to a sprint) alongside its Epics and Sprints. For questions like "what\'s planned ahead", "what\'s next", or "what\'s in the backlog", use that Backlog list (and any relevant epics it belongs to) as the actual answer — do not deflect to "check the project board" when the backlog items are right there in the data.\n\n' +
      'DATA:\n' + summary,
      historyBlock + 'New question: ' + question, 'chat'
    ).then(text => ({ text, usage: _lastCallUsage }));
  }

  // Spillover-aware sprint stats — same logic as _rsSprintWorkStats() in
  // render-reports.js (kept independent here since that one is a private
  // closure inside renderReports() and isn't reachable from this module).
  // For a completed sprint, a plain live query of "tasks currently pointing
  // at this sprint" undercounts, because spillover items get MOVED to the
  // next sprint after carry-forward — so completed sprints fall back to the
  // persisted spilloverTasks/spilloverSubtasks/spilloverPoints/committedPoints
  // snapshot instead (same snapshot Sprint Reports/Release Reports reuse).
  function _sprintStats(s, sprintTasks){
    const sprintSubs = sprintTasks.flatMap(t=>t.subtasks||[]);
    const doneCount = sprintTasks.filter(t=>DONE_STATUSES.includes(t.status)).length
                     + sprintSubs.filter(st=>DONE_STATUSES.includes(st.status)).length;
    const donePts = sprintTasks.filter(t=>DONE_STATUSES.includes(t.status)).reduce((a,t)=>a+(t.points||0),0)
                  + sprintSubs.filter(st=>DONE_STATUSES.includes(st.status)).reduce((a,st)=>a+(st.points||0),0);
    const hasSnapshot = s.status==='completed' && (s.spilloverTasks!==undefined || s.spilloverSubtasks!==undefined);
    if(hasSnapshot){
      const spillCount = (s.spilloverTasks||0)+(s.spilloverSubtasks||0);
      const totalCount = doneCount+spillCount;
      const totalPts = (s.committedPoints!=null && s.committedPoints>0) ? s.committedPoints : (donePts+(s.spilloverPoints||0));
      return { totalCount, doneCount, totalPts, donePts };
    }
    const totalCount = sprintTasks.length + sprintSubs.length;
    const totalPts = sprintTasks.reduce((a,t)=>a+(t.points||0),0) + sprintSubs.reduce((a,st)=>a+(st.points||0),0);
    return { totalCount, doneCount, totalPts, donePts };
  }

  // Same delay rule Delay Reports uses (js/render-delay-reports.js
  // _drComputeDelay): a done item is late iff it has BOTH a due date and a
  // completedDate and completedDate > due date; an open item is late iff
  // today is past its due date. Items missing a due date, or done items from
  // before completedDate-tracking existed, return null ("unknown") rather
  // than guessing — same "never guess" policy as that report.
  function _delayFlag(item, todayStr){
    if(!item.dueDate) return null;
    if(DONE_STATUSES.includes(item.status)){
      if(!item.completedDate) return null;
      return item.completedDate > new Date(item.dueDate).getTime();
    }
    return item.dueDate < todayStr;
  }
  function _monthKey(ms){
    const d = new Date(ms);
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
  }

  // Per-project aggregate summary, scoped by the exact same RBAC rule the
  // rest of the app already uses (RBAC.getVisibleProjects(): Program Manager
  // sees only their own projects, Senior Manager/Admin see all). Computed
  // entirely from already-loaded `state` — no additional Firebase reads, so
  // expanding this never increases Firebase download/bandwidth usage; it
  // only changes how much of the already-in-memory data we hand to Gemini.
  function _buildProjectsSummary(){
    const projects = RBAC.getVisibleProjects();
    if(!projects.length) return 'No accessible projects.';
    const today = new Date().toISOString().slice(0,10);
    // Kept deliberately tight — a large portfolio (many projects, thousands of
    // tasks) can otherwise push the prompt to tens of thousands of tokens,
    // which both slows Gemini down and makes the round trip more likely to be
    // killed by a network timeout before the (otherwise successful) response
    // arrives back in the browser. Every cap already has an "…and N more not
    // shown" overflow note, so truncation is visible rather than silent.
    const EPIC_CAP = 12, SPRINT_CAP = 6, ACTIVE_TASK_CAP = 15;
    const now = new Date();
    // Last 3 calendar months (this one first) for the delivery-trend line.
    const monthKeys = [0,1,2].map(back=>{
      const d = new Date(now.getFullYear(), now.getMonth()-back, 1);
      return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
    });
    const monthLabels = ['This month','Last month','2 months ago'];
    const projectBlocks = []; // {name, pct, done, total, deliveredThisMonth, block}

    projects.forEach(p=>{
      const pTasks = (state.tasks||[]).filter(t=>t.project===p.id);
      // Subtasks inherit their parent's epic when they have no epicId of
      // their own — same fallback rule used by Epic Reports (st.epicId||t.epicId).
      const pSubsFlat = pTasks.flatMap(t=>(t.subtasks||[]).map(st=>({ st, t })));
      const items = [
        ...pTasks.map(t=>({ ref:t, _epicId:t.epicId||null })),
        ...pSubsFlat.map(({st,t})=>({ ref:st, _epicId: st.epicId||t.epicId||null }))
      ];
      const total = items.length;
      const done  = items.filter(i=>DONE_STATUSES.includes(i.ref.status)).length;
      const pct   = total ? Math.round((done/total)*100) : 0;
      const openBugs = items.filter(i=>i.ref.type==='bug' && !DONE_STATUSES.includes(i.ref.status)).length;
      const overdue  = items.filter(i=>i.ref.dueDate && i.ref.dueDate < today && !DONE_STATUSES.includes(i.ref.status)).length;

      // ── Delay diagnosis: same rule as Delay Reports (completedDate vs
      //    dueDate for done items, today vs dueDate for open ones). Items
      //    with no due date, or done items that predate completedDate
      //    tracking, are excluded rather than guessed at. ──
      const delayFlags = items.map(i=>_delayFlag(i.ref, today)).filter(f=>f!==null);
      const delayedCount = delayFlags.filter(Boolean).length;
      const delayedPct = delayFlags.length ? Math.round((delayedCount/delayFlags.length)*100) : null;

      // ── Delivery trend: items whose completedDate falls in each of the
      //    last 3 months. completedDate is only stamped going forward from
      //    when that feature shipped, so older completions may be undercounted
      //    — flagged explicitly rather than presented as exact history. ──
      const DELIVERED_TITLES_CAP = 6;
      const deliveredByMonth = {}; monthKeys.forEach(k=>deliveredByMonth[k]=0);
      const deliveredTitlesByMonth = {}; monthKeys.slice(0,2).forEach(k=>deliveredTitlesByMonth[k]=[]);
      let trackedCompleted = 0;
      items.forEach(i=>{
        if(i.ref.completedDate){
          trackedCompleted++;
          const mk = _monthKey(i.ref.completedDate);
          if(mk in deliveredByMonth) deliveredByMonth[mk]++;
          if(mk in deliveredTitlesByMonth) deliveredTitlesByMonth[mk].push(i.ref.title||'(untitled)');
        }
      });
      const monthlyTrendLine = monthKeys.map((k,idx)=>`${monthLabels[idx]}: ${deliveredByMonth[k]}`).join(', ');
      const trendCaveat = (done>0 && trackedCompleted < done*0.6)
        ? ' (Note: completion-date tracking only covers items completed after that feature shipped — older completions before it are likely undercounted here.)'
        : '';
      // Actual titles for "what did we deliver" questions — This month/Last
      // month only (older months would make this too long to be useful).
      const deliveredTitlesLines = monthKeys.slice(0,2).map((k,idx)=>{
        const titles = deliveredTitlesByMonth[k];
        if(!titles.length) return null;
        const shown = titles.slice(0,DELIVERED_TITLES_CAP).map(t=>`"${t}"`).join(', ');
        const overflow = titles.length>DELIVERED_TITLES_CAP ? ` (+${titles.length-DELIVERED_TITLES_CAP} more)` : '';
        return `  ${monthLabels[idx]} delivered: ${shown}${overflow}`;
      }).filter(Boolean).join('\n');

      // ── Epics: per-epic completion, not just names ──
      const allEpics = (state.epics||[]).filter(e=>{
        const ids = e.projectIds || (e.projectId?[e.projectId]:[]);
        return ids.includes(p.id);
      });
      const epicLines = allEpics.slice(0,EPIC_CAP).map(e=>{
        const eItems = items.filter(i=>i._epicId===e.id);
        const eTotal = eItems.length;
        const eDone  = eItems.filter(i=>DONE_STATUSES.includes(i.ref.status)).length;
        const ePct   = eTotal ? Math.round((eDone/eTotal)*100) : 0;
        const overdueTag = (e.dueDate && e.dueDate<today && e.status!=='Completed') ? ', OVERDUE' : '';
        return `  - "${e.title}" [${e.status||'—'}${overdueTag}]${e.dueDate?' due '+e.dueDate:''}: ${eTotal} items, ${ePct}% done (${eDone}/${eTotal})`;
      });
      const epicOverflow = allEpics.length>EPIC_CAP ? `\n  …and ${allEpics.length-EPIC_CAP} more epics not shown` : '';

      // ── Sprints: every sprint for this project, with spillover-aware stats.
      //    The active sprint(s) additionally list individual task titles so
      //    "what's in the current sprint" can actually be answered. ──
      const allSprints = (state.sprints||[]).filter(s=>s.project===p.id);
      const sortedSprints = [...allSprints].sort((a,b)=>(b.start||'').localeCompare(a.start||''));
      const sprintLines = sortedSprints.slice(0,SPRINT_CAP).map(s=>{
        const sprintTasks = pTasks.filter(t=>t.sprint===s.id);
        const stats = _sprintStats(s, sprintTasks);
        const sPct = stats.totalCount ? Math.round((stats.doneCount/stats.totalCount)*100) : 0;
        const dates = s.start ? ` (${s.start} to ${s.end||'?'})` : '';
        let line = `  - "${s.name}" [${s.status}]${dates}: ${stats.totalCount} items, ${sPct}% done, ${stats.donePts}/${stats.totalPts} points`;
        if(s.status==='active' && sprintTasks.length){
          const titles = sprintTasks.slice(0,ACTIVE_TASK_CAP).map(t=>
            `      • [${t.type||'task'}] ${t.title} (${statusLabel?statusLabel(t.status):t.status}${t.points?', '+t.points+'sp':''})`
          );
          const overflowNote = sprintTasks.length>ACTIVE_TASK_CAP ? `\n      …and ${sprintTasks.length-ACTIVE_TASK_CAP} more tasks not shown` : '';
          line += '\n    Tasks in this sprint:\n' + titles.join('\n') + overflowNote;
        }
        return line;
      });
      const sprintOverflow = allSprints.length>SPRINT_CAP ? `\n  …and ${allSprints.length-SPRINT_CAP} more sprints not shown` : '';

      // ── Backlog: items not yet mapped to any sprint (same definition
      //    Backlog Planner uses) and not yet done — the actual "what's
      //    planned but not started" queue that "what should we deliver next /
      //    what's in the backlog" questions need. Without this, the model had
      //    no backlog data at all and could only describe the active sprint —
      //    sorted by priority so the most pressing items surface first when
      //    there's more than the cap. ──
      const BACKLOG_CAP = 15;
      const backlogItems = items.filter(i=>!i.ref.sprint && !DONE_STATUSES.includes(i.ref.status));
      const _priorityRank = { critical:0, high:1, medium:2, low:3 };
      const sortedBacklog = [...backlogItems].sort((a,b)=>(_priorityRank[a.ref.priority]??9)-(_priorityRank[b.ref.priority]??9));
      const backlogLines = sortedBacklog.slice(0,BACKLOG_CAP).map(i=>{
        const _bEpic = i._epicId ? (state.epics||[]).find(e=>e.id===i._epicId) : null;
        return `  - [${i.ref.type||'task'}, ${i.ref.priority}] ${i.ref.title}${_bEpic?' (epic: "'+_bEpic.title+'")':''}${i.ref.points?', '+i.ref.points+'sp':''}`;
      });
      const backlogOverflow = backlogItems.length>BACKLOG_CAP ? `\n  …and ${backlogItems.length-BACKLOG_CAP} more backlog items not shown` : '';

      // ── Team roster: headcount, role, and a relative workload signal.
      // SprintFlow has no explicit capacity/hours field per member, so
      // "overloaded/underutilized" is answered via active (non-done) item
      // count vs. this project's own average — a real, defensible signal,
      // not a fabricated utilization %. memberIds is the maintained
      // Teams-page membership list; falls back to whoever has assigned
      // items if a project has none set. ──
      const activeLoadMap = new Map(), totalLoadMap = new Map();
      items.forEach(i=>{
        const uid = i.ref.assignee;
        if(!uid) return;
        totalLoadMap.set(uid, (totalLoadMap.get(uid)||0)+1);
        if(!DONE_STATUSES.includes(i.ref.status)) activeLoadMap.set(uid, (activeLoadMap.get(uid)||0)+1);
      });
      const memberIds = (p.memberIds && p.memberIds.length) ? p.memberIds : [...totalLoadMap.keys()];
      const MEMBER_CAP = 15;
      const activeCounts = memberIds.map(uid=>activeLoadMap.get(uid)||0);
      const avgActive = activeCounts.length ? activeCounts.reduce((a,b)=>a+b,0)/activeCounts.length : 0;
      const teamLines = memberIds.slice(0,MEMBER_CAP).map(uid=>{
        const u = getUser(uid);
        const roleLabel = u ? (ROLE_LABELS[u.role]||'Team Member') : 'Unknown';
        const active = activeLoadMap.get(uid)||0;
        const totalCnt = totalLoadMap.get(uid)||0;
        const loadTag = avgActive>0 ? (active>avgActive*1.5 ? ' [above-average active load]' : (active<avgActive*0.5 ? ' [below-average active load]' : '')) : '';
        return `  - ${u?u.name:uid} (${roleLabel}): ${active} active item(s), ${totalCnt} total${loadTag}`;
      }).join('\n');
      const memberOverflow = memberIds.length>MEMBER_CAP ? `\n  …and ${memberIds.length-MEMBER_CAP} more members not shown` : '';

      projectBlocks.push({
        name: p.name, pct, done, total, deliveredThisMonth: deliveredByMonth[monthKeys[0]],
        delayedPct, openBugs,
        block:
          `Project "${p.name}": ${total} tasks/subtasks total, ${pct}% complete (${done}/${total} done). ` +
          `Open bugs: ${openBugs}. Currently overdue (still open, past due date): ${overdue}. ` +
          `Delivered by month (${monthLabels.join(' / ')}): ${monthlyTrendLine}.${trendCaveat}\n` +
          (deliveredTitlesLines ? deliveredTitlesLines+'\n' : '') +
          `Delay rate: ${delayedPct===null?'not enough due-date data to compute':delayedPct+'% of items with a due date were/are delivered late ('+delayedCount+' of '+delayFlags.length+')'}. \n` +
          `Team (${memberIds.length} member${memberIds.length!==1?'s':''}, "active item(s)" = not yet done):\n${teamLines||'  none'}${memberOverflow}\n` +
          `Epics (${allEpics.length}):\n${epicLines.join('\n')||'  none'}${epicOverflow}\n` +
          `Sprints (${allSprints.length}):\n${sprintLines.join('\n')||'  none'}${sprintOverflow}\n` +
          `Backlog — not yet mapped to a sprint (${backlogItems.length} item${backlogItems.length!==1?'s':''}, showing top ${Math.min(BACKLOG_CAP,backlogItems.length)} by priority):\n${backlogLines.join('\n')||'  none'}${backlogOverflow}`
      });
    });

    // ── Portfolio overview: an explicit ranking so "which project is
    //    underperforming / has more deliveries" doesn't rely on Gemini doing
    //    the arithmetic itself across many project blocks below. ──
    const byCompletion = [...projectBlocks].sort((a,b)=>b.pct-a.pct);
    const byDelivered = [...projectBlocks].sort((a,b)=>b.deliveredThisMonth-a.deliveredThisMonth);
    const overview =
      `PORTFOLIO OVERVIEW (${projectBlocks.length} project(s), ranked by % complete):\n` +
      byCompletion.map((pb,idx)=>`  ${idx+1}. "${pb.name}": ${pb.pct}% complete, ${pb.done}/${pb.total} items done, ${pb.openBugs} open bugs, ${pb.delayedPct===null?'delay rate n/a':pb.delayedPct+'% delayed'}`).join('\n') +
      `\nRanked by items delivered this month:\n` +
      byDelivered.map((pb,idx)=>`  ${idx+1}. "${pb.name}": ${pb.deliveredThisMonth} delivered this month`).join('\n');

    return overview + '\n\n' + projectBlocks.map(pb=>pb.block).join('\n\n');
  }

  return { canUseChat, canUseWriting, rewriteText, generateReleaseNotes, ask, friendlyError: _aiFriendlyErrorText };
})();

// ── UI visibility toggling ────────────────────────────────────────
// Called on boot, on every modal open (see modal-shared.js), and whenever
// the current user's own record changes (see the 'users' case in sync.js).
// Hides/shows every element marked with the "ai-writing-only" class
// (description-rewrite buttons, release-notes button) per
// AI.canUseWriting(), and the floating chatbot widget per AI.canUseChat() —
// the two are independent per member.
function _updateAiFeatureVisibility(){
  const showWriting = AI.canUseWriting();
  document.querySelectorAll('.ai-writing-only').forEach(el=> el.style.display = showWriting ? '' : 'none');
  _renderAiChatWidget();
}

// ── Floating chatbot widget ────────────────────────────────────────
let _aiChatOpen = false;
let _aiChatHistory = []; // [{role:'user'|'ai', text}]
let _aiChatThinking = false; // true while a request is in flight

// Minimal, safe Markdown → HTML for AI answers: escapes first, then renders
// **bold**, *italic*, "- "/"* " and "1. " lists, and blank-line spacing. The
// systemInstruction in AI.ask() asks Gemini to stick to this exact subset
// (no headers/tables/code fences) so what it returns actually round-trips.
function _mdToHtml(text){
  if(!text) return '';
  const inline = s => s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(?:^|(?<=[^*]))\*(?!\*)([^*\n]+?)\*(?!\*)/g, '<em>$1</em>');
  const lines = _escHtml(text).split('\n');
  let html = '', listBuf = [], listType = null;
  const flushList = () => {
    if(!listBuf.length) return;
    // Tailwind's CDN preflight resets ALL <ul>/<ol> to list-style:none
    // globally, and an inline style only overrides properties it actually
    // sets — so list-style-type must be set explicitly here or the bullets
    // silently disappear (this bit us once already).
    const styleType = listType==='ul' ? 'disc' : 'decimal';
    html += `<${listType} style="margin:6px 0 10px;padding-left:20px;list-style-type:${styleType}">` +
      listBuf.map(li=>`<li style="margin:5px 0">${inline(li)}</li>`).join('') + `</${listType}>`;
    listBuf = []; listType = null;
  };
  lines.forEach(line=>{
    const t = line.trim();
    const bullet = /^[*\-]\s+(.*)$/.exec(t);
    const numbered = /^\d+\.\s+(.*)$/.exec(t);
    // Defensive: render stray "#"/"##"/"###" headers as a bold lead-in
    // instead of leaking the literal hashes — Gemini is asked not to use
    // headers, but doesn't always comply, so this handles it either way.
    const heading = /^#{1,6}\s+(.*)$/.exec(t);
    if(bullet){
      if(listType && listType!=='ul') flushList();
      listType = 'ul'; listBuf.push(bullet[1]);
    } else if(numbered){
      if(listType && listType!=='ol') flushList();
      listType = 'ol'; listBuf.push(numbered[1]);
    } else {
      flushList();
      if(heading){
        html += `<div style="margin:8px 0 2px;font-weight:700">${inline(heading[1])}</div>`;
      } else {
        html += t==='' ? '<div style="height:6px"></div>' : `<div style="margin:2px 0">${inline(t)}</div>`;
      }
    }
  });
  flushList();
  return html;
}

// Always-visible, always-accurate progress strip at the top of the chat
// panel — computed directly from `state` (not Gemini), so "show me a
// progress chart" is answered with real numbers rather than an LLM
// approximating a chart in text. Recomputed on every panel render.
function _aiPortfolioSnapshotHtml(){
  const projects = RBAC.getVisibleProjects();
  if(!projects.length) return '';
  const rows = projects.map(p=>{
    const pTasks = (state.tasks||[]).filter(t=>t.project===p.id);
    const pSubs = pTasks.flatMap(t=>t.subtasks||[]);
    const total = pTasks.length + pSubs.length;
    const done = pTasks.filter(t=>DONE_STATUSES.includes(t.status)).length
               + pSubs.filter(st=>DONE_STATUSES.includes(st.status)).length;
    const pct = total ? Math.round((done/total)*100) : 0;
    const barColor = pct>=70 ? '#16a34a' : pct>=40 ? '#d97706' : '#dc2626';
    return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:5px">
      <div style="width:64px;font-size:10.5px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-shrink:0" title="${_escHtml(p.name)}">${_escHtml(p.name)}</div>
      <div style="flex:1;height:6px;background:var(--control-bg);border-radius:3px;overflow:hidden"><div style="width:${pct}%;height:100%;background:${barColor}"></div></div>
      <div style="width:32px;text-align:right;font-size:10.5px;color:var(--text-tertiary);flex-shrink:0">${pct}%</div>
    </div>`;
  }).join('');
  return `<div style="padding:10px 14px 8px;border-bottom:1px solid var(--card-border);max-height:118px;overflow-y:auto;flex-shrink:0">
    <div style="font-size:10px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;color:var(--text-tertiary);margin-bottom:6px">Portfolio Snapshot</div>
    ${rows}
  </div>`;
}

function _resetAiChat(){
  _aiChatHistory = [];
  _renderAiChatWidget();
  setTimeout(()=>{ const inp=document.getElementById('ai-chat-input'); if(inp) inp.focus(); },50);
}

// Hidden by default — shown only when the user opts in via the header
// toggle, so opening the chatbot doesn't dump a stacked percentage list
// (which reads as noise, especially once copy-pasted as plain text).
let _aiSnapshotVisible = false;
function _toggleAiSnapshot(){
  _aiSnapshotVisible = !_aiSnapshotVisible;
  _renderAiChatWidget();
}

// One-time <style> injection for the "Thinking…" animation — done once
// into <head> rather than re-embedded in every innerHTML render.
function _ensureAiChatStyles(){
  if(document.getElementById('ai-chat-styles')) return;
  const style = document.createElement('style');
  style.id = 'ai-chat-styles';
  style.textContent = `
    @keyframes aiTypingDot { 0%,60%,100%{ opacity:.35; transform:scale(0.75); } 30%{ opacity:1; transform:scale(1); } }
    .ai-typing-dot { display:inline-block; width:6px; height:6px; border-radius:50%; background:var(--text-tertiary); margin-right:4px; animation:aiTypingDot 1.4s infinite ease-in-out; }
    .ai-typing-dot:nth-child(2){ animation-delay:.2s; }
    .ai-typing-dot:nth-child(3){ animation-delay:.4s; margin-right:0; }
  `;
  document.head.appendChild(style);
}

// Keeps the message list pinned to the newest message instead of visually
// "jumping" while a question is in flight — called right after the user's
// own message is pushed (so it stays visible during "Thinking…"), and again
// once the answer lands.
function _scrollAiChatToBottom(){
  const msgs = document.getElementById('ai-chat-messages');
  if(msgs) msgs.scrollTop = msgs.scrollHeight;
}

function _renderAiChatWidget(){
  _ensureAiChatStyles();
  let root = document.getElementById('ai-chat-root');
  const show = AI.canUseChat();
  if(!show){
    if(root) root.style.display = 'none';
    return;
  }
  if(!root){
    root = document.createElement('div');
    root.id = 'ai-chat-root';
    document.body.appendChild(root);
  }
  root.style.display = '';
  root.innerHTML = _aiChatOpen ? _aiChatPanelHtml() : _aiChatBubbleHtml();
  if(_aiChatOpen) _scrollAiChatToBottom();
}

function _aiChatBubbleHtml(){
  return `<button onclick="_toggleAiChat()" title="Ask SprintFlow AI" style="position:fixed;bottom:22px;right:22px;width:40px;height:40px;border-radius:10px;background:linear-gradient(145deg,#6b6fd8,#4648b0);border:none;box-shadow:0 4px 14px rgba(91,95,199,0.5),inset 0 1px 0 rgba(255,255,255,0.2);cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:9000">
    <svg width="19" height="19" fill="none" viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="white"/></svg>
  </button>`;
}

function _toggleAiChat(){
  _aiChatOpen = !_aiChatOpen;
  _renderAiChatWidget();
  if(_aiChatOpen){
    setTimeout(()=>{ const inp=document.getElementById('ai-chat-input'); if(inp) inp.focus(); },50);
  }
}

function _aiChatPanelHtml(){
  const scopeLabel = (RBAC.isAdmin()||RBAC.isSeniorManager()) ? 'All Projects' : 'Your Projects';
  const typingBubble = _aiChatThinking
    ? `<div style="display:flex;margin-bottom:8px">
        <div style="padding:10px 14px;border-radius:12px;border-bottom-left-radius:3px;background:var(--control-bg);display:flex;align-items:center"><span class="ai-typing-dot"></span><span class="ai-typing-dot"></span><span class="ai-typing-dot"></span></div>
      </div>`
    : '';
  const messages = (_aiChatHistory.map(m=>`
    <div style="display:flex;flex-direction:column;${m.role==='user'?'align-items:flex-end':'align-items:flex-start'};margin-bottom:8px">
      <div style="max-width:86%;padding:8px 12px;border-radius:12px;font-size:13px;line-height:1.45;${m.role==='user'?'background:var(--accent);color:#fff;border-bottom-right-radius:3px;white-space:pre-wrap':'background:var(--control-bg);color:var(--text-primary);border-bottom-left-radius:3px'}">${m.role==='user'?_escHtml(m.text):_mdToHtml(m.text)}</div>
    </div>`).join('') + typingBubble) || `<div style="text-align:center;color:var(--text-tertiary);font-size:12.5px;padding:24px 12px">Ask about project status, completion %, epics, deliveries, or who's working on what.<br><span style="opacity:0.7">Scope: ${scopeLabel}</span></div>`;

  return `<div style="position:fixed;bottom:22px;right:22px;width:340px;max-width:calc(100vw - 32px);height:520px;max-height:calc(100vh - 100px);background:var(--card-bg);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid var(--card-border);border-radius:var(--r-xl);box-shadow:0 12px 40px rgba(0,0,0,0.18);display:flex;flex-direction:column;z-index:9000;overflow:hidden">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--card-border);flex-shrink:0">
      <div style="font-weight:600;font-size:13.5px;color:var(--text-primary);display:flex;align-items:center;gap:6px">
        <span style="background:linear-gradient(145deg,#6b6fd8,#4648b0);width:22px;height:22px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 2px 8px rgba(91,95,199,0.4),inset 0 1px 0 rgba(255,255,255,0.2)"><svg width="12" height="12" fill="none" viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="white"/></svg></span>
        SprintFlow AI
      </div>
      <div style="display:flex;align-items:center;gap:2px">
        <button onclick="_toggleAiSnapshot()" title="${_aiSnapshotVisible?'Hide':'Show'} portfolio snapshot" style="background:${_aiSnapshotVisible?'var(--control-bg)':'none'};border:none;border-radius:6px;cursor:pointer;color:var(--text-muted);padding:5px;display:flex;align-items:center"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg></button>
        <button onclick="_resetAiChat()" title="Start a new conversation" style="background:none;border:none;cursor:pointer;color:var(--text-muted);padding:5px;display:flex;align-items:center"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg></button>
        <button onclick="_toggleAiChat()" title="Close" style="background:none;border:none;cursor:pointer;color:var(--text-muted);padding:5px;display:flex;align-items:center"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
    </div>
    ${_aiSnapshotVisible ? _aiPortfolioSnapshotHtml() : ''}
    <div id="ai-chat-messages" style="flex:1;overflow-y:auto;padding:14px">${messages}</div>
    <div style="display:flex;gap:8px;padding:12px 14px;border-top:1px solid var(--card-border);flex-shrink:0">
      <input id="ai-chat-input" type="text" placeholder="Ask a question…" onkeydown="if(event.key==='Enter')_sendAiChatMessage()" style="flex:1;height:34px;padding:0 10px;border:1px solid var(--control-border);border-radius:var(--r-md);background:var(--control-bg);font-size:13px;font-family:inherit;color:var(--text-primary);outline:none"/>
      <button onclick="_sendAiChatMessage()" class="btn btn-primary" style="padding:0 14px">Ask</button>
    </div>
  </div>`;
}

async function _sendAiChatMessage(){
  const inp = document.getElementById('ai-chat-input');
  if(!inp) return;
  const q = inp.value.trim();
  if(!q) return;
  inp.value = '';
  _aiChatHistory.push({role:'user', text:q});
  _aiChatThinking = true;
  _renderAiChatWidget();
  try{
    const result = await AI.ask(q);
    _aiChatHistory.push({role:'ai', text: (result&&result.text) || '(no answer)', usage: result&&result.usage});
  }catch(e){
    console.warn('[AI] chat error:', e);
    _aiChatHistory.push({role:'ai', text: '⚠ '+AI.friendlyError(e)});
  }
  _aiChatThinking = false;
  _renderAiChatWidget();
  setTimeout(()=>{
    const inp2=document.getElementById('ai-chat-input'); if(inp2) inp2.focus();
    _scrollAiChatToBottom();
  },30);
}
