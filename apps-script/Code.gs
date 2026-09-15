/**
 * SprintFlow — AI (Gemini) Proxy
 * ────────────────────────────────────────────────────────────────────
 * Deploy this as a Google Apps Script Web App. It is the ONLY thing that
 * holds the Gemini API key — the SprintFlow browser app never sees it,
 * it only calls this Script's Web App URL.
 *
 * Authorization model:
 *   The caller sends their own SprintFlow (Firebase Auth) ID token. This
 *   Script uses THAT token to make an authenticated read of
 *   sprintflow/users from the Realtime Database. Firebase itself
 *   validates the token's signature as part of that read — if the token
 *   is invalid, expired, or forged, the read fails and this Script
 *   rejects the request. So we get token verification for free, with no
 *   separate crypto/JWT-verification code needed here.
 *
 *   Once the read succeeds, the token's own payload (decoded, NOT
 *   re-verified — its authenticity was already proven by the successful
 *   authenticated read above) gives us the caller's email, which is
 *   matched against sprintflow/users to find their role AND their
 *   per-feature flags (aiChatEnabled / aiWritingEnabled). Admin always
 *   passes. A Program Manager or Senior Manager must ALSO have the flag
 *   matching the requested `feature` ('chat' or 'writing') set true on
 *   their own user record — this is enforced HERE, not just by SprintFlow
 *   hiding the button, so a member the Admin disabled can't get access by
 *   calling this Script directly with their own valid session token.
 *   Every other role is rejected outright.
 *
 * Setup:
 *   1. script.google.com → New project → paste this file in as Code.gs
 *   2. Project Settings → Script Properties → add GEMINI_API_KEY
 *   3. Deploy → New deployment → Web app
 *        Execute as: Me
 *        Who has access: Anyone
 *   4. Copy the Web App URL — it's hardcoded as AI_SCRIPT_URL in
 *      sprintflow-stg/js/ai-chatbot.js (not stored in Firebase or shown in
 *      any UI, per the app owner's choice — update that constant directly
 *      if the Script is ever redeployed to a new URL).
 *
 * Q&A audit log: both this deployment and the production one (sprintflow-
 * v1/apps-script/Code.gs) write to the SAME Google Sheet (LOG_SHEET_ID
 * below) — each row is tagged with ENV_LABEL ('stg' or 'prod') so entries
 * from both environments can share one sheet without being confused for
 * each other. The account running this Script needs edit access to that
 * Sheet; the first request after deploying will prompt for Sheets
 * permission if it hasn't been granted yet.
 *
 * IMPORTANT (client-side gotcha): Apps Script Web Apps don't handle a
 * CORS preflight (OPTIONS) request. The browser only skips preflight for
 * a "simple" POST, which means the request must NOT set an explicit
 * Content-Type: application/json header. SprintFlow's client code
 * already sends the JSON body as a plain string with no explicit
 * header (defaults to text/plain), which avoids this — don't change
 * that when wiring up new callers.
 */

// ── Config ──────────────────────────────────────────────────────────
var DB_URL = 'https://sprintflow-a069d-default-rtdb.firebaseio.com'; // STAGING database
var ALLOWED_ROLES = ['program_manager', 'senior_manager', 'admin'];
var GEMINI_MODEL = 'gemini-3.1-flash-lite'; // was gemini-2.0-flash (deprecated), then gemini-3.6-flash
                                             // (hit real 503 "high demand" repeatedly in testing) — a
                                             // lighter/less-congested tier is plenty for short grounded
                                             // Q&A / grammar-fix / release-notes use cases here
var LOG_SHEET_ID = '1OKyixeKsqKvwuJrcU62RJjaypA5ld7skWZuwmSVa_lw'; // shared with prod's deployment
var ENV_LABEL = 'stg';

// ── Entry point ───────────────────────────────────────────────────────
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var idToken = body.idToken;
    var systemInstruction = body.systemInstruction || '';
    var userContent = body.userContent || '';
    var feature = body.feature; // 'chat' | 'writing' — which per-member flag to require

    if (!idToken) return _json({ error: 'Missing idToken' });
    if (!userContent) return _json({ error: 'Missing userContent' });
    if (feature !== 'chat' && feature !== 'writing') return _json({ error: 'Missing or invalid feature' });

    // ── 1. Authenticated read of sprintflow/users using the CALLER's own
    //    ID token. This both verifies the token (Firebase rejects a bad
    //    one) and gives us the full user list to check the role against. ──
    var usersUrl = DB_URL + '/sprintflow/users.json?auth=' + encodeURIComponent(idToken);
    var usersResp = UrlFetchApp.fetch(usersUrl, { muteHttpExceptions: true });
    if (usersResp.getResponseCode() !== 200) {
      return _json({ error: 'Your session has expired — please refresh SprintFlow and try again.' });
    }
    var usersRaw = JSON.parse(usersResp.getContentText() || '{}');

    // ── 2. Identify the caller from the token payload (safe: the token's
    //    authenticity was already proven by step 1 succeeding). ──
    var email = _emailFromIdToken(idToken);
    if (!email) return _json({ error: 'Could not identify caller from session token.' });

    // ── 3. Role + per-feature flag check ──
    var users = Object.keys(usersRaw || {}).map(function (k) { return usersRaw[k]; });
    var me = null;
    for (var i = 0; i < users.length; i++) {
      var u = users[i];
      if (u && u.email && String(u.email).toLowerCase() === email.toLowerCase()) { me = u; break; }
    }
    var role = me && me.role ? String(me.role).toLowerCase() : '';
    if (ALLOWED_ROLES.indexOf(role) === -1) {
      return _json({ error: 'AI features are only available to Program Managers and above.' });
    }
    // Admin always passes. PM/Senior Manager need their own per-feature flag
    // set true — checked here (not just hidden client-side) so a member the
    // Admin has disabled can't get access by calling this Script directly.
    if (role !== 'admin') {
      var flagField = feature === 'chat' ? 'aiChatEnabled' : 'aiWritingEnabled';
      if (!me || me[flagField] !== true) {
        return _json({ error: 'This AI feature is not enabled for your account. Ask an Admin to turn it on from your Team member profile.' });
      }
    }

    // ── 4. Call Gemini ──
    var apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!apiKey) return _json({ error: 'Server misconfigured — GEMINI_API_KEY not set.' });

    var geminiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent?key=' + apiKey;
    var payload = {
      contents: [{ role: 'user', parts: [{ text: userContent }] }]
    };
    if (systemInstruction) {
      payload.systemInstruction = { parts: [{ text: systemInstruction }] };
    }
    var fetchOptions = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    // Bounded retries on 503 (model overloaded) — Gemini's own error message
    // for this literally says "usually temporary, try again later". A single
    // retry wasn't always enough during real demand spikes, so this backs
    // off across up to 3 attempts total (1.2s, then 2.5s pause) — still
    // comfortably inside Apps Script's execution time limit, and bounded
    // rather than looping indefinitely.
    var geminiResp = UrlFetchApp.fetch(geminiUrl, fetchOptions);
    var retryDelaysMs = [1200, 2500];
    for (var attempt = 0; attempt < retryDelaysMs.length && geminiResp.getResponseCode() === 503; attempt++) {
      Utilities.sleep(retryDelaysMs[attempt]);
      geminiResp = UrlFetchApp.fetch(geminiUrl, fetchOptions);
    }
    var geminiJson = JSON.parse(geminiResp.getContentText() || '{}');
    if (geminiResp.getResponseCode() !== 200) {
      var msg = (geminiJson.error && geminiJson.error.message) || ('Gemini HTTP ' + geminiResp.getResponseCode());
      if (feature === 'chat') _logChatToSheet(me.name, email, _extractQuestionForLog(userContent), 'ERROR: ' + msg);
      return _json({ error: 'Gemini error: ' + msg });
    }

    var text = '';
    try {
      text = geminiJson.candidates[0].content.parts[0].text;
    } catch (extractErr) {
      if (feature === 'chat') _logChatToSheet(me.name, email, _extractQuestionForLog(userContent), 'ERROR: unexpected response shape');
      return _json({ error: 'Gemini returned an unexpected response shape.' });
    }

    // Chatbot Q&A log (chat feature only, not description-rewrite/release-
    // notes — see _logChatToSheet). Never blocks or affects the real
    // response: logging happens after `text` is already resolved, and its
    // own errors are swallowed internally.
    if (feature === 'chat') _logChatToSheet(me.name, email, _extractQuestionForLog(userContent), text);

    // Gemini returns actual token counts for this call — forwarded as-is so
    // the client can show a real per-answer token count. There is no
    // separate "quota remaining" endpoint this Script can query (confirmed:
    // the generateContent response carries only usageMetadata for THIS
    // call — promptTokenCount/candidatesTokenCount/totalTokenCount — no
    // remaining/exhausted quota field anywhere), so this is usage for THIS
    // call only, not a remaining balance.
    return _json({ text: text, usage: geminiJson.usageMetadata || null });
  } catch (err) {
    return _json({ error: 'Server error: ' + err.message });
  }
}

// ── Helpers ─────────────────────────────────────────────────────────
// NOTE: Apps Script Web Apps always return HTTP 200 for a completed
// doPost() — there is no way to surface a different HTTP status to the
// caller. Callers must check the JSON body's `error` field, not the
// response's ok/status.
function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ── Chatbot Q&A audit log (Google Sheets) ──────────────────────────
// Shared with the other environment's deployment — same LOG_SHEET_ID, each
// row tagged with ENV_LABEL so 'stg' and 'prod' rows coexist in one sheet.
// Logs ONLY the 'chat' feature (not description-rewrite or release-notes,
// per the app owner's choice — those aren't "questions members asked",
// they're editing existing text). Columns: Env, Member Name, Member Email
// Id, Time, Question, Answer (a failed call's Answer is prefixed "ERROR: "
// rather than using a separate status column). Wrapped so a Sheets failure
// (quota, wrong ID, missing permission) can NEVER break the actual chat
// response — it just silently skips logging that turn.
var _LOG_MAX_CELL_CHARS = 4000; // stay well under Sheets' ~50k/cell limit
var _LOG_HEADERS = ['Env', 'Member Name', 'Member Email Id', 'Time', 'Question', 'Answer'];
function _logChatToSheet(name, email, question, answer) {
  try {
    if (!LOG_SHEET_ID) return; // logging not configured — no-op
    var sheet = SpreadsheetApp.openById(LOG_SHEET_ID).getSheets()[0];
    _ensureLogHeaders(sheet);
    var q = _truncateForLog(question);
    var a = _truncateForLog(answer);
    sheet.appendRow([ENV_LABEL, name || '', email || '', new Date(), q, a]);
  } catch (e) {
    console.error('Chat log write failed: ' + e.message);
  }
}
// Writes the header row (bolded) if row 1 is empty — so a fresh/cleared
// sheet always gets the right column titles automatically, no manual setup.
// Never touches row 1 if it already has anything in it, even if that
// content doesn't match — avoids clobbering a header someone edited by hand.
function _ensureLogHeaders(sheet) {
  var range = sheet.getRange(1, 1, 1, _LOG_HEADERS.length);
  var firstRow = range.getValues()[0];
  var isEmpty = firstRow.join('') === '';
  if (!isEmpty) return;
  range.setValues([_LOG_HEADERS]);
  range.setFontWeight('bold');
}
function _truncateForLog(s) {
  s = (s || '').toString();
  return s.length > _LOG_MAX_CELL_CHARS ? s.substring(0, _LOG_MAX_CELL_CHARS) + '…' : s;
}
// The chatbot's userContent is "<history block>New question: <question>" —
// strip the history/context prefix so the log shows just what the user
// actually typed this turn, not the whole running conversation each time.
function _extractQuestionForLog(userContent) {
  var marker = 'New question: ';
  var idx = userContent.lastIndexOf(marker);
  return idx >= 0 ? userContent.substring(idx + marker.length) : userContent;
}

function _emailFromIdToken(idToken) {
  try {
    var parts = idToken.split('.');
    if (parts.length < 2) return null;
    var payloadJson = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[1])).getDataAsString();
    var payload = JSON.parse(payloadJson);
    return payload.email || null;
  } catch (e) {
    return null;
  }
}
