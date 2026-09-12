// Admin panel controller. Access is restricted to users whose Firestore
// users/{uid} document has role === 'admin'.
//
// Domain model: the portal never matches students to supervisors — each
// school decides that and hands the admin a ready-made list. This panel
// just records it:
//   schools/{id}            -> { name }
//   users/{uid}             -> role, schoolId, schoolName, session, and
//                               (students only) assignedSupervisorUid/Name
//
// A student can exist with no assigned supervisor yet — that's normal;
// the admin fills it in later once the school provides it.

const db = window.db;
const auth = window.auth;

let currentUser = null;
let currentProfile = null;
let schoolsCache = [];

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

function logout() {
  if (!auth || !auth.signOut) { location.href = 'admin-login.html'; return; }
  auth.signOut().then(() => location.href = 'admin-login.html');
}

document.addEventListener('DOMContentLoaded', () => {
  if (!auth || !auth.onAuthStateChanged) return;

  auth.onAuthStateChanged(user => {
    if (!user) { location.href = 'admin-login.html'; return; }
    currentUser = user;

    db.collection('users').doc(user.uid).get().then(snap => {
      currentProfile = snap.exists ? snap.data() : {};

      if ((currentProfile.role || '') !== 'admin') {
        alert('You don\u2019t have access to the admin panel.');
        auth.signOut().then(() => location.href = 'admin-login.html');
        return;
      }

      return loadSchools().then(() => {
        renderShell();
        document.getElementById('loading').style.display = 'none';
        document.getElementById('app').style.display = 'flex';
      });
    }).catch(err => console.error('Failed to load profile', err));
  });
});

function loadSchools() {
  return db.collection('schools').orderBy('name').get().then(snap => {
    schoolsCache = [];
    snap.forEach(d => schoolsCache.push({ id: d.id, ...d.data() }));
  }).catch(err => { console.error(err); schoolsCache = []; });
}

function schoolOptions(selectedId) {
  if (!schoolsCache.length) return '<option value="">No schools yet — add one first</option>';
  return schoolsCache.map(s => `<option value="${s.id}" ${s.id === selectedId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('');
}

function renderShell() {
  document.getElementById('avatarInitial').textContent = initials(currentProfile.fullname);
  document.getElementById('topbarName').textContent = currentProfile.fullname || currentUser.email;

  const sidebar = document.getElementById('sidebar');
  sidebar.innerHTML = `
    <div class="sidebar-section">Menu</div>
    <div class="nav-item" data-page="users">All users</div>
    <div class="nav-item" data-page="schools">Schools</div>
    <div class="sidebar-section">Add accounts</div>
    <div class="nav-item" data-page="addSupervisor">Add supervisor</div>
    <div class="nav-item" data-page="addStudent">Add student</div>
    <div class="nav-item" data-page="bulkImport">Bulk import</div>
  `;

  sidebar.querySelectorAll('.nav-item[data-page]').forEach(el => {
    el.addEventListener('click', () => switchPage(el.dataset.page));
  });

  switchPage('users');
}

function switchPage(id) {
  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    el.classList.toggle('active', el.dataset.page === id);
  });

  const main = document.getElementById('mainContent');
  main.innerHTML = '<div class="page active" id="pageContent"></div>';
  const target = document.getElementById('pageContent');

  if (id === 'users') renderUsers(target);
  if (id === 'schools') renderSchools(target);
  if (id === 'addSupervisor') renderAddSupervisor(target);
  if (id === 'addStudent') renderAddStudent(target);
  if (id === 'bulkImport') renderBulkImport(target);
}

// ── Schools ───────────────────────────────────────────────────
function renderSchools(el) {
  el.innerHTML = `
    <div class="page-title">Schools</div>
    <div class="page-sub">Universities registered under this system. Add a school before adding its supervisors or students.</div>
    <div class="card" style="max-width:480px;">
      <div class="form-group">
        <label class="form-label">School / university name</label>
        <input class="form-input" id="schoolName" placeholder="e.g. University of Ibadan">
      </div>
      <div id="schoolMsg" class="stat-sub" style="margin-bottom:10px;"></div>
      <button class="btn btn-primary" id="schoolAdd">Add school</button>
    </div>
    <div class="card">
      <div class="card-title">Existing schools</div>
      <table>
        <thead><tr><th>Name</th></tr></thead>
        <tbody id="schoolsTbody"></tbody>
      </table>
    </div>
  `;

  function refreshList() {
    const tbody = document.getElementById('schoolsTbody');
    tbody.innerHTML = schoolsCache.length
      ? schoolsCache.map(s => `<tr><td>${escapeHtml(s.name)}</td></tr>`).join('')
      : `<tr><td>No schools added yet.</td></tr>`;
  }
  refreshList();

  document.getElementById('schoolAdd').addEventListener('click', () => {
    const name = document.getElementById('schoolName').value.trim();
    const msg = document.getElementById('schoolMsg');
    if (!name) { msg.textContent = 'Please enter a school name.'; msg.style.color = '#dc2626'; return; }

    const btn = document.getElementById('schoolAdd');
    btn.disabled = true; btn.textContent = 'Adding…';

    db.collection('schools').add({ name, createdAt: firebase.firestore.FieldValue.serverTimestamp() })
      .then(() => loadSchools())
      .then(() => {
        document.getElementById('schoolName').value = '';
        msg.textContent = 'School added.'; msg.style.color = '#0ea5a0';
        btn.disabled = false; btn.textContent = 'Add school';
        refreshList();
      })
      .catch(err => {
        msg.textContent = err.message; msg.style.color = '#dc2626';
        btn.disabled = false; btn.textContent = 'Add school';
      });
  });
}

// ── All users ─────────────────────────────────────────────────
function renderUsers(el) {
  el.innerHTML = `
    <div class="page-title">All users</div>
    <div class="page-sub">Change a user's role, school, session, or assigned supervisor, then click Save. A student can be created before a supervisor is assigned — just leave that field blank until the school provides it.</div>
    <div class="card">
      <table>
        <thead><tr><th>Name</th><th>Role</th><th>School</th><th>Session</th><th>Assigned supervisor</th><th></th></tr></thead>
        <tbody id="usersTbody"><tr><td colspan="6">Loading…</td></tr></tbody>
      </table>
    </div>
  `;

  db.collection('users').get().then(usersSnap => {
    const users = [];
    usersSnap.forEach(d => users.push({ uid: d.id, ...d.data() }));
    users.sort((a, b) => (a.fullname || '').localeCompare(b.fullname || ''));

    const supervisorsBySchool = {};
    users.filter(u => u.role === 'supervisor').forEach(s => {
      const key = s.schoolId || '';
      (supervisorsBySchool[key] = supervisorsBySchool[key] || []).push(s);
    });

    const tbody = document.getElementById('usersTbody');
    tbody.innerHTML = users.length ? users.map(u => `
      <tr data-row="${u.uid}">
        <td>${escapeHtml(u.fullname || u.email)}${u.uid === currentUser.uid ? ' (you)' : ''}</td>
        <td>
          <select class="form-select" style="padding:6px 8px;font-size:12.5px;width:auto;" data-role-uid="${u.uid}">
            <option value="student" ${(!u.role || u.role === 'student') ? 'selected' : ''}>Student</option>
            <option value="supervisor" ${u.role === 'supervisor' ? 'selected' : ''}>Supervisor</option>
            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
          </select>
        </td>
        <td>
          <select class="form-select" style="padding:6px 8px;font-size:12.5px;width:auto;" data-school-uid="${u.uid}">
            <option value="">—</option>
            ${schoolOptions(u.schoolId)}
          </select>
        </td>
        <td><input class="form-input" style="padding:6px 8px;font-size:12.5px;width:100px;" data-session-uid="${u.uid}" value="${escapeHtml(u.session || '')}" placeholder="2025/2026"></td>
        <td>
          <select class="form-select" style="padding:6px 8px;font-size:12.5px;width:auto;" data-sup-uid="${u.uid}" ${u.role !== 'student' ? 'disabled' : ''}>
            <option value="">— none yet —</option>
            ${(supervisorsBySchool[u.schoolId || ''] || []).map(s => `<option value="${s.uid}" ${s.uid === u.assignedSupervisorUid ? 'selected' : ''}>${escapeHtml(s.fullname || s.email)}</option>`).join('')}
          </select>
        </td>
        <td><button class="btn btn-outline btn-sm" data-save-uid="${u.uid}">Save</button></td>
      </tr>
    `).join('') : `<tr><td colspan="6">No users yet.</td></tr>`;

    tbody.querySelectorAll('button[data-save-uid]').forEach(btn => {
      btn.addEventListener('click', () => {
        const uid = btn.dataset.saveUid;
        const row = tbody.querySelector(`tr[data-row="${uid}"]`);
        const role = row.querySelector(`[data-role-uid="${uid}"]`).value;
        const schoolId = row.querySelector(`[data-school-uid="${uid}"]`).value;
        const school = schoolsCache.find(s => s.id === schoolId);
        const session = row.querySelector(`[data-session-uid="${uid}"]`).value.trim();
        const supSelect = row.querySelector(`[data-sup-uid="${uid}"]`);
        const assignedSupervisorUid = role === 'student' ? supSelect.value : '';
        const assignedSupervisorName = (role === 'student' && assignedSupervisorUid && supSelect.selectedIndex >= 0)
          ? supSelect.options[supSelect.selectedIndex].textContent : '';

        btn.disabled = true; btn.textContent = 'Saving…';

        db.collection('users').doc(uid).update({
          role,
          schoolId: schoolId || '',
          schoolName: school ? school.name : '',
          session,
          assignedSupervisorUid,
          assignedSupervisorName
        }).then(() => {
          btn.textContent = 'Saved ✓';
          setTimeout(() => { btn.disabled = false; btn.textContent = 'Save'; }, 1200);
        }).catch(err => {
          alert(err.message);
          btn.disabled = false;
          btn.textContent = 'Save';
        });
      });
    });

    tbody.querySelectorAll('[data-role-uid]').forEach(sel => {
      sel.addEventListener('change', () => {
        const uid = sel.dataset.roleUid;
        const row = tbody.querySelector(`tr[data-row="${uid}"]`);
        row.querySelector(`[data-sup-uid="${uid}"]`).disabled = sel.value !== 'student';
      });
    });
    tbody.querySelectorAll('[data-school-uid]').forEach(sel => {
      sel.addEventListener('change', () => {
        const uid = sel.dataset.schoolUid;
        const row = tbody.querySelector(`tr[data-row="${uid}"]`);
        const supSelect = row.querySelector(`[data-sup-uid="${uid}"]`);
        const list = supervisorsBySchool[sel.value || ''] || [];
        supSelect.innerHTML = '<option value="">— none yet —</option>' +
          list.map(s => `<option value="${s.uid}">${escapeHtml(s.fullname || s.email)}</option>`).join('');
      });
    });
  }).catch(err => console.error(err));
}

// ── Add supervisor (one at a time) ───────────────────────────
function renderAddSupervisor(el) {
  el.innerHTML = `
    <div class="page-title">Add supervisor</div>
    <div class="page-sub">Creates a supervisor login for a specific school. Doesn't sign you out of your own session.</div>
    <div class="card" style="max-width:480px;">
      <div class="form-group">
        <label class="form-label">School</label>
        <select class="form-select" id="supSchool">${schoolOptions()}</select>
      </div>
      <div class="form-group">
        <label class="form-label">Full name</label>
        <input class="form-input" id="supName" placeholder="e.g. Dr. Ifeoma Balogun">
      </div>
      <div class="form-group">
        <label class="form-label">Email address</label>
        <input class="form-input" type="email" id="supEmail" placeholder="supervisor@example.com">
      </div>
      <div class="form-group">
        <label class="form-label">Temporary password</label>
        <input class="form-input" type="text" id="supPassword" placeholder="Min. 6 characters">
      </div>
      <div id="supMsg" class="stat-sub" style="margin-bottom:10px;"></div>
      <button class="btn btn-primary" id="supCreate">Create supervisor</button>
    </div>
  `;

  document.getElementById('supCreate').addEventListener('click', () => {
    const schoolId = document.getElementById('supSchool').value;
    const school = schoolsCache.find(s => s.id === schoolId);
    const fullname = document.getElementById('supName').value.trim();
    const email = document.getElementById('supEmail').value.trim();
    const password = document.getElementById('supPassword').value;
    const msg = document.getElementById('supMsg');

    if (!schoolId) { msg.textContent = 'Please add and select a school first.'; msg.style.color = '#dc2626'; return; }
    if (!fullname || !email || !email.includes('@') || password.length < 6) {
      msg.textContent = 'Please fill in all fields (password min. 6 characters).';
      msg.style.color = '#dc2626';
      return;
    }

    const btn = document.getElementById('supCreate');
    btn.disabled = true; btn.textContent = 'Creating…'; msg.textContent = '';

    createAccount({ fullname, email, password, role: 'supervisor', schoolId, schoolName: school.name, session: '' })
      .then(() => {
        msg.textContent = `Supervisor account created for ${fullname}.`;
        msg.style.color = '#0ea5a0';
        document.getElementById('supName').value = '';
        document.getElementById('supEmail').value = '';
        document.getElementById('supPassword').value = '';
        btn.disabled = false; btn.textContent = 'Create supervisor';
      })
      .catch(err => {
        msg.textContent = err.message; msg.style.color = '#dc2626';
        btn.disabled = false; btn.textContent = 'Create supervisor';
      });
  });
}

// ── Add student (one at a time) ──────────────────────────────
function renderAddStudent(el) {
  el.innerHTML = `
    <div class="page-title">Add student</div>
    <div class="page-sub">Creates a student login. If the school hasn't assigned a supervisor yet, just leave that field on "none yet" — you can set it later from All users.</div>
    <div class="card" style="max-width:520px;">
      <div class="two-col">
        <div class="form-group">
          <label class="form-label">School</label>
          <select class="form-select" id="stuSchool">${schoolOptions()}</select>
        </div>
        <div class="form-group">
          <label class="form-label">Session</label>
          <input class="form-input" id="stuSession" placeholder="e.g. 2025/2026">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Assigned supervisor</label>
        <select class="form-select" id="stuSupervisor"><option value="">Select a school first…</option></select>
      </div>
      <div class="form-group">
        <label class="form-label">Full name</label>
        <input class="form-input" id="stuName" placeholder="e.g. Adaeze Okonkwo">
      </div>
      <div class="two-col">
        <div class="form-group">
          <label class="form-label">Email address</label>
          <input class="form-input" type="email" id="stuEmail" placeholder="student@example.com">
        </div>
        <div class="form-group">
          <label class="form-label">Temporary password</label>
          <input class="form-input" type="text" id="stuPassword" placeholder="Min. 6 characters">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Matric number</label>
        <input class="form-input" id="stuMatric" placeholder="e.g. CSC/2021/001">
      </div>
      <div id="stuMsg" class="stat-sub" style="margin-bottom:10px;"></div>
      <button class="btn btn-primary" id="stuCreate">Create student</button>
    </div>
  `;

  function refreshSupervisorOptions() {
    const schoolId = document.getElementById('stuSchool').value;
    const supSelect = document.getElementById('stuSupervisor');
    if (!schoolId) { supSelect.innerHTML = '<option value="">Select a school first…</option>'; return; }
    supSelect.innerHTML = '<option value="">Loading…</option>';
    db.collection('users').where('role', '==', 'supervisor').where('schoolId', '==', schoolId).get().then(snap => {
      const list = [];
      snap.forEach(d => list.push({ uid: d.id, ...d.data() }));
      supSelect.innerHTML = '<option value="">— none yet —</option>' +
        list.map(s => `<option value="${s.uid}" data-name="${escapeHtml(s.fullname || s.email)}">${escapeHtml(s.fullname || s.email)}</option>`).join('');
    }).catch(() => { supSelect.innerHTML = '<option value="">— none yet —</option>'; });
  }
  document.getElementById('stuSchool').addEventListener('change', refreshSupervisorOptions);
  if (document.getElementById('stuSchool').value) refreshSupervisorOptions();

  document.getElementById('stuCreate').addEventListener('click', () => {
    const schoolId = document.getElementById('stuSchool').value;
    const school = schoolsCache.find(s => s.id === schoolId);
    const session = document.getElementById('stuSession').value.trim();
    const supSelect = document.getElementById('stuSupervisor');
    const assignedSupervisorUid = supSelect.value;
    const assignedSupervisorName = (assignedSupervisorUid && supSelect.selectedIndex >= 0)
      ? (supSelect.options[supSelect.selectedIndex].dataset.name || '') : '';
    const fullname = document.getElementById('stuName').value.trim();
    const email = document.getElementById('stuEmail').value.trim();
    const password = document.getElementById('stuPassword').value;
    const matricNo = document.getElementById('stuMatric').value.trim();
    const msg = document.getElementById('stuMsg');

    if (!schoolId) { msg.textContent = 'Please add and select a school first.'; msg.style.color = '#dc2626'; return; }
    if (!fullname || !email || !email.includes('@') || password.length < 6) {
      msg.textContent = 'Please fill in all required fields (password min. 6 characters).';
      msg.style.color = '#dc2626';
      return;
    }

    const btn = document.getElementById('stuCreate');
    btn.disabled = true; btn.textContent = 'Creating…'; msg.textContent = '';

    createAccount({
      fullname, email, password, role: 'student',
      schoolId, schoolName: school.name, session,
      matricNo, assignedSupervisorUid, assignedSupervisorName
    })
      .then(() => {
        msg.textContent = `Student account created for ${fullname}.`;
        msg.style.color = '#0ea5a0';
        document.getElementById('stuName').value = '';
        document.getElementById('stuEmail').value = '';
        document.getElementById('stuPassword').value = '';
        document.getElementById('stuMatric').value = '';
        btn.disabled = false; btn.textContent = 'Create student';
      })
      .catch(err => {
        msg.textContent = err.message; msg.style.color = '#dc2626';
        btn.disabled = false; btn.textContent = 'Create student';
      });
  });
}

// ── Bulk import ───────────────────────────────────────────────
function renderBulkImport(el) {
  el.innerHTML = `
    <div class="page-title">Bulk import</div>
    <div class="page-sub">Paste a school's supervisor and student list. One entry per line, comma-separated.</div>
    <div class="card" style="max-width:640px;">
      <div class="two-col">
        <div class="form-group">
          <label class="form-label">School</label>
          <select class="form-select" id="bulkSchool">${schoolOptions()}</select>
        </div>
        <div class="form-group">
          <label class="form-label">Session</label>
          <input class="form-input" id="bulkSession" placeholder="e.g. 2025/2026">
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Supervisors — one per line: <code>full name, email, temp password</code></label>
        <textarea class="form-textarea" id="bulkSupervisors" style="min-height:110px;font-family:monospace;font-size:12.5px;" placeholder="Dr. Ifeoma Balogun, ifeoma.balogun@example.com, temp1234
Mr. John Adeyemi, john.adeyemi@example.com, temp1234"></textarea>
      </div>

      <div class="form-group">
        <label class="form-label">Students — one per line: <code>full name, email, temp password, supervisor email (optional)</code></label>
        <textarea class="form-textarea" id="bulkStudents" style="min-height:150px;font-family:monospace;font-size:12.5px;" placeholder="Adaeze Okonkwo, adaeze.okonkwo@example.com, temp1234, ifeoma.balogun@example.com
Tunde Bakare, tunde.bakare@example.com, temp1234"></textarea>
        <div class="stat-sub" style="margin-top:4px;">Leave the last column blank if the school hasn't told you the supervisor yet — assign it later from All users.</div>
      </div>

      <div id="bulkMsg" style="margin-bottom:10px;font-size:13px;white-space:pre-line;"></div>
      <button class="btn btn-primary" id="bulkRun">Run import</button>
    </div>
  `;

  document.getElementById('bulkRun').addEventListener('click', async () => {
    const schoolId = document.getElementById('bulkSchool').value;
    const school = schoolsCache.find(s => s.id === schoolId);
    const session = document.getElementById('bulkSession').value.trim();
    const msg = document.getElementById('bulkMsg');
    const btn = document.getElementById('bulkRun');

    if (!schoolId) { msg.textContent = 'Please add and select a school first.'; msg.style.color = '#dc2626'; return; }

    const supervisorLines = document.getElementById('bulkSupervisors').value.split('\n').map(l => l.trim()).filter(Boolean);
    const studentLines = document.getElementById('bulkStudents').value.split('\n').map(l => l.trim()).filter(Boolean);

    if (!supervisorLines.length && !studentLines.length) {
      msg.textContent = 'Paste at least one supervisor or student line.'; msg.style.color = '#dc2626';
      return;
    }

    btn.disabled = true; btn.textContent = 'Importing…';
    msg.style.color = '#637389';
    msg.textContent = 'Starting import — this can take a moment for long lists…';

    const results = { supervisorsCreated: 0, studentsCreated: 0, errors: [] };
    const supervisorEmailToInfo = {};

    try {
      const existing = await db.collection('users').where('role', '==', 'supervisor').where('schoolId', '==', schoolId).get();
      existing.forEach(d => {
        const data = d.data();
        if (data.email) supervisorEmailToInfo[data.email.toLowerCase()] = { uid: d.id, fullname: data.fullname };
      });
    } catch (e) { /* non-fatal */ }

    for (const line of supervisorLines) {
      const [fullname, email, password] = line.split(',').map(s => (s || '').trim());
      if (!fullname || !email || !password) { results.errors.push(`Skipped invalid supervisor line: "${line}"`); continue; }
      try {
        const uid = await createAccount({ fullname, email, password, role: 'supervisor', schoolId, schoolName: school.name, session: '' });
        supervisorEmailToInfo[email.toLowerCase()] = { uid, fullname };
        results.supervisorsCreated++;
      } catch (err) {
        results.errors.push(`${email}: ${err.message}`);
      }
      msg.textContent = `Importing… (${results.supervisorsCreated} supervisors, ${results.studentsCreated} students so far)`;
    }

    for (const line of studentLines) {
      const parts = line.split(',').map(s => (s || '').trim());
      const [fullname, email, password, supervisorEmail] = parts;
      if (!fullname || !email || !password) { results.errors.push(`Skipped invalid student line: "${line}"`); continue; }
      const sup = supervisorEmail ? supervisorEmailToInfo[supervisorEmail.toLowerCase()] : null;
      if (supervisorEmail && !sup) results.errors.push(`${email}: supervisor "${supervisorEmail}" not found — created with no assigned supervisor.`);
      try {
        await createAccount({
          fullname, email, password, role: 'student', schoolId, schoolName: school.name, session,
          assignedSupervisorUid: sup ? sup.uid : '', assignedSupervisorName: sup ? sup.fullname : ''
        });
        results.studentsCreated++;
      } catch (err) {
        results.errors.push(`${email}: ${err.message}`);
      }
      msg.textContent = `Importing… (${results.supervisorsCreated} supervisors, ${results.studentsCreated} students so far)`;
    }

    msg.style.color = results.errors.length ? '#d97706' : '#0ea5a0';
    msg.textContent =
      `Done. Created ${results.supervisorsCreated} supervisor(s) and ${results.studentsCreated} student(s).` +
      (results.errors.length ? `\n\n${results.errors.length} issue(s):\n` + results.errors.join('\n') : '');

    btn.disabled = false;
    btn.textContent = 'Run import';
  });
}

// ── shared account-creation helper ───────────────────────────
// Uses a secondary Firebase app instance so creating a new account never
// signs the admin out of their own session. Returns the new user's uid.
function createAccount({ fullname, email, password, role, schoolId, schoolName, session, matricNo, assignedSupervisorUid, assignedSupervisorName }) {
  const secondaryApp = firebase.initializeApp(firebase.app().options, 'Secondary-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  const secondaryAuth = secondaryApp.auth();

  return secondaryAuth.createUserWithEmailAndPassword(email, password)
    .then(cred => {
      const uid = cred.user.uid;
      const doc = {
        fullname, email, role,
        schoolId: schoolId || '',
        schoolName: schoolName || '',
        session: session || '',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdByAdmin: true
      };
      if (role === 'student') {
        doc.matricNo = matricNo || '';
        doc.assignedSupervisorUid = assignedSupervisorUid || '';
        doc.assignedSupervisorName = assignedSupervisorName || '';
        doc.profileCompleted = false;
      }
      return db.collection('users').doc(uid).set(doc)
        .then(() => secondaryAuth.signOut())
        .then(() => uid);
    })
    .finally(() => secondaryApp.delete().catch(() => {}));
}
