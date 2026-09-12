const db = window.db;
const auth = window.auth;

let currentUser = null;
let currentProfile = null;
let myStudents = [];
let logbookFilterStudent = null;
let chatUnsubscribe = null;
let activeChatStudentUid = null;

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
  if (!auth || !auth.signOut) { location.href = 'supervisor-login.html'; return; }
  auth.signOut().then(() => location.href = 'supervisor-login.html');
}

document.addEventListener('DOMContentLoaded', () => {
  if (!auth || !auth.onAuthStateChanged) return;

  auth.onAuthStateChanged(user => {
    if (!user) { location.href = 'supervisor-login.html'; return; }
    currentUser = user;

    db.collection('users').doc(user.uid).get().then(snap => {
      currentProfile = snap.exists ? snap.data() : {};

      if ((currentProfile.role || '') !== 'supervisor') {
        alert('This account isn\u2019t a supervisor account.');
        auth.signOut().then(() => location.href = 'supervisor-login.html');
        return;
      }

      return loadMyStudents().then(() => {
        renderShell();
        document.getElementById('loading').style.display = 'none';
        document.getElementById('app').style.display = 'flex';
      });
    }).catch(err => console.error('Failed to load profile', err));
  });
});

function loadMyStudents() {
  return db.collection('users').where('role', '==', 'student').where('assignedSupervisorUid', '==', currentUser.uid).get().then(snap => {
    myStudents = [];
    snap.forEach(d => myStudents.push({ uid: d.id, ...d.data() }));
    myStudents.sort((a, b) => (a.fullname || '').localeCompare(b.fullname || ''));
  }).catch(err => { console.error(err); myStudents = []; });
}

function renderShell() {
  document.getElementById('avatarInitial').textContent = initials(currentProfile.fullname);
  document.getElementById('topbarName').textContent = currentProfile.fullname || currentUser.email;

  const sidebar = document.getElementById('sidebar');
  sidebar.innerHTML = `
    <div class="sidebar-section">Menu</div>
    <div class="nav-item" data-page="overview">Overview</div>
    <div class="nav-item" data-page="students">My students</div>
    <div class="nav-item" data-page="reviews">Logbook reviews</div>
    <div class="nav-item" data-page="chat">Chat</div>
    <div class="nav-item" data-page="profile">Profile</div>
  `;
  sidebar.querySelectorAll('.nav-item[data-page]').forEach(el => {
    el.addEventListener('click', () => switchPage(el.dataset.page));
  });

  switchPage('overview');
}

function switchPage(id) {
  if (chatUnsubscribe) { chatUnsubscribe(); chatUnsubscribe = null; }
  activeChatStudentUid = null;

  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    el.classList.toggle('active', el.dataset.page === id);
  });

  const main = document.getElementById('mainContent');
  main.innerHTML = '<div class="page active" id="pageContent"></div>';
  const target = document.getElementById('pageContent');

  if (id === 'overview') renderOverview(target);
  if (id === 'students') renderStudents(target);
  if (id === 'reviews') renderReviews(target);
  if (id === 'chat') renderChat(target);
  if (id === 'profile') renderProfile(target);
}

// ── Overview ──────────────────────────────────────────────────
function renderOverview(el) {
  const firstName = (currentProfile.fullname || '').split(' ')[0] || 'there';
  el.innerHTML = `
    <div class="page-title">Welcome, ${escapeHtml(firstName)}</div>
    <div class="page-sub">Overview of the students assigned to you.</div>
    <div class="stat-grid" id="statGrid"><div class="stat-card"><div class="stat-label">Loading…</div></div></div>
    <div class="card">
      <div class="card-title">Recent submissions</div>
      <div id="recentAll"><div class="stat-sub">Loading…</div></div>
    </div>
  `;

  if (!myStudents.length) {
    document.getElementById('statGrid').innerHTML = `
      <div class="stat-card"><div class="stat-label">Students</div><div class="stat-value blue">0</div></div>
    `;
    document.getElementById('recentAll').innerHTML = `<div class="stat-sub">No students assigned to you yet.</div>`;
    return;
  }

  db.collection('logbookEntries').where('supervisorUid', '==', currentUser.uid).get().then(snap => {
    const entries = [];
    snap.forEach(d => entries.push(d.data()));
    entries.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const pending = entries.filter(e => e.status !== 'reviewed').length;
    const flagged = entries.filter(e => e.aiFlag).length;

    document.getElementById('statGrid').innerHTML = `
      <div class="stat-card"><div class="stat-label">Students</div><div class="stat-value blue">${myStudents.length}</div></div>
      <div class="stat-card"><div class="stat-label">Pending review</div><div class="stat-value amber">${pending}</div></div>
      <div class="stat-card"><div class="stat-label">Flagged by AI</div><div class="stat-value teal">${flagged}</div></div>
    `;

    const recent = entries.slice(0, 6);
    document.getElementById('recentAll').innerHTML = recent.length ? recent.map(e => `
      <div class="logbook-entry">
        <div class="entry-dot ${e.aiFlag ? 'flagged' : ''}"></div>
        <div>
          <div class="entry-date">${escapeHtml(e.studentName || '')} · ${escapeHtml(e.date || '')} · <span class="badge ${e.status === 'reviewed' ? 'badge-green' : 'badge-amber'}">${e.status === 'reviewed' ? 'Reviewed' : 'Pending'}</span>${e.aiFlag ? ' <span class="badge badge-gray">⚠ Flagged</span>' : ''}</div>
          <div class="entry-text">${escapeHtml(e.activities || '')}</div>
        </div>
      </div>`).join('') : `<div class="stat-sub">No submissions yet.</div>`;
  }).catch(err => console.error(err));
}

// ── My students ───────────────────────────────────────────────
function renderStudents(el) {
  el.innerHTML = `
    <div class="page-title">My students</div>
    <div class="page-sub">Students your school has assigned to you.</div>
    <div class="card">
      <table>
        <thead><tr><th>Name</th><th>Matric no.</th><th>School</th><th>Placement</th><th></th></tr></thead>
        <tbody id="studentsTbody"></tbody>
      </table>
    </div>
  `;

  const tbody = document.getElementById('studentsTbody');
  tbody.innerHTML = myStudents.length ? myStudents.map(s => {
    const placement = s.placement || {};
    const placementCell = s.profileCompleted && placement.companyName
      ? `${escapeHtml(placement.companyName)}<div class="stat-sub">${escapeHtml(placement.companyAddress || '')}</div>`
      : `<span class="badge badge-amber">Not yet provided</span>`;
    return `
    <tr>
      <td>${escapeHtml(s.fullname || s.email)}</td>
      <td>${escapeHtml(s.matricNo || '—')}</td>
      <td>${escapeHtml(s.schoolName || '—')}</td>
      <td>${placementCell}</td>
      <td><button class="btn btn-outline btn-sm" data-uid="${s.uid}">View logbook</button></td>
    </tr>`;
  }).join('') : `<tr><td colspan="5">No students assigned to you yet — check with your administrator.</td></tr>`;

  tbody.querySelectorAll('button[data-uid]').forEach(btn => {
    btn.addEventListener('click', () => {
      logbookFilterStudent = btn.dataset.uid;
      switchPage('reviews');
    });
  });
}

// ── Logbook reviews ───────────────────────────────────────────
function renderReviews(el) {
  el.innerHTML = `
    <div class="page-title">Logbook reviews</div>
    <div class="page-sub">
      ${logbookFilterStudent ? 'Showing entries for the selected student. ' : 'Showing entries from all your students. '}
      ${logbookFilterStudent ? '<a href="#" id="clearFilter" style="color:var(--accent);">Clear filter</a>' : ''}
    </div>
    <div id="reviewList"><div class="stat-sub">Loading…</div></div>
  `;

  const clear = document.getElementById('clearFilter');
  if (clear) clear.addEventListener('click', e => { e.preventDefault(); logbookFilterStudent = null; renderReviews(el); });

  if (!myStudents.length) {
    document.getElementById('reviewList').innerHTML = `<div class="card"><div class="stat-sub">No students assigned to you yet.</div></div>`;
    return;
  }

  const query = logbookFilterStudent
    ? db.collection('logbookEntries').where('studentUid', '==', logbookFilterStudent)
    : db.collection('logbookEntries').where('supervisorUid', '==', currentUser.uid);

  query.get().then(snap => {
    const entries = [];
    snap.forEach(d => entries.push({ id: d.id, ...d.data() }));
    entries.sort((a, b) => {
      const statusOrder = (a.status === 'reviewed' ? 1 : 0) - (b.status === 'reviewed' ? 1 : 0);
      return statusOrder || (b.date || '').localeCompare(a.date || '');
    });

    const list = document.getElementById('reviewList');
    list.innerHTML = entries.length ? entries.map(e => `
      <div class="card" data-id="${e.id}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
          <div>
            <div style="font-weight:700;">${escapeHtml(e.studentName || '')} ${e.aiFlag ? '<span class="badge badge-gray">⚠ AI flagged</span>' : ''}</div>
            <div class="entry-date">${escapeHtml(e.date || '')} · <span class="badge ${e.status === 'reviewed' ? 'badge-green' : 'badge-amber'}">${e.status === 'reviewed' ? 'Reviewed' : 'Pending'}</span></div>
          </div>
        </div>
        <div class="entry-text" style="margin:10px 0;">${escapeHtml(e.activities || '')}</div>
        ${e.aiFlag ? `<div class="stat-sub" style="color:#d97706;margin-bottom:10px;">AI note: ${escapeHtml(e.aiFlag)}</div>` : ''}
        <div class="form-group">
          <label class="form-label">Remark</label>
          <textarea class="form-textarea" style="min-height:60px;" data-comment="${e.id}">${escapeHtml(e.supervisorComment || '')}</textarea>
        </div>
        <button class="btn btn-primary btn-sm" data-save="${e.id}">Mark reviewed</button>
      </div>
    `).join('') : `<div class="card"><div class="stat-sub">No entries found.</div></div>`;

    list.querySelectorAll('button[data-save]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.save;
        const comment = list.querySelector(`textarea[data-comment="${id}"]`).value.trim();
        btn.disabled = true;
        btn.textContent = 'Saving…';

        db.collection('logbookEntries').doc(id).update({
          status: 'reviewed',
          supervisorComment: comment,
          reviewedAt: firebase.firestore.FieldValue.serverTimestamp(),
        }).then(() => {
          renderReviews(document.getElementById('pageContent'));
        }).catch(err => {
          alert(err.message);
          btn.disabled = false;
          btn.textContent = 'Mark reviewed';
        });
      });
    });
  }).catch(err => console.error(err));
}

// ── Chat (inbox of assigned students) ────────────────────────
function renderChat(el) {
  el.innerHTML = `
    <div class="page-title">Chat</div>
    <div class="page-sub">Direct messages with your assigned students.</div>
    <div class="chat-wrap">
      <div class="chat-list" id="chatList"></div>
      <div class="chat-panel" id="chatPanel">
        <div class="chat-empty-state" style="margin:auto;">Select a student to start chatting.</div>
      </div>
    </div>
  `;

  const listEl = document.getElementById('chatList');
  listEl.innerHTML = myStudents.length ? myStudents.map(s => `
    <div class="chat-list-item" data-uid="${s.uid}">
      <div class="chat-list-name">${escapeHtml(s.fullname || s.email)}</div>
      <div class="chat-list-sub">${escapeHtml(s.matricNo || '')}</div>
    </div>
  `).join('') : `<div class="chat-list-item" style="cursor:default;">No students assigned yet.</div>`;

  listEl.querySelectorAll('.chat-list-item[data-uid]').forEach(item => {
    item.addEventListener('click', () => {
      listEl.querySelectorAll('.chat-list-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      openChatWith(item.dataset.uid);
    });
  });
}

function openChatWith(studentUid) {
  if (chatUnsubscribe) { chatUnsubscribe(); chatUnsubscribe = null; }
  activeChatStudentUid = studentUid;

  const student = myStudents.find(s => s.uid === studentUid);
  const panel = document.getElementById('chatPanel');
  panel.innerHTML = `
    <div class="chat-panel-header">${escapeHtml(student ? (student.fullname || student.email) : '')}</div>
    <div class="chat-messages" id="chatMessages"><div class="chat-empty-state">Loading…</div></div>
    <form class="chat-send-row" id="chatSendForm">
      <input type="text" id="chatInput" placeholder="Type a message…" autocomplete="off">
      <button type="submit" id="chatSendBtn">Send</button>
    </form>
  `;

  const cid = convId(studentUid, currentUser.uid);
  const convRef = db.collection('conversations').doc(cid);

  convRef.set({
    studentUid,
    studentName: student ? (student.fullname || student.email) : '',
    supervisorUid: currentUser.uid,
    supervisorName: currentProfile.fullname || currentUser.email,
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
      sender: 'supervisor',
      text,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
      convRef.set({ lastMessage: text, lastMessageAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }).catch(err => console.error(err));
  });
}

// ── Profile ───────────────────────────────────────────────────
function renderProfile(el) {
  const p = currentProfile;
  el.innerHTML = `
    <div class="page-title">Profile</div>
    <div class="page-sub">Your account information.</div>
    <div class="card">
      <div class="card-title">Account</div>
      <div class="two-col">
        <div><div class="stat-sub">Full name</div><div>${escapeHtml(p.fullname || '—')}</div></div>
        <div><div class="stat-sub">Email</div><div>${escapeHtml(p.email || currentUser.email)}</div></div>
        <div><div class="stat-sub">School</div><div>${escapeHtml(p.schoolName || '—')}</div></div>
        <div><div class="stat-sub">Students assigned</div><div>${myStudents.length}</div></div>
      </div>
    </div>
  `;
}
