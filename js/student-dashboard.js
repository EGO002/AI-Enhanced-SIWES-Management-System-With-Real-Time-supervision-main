const db = window.db;
const auth = window.auth;

let currentUser = null;
let currentProfile = null;
let chatUnsubscribe = null;

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function convId(studentUid, supervisorUid) {
  return studentUid + '__' + supervisorUid;
}

function logout() {
  if (!auth || !auth.signOut) { location.href = 'student-login.html'; return; }
  auth.signOut().then(() => location.href = 'student-login.html');
}

document.addEventListener('DOMContentLoaded', () => {
  if (!auth || !auth.onAuthStateChanged) return;

  auth.onAuthStateChanged(user => {
    if (!user) { location.href = 'student-login.html'; return; }
    currentUser = user;

    db.collection('users').doc(user.uid).get().then(snap => {
      currentProfile = snap.exists ? snap.data() : { fullname: user.email, email: user.email, role: 'student' };

      if ((currentProfile.role || 'student') !== 'student') {
        alert('This account isn\u2019t a student account.');
        auth.signOut().then(() => location.href = 'student-login.html');
        return;
      }

      if (currentProfile.profileCompleted === true) {
        renderShell();
      } else {
        renderProfileGate();
      }
      document.getElementById('loading').style.display = 'none';
      document.getElementById('app').style.display = 'flex';
    }).catch(err => console.error('Failed to load profile', err));
  });
});

function renderShell() {
  document.getElementById('avatarInitial').textContent = initials(currentProfile.fullname);
  document.getElementById('topbarName').textContent = currentProfile.fullname || currentUser.email;

  const sidebar = document.getElementById('sidebar');
  sidebar.innerHTML = `
    <div class="sidebar-section">Menu</div>
    <div class="nav-item" data-page="overview">Overview</div>
    <div class="nav-item" data-page="logbook">Logbook</div>
    <div class="nav-item" data-page="chat">Chat</div>
    <div class="nav-item" data-page="assistant">AI Assistant</div>
    <div class="nav-item" data-page="profile">Profile</div>
  `;
  sidebar.querySelectorAll('.nav-item[data-page]').forEach(el => {
    el.addEventListener('click', () => switchPage(el.dataset.page));
  });

  switchPage('overview');
}

// ── First-login placement profile gate ───────────────────────
// Students are created by an admin with no placement info attached (the
// admin doesn't know it). Before a student can reach the normal dashboard,
// they must fill this in once; this also drives the "Flagged by AI" style
// visibility the supervisor needs into where the student is placed.
function renderProfileGate() {
  document.getElementById('avatarInitial').textContent = initials(currentProfile.fullname);
  document.getElementById('topbarName').textContent = currentProfile.fullname || currentUser.email;
  document.getElementById('sidebar').innerHTML = '';

  const main = document.getElementById('mainContent');
  main.innerHTML = `
    <div style="max-width:600px;margin:10px auto;">
      <div class="page-title">Complete your placement profile</div>
      <div class="page-sub">Before you can access your dashboard, tell us where you're doing your SIWES placement so your supervisor can see it. You only need to do this once.</div>
      <div class="card">
        ${placementFormFieldsHtml({})}
        <div id="gateMsg" class="stat-sub" style="margin-bottom:10px;"></div>
        <button class="btn btn-primary" id="gateSubmit">Save and continue</button>
      </div>
    </div>
  `;

  document.getElementById('gateSubmit').addEventListener('click', () => {
    const msg = document.getElementById('gateMsg');
    const data = readPlacementFormFields();
    if (!data) {
      msg.textContent = 'Please fill in every field before continuing.';
      msg.style.color = '#dc2626';
      return;
    }

    const btn = document.getElementById('gateSubmit');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    db.collection('users').doc(currentUser.uid).update({
      placement: data,
      profileCompleted: true
    }).then(() => {
      currentProfile.placement = data;
      currentProfile.profileCompleted = true;
      renderShell();
    }).catch(err => {
      msg.textContent = err.message;
      msg.style.color = '#dc2626';
      btn.disabled = false;
      btn.textContent = 'Save and continue';
    });
  });
}

// Shared form markup for placement details, used by both the first-login
// gate and the editable Profile page. Pass existing values to prefill.
function placementFormFieldsHtml(existing) {
  const p = existing || {};
  return `
    <div class="form-group">
      <label class="form-label">Placement organisation name</label>
      <input type="text" class="form-input" id="pfCompanyName" value="${escapeHtml(p.companyName || '')}" placeholder="e.g. Nigerian Railway Corporation">
    </div>
    <div class="form-group">
      <label class="form-label">Organisation address</label>
      <input type="text" class="form-input" id="pfCompanyAddress" value="${escapeHtml(p.companyAddress || '')}" placeholder="e.g. 14 Murtala Mohammed Way, Lagos">
    </div>
    <div class="two-col">
      <div class="form-group">
        <label class="form-label">Placement start date</label>
        <input type="date" class="form-input" id="pfStartDate" value="${escapeHtml(p.startDate || '')}">
      </div>
      <div class="form-group">
        <label class="form-label">Placement end date</label>
        <input type="date" class="form-input" id="pfEndDate" value="${escapeHtml(p.endDate || '')}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Industry supervisor's name</label>
      <input type="text" class="form-input" id="pfSupName" value="${escapeHtml(p.supervisorName || '')}" placeholder="Your on-site supervisor at the organisation">
    </div>
    <div class="form-group">
      <label class="form-label">Industry supervisor's phone or email</label>
      <input type="text" class="form-input" id="pfSupContact" value="${escapeHtml(p.supervisorContact || '')}" placeholder="e.g. 0803 000 0000 or name@company.com">
    </div>
  `;
}

// Reads the fields rendered by placementFormFieldsHtml(). Returns null if
// any field is empty (all six are required for a complete profile).
function readPlacementFormFields() {
  const companyName      = document.getElementById('pfCompanyName').value.trim();
  const companyAddress   = document.getElementById('pfCompanyAddress').value.trim();
  const startDate        = document.getElementById('pfStartDate').value;
  const endDate           = document.getElementById('pfEndDate').value;
  const supervisorName   = document.getElementById('pfSupName').value.trim();
  const supervisorContact = document.getElementById('pfSupContact').value.trim();

  if (!companyName || !companyAddress || !startDate || !endDate || !supervisorName || !supervisorContact) {
    return null;
  }
  return { companyName, companyAddress, startDate, endDate, supervisorName, supervisorContact };
}

function switchPage(id) {
  if (chatUnsubscribe) { chatUnsubscribe(); chatUnsubscribe = null; }

  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    el.classList.toggle('active', el.dataset.page === id);
  });

  const main = document.getElementById('mainContent');
  main.innerHTML = '<div class="page active" id="pageContent"></div>';
  const target = document.getElementById('pageContent');

  if (id === 'overview') renderOverview(target);
  if (id === 'logbook') renderLogbook(target);
  if (id === 'chat') renderChat(target);
  if (id === 'assistant') renderAssistant(target);
  if (id === 'profile') renderProfile(target);
}

// ── Overview ──────────────────────────────────────────────────
function renderOverview(el) {
  const firstName = (currentProfile.fullname || '').split(' ')[0] || 'there';
  el.innerHTML = `
    <div class="page-title">Welcome back, ${escapeHtml(firstName)}</div>
    <div class="page-sub">Here's a snapshot of your SIWES placement.</div>
    <div class="stat-grid" id="statGrid"><div class="stat-card"><div class="stat-label">Loading…</div></div></div>
    <div class="card">
      <div class="card-title">Your supervisor</div>
      <div id="supervisorBlock"></div>
    </div>
    <div class="card">
      <div class="card-title">Recent logbook entries</div>
      <div id="recentEntries"><div class="stat-sub">Loading…</div></div>
    </div>
  `;

  document.getElementById('supervisorBlock').innerHTML = currentProfile.assignedSupervisorUid
    ? `<div style="font-weight:600;">${escapeHtml(currentProfile.assignedSupervisorName || 'Assigned')}</div>
       <div class="stat-sub">Message them directly from the Chat tab.</div>`
    : `<div class="stat-sub">No supervisor assigned yet. This is normal early in your placement — check back later, or message support through the AI Assistant tab.</div>`;

  db.collection('logbookEntries').where('studentUid', '==', currentUser.uid).get().then(snap => {
    const entries = [];
    snap.forEach(d => entries.push(d.data()));
    entries.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const pending = entries.filter(e => e.status !== 'reviewed').length;
    const flagged = entries.filter(e => e.aiFlag).length;

    document.getElementById('statGrid').innerHTML = `
      <div class="stat-card"><div class="stat-label">Logbook entries</div><div class="stat-value blue">${entries.length}</div></div>
      <div class="stat-card"><div class="stat-label">Pending review</div><div class="stat-value amber">${pending}</div></div>
      <div class="stat-card"><div class="stat-label">Flagged by AI</div><div class="stat-value teal">${flagged}</div></div>
    `;

    const recent = entries.slice(0, 5);
    document.getElementById('recentEntries').innerHTML = recent.length ? recent.map(e => `
      <div class="logbook-entry">
        <div class="entry-dot ${e.aiFlag ? 'flagged' : ''}"></div>
        <div>
          <div class="entry-date">${escapeHtml(e.date || '')} · <span class="badge ${e.status === 'reviewed' ? 'badge-green' : 'badge-amber'}">${e.status === 'reviewed' ? 'Reviewed' : 'Pending'}</span>${e.aiFlag ? ' <span class="badge badge-gray">⚠ Flagged</span>' : ''}</div>
          <div class="entry-text">${escapeHtml(e.activities || '')}</div>
        </div>
      </div>`).join('') : `<div class="stat-sub">No entries yet — head to the Logbook tab to add one.</div>`;
  }).catch(err => console.error(err));
}

// ── Logbook ───────────────────────────────────────────────────
function renderLogbook(el) {
  el.innerHTML = `
    <div class="page-title">Digital logbook</div>
    <div class="page-sub">Log your daily or weekly activities for your supervisor to review.</div>
    <div class="card">
      <div class="card-title">New entry</div>
      <div class="form-group">
        <label class="form-label">Date</label>
        <input type="date" class="form-input" id="lbDate">
      </div>
      <div class="form-group">
        <label class="form-label">What did you work on?</label>
        <textarea class="form-textarea" id="lbText" placeholder="Describe tasks, skills learned, challenges…"></textarea>
      </div>
      <div id="lbMsg" class="stat-sub" style="margin-bottom:10px;"></div>
      <button class="btn btn-primary" id="lbSubmit">Submit entry</button>
    </div>
    <div class="card">
      <div class="card-title">Your entries</div>
      <div id="lbList"><div class="stat-sub">Loading…</div></div>
    </div>
  `;

  document.getElementById('lbDate').value = new Date().toISOString().slice(0, 10);

  document.getElementById('lbSubmit').addEventListener('click', () => {
    const date = document.getElementById('lbDate').value;
    const text = document.getElementById('lbText').value.trim();
    const msg = document.getElementById('lbMsg');

    if (!date || !text) {
      msg.textContent = 'Please fill in both the date and description.';
      msg.style.color = '#dc2626';
      return;
    }

    const btn = document.getElementById('lbSubmit');
    btn.disabled = true;
    btn.textContent = 'Checking…';

    db.collection('logbookEntries').where('studentUid', '==', currentUser.uid).get().then(pastSnap => {
      const past = [];
      pastSnap.forEach(d => past.push(d.data()));

      const flagReason = window.SiwesAI ? window.SiwesAI.checkEntryForFlags(text, past) : null;

      btn.textContent = 'Submitting…';
      return db.collection('logbookEntries').add({
        studentUid: currentUser.uid,
        studentName: currentProfile.fullname || currentUser.email,
        supervisorUid: currentProfile.assignedSupervisorUid || '',
        date,
        activities: text,
        status: 'pending',
        supervisorComment: '',
        aiFlag: flagReason || '',
        submittedAt: firebase.firestore.FieldValue.serverTimestamp()
      }).then(() => flagReason);
    }).then(flagReason => {
      document.getElementById('lbText').value = '';
      if (flagReason) {
        msg.textContent = '⚠ Entry submitted — ' + flagReason;
        msg.style.color = '#d97706';
      } else {
        msg.textContent = 'Entry submitted.';
        msg.style.color = '#0ea5a0';
      }
      btn.disabled = false;
      btn.textContent = 'Submit entry';
      loadMyEntries();
    }).catch(err => {
      msg.textContent = err.message;
      msg.style.color = '#dc2626';
      btn.disabled = false;
      btn.textContent = 'Submit entry';
    });
  });

  loadMyEntries();
}

function loadMyEntries() {
  const list = document.getElementById('lbList');
  if (!list) return;

  db.collection('logbookEntries').where('studentUid', '==', currentUser.uid).get().then(snap => {
    const entries = [];
    snap.forEach(d => entries.push(d.data()));
    entries.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    list.innerHTML = entries.length ? entries.map(e => `
      <div class="logbook-entry">
        <div class="entry-dot ${e.aiFlag ? 'flagged' : ''}"></div>
        <div style="flex:1;">
          <div class="entry-date">${escapeHtml(e.date || '')} · <span class="badge ${e.status === 'reviewed' ? 'badge-green' : 'badge-amber'}">${e.status === 'reviewed' ? 'Reviewed' : 'Pending'}</span>${e.aiFlag ? ' <span class="badge badge-gray">⚠ Flagged</span>' : ''}</div>
          <div class="entry-text">${escapeHtml(e.activities || '')}</div>
          ${e.aiFlag ? `<div class="stat-sub" style="margin-top:4px;color:#d97706;">${escapeHtml(e.aiFlag)}</div>` : ''}
          ${e.supervisorComment ? `<div class="stat-sub" style="margin-top:6px;"><strong>Supervisor:</strong> ${escapeHtml(e.supervisorComment)}</div>` : ''}
        </div>
      </div>`).join('') : `<div class="stat-sub">No entries yet.</div>`;
  }).catch(err => console.error(err));
}

// ── Chat (1:1 with assigned supervisor only) ────────────────
function renderChat(el) {
  if (!currentProfile.assignedSupervisorUid) {
    el.innerHTML = `
      <div class="page-title">Chat</div>
      <div class="page-sub">Message your assigned supervisor directly.</div>
      <div class="card"><div class="stat-sub">You don't have a supervisor assigned yet. Once your school assigns one, you'll be able to message them here.</div></div>
    `;
    return;
  }

  el.innerHTML = `
    <div class="page-title">Chat</div>
    <div class="page-sub">Direct messages with ${escapeHtml(currentProfile.assignedSupervisorName || 'your supervisor')}.</div>
    <div class="chat-wrap">
      <div class="chat-panel">
        <div class="chat-panel-header">${escapeHtml(currentProfile.assignedSupervisorName || 'Your supervisor')}</div>
        <div class="chat-messages" id="chatMessages"><div class="chat-empty-state">Loading…</div></div>
        <form class="chat-send-row" id="chatSendForm">
          <input type="text" id="chatInput" placeholder="Type a message…" autocomplete="off">
          <button type="submit" id="chatSendBtn">Send</button>
        </form>
      </div>
    </div>
  `;

  const cid = convId(currentUser.uid, currentProfile.assignedSupervisorUid);
  const convRef = db.collection('conversations').doc(cid);

  convRef.set({
    studentUid: currentUser.uid,
    studentName: currentProfile.fullname || currentUser.email,
    supervisorUid: currentProfile.assignedSupervisorUid,
    supervisorName: currentProfile.assignedSupervisorName || '',
  }, { merge: true }).catch(err => console.error(err));

  const messagesEl = document.getElementById('chatMessages');
  chatUnsubscribe = convRef.collection('messages').orderBy('timestamp').onSnapshot(snap => {
    const msgs = [];
    snap.forEach(d => msgs.push(d.data()));

    if (!msgs.length) {
      messagesEl.innerHTML = `<div class="chat-empty-state">No messages yet — say hello!</div>`;
      return;
    }

    messagesEl.innerHTML = msgs.map(m => {
      const mine = m.senderUid === currentUser.uid;
      const time = m.timestamp && m.timestamp.toDate ? m.timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      return `
        <div class="msg-row ${mine ? 'mine' : ''}">
          <div>
            <div class="msg-bubble">${escapeHtml(m.text || '')}</div>
            <div class="msg-time">${time}</div>
          </div>
        </div>`;
    }).join('');
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }, err => console.error('Chat listener error', err));

  document.getElementById('chatSendForm').addEventListener('submit', e => {
    e.preventDefault();
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    convRef.collection('messages').add({
      senderUid: currentUser.uid,
      sender: 'student',
      text,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
      convRef.set({ lastMessage: text, lastMessageAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }).catch(err => console.error(err));
  });
}

// ── AI Assistant ──────────────────────────────────────────────
function renderAssistant(el) {
  el.innerHTML = `
    <div class="page-title">AI Assistant</div>
    <div class="page-sub">Quick answers to common questions, plus a note on how entry flagging works. This is a rule-based helper, not a live AI model.</div>
    <div class="card">
      <div id="aiLog" style="display:flex;flex-direction:column;gap:10px;max-height:360px;overflow-y:auto;margin-bottom:16px;"></div>
      <div style="display:flex;gap:10px;">
        <input type="text" class="form-input" id="aiInput" placeholder="e.g. Why was my entry flagged?">
        <button class="btn btn-primary" id="aiAsk">Ask</button>
      </div>
    </div>
  `;

  if (window.initAIAssistant) {
    window.initAIAssistant({
      logEl: document.getElementById('aiLog'),
      inputEl: document.getElementById('aiInput'),
      buttonEl: document.getElementById('aiAsk'),
    });
  }
}

// ── Profile ───────────────────────────────────────────────────
function renderProfile(el) {
  const p = currentProfile;
  const placement = p.placement || {};

  el.innerHTML = `
    <div class="page-title">Profile</div>
    <div class="page-sub">Your account information.</div>
    <div class="card">
      <div class="card-title">Account</div>
      <div class="two-col">
        <div><div class="stat-sub">Full name</div><div>${escapeHtml(p.fullname || '—')}</div></div>
        <div><div class="stat-sub">Email</div><div>${escapeHtml(p.email || currentUser.email)}</div></div>
        <div><div class="stat-sub">Matric number</div><div>${escapeHtml(p.matricNo || '—')}</div></div>
        <div><div class="stat-sub">School</div><div>${escapeHtml(p.schoolName || '—')}</div></div>
        <div><div class="stat-sub">Session</div><div>${escapeHtml(p.session || '—')}</div></div>
        <div><div class="stat-sub">Assigned supervisor</div><div>${escapeHtml(p.assignedSupervisorName || 'Not yet assigned')}</div></div>
      </div>
    </div>
    <div class="card" id="placementCard">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <div class="card-title" style="margin-bottom:0;">Placement</div>
        <button class="btn btn-outline btn-sm" id="placementEditBtn">Edit</button>
      </div>
      <div id="placementView" class="two-col">
        <div><div class="stat-sub">Company</div><div>${escapeHtml(placement.companyName || '—')}</div></div>
        <div><div class="stat-sub">Address</div><div>${escapeHtml(placement.companyAddress || '—')}</div></div>
        <div><div class="stat-sub">Start date</div><div>${escapeHtml(placement.startDate || '—')}</div></div>
        <div><div class="stat-sub">End date</div><div>${escapeHtml(placement.endDate || '—')}</div></div>
        <div><div class="stat-sub">Industry supervisor</div><div>${escapeHtml(placement.supervisorName || '—')}</div></div>
        <div><div class="stat-sub">Supervisor contact</div><div>${escapeHtml(placement.supervisorContact || '—')}</div></div>
      </div>
    </div>
  `;

  document.getElementById('placementEditBtn').addEventListener('click', () => {
    const card = document.getElementById('placementCard');
    card.innerHTML = `
      <div class="card-title">Edit placement</div>
      ${placementFormFieldsHtml(placement)}
      <div id="placementMsg" class="stat-sub" style="margin-bottom:10px;"></div>
      <button class="btn btn-primary" id="placementSaveBtn">Save changes</button>
      <button class="btn btn-outline" id="placementCancelBtn" style="margin-left:8px;">Cancel</button>
    `;

    document.getElementById('placementCancelBtn').addEventListener('click', () => renderProfile(el));

    document.getElementById('placementSaveBtn').addEventListener('click', () => {
      const msg = document.getElementById('placementMsg');
      const data = readPlacementFormFields();
      if (!data) {
        msg.textContent = 'Please fill in every field.';
        msg.style.color = '#dc2626';
        return;
      }
      const btn = document.getElementById('placementSaveBtn');
      btn.disabled = true;
      btn.textContent = 'Saving…';

      db.collection('users').doc(currentUser.uid).update({
        placement: data,
        profileCompleted: true
      }).then(() => {
        currentProfile.placement = data;
        currentProfile.profileCompleted = true;
        renderProfile(el);
      }).catch(err => {
        msg.textContent = err.message;
        msg.style.color = '#dc2626';
        btn.disabled = false;
        btn.textContent = 'Save changes';
      });
    });
  });
}
