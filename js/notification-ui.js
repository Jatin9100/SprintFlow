const NotificationUI = (function(){
  const RENDER_LIMIT = 50;
  let _activeTab = 'assigned'; // 'assigned' | 'updated' | 'reminder'
  let _open      = false;

  // ── DOM refs (resolved lazily) ─────────────────────────────────────────────
  function _bell()   { return document.getElementById('notif-bell-btn'); }
  function _badge()  { return document.getElementById('notif-bell-badge'); }
  function _panel()  { return document.getElementById('notif-dropdown'); }
  function _list()   { return document.getElementById('notif-list'); }

  // ── helpers ────────────────────────────────────────────────────────────────
  function _relTime(ts){
    if(!ts) return '';
    const diff = Math.floor((Date.now() - ts) / 1000);
    if(diff < 60)   return 'just now';
    if(diff < 3600) return Math.floor(diff/60) + 'm ago';
    if(diff < 86400)return Math.floor(diff/3600) + 'h ago';
    return Math.floor(diff/86400) + 'd ago';
  }
  function _canMute(){ return typeof RBAC !== 'undefined' && (RBAC.isAdmin() || RBAC.isProgramManager()); }

  // ── unread count — respects user-scoped muted/deleted via getVisibleNotifications ──
  function _unreadCount(){
    if(typeof NotificationSystem === 'undefined') return 0;
    const cu = state && state.currentUser ? state.currentUser.id : null;
    if(!cu) return 0;
    return NotificationSystem.getVisibleNotifications(null,{unreadOnly:true,limit:999}).length;
  }

  // ── update badge ───────────────────────────────────────────────────────────
  function _updateBadge(){
    const b = _badge(); if(!b) return;
    const n = _unreadCount();
    if(n > 0){ b.textContent = n > 99 ? '99+' : String(n); b.style.display = 'flex'; }
    else       { b.style.display = 'none'; }
  }

  // ── render the notification list for active tab ────────────────────────────
  function renderNotifications(){
    console.log('[NotificationUI] renderNotifications called');
    _updateBadge();
    // Show/hide Delete All button based on RBAC
    const delBtn = document.getElementById('notif-delete-all-btn');
    if(delBtn){
      const canDel = typeof RBAC !== 'undefined' && (RBAC.isAdmin() || RBAC.isProgramManager());
      delBtn.style.display = canDel ? 'inline-flex' : 'none';
    }
    if(!_open) return;
    const list = _list(); if(!list) return;

    if(typeof NotificationSystem === 'undefined'){
      list.innerHTML = '<div style="padding:24px 16px;text-align:center;color:var(--text-tertiary);font-size:13px">Notification system not ready.</div>';
      return;
    }

    const all = NotificationSystem.getVisibleNotifications(null,{limit:RENDER_LIMIT,sortDesc:true});
    console.log('[NotificationUI] visible notifications count:', all.length);
    const filtered = all.filter(n => {
      if(_activeTab === 'assigned') return n.category === 'assigned';
      if(_activeTab === 'updated')  return n.category === 'updated';
      if(_activeTab === 'reminder') return n.category === 'reminder';
      return true;
    });

    if(!filtered.length){
      list.innerHTML = `<div style="padding:32px 16px;text-align:center;color:var(--text-tertiary)">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin:0 auto 8px;display:block;opacity:0.35"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
        <div style="font-size:12.5px">No notifications here</div>
      </div>`;
      return;
    }

    const canMute = _canMute();
    const canDelete = typeof RBAC !== 'undefined' && (RBAC.isAdmin() || RBAC.isProgramManager());
    const uid = state && state.currentUser ? state.currentUser.id : null;
    list.innerHTML = filtered.map(n => {
      const us = (n.userState && uid && n.userState[uid]) || {};
      const isRead = !!us.read;
      const taskLabel = n.subtaskId
        ? `<span style="font-size:10.5px;color:var(--text-tertiary);display:block;margin-top:2px">Subtask · Task ${n.taskId ? n.taskId.slice(-6).toUpperCase() : ''}</span>`
        : n.taskId
          ? `<span style="font-size:10.5px;color:var(--text-tertiary);display:block;margin-top:2px">Task ${n.taskId.slice(-6).toUpperCase()}</span>`
          : '';
      const catColor = n.category==='assigned' ? '#5b5fc7'
                     : n.category==='reminder'  ? '#f79009'
                     : '#0ea5e9';
      const muteBtn = canMute && !us.muted
        ? `<button onclick="NotificationUI.muteOne('${n.id}',event)" title="Mute this notification"
             style="flex-shrink:0;background:none;border:none;cursor:pointer;padding:3px 5px;border-radius:5px;
                    color:var(--text-tertiary);font-size:10px;transition:background 0.12s,color 0.12s;line-height:1"
             onmouseenter="this.style.background='rgba(0,0,0,0.05)';this.style.color='var(--text-secondary)'"
             onmouseleave="this.style.background='none';this.style.color='var(--text-tertiary)'">
             <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
           </button>`
        : '';
      return `<div data-notif-id="${n.id}"
        style="display:flex;align-items:flex-start;gap:10px;padding:10px 14px;
               border-bottom:1px solid rgba(0,0,0,0.045);cursor:pointer;
               background:${isRead ? 'transparent' : 'rgba(91,95,199,0.04)'};
               transition:background 0.12s"
        onmouseenter="if(!${isRead})this.style.background='rgba(91,95,199,0.07)';else this.style.background='rgba(0,0,0,0.018)'"
        onmouseleave="this.style.background='${isRead ? 'transparent' : 'rgba(91,95,199,0.04)'}'"
        onclick="NotificationUI.markRead('${n.id}',event)">
        <!-- unread dot -->
        <div style="flex-shrink:0;margin-top:5px;width:7px;height:7px;border-radius:50%;
                    background:${isRead ? 'transparent' : catColor};
                    box-shadow:${isRead ? 'none' : '0 0 0 2px '+catColor+'33'}"></div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12.5px;font-weight:${isRead?'500':'600'};color:var(--text-primary);
                      line-height:1.3;margin-bottom:2px">${_escHtml(n.title)}</div>
          <div style="font-size:12px;color:var(--text-secondary);line-height:1.45;
                      white-space:pre-wrap;word-break:break-word">${_escHtml(n.message)}</div>
          ${taskLabel}
          <div style="font-size:10.5px;color:var(--text-tertiary);margin-top:4px">${_relTime(n.createdAt)}</div>
        </div>
        ${muteBtn}
      </div>`;
    }).join('');
  }

  // ── toggle open/close ──────────────────────────────────────────────────────
  function toggle(e){
    if(e) e.stopPropagation();
    _open = !_open;
    const panel = _panel();
    if(!panel) return;
    if(_open){
      panel.style.display = 'block';
      renderNotifications();
    } else {
      panel.style.display = 'none';
    }
  }

  function close(){
    _open = false;
    const panel = _panel();
    if(panel) panel.style.display = 'none';
  }

  // ── tab switch ─────────────────────────────────────────────────────────────
  function switchTab(tab){
    _activeTab = tab;
    ['assigned','updated','reminder'].forEach(t => {
      const btn = document.getElementById('notif-tab-'+t);
      if(!btn) return;
      if(t === tab){
        btn.style.color      = 'var(--accent)';
        btn.style.borderBottom = '2px solid var(--accent)';
        btn.style.fontWeight = '600';
      } else {
        btn.style.color      = 'var(--text-tertiary)';
        btn.style.borderBottom = '2px solid transparent';
        btn.style.fontWeight = '500';
      }
    });
    renderNotifications();
  }

  // ── mark single read ───────────────────────────────────────────────────────
  function markRead(id, e){
    if(e) e.stopPropagation();
    if(typeof NotificationSystem === 'undefined') return;
    const notif = state.notifications && state.notifications[id];
    const uid = state && state.currentUser ? state.currentUser.id : null;
    const us = (notif && uid && notif.userState && notif.userState[uid]) || {};
    if(notif && !us.read){
      NotificationSystem.markNotificationRead(id).then(()=>{ renderNotifications(); }).catch(()=>{});
    }
  }

  // ── mark all read ──────────────────────────────────────────────────────────
  function markAllRead(e){
    if(e) e.stopPropagation();
    if(typeof NotificationSystem === 'undefined') return;
    const cu = state && state.currentUser ? state.currentUser.id : null;
    NotificationSystem.markAllNotificationsRead(cu).then(()=>{ renderNotifications(); }).catch(()=>{});
  }

  // ── delete all (user-scoped, Admin/PM only) ────────────────────────────────
  function deleteAll(e){
    if(e) e.stopPropagation();
    if(typeof NotificationSystem === 'undefined') return;
    if(typeof RBAC === 'undefined' || (!RBAC.isAdmin() && !RBAC.isProgramManager())) return;
    NotificationSystem.deleteAllNotifications().then(()=>{ renderNotifications(); }).catch(()=>{});
  }

  // ── mute single ────────────────────────────────────────────────────────────
  function muteOne(id, e){
    if(e) e.stopPropagation();
    if(typeof NotificationSystem === 'undefined') return;
    NotificationSystem.muteNotification(id).then(()=>{ renderNotifications(); }).catch(()=>{});
  }

  // ── inject bell HTML into topbar ───────────────────────────────────────────
  function _injectBell(){
    const rightGroup = document.querySelector('#topbar > div[style*="margin-left:auto"]');
    if(!rightGroup || document.getElementById('notif-bell-btn')) return;

    const bellWrap = document.createElement('div');
    bellWrap.id    = 'notif-bell-wrap';
    bellWrap.style.cssText = 'position:relative;display:inline-flex;align-items:center';
    bellWrap.innerHTML = `
      <button id="notif-bell-btn"
        onclick="NotificationUI.toggle(event)"
        title="Notifications"
        style="position:relative;width:34px;height:34px;border-radius:var(--r-md);
               border:1px solid rgba(0,0,0,0.08);background:rgba(255,255,255,0.92);
               cursor:pointer;display:flex;align-items:center;justify-content:center;
               transition:background 0.14s,border-color 0.14s,box-shadow 0.14s;
               box-shadow:0 1px 3px rgba(0,0,0,0.04),inset 0 1px 0 rgba(255,255,255,0.85)"
        onmouseenter="this.style.background='rgba(255,255,255,1)';this.style.borderColor='rgba(91,95,199,0.22)';this.style.boxShadow='0 2px 8px rgba(91,95,199,0.1)'"
        onmouseleave="this.style.background='rgba(255,255,255,0.92)';this.style.borderColor='rgba(0,0,0,0.08)';this.style.boxShadow='0 1px 3px rgba(0,0,0,0.04),inset 0 1px 0 rgba(255,255,255,0.85)'">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 01-3.46 0"/>
        </svg>
        <span id="notif-bell-badge"
          style="display:none;position:absolute;top:-5px;right:-5px;
                 min-width:17px;height:17px;border-radius:9px;
                 background:#ef4444;color:#fff;font-size:9px;font-weight:800;
                 align-items:center;justify-content:center;
                 padding:0 3px;border:2px solid #fff;
                 font-family:'DM Sans',sans-serif;line-height:1">0</span>
      </button>

      <!-- ── Notification dropdown panel ── -->
      <div id="notif-dropdown"
        style="display:none;position:absolute;top:calc(100% + 8px);right:0;
               width:360px;max-width:calc(100vw - 24px);
               background:rgba(255,255,255,0.97);
               border:1px solid rgba(255,255,255,0.82);
               border-radius:14px;
               box-shadow:0 20px 56px rgba(0,0,0,0.13),0 6px 20px rgba(0,0,0,0.07),0 0 0 1px rgba(0,0,0,0.035);
               z-index:9600;overflow:hidden;
               backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);
               animation:notifDropIn 0.2s cubic-bezier(.34,1.2,.64,1)"
        onclick="event.stopPropagation()">

        <!-- Header -->
        <div style="padding:12px 14px 0;border-bottom:1px solid rgba(0,0,0,0.06)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <span style="font-size:13.5px;font-weight:700;color:var(--text-primary);letter-spacing:-.015em">Notifications</span>
            <div style="display:flex;align-items:center;gap:4px">
              <button id="notif-delete-all-btn"
                onclick="NotificationUI.deleteAll(event)"
                style="display:none;font-size:11px;font-weight:600;color:#ef4444;background:none;border:none;
                       cursor:pointer;padding:3px 7px;border-radius:5px;font-family:'DM Sans',sans-serif;
                       transition:background 0.12s"
                onmouseenter="this.style.background='rgba(239,68,68,0.08)'"
                onmouseleave="this.style.background='none'">Clear all</button>
              <button onclick="NotificationUI.markAllRead(event)"
                style="font-size:11px;font-weight:600;color:var(--accent);background:none;border:none;
                       cursor:pointer;padding:3px 7px;border-radius:5px;font-family:'DM Sans',sans-serif;
                       transition:background 0.12s"
                onmouseenter="this.style.background='rgba(91,95,199,0.08)'"
                onmouseleave="this.style.background='none'">Mark all read</button>
            </div>
          </div>
          <!-- Tabs -->
          <div style="display:flex;gap:0">
            <button id="notif-tab-assigned" onclick="NotificationUI.switchTab('assigned')"
              style="flex:1;background:none;border:none;border-bottom:2px solid var(--accent);
                     padding:6px 4px;font-size:11.5px;font-weight:600;color:var(--accent);
                     cursor:pointer;font-family:'DM Sans',sans-serif;transition:color 0.12s;
                     white-space:nowrap">Assigned</button>
            <button id="notif-tab-updated" onclick="NotificationUI.switchTab('updated')"
              style="flex:1;background:none;border:none;border-bottom:2px solid transparent;
                     padding:6px 4px;font-size:11.5px;font-weight:500;color:var(--text-tertiary);
                     cursor:pointer;font-family:'DM Sans',sans-serif;transition:color 0.12s;
                     white-space:nowrap">Updated</button>
            <button id="notif-tab-reminder" onclick="NotificationUI.switchTab('reminder')"
              style="flex:1;background:none;border:none;border-bottom:2px solid transparent;
                     padding:6px 4px;font-size:11.5px;font-weight:500;color:var(--text-tertiary);
                     cursor:pointer;font-family:'DM Sans',sans-serif;transition:color 0.12s;
                     white-space:nowrap">Reminders</button>
          </div>
        </div>

        <!-- Notification list -->
        <div id="notif-list"
          style="max-height:380px;overflow-y:auto;overscroll-behavior:contain">
        </div>
      </div>`;

    rightGroup.insertBefore(bellWrap, rightGroup.firstChild);
  }

  // ── inject animation keyframes once ────────────────────────────────────────
  function _injectStyles(){
    if(document.getElementById('notif-ui-styles')) return;
    const s = document.createElement('style');
    s.id = 'notif-ui-styles';
    s.textContent = `
      @keyframes notifDropIn{from{opacity:0;transform:translateY(-8px) scale(0.97)}to{opacity:1;transform:translateY(0) scale(1)}}
      #notif-list::-webkit-scrollbar{width:4px}
      #notif-list::-webkit-scrollbar-thumb{background:#cdd2e4;border-radius:2px}
      #notif-list::-webkit-scrollbar-track{background:transparent}
    `;
    document.head.appendChild(s);
  }

  // ── global click-outside handler ───────────────────────────────────────────
  function _bindClickOutside(){
    document.addEventListener('click', function(e){
      const wrap = document.getElementById('notif-bell-wrap');
      if(_open && wrap && !wrap.contains(e.target)) close();
    }, { passive: true });
  }

  // ── init — called after app ready ─────────────────────────────────────────
  function init(){
    _injectStyles();
    _injectBell();
    _bindClickOutside();
    _updateBadge();
    console.log('[NotificationUI] initialized');
  }

  return { init, renderNotifications, toggle, close, switchTab, markRead, markAllRead, deleteAll, muteOne };
})();

window.NotificationUI = NotificationUI;

