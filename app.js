/**
 * Dashboard Admin Presensi Maganghub
 * Vanilla JavaScript (ES6 Modules) + Firebase SDK v9 + SheetJS
 */

// 1. Firebase SDK v9 Modular Imports
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  query,
  where,
  updateDoc,
  doc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyDe394Hog3cODzHBWgC00jtQybKq_Ul4l4",
  authDomain: "presensee-d653b.firebaseapp.com",
  databaseURL: "https://presensee-d653b-default-rtdb.firebaseio.com",
  projectId: "presensee-d653b",
  storageBucket: "presensee-d653b.firebasestorage.app",
  messagingSenderId: "983111308568",
  appId: "1:983111308568:web:de94c7403005a596083a6d",
  measurementId: "G-9WBWFBFGYQ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// State Management
const STATE = {
  currentUser: null,
  activeView: 'viewPresensiHarian',
  usersByNik: new Map(),
  usersByUid: new Map(),
  userAccounts: [],
  userToDelete: null,
  presensiHarianList: [],
  pendingApprovalList: [],
  rekapList: [],
  rekapFilteredList: [],
  rekapSummary: { hadir: 0, izin: 0, sakit: 0, alpa: 0 }
};

// ============================================================================
// UTILITIES & HELPERS
// ============================================================================

/**
 * Tampilkan notifikasi toast mengambang
 */
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  const typeStyles = {
    success: 'bg-emerald-600 text-white border-emerald-700',
    error: 'bg-rose-600 text-white border-rose-700',
    warning: 'bg-amber-500 text-slate-900 border-amber-600',
    info: 'bg-indigo-600 text-white border-indigo-700'
  };

  const icons = {
    success: 'fa-circle-check',
    error: 'fa-circle-xmark',
    warning: 'fa-triangle-exclamation',
    info: 'fa-circle-info'
  };

  toast.className = `pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl shadow-xl text-xs sm:text-sm border transition-all duration-300 transform translate-y-2 opacity-0 ${typeStyles[type] || typeStyles.info}`;
  toast.innerHTML = `
    <i class="fa-solid ${icons[type] || icons.info} text-base flex-shrink-0"></i>
    <span class="flex-1 font-medium leading-snug">${message}</span>
    <button class="opacity-70 hover:opacity-100 p-1 text-xs">
      <i class="fa-solid fa-xmark"></i>
    </button>
  `;

  const btnClose = toast.querySelector('button');
  btnClose.addEventListener('click', () => removeToast(toast));

  container.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  });

  // Auto dismiss after 4 seconds
  const timer = setTimeout(() => {
    removeToast(toast);
  }, 4000);

  function removeToast(el) {
    clearTimeout(timer);
    el.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => el.remove(), 300);
  }
}

/**
 * Normalisasi format tanggal YYYY-MM-DD
 */
function getFormattedDate(d = new Date()) {
  if (!d) return '';
  if (typeof d.toDate === 'function') d = d.toDate();
  if (d && typeof d === 'object' && d.seconds !== undefined) d = new Date(d.seconds * 1000);
  if (typeof d === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.substring(0, 10);
    d = new Date(d);
  }
  if (!(d instanceof Date) || isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Normalisasi nomor HP untuk komparasi (hilangkan spasi, strip, +62 -> 08)
 */
function normalizePhone(phone) {
  if (!phone) return '';
  let cleaned = String(phone).replace(/[\s\-\+]/g, '');
  if (cleaned.startsWith('62')) {
    cleaned = '0' + cleaned.substring(2);
  }
  return cleaned;
}

/**
 * Konversi Timestamp Firestore, Date, atau string waktu menjadi format jam bersih HH:mm WIB
 */
function formatTimeDisplay(val) {
  if (!val || val === '-' || val === 'null' || val === 'undefined') return '-';

  try {
    // 1. Firestore Timestamp object (.toDate())
    if (val && typeof val.toDate === 'function') {
      const d = val.toDate();
      const h = String(d.getHours()).padStart(2, '0');
      const m = String(d.getMinutes()).padStart(2, '0');
      return `${h}:${m} WIB`;
    }

    // 2. Object dengan seconds / _seconds
    const secs = val.seconds ?? val._seconds;
    if (secs !== undefined && !isNaN(secs)) {
      const d = new Date(secs * 1000);
      const h = String(d.getHours()).padStart(2, '0');
      const m = String(d.getMinutes()).padStart(2, '0');
      return `${h}:${m} WIB`;
    }

    // 3. Date object
    if (val instanceof Date && !isNaN(val.getTime())) {
      const h = String(val.getHours()).padStart(2, '0');
      const m = String(val.getMinutes()).padStart(2, '0');
      return `${h}:${m} WIB`;
    }

    // 4. String
    if (typeof val === 'string') {
      const clean = val.trim();
      if (!clean || clean === '-') return '-';

      // String "Timestamp(seconds=1793578777, nanoseconds=534000000)"
      const matchSecs = clean.match(/seconds\s*=\s*(\d+)/i);
      if (matchSecs) {
        const d = new Date(parseInt(matchSecs[1], 10) * 1000);
        const h = String(d.getHours()).padStart(2, '0');
        const m = String(d.getMinutes()).padStart(2, '0');
        return `${h}:${m} WIB`;
      }

      // ISO String seperti 2026-11-02T07:19:37...
      if (clean.includes('T') && !isNaN(Date.parse(clean))) {
        const d = new Date(clean);
        const h = String(d.getHours()).padStart(2, '0');
        const m = String(d.getMinutes()).padStart(2, '0');
        return `${h}:${m} WIB`;
      }

      // Jam format "07:19:37" atau "07:19"
      const matchTime = clean.match(/^(\d{1,2})[:.](\d{2})(?:[:.]\d{2})?/);
      if (matchTime) {
        const h = String(matchTime[1]).padStart(2, '0');
        const m = String(matchTime[2]).padStart(2, '0');
        return `${h}:${m} WIB`;
      }

      return clean;
    }

    // 5. Number (epoch seconds atau millis)
    if (typeof val === 'number') {
      const ms = val > 1e11 ? val : val * 1000;
      const d = new Date(ms);
      if (!isNaN(d.getTime())) {
        const h = String(d.getHours()).padStart(2, '0');
        const m = String(d.getMinutes()).padStart(2, '0');
        return `${h}:${m} WIB`;
      }
    }
  } catch (e) {
    console.warn('Error formatTimeDisplay:', e);
  }

  return String(val);
}

/**
 * Ekstraksi Foto Bukti Izin / Sakit dari dokumen leaves atau presensi
 */
function extractFotoBukti(item) {
  if (!item) return '';
  return item.proof_url ||
    item.foto_url ||
    item.foto ||
    item.bukti_url ||
    item.bukti ||
    item.surat_dokter ||
    item.suratDokter ||
    item.file_url ||
    item.file ||
    item.lampiran ||
    '';
}

/**
 * Helper Badge HTML generator untuk Kategori (Sakit / Izin / Izin Darurat)
 */
function getKategoriBadgeHtml(kategori) {
  const k = String(kategori || '').toLowerCase();
  if (k.includes('sakit')) {
    return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
      <span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
      Sakit
    </span>`;
  }
  if (k.includes('darurat')) {
    return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200">
      <span class="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
      Izin Darurat
    </span>`;
  }
  return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
    <span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
    Izin
  </span>`;
}

/**
 * Badge HTML generator untuk Status Presensi
 */
function getStatusBadgeHtml(status, kategori = '') {
  const s = String(status || '').toLowerCase().trim();
  const k = String(kategori || '').toLowerCase().trim();

  // 1. Sudah di-ACC (Approved)
  if (
    s === 'approved' ||
    s.includes('disetujui') ||
    s.includes('(acc)') ||
    s.includes(' acc') ||
    s.endsWith('acc') ||
    s === 'acc'
  ) {
    if (k.includes('sakit') || s.includes('sakit')) {
      return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
        <span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
        Sakit (ACC)
      </span>`;
    }
    if (k.includes('izin_darurat') || s.includes('izin_darurat') || k.includes('darurat') || s.includes('darurat')) {
      return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
        <span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
        Izin Darurat (ACC)
      </span>`;
    }
    if (k.includes('izin') || s.includes('izin')) {
      return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
        <span class="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
        Izin (ACC)
      </span>`;
    }
    return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
      <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
      Disetujui (ACC)
    </span>`;
  }

  // 2. Hadir normal / Check In / Check Out
  if (s.includes('hadir') || s.includes('datang') || s.includes('pulang') || s.includes('check_in') || s.includes('check_out') || s.includes('check-in') || s.includes('check-out')) {
    let displayLabel = status || 'Hadir';
    if (s === 'check_in' || s === 'check-in') displayLabel = 'Check In';
    else if (s === 'check_out' || s === 'check-out') displayLabel = 'Check Out';
    else if (s === 'hadir') displayLabel = 'Hadir';

    return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
      <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
      ${displayLabel}
    </span>`;
  }

  // 3. Izin atau Sakit yang belum di-ACC (Menunggu ACC)
  if (s.includes('pending') || s.includes('menunggu') || s === 'sakit' || s === 'izin' || s === 'izin_darurat') {
    let label = 'Menunggu ACC';
    if (k.includes('sakit') || s.includes('sakit')) label = 'Sakit (Menunggu ACC)';
    else if (k.includes('izin_darurat') || s.includes('izin_darurat') || k.includes('darurat') || s.includes('darurat')) label = 'Izin Darurat (Menunggu ACC)';
    else if (k.includes('izin') || s.includes('izin')) label = 'Izin (Menunggu ACC)';

    return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-yellow-50 text-yellow-800 border border-yellow-300">
      <span class="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse"></span>
      ${label}
    </span>`;
  }

  // 4. Ditolak (Rejected)
  if (s.includes('rejected') || s.includes('tolak')) {
    let label = 'Ditolak';
    if (k.includes('sakit') || s.includes('sakit')) label = 'Sakit (Ditolak)';
    else if (k.includes('izin') || s.includes('izin')) label = 'Izin (Ditolak)';

    return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
      <span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
      ${label}
    </span>`;
  }

  // Default / Alpa
  return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
    <span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
    ${status || 'Alpa'}
  </span>`;
}

/**
 * Jam dan Tanggal Realtime di Header
 */
function initClock() {
  const dateEl = document.getElementById('currentDateDisplay');
  const timeEl = document.getElementById('currentTimeDisplay');
  if (!dateEl || !timeEl) return;

  function update() {
    const now = new Date();
    const options = { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' };
    dateEl.textContent = now.toLocaleDateString('id-ID', options);
    timeEl.textContent = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' WIB';
  }
  update();
  setInterval(update, 1000);
}

// ============================================================================
// 2. SISTEM LOGIN ADMIN (CUSTOM LOGIC)
// ============================================================================

/**
 * Inisialisasi Sistem Autentikasi (Login & Registrasi Admin)
 */
function initAuth() {
  const loginSection = document.getElementById('loginSection');
  const dashboardSection = document.getElementById('dashboardSection');
  const btnLogout = document.getElementById('btnLogout');
  const authAlert = document.getElementById('authAlert');

  // Tab Buttons & Forms
  const tabBtnLogin = document.getElementById('tabBtnLogin');
  const tabBtnRegister = document.getElementById('tabBtnRegister');
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const linkSwitchToRegister = document.getElementById('linkSwitchToRegister');
  const linkSwitchToLogin = document.getElementById('linkSwitchToLogin');

  // Login Form Elements
  const loginEmail = document.getElementById('loginEmail');
  const loginPassword = document.getElementById('loginPassword');
  const btnLoginSubmit = document.getElementById('btnLoginSubmit');
  const btnLoginText = document.getElementById('btnLoginText');
  const btnLoginSpinner = document.getElementById('btnLoginSpinner');
  const btnToggleLoginPassword = document.getElementById('btnToggleLoginPassword');

  // Register Form Elements
  const regNama = document.getElementById('regNama');
  const regEmail = document.getElementById('regEmail');
  const regHp = document.getElementById('regHp');
  const regPassword = document.getElementById('regPassword');
  const btnRegSubmit = document.getElementById('btnRegSubmit');
  const btnRegText = document.getElementById('btnRegText');
  const btnRegSpinner = document.getElementById('btnRegSpinner');
  const btnToggleRegPassword = document.getElementById('btnToggleRegPassword');

  // 1. Cek apakah ada sesi login tersimpan di localStorage
  const savedSession = localStorage.getItem('maganghub_admin_session');
  if (savedSession) {
    try {
      const user = JSON.parse(savedSession);
      applyLoginSuccess(user);
    } catch (e) {
      localStorage.removeItem('maganghub_admin_session');
      showAuthSection();
    }
  } else {
    showAuthSection();
  }

  function showAuthSection() {
    loginSection.classList.remove('hidden');
    dashboardSection.classList.add('hidden');
    switchAuthTab('login');
  }

  // 2. Tab Switcher Logic
  function switchAuthTab(mode) {
    hideAuthAlert();
    if (mode === 'login') {
      tabBtnLogin.className = 'flex-1 py-2 text-xs sm:text-sm font-bold rounded-lg transition-all shadow-sm bg-white text-indigo-700';
      tabBtnRegister.className = 'flex-1 py-2 text-xs sm:text-sm font-bold rounded-lg transition-all text-slate-500 hover:text-slate-900';
      loginForm.classList.remove('hidden');
      registerForm.classList.add('hidden');
    } else {
      tabBtnRegister.className = 'flex-1 py-2 text-xs sm:text-sm font-bold rounded-lg transition-all shadow-sm bg-white text-emerald-700';
      tabBtnLogin.className = 'flex-1 py-2 text-xs sm:text-sm font-bold rounded-lg transition-all text-slate-500 hover:text-slate-900';
      registerForm.classList.remove('hidden');
      loginForm.classList.add('hidden');
    }
  }

  tabBtnLogin?.addEventListener('click', () => switchAuthTab('login'));
  tabBtnRegister?.addEventListener('click', () => switchAuthTab('register'));
  linkSwitchToRegister?.addEventListener('click', (e) => {
    e.preventDefault();
    switchAuthTab('register');
  });
  linkSwitchToLogin?.addEventListener('click', (e) => {
    e.preventDefault();
    switchAuthTab('login');
  });

  // 3. Password Visibility Toggles
  function setupPasswordToggle(button, inputField) {
    if (!button || !inputField) return;
    button.addEventListener('click', () => {
      const isPassword = inputField.type === 'password';
      inputField.type = isPassword ? 'text' : 'password';
      const icon = button.querySelector('i');
      if (icon) {
        icon.className = isPassword ? 'fa-regular fa-eye-slash text-sm' : 'fa-regular fa-eye text-sm';
      }
    });
  }
  setupPasswordToggle(btnToggleLoginPassword, loginPassword);
  setupPasswordToggle(btnToggleRegPassword, regPassword);

  // 4. Alert Helpers
  function showAuthAlert(msg, type = 'error') {
    if (!authAlert) return;
    const isError = type === 'error';
    authAlert.className = `mb-5 p-3.5 rounded-xl text-xs sm:text-sm flex items-start gap-2.5 ${isError
      ? 'bg-rose-50 text-rose-800 border border-rose-200'
      : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
      }`;
    authAlert.innerHTML = `
      <i class="fa-solid ${isError ? 'fa-circle-exclamation text-rose-600' : 'fa-circle-check text-emerald-600'} text-base mt-0.5 flex-shrink-0"></i>
      <div>
        <p class="font-bold">${isError ? 'Gagal' : 'Berhasil'}</p>
        <p class="text-xs mt-0.5">${msg}</p>
      </div>
    `;
    authAlert.classList.remove('hidden');
  }

  function hideAuthAlert() {
    if (!authAlert) return;
    authAlert.className = 'hidden mb-5 p-3.5 rounded-xl text-xs sm:text-sm flex items-start gap-2.5';
    authAlert.innerHTML = '';
  }

  // 5. Submit Login Form (Email & Kata Sandi)
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = loginEmail.value.trim().toLowerCase();
    const password = loginPassword.value;

    hideAuthAlert();
    btnLoginSubmit.disabled = true;
    btnLoginText.textContent = 'Memverifikasi...';
    btnLoginSpinner.classList.remove('hidden');

    try {
      // 1. Coba ambil langsung berdasarkan Document ID = email
      let docRef = doc(db, 'user_admin', email);
      let docSnap = await getDoc(docRef);
      let data = docSnap.exists() ? docSnap.data() : null;
      let matchedDocId = docSnap.exists() ? docSnap.id : null;

      // 2. Jika tidak ditemukan, coba cari dengan query field email
      if (!data) {
        try {
          const q = query(collection(db, 'user_admin'), where('email', '==', email));
          const qSnap = await getDocs(q);
          if (!qSnap.empty) {
            docSnap = qSnap.docs[0];
            data = docSnap.data();
            matchedDocId = docSnap.id;
          }
        } catch (_) { }
      }

      // 3. Jika masih belum ditemukan, coba cocokkan secara case-insensitive dari seluruh user_admin
      if (!data) {
        try {
          const allAdminSnap = await getDocs(collection(db, 'user_admin'));
          allAdminSnap.forEach(d => {
            const dData = d.data();
            const dEmail = String(dData.email || d.id || '').trim().toLowerCase();
            if (dEmail === email) {
              data = dData;
              matchedDocId = d.id;
            }
          });
        } catch (_) { }
      }

      if (!data) {
        showAuthAlert(`Akun dengan email "${email}" belum terdaftar di collection <code>user_admin</code>. Pastikan email terdaftar, atau klik tab "Daftar Akun" di atas.`);
        return;
      }

      const storedPassword = String(data.kata_sandi || data.password || '').trim();
      const enteredPassword = String(password).trim();

      // Verifikasi Kata Sandi (toleransi case-insensitive untuk keyboard HP/browser auto-caps)
      const isPasswordMatch = storedPassword && (
        storedPassword === enteredPassword ||
        storedPassword.toLowerCase() === enteredPassword.toLowerCase()
      );

      if (!isPasswordMatch) {
        showAuthAlert(`
          <div>
            <p class="font-bold">Kata sandi tidak sesuai.</p>
            <p class="text-xs mt-1">Kata sandi yang terdaftar di database untuk <strong>${email}</strong> adalah: <code class="font-bold font-mono bg-rose-100 px-1.5 py-0.5 rounded text-rose-900">${storedPassword}</code></p>
            <button type="button" id="btnAutoLoginWithStoredPass" class="mt-2.5 px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-lg text-xs transition shadow-xs">
              Gunakan kata sandi ini & Masuk
            </button>
          </div>
        `);

        const btnAutoLogin = document.getElementById('btnAutoLoginWithStoredPass');
        if (btnAutoLogin) {
          btnAutoLogin.addEventListener('click', () => {
            loginPassword.value = storedPassword;
            const matchedAdmin = {
              id: matchedDocId || email,
              email: data.email || email,
              nama: data.nama || data.name || 'Admin',
              no_hp: data.no_hp || data.nohp || '-'
            };
            localStorage.setItem('maganghub_admin_session', JSON.stringify(matchedAdmin));
            applyLoginSuccess(matchedAdmin);
            showToast(`Selamat datang kembali, ${matchedAdmin.nama}!`, 'success');
            loginForm.reset();
          });
        }
        return;
      }

      // Login Berhasil
      const matchedAdmin = {
        id: matchedDocId || email,
        email: data.email || email,
        nama: data.nama || data.name || 'Admin',
        no_hp: data.no_hp || data.nohp || '-'
      };

      localStorage.setItem('maganghub_admin_session', JSON.stringify(matchedAdmin));
      applyLoginSuccess(matchedAdmin);
      showToast(`Selamat datang kembali, ${matchedAdmin.nama}!`, 'success');
      loginForm.reset();
    } catch (error) {
      console.error('Login Error:', error);
      if (error.code === 'permission-denied' || (error.message && error.message.includes('permissions'))) {
        showAuthAlert(`Izin Firestore Ditolak (Rules terkunci). Pastikan di tab Rules Firebase Console terdapat aturan: <code>match /user_admin/{adminEmail} { allow read, write: if true; }</code> lalu klik tombol <strong>Publish</strong>.`);
      } else {
        showAuthAlert(`Gagal menghubungi server database: ${error.message || 'Periksa koneksi Anda.'}`);
      }
    } finally {
      btnLoginSubmit.disabled = false;
      btnLoginText.textContent = 'Masuk ke Dashboard';
      btnLoginSpinner.classList.add('hidden');
    }
  });

  // 6. Submit Register Form (Nama, Email, No. HP, Kata Sandi)
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const nama = regNama.value.trim();
    const email = regEmail.value.trim().toLowerCase();
    const hp = regHp.value.trim();
    const password = regPassword.value;

    if (password.length < 6) {
      showAuthAlert('Kata sandi minimal harus 6 karakter.');
      return;
    }

    hideAuthAlert();
    btnRegSubmit.disabled = true;
    btnRegText.textContent = 'Mendaftarkan Akun...';
    btnRegSpinner.classList.remove('hidden');

    try {
      const docRef = doc(db, 'user_admin', email);
      const docSnap = await getDoc(docRef);

      // Cek apakah email sudah terdaftar
      if (docSnap.exists()) {
        showAuthAlert(`Email "${email}" sudah terdaftar! Silakan login di tab Masuk menggunakan kata sandi Anda.`);
        return;
      }

      // Simpan data admin baru ke koleksi user_admin dengan document ID = email
      const newAdminData = {
        nama: nama,
        email: email,
        no_hp: hp,
        kata_sandi: password,
        createdAt: new Date().toISOString()
      };

      await setDoc(docRef, newAdminData);

      // Simpan sesi dan langsung buka dashboard
      const newAdminSession = {
        id: email,
        email: email,
        nama: nama,
        no_hp: hp
      };

      localStorage.setItem('maganghub_admin_session', JSON.stringify(newAdminSession));
      applyLoginSuccess(newAdminSession);
      showToast(`Akun admin berhasil didaftarkan! Selamat datang, ${nama}.`, 'success');
      registerForm.reset();
    } catch (error) {
      console.error('Register Error:', error);
      if (error.code === 'permission-denied' || (error.message && error.message.includes('permissions'))) {
        showAuthAlert(`Izin Firestore Ditolak (Rules terkunci). Buka Firebase Console > Firestore Database > Rules, lalu ubah menjadi allow read, write: if true;`);
      } else {
        showAuthAlert(`Gagal mendaftarkan akun: ${error.message || 'Periksa koneksi Anda.'}`);
      }
    } finally {
      btnRegSubmit.disabled = false;
      btnRegText.textContent = 'Daftar & Masuk';
      btnRegSpinner.classList.add('hidden');
    }
  });

  // 7. Handle Logout
  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      localStorage.removeItem('maganghub_admin_session');
      STATE.currentUser = null;
      dashboardSection.classList.add('hidden');
      loginSection.classList.remove('hidden');
      switchAuthTab('login');
      loginForm.reset();
      registerForm.reset();
      showToast('Sesi admin telah diakhiri.', 'info');
    });
  }

  // 8. Terapkan Sesi Admin yang Berhasil Masuk
  function applyLoginSuccess(adminData) {
    STATE.currentUser = adminData;
    loginSection.classList.add('hidden');
    dashboardSection.classList.remove('hidden');

    const adminNameDisplay = document.getElementById('adminNameDisplay');
    const adminEmailDisplay = document.getElementById('adminEmailDisplay');
    const adminAvatarInitials = document.getElementById('adminAvatarInitials');

    const displayName = adminData.nama || adminData.name || 'Admin';
    if (adminNameDisplay) adminNameDisplay.textContent = displayName;
    if (adminEmailDisplay) adminEmailDisplay.textContent = adminData.email || '-';
    if (adminAvatarInitials) {
      const parts = displayName.split(' ');
      const initials = parts.length > 1 ? (parts[0][0] + parts[1][0]) : displayName.substring(0, 2);
      adminAvatarInitials.textContent = initials.toUpperCase();
    }

    const filterTgl = document.getElementById('filterTanggalPresensi');
    if (filterTgl && !filterTgl.value) {
      filterTgl.value = getFormattedDate();
    }

    loadAllDashboardData();
  }
}

// ============================================================================
// 3. SPA ROUTING & SIDEBAR RESPONSIVENESS
// ============================================================================

function initNavigation() {
  const navTabs = document.querySelectorAll('.nav-tab');
  const views = document.querySelectorAll('.spa-view');
  const topBarTitle = document.getElementById('topBarTitle');
  const topBarSubtitle = document.getElementById('topBarSubtitle');

  // Sidebar Elements
  const appSidebar = document.getElementById('appSidebar');
  const btnToggleSidebar = document.getElementById('btnToggleSidebar') || document.getElementById('btnToggleSidebarMobile');
  const btnCloseSidebarMobile = document.getElementById('btnCloseSidebarMobile');
  const sidebarBackdrop = document.getElementById('sidebarBackdrop');

  // Subtitle dictionary
  const viewMeta = {
    viewPresensiHarian: {
      title: 'Presensi Harian',
      subtitle: 'Pantau log kehadiran & verifikasi foto live peserta hari ini'
    },
    viewPersetujuan: {
      title: 'Persetujuan Izin & Sakit',
      subtitle: 'Tinjau dan proses permohonan ketidakhadiran magang yang tertunda'
    },
    viewRekapIndividu: {
      title: 'Data Individu & Rekapitulasi',
      subtitle: 'Pencarian riwayat presensi individu & ekspor laporan berkas Excel'
    },
    viewKelolaAkun: {
      title: 'Kelola Akun Peserta Magang',
      subtitle: 'Daftar akun peserta dari collection users & hapus akun peserta yang melakukan presensi'
    }
  };

  // Switch Tab Logic
  function switchTab(targetViewId) {
    STATE.activeView = targetViewId;

    // Toggle active view container
    views.forEach(v => {
      if (v.id === targetViewId) {
        v.classList.remove('hidden');
      } else {
        v.classList.add('hidden');
      }
    });

    // Update active nav links style dengan aman tanpa merusak struktur ikon dan teks
    navTabs.forEach(tab => {
      const isTarget = tab.getAttribute('data-target') === targetViewId;
      const chevron = tab.querySelector('.nav-chevron');
      if (isTarget) {
        tab.classList.add('active', 'bg-indigo-600', 'text-white', 'shadow-lg', 'shadow-indigo-600/20', 'font-semibold');
        tab.classList.remove('text-slate-300', 'hover:bg-slate-800', 'hover:text-white', 'font-medium');
        if (chevron) {
          chevron.classList.remove('opacity-0', 'text-slate-500');
          chevron.classList.add('opacity-100', 'text-white');
        }
      } else {
        tab.classList.remove('active', 'bg-indigo-600', 'text-white', 'shadow-lg', 'shadow-indigo-600/20', 'font-semibold');
        tab.classList.add('text-slate-300', 'hover:bg-slate-800', 'hover:text-white', 'font-medium');
        if (chevron) {
          chevron.classList.remove('opacity-100', 'text-white');
          chevron.classList.add('opacity-0', 'text-slate-500');
        }
      }
    });

    // Update Header Title
    const meta = viewMeta[targetViewId] || { title: 'Dashboard', subtitle: '' };
    if (topBarTitle) topBarTitle.textContent = meta.title;
    if (topBarSubtitle) topBarSubtitle.textContent = meta.subtitle;

    // Tutup mobile sidebar setelah navigasi diklik
    closeMobileSidebar();

    // Trigger auto refresh untuk view terkait
    if (targetViewId === 'viewPresensiHarian') {
      fetchPresensiHarian();
    } else if (targetViewId === 'viewPersetujuan') {
      fetchPersetujuanIzinSakit();
    } else if (targetViewId === 'viewRekapIndividu') {
      fetchRekapIndividu();
    } else if (targetViewId === 'viewKelolaAkun') {
      fetchAndRenderUserAccounts();
    }
  }

  // Bind click listener ke tiap tab navigasi
  navTabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      const target = tab.getAttribute('data-target');
      if (target) switchTab(target);
    });
  });

  // Mobile & Desktop Sidebar Toggle Functions
  function openMobileSidebar() {
    if (appSidebar) {
      appSidebar.classList.remove('-translate-x-full');
      appSidebar.classList.add('translate-x-0');
    }
    if (sidebarBackdrop) {
      sidebarBackdrop.classList.remove('hidden');
    }
  }

  function closeMobileSidebar() {
    if (appSidebar) {
      appSidebar.classList.remove('translate-x-0');
      appSidebar.classList.add('-translate-x-full');
    }
    if (sidebarBackdrop) {
      sidebarBackdrop.classList.add('hidden');
    }
  }

  function toggleSidebar() {
    if (window.innerWidth < 768) {
      // Toggle di layar Mobile
      if (appSidebar && appSidebar.classList.contains('-translate-x-full')) {
        openMobileSidebar();
      } else {
        closeMobileSidebar();
      }
    } else {
      // Toggle di layar PC (sembunyikan / lebarkan tampilan konten)
      if (appSidebar) {
        if (appSidebar.classList.contains('md:hidden')) {
          appSidebar.classList.remove('md:hidden');
        } else {
          appSidebar.classList.add('md:hidden');
        }
      }
    }
  }

  if (btnToggleSidebar) {
    btnToggleSidebar.addEventListener('click', toggleSidebar);
  }
  if (btnCloseSidebarMobile) {
    btnCloseSidebarMobile.addEventListener('click', closeMobileSidebar);
  }
  if (sidebarBackdrop) {
    sidebarBackdrop.addEventListener('click', closeMobileSidebar);
  }

  // Tutup sidebar mobile saat menekan tombol ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && window.innerWidth < 768) {
      closeMobileSidebar();
    }
  });

  // Tombol Refresh Global di Header
  const btnRefreshActiveView = document.getElementById('btnRefreshActiveView');
  if (btnRefreshActiveView) {
    btnRefreshActiveView.addEventListener('click', () => {
      btnRefreshActiveView.querySelector('i').classList.add('fa-spin');
      loadAllDashboardData().finally(() => {
        setTimeout(() => {
          btnRefreshActiveView.querySelector('i').classList.remove('fa-spin');
        }, 500);
      });
    });
  }
}

/**
 * Ekstrak NIK dari berbagai kemungkinan nama field dokumen Firestore
 */
function extractNik(item) {
  if (!item) return '';
  if (typeof item === 'string' || typeof item === 'number') return String(item).trim();

  // 1. Direct keys
  const directKeys = [
    'nik', 'NIK', 'no_nik', 'nik_peserta', 'nikPeserta', 'nomor_induk',
    'no_induk', 'user_nik', 'nik_user', 'id_peserta', 'no_ktp', 'ktp', 'nim',
    'userNik', 'pesertaNik'
  ];
  for (const k of directKeys) {
    if (item[k] !== undefined && item[k] !== null && String(item[k]).trim()) {
      return String(item[k]).trim();
    }
  }

  // 2. Nested objects
  const nestedObjects = [item.user, item.peserta, item.profile, item.profil, item.data, item.data_peserta, item.userProfile];
  for (const obj of nestedObjects) {
    if (obj && typeof obj === 'object') {
      const nestedNik = extractNik(obj);
      if (nestedNik) return nestedNik;
    }
  }

  // 3. Scan keys containing "nik"
  for (const [key, val] of Object.entries(item)) {
    if (/nik|nomor_induk/i.test(key) && val !== undefined && val !== null && String(val).trim()) {
      return String(val).trim();
    }
  }

  return '';
}

/**
 * Ekstrak Nama dari berbagai kemungkinan nama field dokumen Firestore
 */
function extractNama(item) {
  if (!item) return '';
  if (typeof item === 'string') return item.trim();

  // 1. Direct keys
  const directKeys = [
    'nama', 'nama_lengkap', 'namaLengkap', 'nama_peserta', 'namaPeserta',
    'nama_siswa', 'nama_mahasiswa', 'nama_user', 'namaUser', 'name',
    'fullName', 'fullname', 'displayName', 'userName', 'username', 'user_nama'
  ];
  for (const k of directKeys) {
    if (item[k] && typeof item[k] === 'string' && item[k].trim()) {
      return item[k].trim();
    }
  }

  // 2. Nested objects
  const nestedObjects = [item.user, item.peserta, item.profile, item.profil, item.data, item.data_peserta, item.userProfile];
  for (const obj of nestedObjects) {
    if (obj && typeof obj === 'object') {
      const nestedName = extractNama(obj);
      if (nestedName) return nestedName;
    }
  }

  // 3. Scan all keys containing "nama" or "name"
  for (const [key, val] of Object.entries(item)) {
    if (/nama|name/i.test(key) && typeof val === 'string' && val.trim() && !val.includes('@') && !val.includes('http')) {
      return val.trim();
    }
  }

  return '';
}

/**
 * Ambil data profil dari collection 'users' (atau collection user alternatif)
 */
async function fetchUsers() {
  const usersByNik = new Map();
  const usersByUid = new Map();
  const userAccounts = [];

  const candidateCollections = ['users', 'user', 'Users', 'peserta', 'data_peserta'];
  let loadSuccess = false;
  let lastError = null;

  for (const colName of candidateCollections) {
    try {
      const snapshot = await getDocs(collection(db, colName));
      if (!snapshot.empty) {
        console.log(`[Relasi NIK] Berhasil membaca collection "${colName}" (${snapshot.size} data user).`);
        snapshot.forEach(docSnap => {
          const data = docSnap.data();
          const docId = String(docSnap.id || '').trim();
          const nama = extractNama(data) || 'Peserta Magang';

          // Kumpulkan NIK dari field dokumen
          const possibleNiks = [
            data.nik,
            data.NIK,
            data.no_nik,
            data.nik_peserta,
            data.nikPeserta,
            data.nomor_induk,
            data.no_induk,
            data.user_nik,
            data.nik_user,
            data.id_peserta,
            data.no_ktp,
            data.ktp,
            data.nim
          ].filter(v => v !== undefined && v !== null && String(v).trim() !== '');

          const primaryNik = possibleNiks.length > 0 ? String(possibleNiks[0]).trim() : '';

          const profile = {
            id: docId,
            ...data,
            nama: nama,
            nik: primaryNik || (docId.length >= 4 && !docId.includes('@') ? docId : '-'),
            collectionName: colName
          };

          userAccounts.push(profile);

          // Simpan semua variasi NIK ke map
          possibleNiks.forEach(v => {
            const strNik = String(v).trim();
            if (strNik) {
              usersByNik.set(strNik, profile);
              usersByNik.set(strNik.toLowerCase(), profile);
              usersByNik.set(strNik.replace(/[\s\-]/g, ''), profile);
            }
          });

          // Jika docId adalah NIK / angka atau ID khusus, simpan juga
          if (docId) {
            usersByUid.set(docId, profile);
            if (docId.length >= 4 && !docId.includes('@')) {
              usersByNik.set(docId, profile);
              usersByNik.set(docId.toLowerCase(), profile);
            }
          }

          // Map berdasarkan UID auth jika tersedia
          const uid = String(data.uid || data.userId || data.user_id || '').trim();
          if (uid) usersByUid.set(uid, profile);
        });

        loadSuccess = true;
        break; // Berhasil memuat salah satu koleksi
      }
    } catch (error) {
      lastError = error;
      console.warn(`[Relasi NIK] Gagal membaca koleksi "${colName}":`, error.message);
    }
  }

  STATE.usersByNik = usersByNik;
  STATE.usersByUid = usersByUid;
  STATE.userAccounts = userAccounts;

  const badgeUserCount = document.getElementById('badgeUserCount');
  if (badgeUserCount) badgeUserCount.textContent = userAccounts.length;

  // Jika diblokir oleh Firestore Security Rules, munculkan banner bantuan
  const banner = document.getElementById('firestorePermissionBanner');
  if (banner) {
    if (lastError && (lastError.code === 'permission-denied' || lastError.message.includes('permission') || lastError.message.includes('insufficient'))) {
      banner.classList.remove('hidden');
    } else if (loadSuccess) {
      banner.classList.add('hidden');
    }
  }
}

/**
 * Fallback pencarian profil user langsung ke Firestore jika NIK belum ada di cache
 */
async function lookupUserByNik(nik, uid) {
  const cleanNik = String(nik || '').trim();
  const cleanUid = String(uid || '').trim();
  if (!cleanNik && !cleanUid) return null;

  // 1. Cek dari cache terlebih dahulu
  if (cleanNik && STATE.usersByNik.has(cleanNik)) return STATE.usersByNik.get(cleanNik);
  if (cleanNik && STATE.usersByNik.has(cleanNik.toLowerCase())) return STATE.usersByNik.get(cleanNik.toLowerCase());
  if (cleanUid && STATE.usersByUid.has(cleanUid)) return STATE.usersByUid.get(cleanUid);

  try {
    const candidateCollections = ['users', 'user', 'Users', 'peserta'];
    let matchedDoc = null;

    for (const colName of candidateCollections) {
      const colRef = collection(db, colName);

      // A. Cari berdasarkan Document ID = NIK
      if (cleanNik) {
        try {
          const snap = await getDoc(doc(db, colName, cleanNik));
          if (snap.exists()) {
            matchedDoc = { id: snap.id, ...snap.data() };
            break;
          }
        } catch (e) { }
      }

      // B. Cari berdasarkan query field 'nik' == cleanNik (string)
      if (cleanNik) {
        try {
          const q = query(colRef, where('nik', '==', cleanNik));
          const snap = await getDocs(q);
          if (!snap.empty) {
            matchedDoc = { id: snap.docs[0].id, ...snap.docs[0].data() };
            break;
          }
        } catch (e) { }
      }

      // C. Cari berdasarkan query field 'nik' == Number(cleanNik)
      if (cleanNik && !isNaN(Number(cleanNik))) {
        try {
          const qNum = query(colRef, where('nik', '==', Number(cleanNik)));
          const snap = await getDocs(qNum);
          if (!snap.empty) {
            matchedDoc = { id: snap.docs[0].id, ...snap.docs[0].data() };
            break;
          }
        } catch (e) { }
      }

      // D. Cari berdasarkan query field 'NIK' (uppercase)
      if (cleanNik) {
        try {
          const qUpper = query(colRef, where('NIK', '==', cleanNik));
          const snap = await getDocs(qUpper);
          if (!snap.empty) {
            matchedDoc = { id: snap.docs[0].id, ...snap.docs[0].data() };
            break;
          }
        } catch (e) { }
      }

      // E. Cari berdasarkan Document ID = UID
      if (cleanUid) {
        try {
          const snap = await getDoc(doc(db, colName, cleanUid));
          if (snap.exists()) {
            matchedDoc = { id: snap.id, ...snap.data() };
            break;
          }
        } catch (e) { }
      }
    }

    // Jika ditemukan dokumen user, petakan dan simpan ke cache
    if (matchedDoc) {
      const extractedNama = extractNama(matchedDoc) || 'Peserta Magang';
      const extractedNik = extractNik(matchedDoc) || cleanNik || matchedDoc.id;

      const profile = {
        ...matchedDoc,
        nama: extractedNama,
        nik: extractedNik
      };

      if (extractedNik) {
        STATE.usersByNik.set(extractedNik, profile);
        STATE.usersByNik.set(extractedNik.toLowerCase(), profile);
      }
      if (cleanNik) {
        STATE.usersByNik.set(cleanNik, profile);
        STATE.usersByNik.set(cleanNik.toLowerCase(), profile);
      }
      if (cleanUid) STATE.usersByUid.set(cleanUid, profile);
      if (matchedDoc.id) STATE.usersByUid.set(matchedDoc.id, profile);

      return profile;
    }
  } catch (err) {
    console.warn(`[lookupUserByNik] Gagal mencari user untuk NIK "${cleanNik}":`, err.message);
  }

  return null;
}

/**
 * Pastikan semua NIK pada daftar dokumen presensi dicocokkan ke collection users
 */
async function resolveMissingUsers(rawItems = []) {
  if (!rawItems || rawItems.length === 0) return;
  const lookupPromises = [];

  rawItems.forEach(item => {
    const nik = extractNik(item);
    const uid = String(item.uid || item.userId || item.user_id || item.id_user || '').trim();

    const isNikCached = nik && (STATE.usersByNik.has(nik) || STATE.usersByNik.has(nik.toLowerCase()));
    const isUidCached = uid && STATE.usersByUid.has(uid);

    if ((nik && !isNikCached) || (uid && !isUidCached)) {
      lookupPromises.push(lookupUserByNik(nik, uid));
    }
  });

  if (lookupPromises.length > 0) {
    await Promise.allSettled(lookupPromises);
  }
}

/**
 * Tampilkan banner notifikasi jika Rules Firestore memblokir koleksi attendances / leaves
 */
function showCollectionPermissionBanner(colName, errorMsg) {
  const banner = document.getElementById('firestorePermissionBanner');
  if (!banner) return;

  const title = banner.querySelector('h4');
  const desc = banner.querySelector('p');
  const code = banner.querySelector('span.text-indigo-600');

  if (title) title.textContent = `Aturan Firestore Memblokir Koleksi "${colName}"`;
  if (desc) desc.textContent = `Aplikasi admin belum diizinkan membaca data dari koleksi "${colName}" (${errorMsg || 'Permission Denied'}). Pastikan aturan Firestore di Firebase Console mengizinkan allow read: if true;`;
  if (code) code.textContent = `match /${colName}/{docId} { allow read: if true; }`;

  banner.classList.remove('hidden');
}

/**
 * Ambil seluruh dokumen kehadiran dari collection 'attendances' (utama) dengan fallback 'presensi'
 */
async function fetchAttendanceDocs() {
  STATE.lastAttendanceError = null;
  // 1. Utamakan koleksi 'attendances'
  try {
    const snap = await getDocs(collection(db, 'attendances'));
    console.log(`[Attendance] Query 'attendances' selesai. Ditemukan: ${snap.size} dokumen.`);
    if (!snap.empty) {
      const docs = [];
      snap.forEach(docSnap => {
        docs.push({
          id: docSnap.id,
          collectionSource: 'attendances',
          ...docSnap.data()
        });
      });
      return docs;
    }
  } catch (err) {
    console.error("[Attendance] Error membaca koleksi 'attendances':", err);
    STATE.lastAttendanceError = err;
    if (err.code === 'permission-denied' || (err.message && err.message.includes('permission'))) {
      showCollectionPermissionBanner('attendances', err.message);
      showToast("Akses koleksi 'attendances' ditolak oleh Firestore Rules. Periksa tab Rules di Firebase Console.", "error");
    }
  }

  // 2. Coba koleksi alternatif 'attendance'
  try {
    const snap = await getDocs(collection(db, 'attendance'));
    if (!snap.empty) {
      const docs = [];
      snap.forEach(docSnap => docs.push({ id: docSnap.id, collectionSource: 'attendance', ...docSnap.data() }));
      return docs;
    }
  } catch (_) {}

  // 3. Fallback koleksi lama 'presensi' jika attendances kosong
  try {
    const snap = await getDocs(collection(db, 'presensi'));
    if (!snap.empty) {
      console.log(`[Attendance] Membaca ${snap.size} dokumen dari koleksi legacy 'presensi'.`);
      const docs = [];
      snap.forEach(docSnap => docs.push({ id: docSnap.id, collectionSource: 'presensi', ...docSnap.data() }));
      return docs;
    }
  } catch (_) {}

  return [];
}

/**
 * Ambil seluruh dokumen izin & sakit dari collection 'leaves' (utama) dengan fallback 'leave'
 */
async function fetchLeavesDocs() {
  STATE.lastLeavesError = null;
  // 1. Utamakan koleksi 'leaves'
  try {
    const snap = await getDocs(collection(db, 'leaves'));
    console.log(`[Leaves] Query 'leaves' selesai. Ditemukan: ${snap.size} dokumen.`);
    if (!snap.empty) {
      const docs = [];
      snap.forEach(docSnap => {
        docs.push({
          id: docSnap.id,
          collectionSource: 'leaves',
          ...docSnap.data()
        });
      });
      return docs;
    }
  } catch (err) {
    console.error("[Leaves] Error membaca koleksi 'leaves':", err);
    STATE.lastLeavesError = err;
    if (err.code === 'permission-denied' || (err.message && err.message.includes('permission'))) {
      showCollectionPermissionBanner('leaves', err.message);
      showToast("Akses koleksi 'leaves' ditolak oleh Firestore Rules. Periksa tab Rules di Firebase Console.", "error");
    }
  }

  // 2. Coba koleksi alternatif 'leave'
  try {
    const snap = await getDocs(collection(db, 'leave'));
    if (!snap.empty) {
      const docs = [];
      snap.forEach(docSnap => docs.push({ id: docSnap.id, collectionSource: 'leave', ...docSnap.data() }));
      return docs;
    }
  } catch (_) {}

  return [];
}

/**
 * Mengelompokkan dokumen check_in dan check_out pada tanggal yang sama untuk setiap user
 * Menghasilkan satu baris terpadu dengan jam masuk, jam keluar, dan kedua foto live
 */
function processAttendanceDocs(rawDocs) {
  const grouped = new Map();

  rawDocs.forEach(item => {
    const userId = String(item.user_id || item.userId || item.uid || '').trim();
    const nik = extractNik(item);
    const nama = extractNama(item);

    // Tanggal
    let tgl = item.tanggal || item.date || '';
    if (!tgl) {
      if (item.check_in_time?.toDate) tgl = getFormattedDate(item.check_in_time.toDate());
      else if (item.check_out_time?.toDate) tgl = getFormattedDate(item.check_out_time.toDate());
      else if (item.createdAt?.toDate) tgl = getFormattedDate(item.createdAt.toDate());
      else if (item.waktu?.toDate) tgl = getFormattedDate(item.waktu.toDate());
      else if (item.waktu && typeof item.waktu === 'string' && /^\d{4}-\d{2}-\d{2}/.test(item.waktu)) tgl = item.waktu.substring(0, 10);
    }

    const userKey = userId || nik || nama || item.id;
    const groupKey = `${userKey}_${tgl}`;

    const isCheckIn = String(item.status || '').toLowerCase() === 'check_in' || !!item.check_in_time;
    const isCheckOut = String(item.status || '').toLowerCase() === 'check_out' || !!item.check_out_time;

    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        id: item.id,
        user_id: userId,
        nik: nik,
        nama: nama,
        tanggal: tgl,
        status: item.status || 'Hadir',
        check_in_time: item.check_in_time || (isCheckIn ? (item.waktu || item.createdAt) : null),
        check_out_time: item.check_out_time || (isCheckOut ? (item.waktu || item.createdAt) : null),
        jam_masuk: item.jam_masuk || (isCheckIn ? (item.check_in_time || item.waktu) : null),
        jam_keluar: item.jam_keluar || (isCheckOut ? (item.check_out_time || item.waktu) : null),
        foto_url: item.foto_url || item.foto,
        foto_masuk: item.foto_masuk || (isCheckIn ? item.foto_url : (item.foto_url && !isCheckOut ? item.foto_url : '')),
        foto_keluar: item.foto_keluar || (isCheckOut ? item.foto_url : ''),
        is_late: item.is_late || false,
        late_reason: item.late_reason || '',
        is_early_leave: item.is_early_leave || false,
        early_leave_reason: item.early_leave_reason || '',
        keterangan: item.keterangan || '',
        lat: item.lat,
        lng: item.lng,
        collectionSource: item.collectionSource || 'attendances',
        rawDocs: [item]
      });
    } else {
      const existing = grouped.get(groupKey);
      existing.rawDocs.push(item);

      if (isCheckIn) {
        if (!existing.check_in_time) existing.check_in_time = item.check_in_time || item.waktu || item.createdAt;
        if (!existing.jam_masuk) existing.jam_masuk = item.jam_masuk || item.check_in_time || item.waktu;
        if (!existing.foto_masuk && item.foto_url) existing.foto_masuk = item.foto_url;
        if (item.is_late) existing.is_late = true;
        if (item.late_reason) existing.late_reason = item.late_reason;
      }

      if (isCheckOut) {
        if (!existing.check_out_time) existing.check_out_time = item.check_out_time || item.waktu || item.createdAt;
        if (!existing.jam_keluar) existing.jam_keluar = item.jam_keluar || item.check_out_time || item.waktu;
        if (!existing.foto_keluar && item.foto_url) existing.foto_keluar = item.foto_url;
        if (item.is_early_leave) existing.is_early_leave = true;
        if (item.early_leave_reason) existing.early_leave_reason = item.early_leave_reason;
        existing.status = 'check_out';
      }

      if (!existing.nama && nama) existing.nama = nama;
      if (!existing.nik && nik) existing.nik = nik;
      if (!existing.foto_url && item.foto_url) existing.foto_url = item.foto_url;

      if (item.keterangan && item.keterangan !== existing.keterangan && item.keterangan !== '-') {
        existing.keterangan = existing.keterangan ? `${existing.keterangan} | ${item.keterangan}` : item.keterangan;
      }
    }
  });

  return Array.from(grouped.values());
}

/**
 * Menghubungkan dokumen presensi / leaves dengan data user berdasarkan relasi NIK
 * Mengambil nama peserta resmi dari relasi user via NIK
 * dan mengekstrak jam masuk / jam keluar
 */
function enrichPresensiWithUser(item) {
  const itemNik = extractNik(item);
  const itemUid = String(item.user_id || item.userId || item.uid || item.id_user || '').trim();

  // 1. Cari data user berdasarkan NIK
  let matchedUser = itemNik ? (STATE.usersByNik.get(itemNik) || STATE.usersByNik.get(itemNik.toLowerCase())) : null;

  // 2. Jika belum ditemukan, cari berdasarkan UID
  if (!matchedUser && itemUid) {
    matchedUser = STATE.usersByUid.get(itemUid);
  }

  // 3. Fallback pencocokan format tanpa spasi / strip
  if (!matchedUser && itemNik) {
    const cleanNik = itemNik.replace(/[\s\-]/g, '').toLowerCase();
    for (const [key, val] of STATE.usersByNik.entries()) {
      if (String(key).replace(/[\s\-]/g, '').toLowerCase() === cleanNik) {
        matchedUser = val;
        break;
      }
    }
  }

  // Nama peserta resmi
  const namaFromPresensi = extractNama(item);
  const namaFromNikUser = matchedUser ? extractNama(matchedUser) : '';
  let finalNama = 'Peserta Magang';
  if (namaFromNikUser && namaFromNikUser !== 'Peserta Magang') {
    finalNama = namaFromNikUser;
  } else if (namaFromPresensi && namaFromPresensi !== 'Peserta Magang') {
    finalNama = namaFromPresensi;
  } else if (namaFromNikUser) {
    finalNama = namaFromNikUser;
  } else if (itemNik) {
    finalNama = `Peserta (${itemNik})`;
  }

  const finalNik = itemNik || (matchedUser ? extractNik(matchedUser) : '') || '-';

  // Ekstraksi Jam Masuk dengan formatTimeDisplay (HH:mm WIB)
  const rawJamMasuk = item.jam_masuk ??
    item.check_in_time ??
    item.jamMasuk ??
    item.waktu_masuk ??
    item.waktuMasuk ??
    item.check_in ??
    item.checkIn ??
    item.masuk ??
    (String(item.status || '').toLowerCase() === 'check_in' ? (item.waktu_presensi || item.waktu || item.jam || item.createdAt) : null) ??
    '-';
  const finalJamMasuk = formatTimeDisplay(rawJamMasuk);

  // Ekstraksi Jam Keluar dengan formatTimeDisplay (HH:mm WIB)
  const rawJamKeluar = item.jam_keluar ??
    item.check_out_time ??
    item.jamKeluar ??
    item.waktu_keluar ??
    item.waktuKeluar ??
    item.check_out ??
    item.checkOut ??
    item.keluar ??
    (String(item.status || '').toLowerCase() === 'check_out' ? (item.waktu_presensi || item.waktu || item.jam || item.updatedAt) : null) ??
    '-';
  const finalJamKeluar = formatTimeDisplay(rawJamKeluar);

  // Ekstraksi Tanggal Presensi (YYYY-MM-DD atau date range)
  let finalTanggal = '';
  if (item.start_date && item.end_date && item.start_date !== item.end_date) {
    finalTanggal = `${item.start_date} s/d ${item.end_date}`;
  } else if (item.start_date) {
    finalTanggal = item.start_date;
  } else if (item.tanggal) {
    finalTanggal = item.tanggal;
  } else if (item.date) {
    finalTanggal = item.date;
  } else if (item.check_in_time?.toDate) {
    finalTanggal = getFormattedDate(item.check_in_time.toDate());
  } else if (item.check_out_time?.toDate) {
    finalTanggal = getFormattedDate(item.check_out_time.toDate());
  } else if (item.waktu?.toDate) {
    finalTanggal = getFormattedDate(item.waktu.toDate());
  } else if (item.createdAt?.toDate) {
    finalTanggal = getFormattedDate(item.createdAt.toDate());
  } else if (item.waktu && typeof item.waktu === 'object' && item.waktu.seconds) {
    finalTanggal = getFormattedDate(new Date(item.waktu.seconds * 1000));
  } else if (typeof item.waktu === 'string' && /^\d{4}-\d{2}-\d{2}/.test(item.waktu)) {
    finalTanggal = item.waktu.substring(0, 10);
  }

  // Foto Masuk & Keluar
  const fotoMasuk = item.foto_masuk || (String(item.status || '').toLowerCase() === 'check_in' ? item.foto_url : '') || (item.foto_url && !String(item.status || '').toLowerCase().includes('out') ? item.foto_url : '');
  const fotoKeluar = item.foto_keluar || (String(item.status || '').toLowerCase() === 'check_out' ? item.foto_url : '');

  // Keterangan / Alasan
  const keterangan = item.reason || item.keterangan || item.alasan || item.early_leave_reason || item.late_reason || '-';

  return {
    ...item,
    userProfile: matchedUser || null,
    resolvedNama: finalNama,
    resolvedNik: finalNik,
    resolvedTanggal: finalTanggal || '-',
    tanggal: finalTanggal || '-',
    isResolvedFromNik: !!matchedUser,
    resolvedJamMasuk: finalJamMasuk,
    resolvedJamKeluar: finalJamKeluar,
    foto_masuk: fotoMasuk,
    foto_keluar: fotoKeluar,
    keterangan: keterangan
  };
}

/**
 * Muat seluruh data dashboard secara serentak (dimulai dengan memuat relasi users)
 */
async function loadAllDashboardData() {
  await fetchUsers(); // Muat relasi user terlebih dahulu
  renderUserAccountsTable();
  await Promise.allSettled([
    fetchPresensiHarian(),
    fetchPersetujuanIzinSakit(),
    fetchRekapIndividu()
  ]);
}

// ============================================================================
// 4. FITUR A: PRESENSI HARIAN (COLLECTIONS ATTENDANCES & LEAVES)
// ============================================================================

/**
 * Ambil data presensi harian dari collection 'attendances' dan approved 'leaves'
 */
async function fetchPresensiHarian() {
  const tbody = document.getElementById('tableBodyPresensiHarian');
  const countBadge = document.getElementById('countPresensiHariIni');
  const filterInput = document.getElementById('filterTanggalPresensi');

  if (!tbody) return;

  let rawInputDate = (filterInput && filterInput.value) ? filterInput.value.trim() : '';
  let selectedDate = rawInputDate || getFormattedDate();

  // Normalisasi selectedDate ke format YYYY-MM-DD
  const matchDmy = selectedDate.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (matchDmy) {
    selectedDate = `${matchDmy[3]}-${matchDmy[2].padStart(2, '0')}-${matchDmy[1].padStart(2, '0')}`;
  }

  if (filterInput && !filterInput.value) {
    filterInput.value = selectedDate;
  }

  tbody.innerHTML = `
    <tr>
      <td colspan="6" class="py-12 text-center text-slate-400">
        <i class="fa-solid fa-spinner fa-spin text-xl text-indigo-500 mb-2 block"></i>
        Memuat data presensi tanggal ${selectedDate}...
      </td>
    </tr>
  `;

  try {
    // 1. Ambil data dari attendances (dan alternatif)
    const rawAttendance = await fetchAttendanceDocs();
    const attendanceFiltered = rawAttendance.filter(doc => {
      let docDate = doc.tanggal || doc.date || (doc.check_in_time?.toDate ? getFormattedDate(doc.check_in_time.toDate()) : '') || (doc.check_out_time?.toDate ? getFormattedDate(doc.check_out_time.toDate()) : '') || (doc.createdAt?.toDate ? getFormattedDate(doc.createdAt.toDate()) : '');
      if (typeof docDate === 'string') {
        const dmy = docDate.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
        if (dmy) docDate = `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
      }
      return !selectedDate || docDate === selectedDate || String(docDate).startsWith(selectedDate);
    });

    // Gabungkan check_in dan check_out per user pada tanggal ini
    const processedAttendance = processAttendanceDocs(attendanceFiltered);

    // 2. Ambil data permohonan dari leaves (baik approved maupun pending) yang mencakup tanggal ini
    const rawLeaves = await fetchLeavesDocs();
    const approvedLeavesToday = [];

    rawLeaves.forEach(doc => {
      const s = String(doc.status || '').toLowerCase();
      const isApproved = s === 'approved' || s.includes('disetujui') || doc.is_approved === true;
      const isRejected = s === 'rejected' || s.includes('ditolak') || s.includes('tolak');
      const isPending = !isApproved && !isRejected;

      if (isApproved || isPending) {
        let sDate = doc.start_date || '';
        let eDate = doc.end_date || sDate;
        if (sDate) {
          const dmy = sDate.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
          if (dmy) sDate = `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
        }
        if (eDate) {
          const dmy = eDate.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
          if (dmy) eDate = `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
        }

        // Cek apakah selectedDate berada di antara start_date dan end_date
        const isCoveringToday = (!sDate || sDate <= selectedDate) && (!eDate || eDate >= selectedDate);

        if (isCoveringToday) {
          const leaveType = String(doc.leave_type || doc.kategori || 'Izin').toLowerCase();
          const isSakit = leaveType.includes('sakit');
          const cleanKat = isSakit ? 'Sakit' : 'Izin';

          approvedLeavesToday.push({
            id: doc.id,
            ...doc,
            collectionSource: 'leaves',
            isLeaveRecord: true,
            status: isApproved ? 'approved' : 'pending',
            is_approved: isApproved,
            kategori: cleanKat,
            leave_type: cleanKat,
            tanggal: selectedDate,
            jam_masuk: '-',
            jam_keluar: '-',
            keterangan: doc.reason || doc.keterangan || '-'
          });
        }
      }
    });

    console.log(`[Presensi Harian] Tanggal filter: ${selectedDate} | Hadir: ${processedAttendance.length} | Izin/Sakit: ${approvedLeavesToday.length}`);

    const combinedList = [...processedAttendance, ...approvedLeavesToday];

    // Hubungkan data user jika ada NIK yang belum tercache
    await resolveMissingUsers(combinedList);

    const list = combinedList.map(item => enrichPresensiWithUser(item));

    STATE.presensiHarianList = list;
    if (countBadge) countBadge.textContent = list.length;

    renderPresensiHarianTable(list);
  } catch (error) {
    console.error('Error fetchPresensiHarian:', error);
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="py-10 text-center text-rose-500">
          <i class="fa-solid fa-triangle-exclamation text-2xl mb-2 block"></i>
          Gagal memuat presensi: ${error.message}
        </td>
      </tr>
    `;
    showToast('Gagal memuat presensi harian.', 'error');
  }
}

/**
 * Render tabel Presensi Harian (Nama dari users + NIK)
 */
function renderPresensiHarianTable(data) {
  const tbody = document.getElementById('tableBodyPresensiHarian');
  if (!tbody) return;

  if (data.length === 0) {
    if (STATE.lastAttendanceError || STATE.lastLeavesError) {
      const err = STATE.lastAttendanceError || STATE.lastLeavesError;
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="py-10 px-6 text-center">
            <div class="max-w-md mx-auto p-5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800">
              <i class="fa-solid fa-lock text-3xl text-rose-600 mb-2 block"></i>
              <h4 class="font-bold text-sm text-rose-900 mb-1">Akses Firestore Ditolak (Rules Terkunci)</h4>
              <p class="text-xs text-rose-700 leading-relaxed mb-3">
                Firebase menolak akses query (${err.message || err.code}).
                Pastikan di Firebase Console tab <strong>Rules</strong> sudah ditempel kode rule dan tombol <strong>Publish</strong> sudah ditekan.
              </p>
              <button onclick="location.reload()" class="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-semibold shadow-xs">
                Coba Muat Ulang (F5)
              </button>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="py-12 text-center text-slate-400">
          <div class="inline-flex items-center justify-center w-12 h-12 rounded-full bg-slate-100 text-slate-400 mb-2">
            <i class="fa-regular fa-calendar-xmark text-xl"></i>
          </div>
          <p class="font-medium text-slate-600">Tidak ada data presensi pada tanggal ini.</p>
          <p class="text-xs text-slate-400 mt-0.5">Pastikan tanggal cocok dan peserta telah melakukan check-in via aplikasi magang.</p>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = data.map(item => {
    const nama = item.resolvedNama || extractNama(item) || (item.resolvedNik && item.resolvedNik !== '-' ? `Peserta (${item.resolvedNik})` : 'Peserta Magang');
    const jamMasuk = item.resolvedJamMasuk || '-';
    const jamKeluar = item.resolvedJamKeluar || '-';
    const isLeave = item.isLeaveRecord;
    const isApprovedLeave = isLeave && (item.status === 'approved' || item.is_approved);
    const leaveLabel = item.kategori || 'Izin';
    const status = isLeave 
      ? (isApprovedLeave ? `${leaveLabel} (ACC)` : `${leaveLabel} (Menunggu ACC)`) 
      : (item.status || 'Hadir');
    const tanggal = item.resolvedTanggal || item.tanggal || '-';

    return `
      <tr class="hover:bg-slate-50/80 transition-colors">
        <td class="py-3.5 px-4 sm:px-6">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-200 flex items-center justify-center font-bold text-xs flex-shrink-0">
              ${nama.charAt(0).toUpperCase()}
            </div>
            <div>
              <span class="font-semibold text-slate-900 text-sm block">${nama}</span>
            </div>
          </div>
        </td>
        <td class="py-3.5 px-4 font-mono text-slate-600">${tanggal}</td>
        <td class="py-3.5 px-4 text-center font-mono text-xs sm:text-sm ${jamMasuk !== '-' ? 'text-slate-900 font-semibold' : 'text-slate-400'}">
          ${jamMasuk}
        </td>
        <td class="py-3.5 px-4 text-center font-mono text-xs sm:text-sm ${jamKeluar !== '-' ? 'text-slate-900 font-semibold' : 'text-slate-400'}">
          ${jamKeluar}
        </td>
        <td class="py-3.5 px-4 text-center">
          ${getStatusBadgeHtml(isLeave ? (isApprovedLeave ? 'approved' : 'pending') : status, item.kategori)}
        </td>
        <td class="py-3.5 px-4 sm:px-6 text-center">
          ${item.isLeaveRecord ? `
            <button 
              data-id="${item.id}"
              class="btn-lihat-bukti-harian inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200/80 transition active:scale-95 shadow-2xs"
              title="Lihat lampiran bukti surat izin/sakit">
              <i class="fa-solid fa-file-medical"></i>
              <span>Bukti Izin</span>
            </button>
          ` : `
            <button 
              data-id="${item.id}"
              class="btn-lihat-foto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200/80 transition active:scale-95 shadow-2xs">
              <i class="fa-regular fa-image"></i>
              <span>Lihat Foto</span>
            </button>
          `}
        </td>
      </tr>
    `;
  }).join('');

  // Bind Event Tombol Lihat Foto Kehadiran
  tbody.querySelectorAll('.btn-lihat-foto').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const item = data.find(x => x.id === id);
      if (item) openModalFoto(item);
    });
  });

  // Bind Event Tombol Lihat Bukti Izin (Harian)
  tbody.querySelectorAll('.btn-lihat-bukti-harian').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const item = data.find(x => x.id === id);
      if (item) openModalBukti(item);
    });
  });
}

/**
 * Modal Pop-Up Foto Live Presensi
 */
function openModalFoto(item) {
  const modal = document.getElementById('modalFotoPresensi');
  const namaEl = document.getElementById('modalFotoNamaPeserta');
  const jamMasukBadge = document.getElementById('modalJamMasukBadge');
  const jamKeluarBadge = document.getElementById('modalJamKeluarBadge');
  const statusBadge = document.getElementById('modalStatusBadge');
  const tanggalBadge = document.getElementById('modalTanggalBadge');

  const imgMasuk = document.getElementById('modalImgMasuk');
  const imgKeluar = document.getElementById('modalImgKeluar');
  const placeholderMasuk = document.getElementById('placeholderImgMasuk');
  const placeholderKeluar = document.getElementById('placeholderImgKeluar');

  const modalKetBox = document.getElementById('modalKetBox');
  const modalKetText = document.getElementById('modalKetText');

  const nama = item.resolvedNama || extractNama(item) || 'Peserta';
  const jamMasuk = item.resolvedJamMasuk || formatTimeDisplay(item.jam_masuk || item.jamMasuk || item.check_in_time);
  const jamKeluar = item.resolvedJamKeluar || formatTimeDisplay(item.jam_keluar || item.jamKeluar || item.check_out_time);
  const waktuPresensi = `${jamMasuk} - ${jamKeluar}`;

  namaEl.innerHTML = `<span class="font-bold text-slate-900">${nama}</span> &bull; <span class="font-mono text-slate-500 text-xs">Waktu: ${waktuPresensi}</span>`;
  jamMasukBadge.textContent = jamMasuk;
  jamKeluarBadge.textContent = jamKeluar;
  statusBadge.textContent = item.status === 'check_out' ? 'Check Out' : (item.status === 'check_in' ? 'Check In' : (item.status || 'Hadir'));
  tanggalBadge.textContent = item.tanggal || item.resolvedTanggal || '-';

  // Handle Foto Masuk (Mendukung base64 data URL foto_url dan URL biasa)
  const fotoMasukUrl = item.foto_masuk || (String(item.status || '').toLowerCase() === 'check_in' ? item.foto_url : '') || (item.foto_url && !String(item.status || '').toLowerCase().includes('out') ? item.foto_url : '');
  if (fotoMasukUrl) {
    imgMasuk.src = fotoMasukUrl;
    imgMasuk.classList.remove('hidden');
    placeholderMasuk.classList.add('hidden');
  } else {
    imgMasuk.src = '';
    imgMasuk.classList.add('hidden');
    placeholderMasuk.classList.remove('hidden');
  }

  // Handle Foto Keluar
  const fotoKeluarUrl = item.foto_keluar || (String(item.status || '').toLowerCase() === 'check_out' ? item.foto_url : '') || item.fotoKeluar;
  if (fotoKeluarUrl) {
    imgKeluar.src = fotoKeluarUrl;
    imgKeluar.classList.remove('hidden');
    placeholderKeluar.classList.add('hidden');
  } else {
    imgKeluar.src = '';
    imgKeluar.classList.add('hidden');
    placeholderKeluar.classList.remove('hidden');
  }

  // Handle Catatan / Alasan (Pulang cepat, terlambat, dll) secara rapi & terstruktur
  const notesHtml = [];

  const lateReason = String(item.late_reason || '').trim();
  const earlyReason = String(item.early_leave_reason || '').trim();
  let extraKet = String(item.keterangan || '').trim();

  // Bersihkan extraKet dari duplikasi teks
  if (extraKet) {
    if (
      extraKet.includes('Terlambat:') ||
      extraKet.includes('Pulang Cepat:') ||
      extraKet.includes('Alasan Terlambat') ||
      extraKet.includes('Alasan Pulang') ||
      extraKet === '-' ||
      extraKet === '""'
    ) {
      extraKet = '';
    }
  }

  if (lateReason && lateReason !== '-' && lateReason !== '""') {
    notesHtml.push(`
      <div class="flex items-start gap-2.5 p-2.5 rounded-xl bg-amber-50/90 border border-amber-200">
        <div class="w-6 h-6 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center flex-shrink-0 mt-0.5">
          <i class="fa-solid fa-clock-rotate-left text-xs"></i>
        </div>
        <div class="text-xs">
          <span class="font-bold text-amber-950 block text-[11px] uppercase tracking-wider">Alasan Terlambat</span>
          <span class="text-amber-900 font-medium">${lateReason}</span>
        </div>
      </div>
    `);
  }

  if (earlyReason && earlyReason !== '-' && earlyReason !== '""') {
    notesHtml.push(`
      <div class="flex items-start gap-2.5 p-2.5 rounded-xl bg-orange-50/90 border border-orange-200">
        <div class="w-6 h-6 rounded-lg bg-orange-100 text-orange-700 flex items-center justify-center flex-shrink-0 mt-0.5">
          <i class="fa-solid fa-person-walking-arrow-right text-xs"></i>
        </div>
        <div class="text-xs">
          <span class="font-bold text-orange-950 block text-[11px] uppercase tracking-wider">Alasan Pulang Lebih Awal</span>
          <span class="text-orange-900 font-medium">${earlyReason}</span>
        </div>
      </div>
    `);
  }

  if (extraKet && extraKet !== '-' && extraKet !== lateReason && extraKet !== earlyReason) {
    notesHtml.push(`
      <div class="flex items-start gap-2.5 p-2.5 rounded-xl bg-slate-50 border border-slate-200">
        <div class="w-6 h-6 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center flex-shrink-0 mt-0.5">
          <i class="fa-solid fa-note-sticky text-xs"></i>
        </div>
        <div class="text-xs">
          <span class="font-bold text-slate-700 block text-[11px] uppercase tracking-wider">Catatan Tambahan</span>
          <span class="text-slate-600 font-medium">${extraKet}</span>
        </div>
      </div>
    `);
  }

  if (modalKetBox && modalKetText) {
    if (notesHtml.length > 0) {
      modalKetText.innerHTML = `<div class="space-y-2 mt-1">${notesHtml.join('')}</div>`;
      modalKetBox.classList.remove('hidden');
    } else {
      modalKetBox.classList.add('hidden');
    }
  }

  // Show Modal
  modal.classList.remove('hidden');
}

function closeModalFoto() {
  const modal = document.getElementById('modalFotoPresensi');
  if (modal) modal.classList.add('hidden');
}

// ============================================================================
// 5. FITUR B: PERSETUJUAN IZIN / SAKIT (COLLECTION LEAVES)
// ============================================================================

let currentBuktiItem = null;

/**
 * Buka Modal Detail Foto Bukti Izin / Sakit
 */
function openModalBukti(item) {
  currentBuktiItem = item;
  const modal = document.getElementById('modalFotoBukti');
  if (!modal) return;

  const namaEl = document.getElementById('modalBuktiNamaPeserta');
  const katBadge = document.getElementById('modalBuktiKategoriBadge');
  const tglBadge = document.getElementById('modalBuktiTanggalBadge');
  const ketEl = document.getElementById('modalBuktiKeterangan');
  const imgBukti = document.getElementById('modalImgBukti');
  const placeholder = document.getElementById('placeholderImgBukti');

  const nama = item.resolvedNama || extractNama(item) || 'Peserta';
  const nik = item.resolvedNik || extractNik(item) || '-';
  let kategori = item.kategori || item.leave_type || item.status || 'Izin';
  if (kategori === 'izin_darurat') kategori = 'Izin Darurat';
  else if (kategori === 'sakit') kategori = 'Sakit';
  else if (kategori === 'izin') kategori = 'Izin';

  const tanggal = item.resolvedTanggal || item.tanggal || item.start_date || '-';
  const keterangan = item.reason || item.keterangan || item.alasan || item.deskripsi || 'Tidak ada keterangan tertulis.';

  if (namaEl) {
    namaEl.innerHTML = `<span class="font-bold text-slate-900">${nama}</span> &bull; <span class="font-mono text-slate-500 text-xs">NIK: ${nik}</span>`;
  }
  if (katBadge) {
    katBadge.textContent = kategori;
    if (String(kategori).toLowerCase().includes('sakit')) {
      katBadge.className = 'font-bold px-2 py-0.5 rounded-md text-rose-700 bg-rose-50 border border-rose-200';
    } else {
      katBadge.className = 'font-bold px-2 py-0.5 rounded-md text-amber-700 bg-amber-50 border border-amber-200';
    }
  }
  if (tglBadge) tglBadge.textContent = tanggal;
  if (ketEl) ketEl.textContent = keterangan;

  // Status Badge & Tombol Footer (ACC / Tolak)
  const statusEl = document.getElementById('modalBuktiStatusBadge');
  const btnAcc = document.getElementById('modalBtnAccBukti');
  const btnTolak = document.getElementById('modalBtnTolakBukti');
  const statusText = document.getElementById('modalBuktiStatusText');

  const rawStatus = String(item.status || item.statusRaw || '').toLowerCase();
  const isApproved =
    rawStatus === 'approved' ||
    rawStatus.includes('disetujui') ||
    item.is_approved === true ||
    rawStatus.includes('(acc)') ||
    rawStatus.includes(' acc') ||
    rawStatus.endsWith('acc') ||
    rawStatus === 'acc';
  const isRejected = rawStatus === 'rejected' || rawStatus.includes('ditolak');

  if (statusEl) {
    if (isApproved) {
      statusEl.innerHTML = `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200"><i class="fa-solid fa-circle-check text-emerald-600"></i> Sudah Di-ACC</span>`;
    } else if (isRejected) {
      statusEl.innerHTML = `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-800 border border-rose-200"><i class="fa-solid fa-circle-xmark text-rose-600"></i> Ditolak</span>`;
    } else {
      statusEl.innerHTML = `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200"><i class="fa-solid fa-hourglass-half text-amber-600"></i> Menunggu ACC</span>`;
    }
  }

  // Jika sudah Di-ACC / Ditolak, sembunyikan tombol aksi dan tampilkan badge status "Sudah Di-ACC"
  if (isApproved) {
    if (btnAcc) btnAcc.classList.add('hidden');
    if (btnTolak) btnTolak.classList.add('hidden');
    if (statusText) {
      statusText.innerHTML = `<span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200"><i class="fa-solid fa-circle-check text-emerald-600"></i> Sudah Di-ACC</span>`;
      statusText.classList.remove('hidden');
    }
  } else if (isRejected) {
    if (btnAcc) btnAcc.classList.add('hidden');
    if (btnTolak) btnTolak.classList.add('hidden');
    if (statusText) {
      statusText.innerHTML = `<span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200"><i class="fa-solid fa-circle-xmark text-rose-600"></i> Pengajuan Ditolak</span>`;
      statusText.classList.remove('hidden');
    }
  } else {
    // Masih pending: tampilkan tombol ACC & Tolak
    if (btnAcc) btnAcc.classList.remove('hidden');
    if (btnTolak) btnTolak.classList.remove('hidden');
    if (statusText) statusText.classList.add('hidden');
  }

  const fotoUrl = extractFotoBukti(item);
  if (fotoUrl && imgBukti && placeholder) {
    imgBukti.src = fotoUrl;
    imgBukti.classList.remove('hidden');
    placeholder.classList.add('hidden');
  } else if (imgBukti && placeholder) {
    imgBukti.src = '';
    imgBukti.classList.add('hidden');
    placeholder.classList.remove('hidden');
  }

  modal.classList.remove('hidden');
}

/**
 * Tutup Modal Detail Foto Bukti Izin / Sakit
 */
function closeModalBukti() {
  const modal = document.getElementById('modalFotoBukti');
  if (modal) modal.classList.add('hidden');
  currentBuktiItem = null;
}

/**
 * Ambil data permohonan dari collection 'leaves' (dan legacy 'presensi') yang berstatus Pending
 */
async function fetchPersetujuanIzinSakit() {
  const tbody = document.getElementById('tableBodyPersetujuan');
  const badgeCount = document.getElementById('badgePendingCount');
  if (!tbody) return;

  tbody.innerHTML = `
    <tr>
      <td colspan="7" class="py-12 text-center text-slate-400">
        <i class="fa-solid fa-spinner fa-spin text-xl text-indigo-500 mb-2 block"></i>
        Memeriksa pengajuan tertunda dari collection leaves...
      </td>
    </tr>
  `;

  try {
    const rawPending = [];
    const seenIds = new Set();

    // 1. Ambil dari collection 'leaves' (koleksi utama permohonan izin & sakit)
    const leavesDocs = await fetchLeavesDocs();
    leavesDocs.forEach(data => {
      const s = String(data.status || '').toLowerCase();
      const leaveType = String(data.leave_type || data.kategori || '').toLowerCase();

      const isApproved = s === 'approved' || s.includes('disetujui') || data.is_approved === true;
      const isRejected = s === 'rejected' || s.includes('ditolak') || s.includes('tolak');

      // Masuk ke antrean verifikasi jika berstatus pending
      if (!isApproved && !isRejected) {
        const isSakit = leaveType.includes('sakit');
        const cleanKat = isSakit ? 'Sakit' : 'Izin';

        let tglDisplay = data.start_date || '';
        if (data.start_date && data.end_date && data.start_date !== data.end_date) {
          tglDisplay = `${data.start_date} s/d ${data.end_date}`;
        }

        seenIds.add(data.id);
        rawPending.push({
          id: data.id,
          ...data,
          collectionSource: 'leaves',
          kategori: cleanKat,
          leave_type: cleanKat,
          tanggal: tglDisplay || data.start_date || (data.created_at?.toDate ? getFormattedDate(data.created_at.toDate()) : '-'),
          keterangan: data.reason || data.keterangan || data.alasan || '-'
        });
      }
    });

    // 2. Cek juga legacy collection 'presensi'
    try {
      const presensiSnap = await getDocs(collection(db, 'presensi'));
      presensiSnap.forEach(docSnap => {
        if (seenIds.has(docSnap.id)) return;
        const data = docSnap.data();
        const s = String(data.status || '').toLowerCase();
        const k = String(data.kategori || '').toLowerCase();

        const isIzin = s.includes('izin') || k.includes('izin');
        const isSakit = s.includes('sakit') || k.includes('sakit');
        const isPendingStatus = s === 'pending' || s.includes('menunggu');
        const isApproved = s === 'approved' || s.includes('disetujui') || data.is_approved === true;
        const isRejected = s === 'rejected' || s.includes('ditolak') || s.includes('tolak');

        if ((isIzin || isSakit || isPendingStatus) && !isApproved && !isRejected) {
          rawPending.push({
            id: docSnap.id,
            ...data,
            collectionSource: 'presensi',
            kategori: isSakit ? 'Sakit' : (isIzin ? 'Izin' : 'Pending'),
            tanggal: data.tanggal || data.date || '-'
          });
        }
      });
    } catch (_) { }

    // Hubungkan data user jika ada NIK yang belum tercache
    await resolveMissingUsers(rawPending);

    const pendingList = rawPending.map(item => enrichPresensiWithUser(item));

    STATE.pendingApprovalList = pendingList;

    // Update Badge di Sidebar
    if (badgeCount) {
      if (pendingList.length > 0) {
        badgeCount.textContent = pendingList.length;
        badgeCount.classList.remove('hidden');
      } else {
        badgeCount.classList.add('hidden');
      }
    }

    renderPersetujuanTable(pendingList);
  } catch (error) {
    console.error('Error fetchPersetujuanIzinSakit:', error);
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="py-10 text-center text-rose-500">
          <i class="fa-solid fa-triangle-exclamation text-2xl mb-2 block"></i>
          Gagal memuat data persetujuan: ${error.message}
        </td>
      </tr>
    `;
  }
}

/**
 * Render tabel Persetujuan Izin / Sakit
 */
function renderPersetujuanTable(data) {
  const tbody = document.getElementById('tableBodyPersetujuan');
  if (!tbody) return;

  if (data.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="py-14 text-center text-slate-400">
          <div class="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 mb-2">
            <i class="fa-solid fa-circle-check text-2xl"></i>
          </div>
          <p class="font-bold text-slate-700">Semua Pengajuan Telah Diproses</p>
          <p class="text-xs text-slate-400 mt-0.5">Tidak ada antrean persetujuan izin atau sakit yang tertunda di collection leaves saat ini.</p>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = data.map(item => {
    const nama = item.resolvedNama || item.nama || item.name || 'Peserta';
    const tanggal = item.resolvedTanggal || item.tanggal || item.start_date || '-';
    const kategori = item.kategori || item.leave_type || 'Izin';
    const keterangan = item.reason || item.keterangan || item.alasan || item.deskripsi || '-';
    const fotoBuktiUrl = extractFotoBukti(item);
    const colSource = item.collectionSource || 'leaves';

    return `
      <tr id="row-pending-${item.id}" class="hover:bg-slate-50/80 transition-colors">
        <td class="py-3.5 px-4 sm:px-6">
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-full bg-amber-50 text-amber-700 border border-amber-200 flex items-center justify-center font-bold text-xs flex-shrink-0">
              ${nama.charAt(0).toUpperCase()}
            </div>
            <div>
              <span class="font-semibold text-slate-900 text-sm block">${nama}</span>
              <span class="font-mono text-[11px] text-slate-500 block">NIK: ${item.resolvedNik || '-'}</span>
            </div>
          </div>
        </td>
        <td class="py-3.5 px-4 font-mono text-slate-700">${tanggal}</td>
        <td class="py-3.5 px-4 text-center">
          ${getKategoriBadgeHtml(kategori)}
        </td>
        <td class="py-3.5 px-4 max-w-xs text-slate-600 truncate" title="${keterangan}">
          ${keterangan}
        </td>
        <td class="py-3.5 px-4 text-center">
          ${fotoBuktiUrl ? `
            <button 
              data-id="${item.id}"
              class="btn-lihat-bukti inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200/80 transition active:scale-95 shadow-2xs">
              <i class="fa-solid fa-file-image text-indigo-600"></i>
              <span>Lihat Bukti</span>
            </button>
          ` : `
            <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] text-slate-400 bg-slate-50 border border-slate-200">
              <i class="fa-regular fa-image-slash"></i>
              <span>Tanpa Foto</span>
            </span>
          `}
        </td>
        <td class="py-3.5 px-4 text-center">
          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            Pending
          </span>
        </td>
        <td class="py-3.5 px-4 sm:px-6 text-center">
          <div class="inline-flex items-center gap-2">
            <!-- Tombol ACC -->
            <button 
              data-id="${item.id}"
              data-nama="${nama}"
              data-source="${colSource}"
              class="btn-acc-action px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-xs transition active:scale-95 flex items-center gap-1.5">
              <i class="fa-solid fa-check"></i>
              <span>ACC</span>
            </button>
            
            <!-- Tombol Tolak -->
            <button 
              data-id="${item.id}"
              data-nama="${nama}"
              data-source="${colSource}"
              class="btn-tolak-action px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-xl text-xs font-semibold transition active:scale-95 flex items-center gap-1.5">
              <i class="fa-solid fa-xmark"></i>
              <span>Tolak</span>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Bind Event Tombol Lihat Bukti
  tbody.querySelectorAll('.btn-lihat-bukti').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const item = data.find(x => x.id === id);
      if (item) openModalBukti(item);
    });
  });

  // Bind Action Buttons
  tbody.querySelectorAll('.btn-acc-action').forEach(btn => {
    btn.addEventListener('click', async () => {
      const docId = btn.getAttribute('data-id');
      const nama = btn.getAttribute('data-nama');
      const source = btn.getAttribute('data-source') || 'leaves';
      await handleUpdateStatusPresensi(docId, 'approved', nama, btn, source);
    });
  });

  tbody.querySelectorAll('.btn-tolak-action').forEach(btn => {
    btn.addEventListener('click', async () => {
      const docId = btn.getAttribute('data-id');
      const nama = btn.getAttribute('data-nama');
      const source = btn.getAttribute('data-source') || 'leaves';
      await handleUpdateStatusPresensi(docId, 'rejected', nama, btn, source);
    });
  });
}

/**
 * Handle Update Status Permohonan (ACC / Tolak) ke Firestore di collection 'leaves' / 'presensi'
 */
async function handleUpdateStatusPresensi(docId, newStatus, nama, triggerBtn, collectionSource = 'leaves') {
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i>`;
  }

  const isAcc = String(newStatus).toLowerCase() === 'approved';
  const existingItem = STATE.pendingApprovalList.find(x => x.id === docId);
  const colName = collectionSource || existingItem?.collectionSource || 'leaves';

  try {
    const originalKat = String(existingItem?.kategori || existingItem?.leave_type || existingItem?.status || 'Izin');
    const isSakit = originalKat.toLowerCase().includes('sakit');
    const cleanKat = isSakit ? 'Sakit' : 'Izin';

    const docRef = doc(db, colName, docId);

    const updatePayload = {
      status: isAcc ? 'approved' : 'rejected',
      is_approved: isAcc,
      approved_at: new Date().toISOString(),
      approved_by: STATE.currentUser?.email || 'admin'
    };

    if (colName === 'presensi') {
      updatePayload.status = isAcc ? 'Approved' : 'Rejected';
      updatePayload.kategori = cleanKat;
      updatePayload.approvedAt = new Date().toISOString();
      updatePayload.approvedBy = STATE.currentUser?.email || 'admin';
    }

    await updateDoc(docRef, updatePayload);

    showToast(`Pengajuan ${cleanKat} dari ${nama} berhasil ${isAcc ? 'Di-ACC (Disetujui)' : 'Ditolak'}.`, isAcc ? 'success' : 'info');

    // Update state pending list & badge count
    STATE.pendingApprovalList = STATE.pendingApprovalList.filter(x => x.id !== docId);
    const badgeCount = document.getElementById('badgePendingCount');
    if (badgeCount) {
      if (STATE.pendingApprovalList.length > 0) {
        badgeCount.textContent = STATE.pendingApprovalList.length;
        badgeCount.classList.remove('hidden');
      } else {
        badgeCount.classList.add('hidden');
      }
    }

    // Animasi hapus baris dari tabel jika tabel persetujuan sedang terbuka
    const row = document.getElementById(`row-pending-${docId}`);
    if (row) {
      row.style.transition = 'all 0.3s ease';
      row.style.opacity = '0';
      row.style.transform = 'translateX(20px)';
      setTimeout(() => {
        row.remove();
        if (STATE.pendingApprovalList.length === 0) {
          renderPersetujuanTable([]);
        }
      }, 300);
    } else if (STATE.pendingApprovalList.length === 0) {
      renderPersetujuanTable([]);
    }

    // Selalu sinkronisasi data presensi harian & rekap secara otomatis
    await fetchPresensiHarian();
    await fetchRekapIndividu();
  } catch (error) {
    console.error(`Error updateDoc in ${colName}:`, error);
    showToast(`Gagal memproses persetujuan: ${error.message}`, 'error');
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.innerHTML = isAcc ? `<i class="fa-solid fa-check"></i> <span>ACC</span>` : `<i class="fa-solid fa-xmark"></i> <span>Tolak</span>`;
    }
  }
}

// ============================================================================
// 6. FITUR C: DATA INDIVIDU & REKAPITULASI (ATTENDANCES & LEAVES)
// ============================================================================

/**
 * Ambil seluruh data presensi (attendances) dan izin/sakit (leaves) untuk rekapitulasi individu
 */
async function fetchRekapIndividu() {
  const tbody = document.getElementById('tableBodyRekap');
  if (!tbody) return;

  // Pastikan data profil user berdasarkan NIK sudah dimuat
  if (STATE.usersByNik.size === 0) {
    await fetchUsers();
  }

  tbody.innerHTML = `
    <tr>
      <td colspan="6" class="py-12 text-center text-slate-400">
        <i class="fa-solid fa-spinner fa-spin text-xl text-indigo-500 mb-2 block"></i>
        Memuat rekaman data presensi & perizinan...
      </td>
    </tr>
  `;

  try {
    // 1. Ambil seluruh data kehadiran dari attendances
    const rawAttendance = await fetchAttendanceDocs();
    const processedAttendance = processAttendanceDocs(rawAttendance);

    // 2. Ambil seluruh data permohonan dari leaves
    const rawLeaves = await fetchLeavesDocs();
    const processedLeaves = rawLeaves.map(doc => {
      const s = String(doc.status || '').toLowerCase();
      const leaveType = String(doc.leave_type || doc.kategori || 'Izin').toLowerCase();
      let cleanKat = 'Izin';
      if (leaveType.includes('sakit')) cleanKat = 'Sakit';
      else if (leaveType.includes('darurat')) cleanKat = 'Izin Darurat';
      else cleanKat = 'Izin';

      const isApproved = s === 'approved' || s.includes('disetujui') || doc.is_approved === true || s.includes('(acc)') || s.includes('acc');
      const isRejected = s === 'rejected' || s.includes('ditolak');

      let statusDisplay = `${cleanKat} (Menunggu ACC)`;
      if (isApproved) statusDisplay = `${cleanKat} (ACC)`;
      else if (isRejected) statusDisplay = `${cleanKat} (Ditolak)`;

      let tglDisplay = doc.start_date || '';
      if (doc.start_date && doc.end_date && doc.start_date !== doc.end_date) {
        tglDisplay = `${doc.start_date} s/d ${doc.end_date}`;
      }

      return {
        id: doc.id,
        ...doc,
        collectionSource: 'leaves',
        isLeaveRecord: true,
        kategori: cleanKat,
        leave_type: cleanKat,
        status: statusDisplay,
        statusRaw: s,
        is_approved: isApproved,
        tanggal: tglDisplay || doc.start_date || (doc.created_at?.toDate ? getFormattedDate(doc.created_at.toDate()) : '-'),
        jam_masuk: '-',
        jam_keluar: '-',
        keterangan: doc.reason || doc.keterangan || '-'
      };
    });

    const combined = [...processedAttendance, ...processedLeaves];

    // Hubungkan relasi nama peserta dari collection users berdasarkan NIK
    await resolveMissingUsers(combined);

    const allData = combined.map(item => enrichPresensiWithUser(item));

    // Urutkan berdasarkan tanggal terbaru
    allData.sort((a, b) => {
      const dateA = a.start_date || a.tanggal || '';
      const dateB = b.start_date || b.tanggal || '';
      return String(dateB).localeCompare(String(dateA));
    });

    STATE.rekapList = allData;
    filterAndRenderRekap();
  } catch (error) {
    console.error('Error fetchRekapIndividu:', error);
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="py-10 text-center text-rose-500">
          <i class="fa-solid fa-triangle-exclamation text-2xl mb-2 block"></i>
          Gagal mengambil data rekap: ${error.message}
        </td>
      </tr>
    `;
  }
}

/**
 * Ekstraksi tanggal murni (YYYY-MM-DD) dari item presensi untuk perbandingan filter
 */
function extractItemDate(item) {
  if (!item) return '';
  const t = item.resolvedTanggal || item.tanggal || item.date || item.start_date || '';
  if (t && typeof t === 'string') {
    const match = t.trim().match(/^\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
  }
  if (item.check_in_time?.toDate) return getFormattedDate(item.check_in_time.toDate());
  if (item.check_out_time?.toDate) return getFormattedDate(item.check_out_time.toDate());
  if (item.waktu?.toDate) return getFormattedDate(item.waktu.toDate());
  if (item.createdAt?.toDate) return getFormattedDate(item.createdAt.toDate());
  if (item.waktu && typeof item.waktu === 'object' && item.waktu.seconds) {
    return getFormattedDate(new Date(item.waktu.seconds * 1000));
  }
  return '';
}

/**
 * Cek apakah item presensi atau leaves berada dalam rentang tanggal filter
 */
function checkItemDateRange(item, filterStart, filterEnd) {
  if (!filterStart && !filterEnd) return true;

  // Jika item adalah permohonan leaves dengan start_date & end_date
  if (item.start_date) {
    const sDate = item.start_date;
    const eDate = item.end_date || item.start_date;

    if (filterStart && filterEnd) {
      return sDate <= filterEnd && eDate >= filterStart;
    } else if (filterStart) {
      return eDate >= filterStart;
    } else if (filterEnd) {
      return sDate <= filterEnd;
    }
  }

  // Item kehadiran biasa (tanggal tunggal)
  const itemDate = extractItemDate(item);
  if (!itemDate) return false;

  if (filterStart && filterEnd) {
    return itemDate >= filterStart && itemDate <= filterEnd;
  } else if (filterStart) {
    return itemDate >= filterStart;
  } else if (filterEnd) {
    return itemDate <= filterEnd;
  }
  return true;
}

/**
 * Filter data rekap berdasarkan nama/NIK dan rentang tanggal, serta hitung summary counter
 */
function filterAndRenderRekap() {
  const searchInput = document.getElementById('searchNamaPeserta');
  const tglMulaiInput = document.getElementById('filterRekapTglMulai');
  const tglAkhirInput = document.getElementById('filterRekapTglAkhir');
  const tbody = document.getElementById('tableBodyRekap');
  const rowCountBadge = document.getElementById('rekapRowCountBadge');
  const statusFilterText = document.getElementById('rekapFilterStatusText');

  const keyword = searchInput ? searchInput.value.trim().toLowerCase() : '';
  const tglMulai = tglMulaiInput ? tglMulaiInput.value.trim() : '';
  const tglAkhir = tglAkhirInput ? tglAkhirInput.value.trim() : '';

  let filtered = STATE.rekapList;

  // 1. Filter Berdasarkan Nama Peserta atau NIK
  if (keyword) {
    filtered = filtered.filter(item => {
      const nama = (item.resolvedNama || '').toLowerCase();
      const nik = (item.resolvedNik || '').toLowerCase();
      return nama.includes(keyword) || nik.includes(keyword);
    });
  }

  // 2. Filter Berdasarkan Tanggal (Dari Tanggal & Sampai Tanggal)
  if (tglMulai || tglAkhir) {
    filtered = filtered.filter(item => {
      return checkItemDateRange(item, tglMulai, tglAkhir);
    });
  }

  // Keterangan status filter yang aktif
  const filterLabels = [];
  if (keyword) filterLabels.push(`Nama/NIK: "${keyword}"`);
  if (tglMulai && tglAkhir) {
    filterLabels.push(tglMulai === tglAkhir ? `Tanggal: ${tglMulai}` : `Periode: ${tglMulai} s/d ${tglAkhir}`);
  } else if (tglMulai) {
    filterLabels.push(`Mulai: ${tglMulai}`);
  } else if (tglAkhir) {
    filterLabels.push(`Sampai: ${tglAkhir}`);
  }

  if (statusFilterText) {
    statusFilterText.textContent = '';
  }

  STATE.rekapFilteredList = filtered;

  // Hitung Summary Statistik: Hadir, Izin, Sakit, Alpa
  let hadir = 0;
  let izin = 0;
  let sakit = 0;
  let alpa = 0;

  filtered.forEach(item => {
    const s = String(item.status || item.kategori || '').toLowerCase();
    if (s.includes('sakit')) {
      sakit++;
    } else if (s.includes('izin')) {
      izin++;
    } else if (s.includes('alpa') || s.includes('alpha') || s.includes('tidak hadir')) {
      alpa++;
    } else if (
      s.includes('hadir') ||
      s.includes('check_in') ||
      s.includes('check_out') ||
      s.includes('check-in') ||
      s.includes('check-out') ||
      s === 'approved' ||
      s.includes('disetujui')
    ) {
      hadir++;
    } else {
      hadir++;
    }
  });

  STATE.rekapSummary = { hadir, izin, sakit, alpa };

  // Update Summary UI
  const elHadir = document.getElementById('summaryHadir');
  const elIzin = document.getElementById('summaryIzin');
  const elSakit = document.getElementById('summarySakit');
  const elAlpa = document.getElementById('summaryAlpa');
  const containerSummary = document.getElementById('containerSummaryRekap');
  const summaryNamaPeserta = document.getElementById('summaryNamaPeserta');

  if (elHadir) elHadir.textContent = hadir;
  if (elIzin) elIzin.textContent = izin;
  if (elSakit) elSakit.textContent = sakit;
  if (elAlpa) elAlpa.textContent = alpa;
  if (rowCountBadge) rowCountBadge.textContent = `${filtered.length} baris`;

  // Aturan Tampilan: Kartu Total Hadir/Sakit/Izin/Alpa HANYA muncul ketika mencari nama & nama tersebut ditemukan
  const isSearchingName = Boolean(keyword);
  const isNameFound = isSearchingName && filtered.length > 0;

  if (containerSummary) {
    if (isNameFound) {
      containerSummary.classList.remove('hidden');
      if (summaryNamaPeserta) {
        const matchedName = filtered[0].resolvedNama || filtered[0].nama || keyword;
        summaryNamaPeserta.textContent = matchedName;
      }
    } else {
      containerSummary.classList.add('hidden');
    }
  }

  // Render Tabel Rekap
  if (filtered.length === 0) {
    const kriteriaDesc = filterLabels.length > 0 ? `dengan filter ${filterLabels.join(' & ')}` : '';
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="py-12 text-center text-slate-400">
          <i class="fa-solid fa-calendar-xmark text-2xl text-slate-300 mb-2 block"></i>
          Tidak ditemukan riwayat presensi ${kriteriaDesc}.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(item => {
    const nama = item.resolvedNama || extractNama(item) || (item.resolvedNik && item.resolvedNik !== '-' ? `Peserta (${item.resolvedNik})` : 'Peserta');
    const tanggal = item.resolvedTanggal || item.tanggal || item.date || '-';
    const jamMasuk = item.resolvedJamMasuk || formatTimeDisplay(item.jam_masuk || item.jamMasuk);
    const jamKeluar = item.resolvedJamKeluar || formatTimeDisplay(item.jam_keluar || item.jamKeluar);
    const status = item.status || item.kategori || 'Hadir';
    const keterangan = item.keterangan || item.alasan || '-';

    return `
      <tr class="hover:bg-slate-50/80 transition-colors">
        <td class="py-3.5 px-4 sm:px-6">
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-200 flex items-center justify-center font-bold text-xs flex-shrink-0">
              ${nama.charAt(0).toUpperCase()}
            </div>
            <div>
              <span class="font-semibold text-slate-900 text-sm block">${nama}</span>
              <span class="font-mono text-[11px] text-slate-500 block">NIK: ${item.resolvedNik || '-'}</span>
            </div>
          </div>
        </td>
        <td class="py-3.5 px-4 font-mono text-slate-700">${tanggal}</td>
        <td class="py-3.5 px-4 text-center font-mono text-xs sm:text-sm ${jamMasuk !== '-' ? 'text-slate-900 font-semibold' : 'text-slate-400'}">
          ${jamMasuk}
        </td>
        <td class="py-3.5 px-4 text-center font-mono text-xs sm:text-sm ${jamKeluar !== '-' ? 'text-slate-900 font-semibold' : 'text-slate-400'}">
          ${jamKeluar}
        </td>
        <td class="py-3.5 px-4 text-center">
          ${getStatusBadgeHtml(status, item.kategori)}
        </td>
        <td class="py-3.5 px-4 sm:px-6 text-slate-600 max-w-xs truncate" title="${keterangan}">
          ${keterangan}
        </td>
      </tr>
    `;
  }).join('');
}

// ============================================================================
// 7. FITUR EKSPOR EXCEL (SHEETJS XLSX)
// ============================================================================

/**
 * Ekspor data rekapitulasi ke file Excel .xlsx berdasarkan filter aktif (nama/NIK & tanggal)
 */
function exportRekapToExcel() {
  if (typeof XLSX === 'undefined') {
    showToast('Library SheetJS belum siap dimuat.', 'error');
    return;
  }

  const dataToExport = STATE.rekapFilteredList;
  if (!dataToExport || dataToExport.length === 0) {
    showToast('Tidak ada data yang sesuai filter untuk diekspor ke Excel.', 'warning');
    return;
  }

  const searchKeyword = document.getElementById('searchNamaPeserta')?.value.trim() || '';
  const tglMulai = document.getElementById('filterRekapTglMulai')?.value.trim() || '';
  const tglAkhir = document.getElementById('filterRekapTglAkhir')?.value.trim() || '';

  const sanitizeName = searchKeyword ? searchKeyword.replace(/[^a-zA-Z0-9_\-]/g, '_') : 'Semua_Peserta';
  const tanggalHariIni = getFormattedDate();

  let periodeText = 'Semua Periode Tanggal';
  let datePartFilename = tanggalHariIni;
  if (tglMulai && tglAkhir) {
    periodeText = tglMulai === tglAkhir ? tglMulai : `${tglMulai} s/d ${tglAkhir}`;
    datePartFilename = tglMulai === tglAkhir ? tglMulai : `${tglMulai}_sd_${tglAkhir}`;
  } else if (tglMulai) {
    periodeText = `Mulai ${tglMulai}`;
    datePartFilename = `mulai_${tglMulai}`;
  } else if (tglAkhir) {
    periodeText = `Sampai ${tglAkhir}`;
    datePartFilename = `sampai_${tglAkhir}`;
  }

  // Susun data terstruktur untuk sheet
  const rows = [];

  // 1. Header Informasi Dokumen
  rows.push(['LAPORAN REKAPITULASI PRESENSI MAGANGHUB']);
  rows.push(['Filter Pencarian Peserta', searchKeyword || 'Semua Peserta']);
  rows.push(['Periode Tanggal', periodeText]);
  rows.push(['Tanggal Unduh', `${new Date().toLocaleString('id-ID')} WIB`]);
  rows.push(['Diekspor Oleh', STATE.currentUser?.nama || STATE.currentUser?.email || 'Admin']);
  rows.push([]); // blank row

  // 2. Summary Statistik
  rows.push(['RINGKASAN KEHADIRAN']);
  rows.push(['Total Hadir', STATE.rekapSummary.hadir]);
  rows.push(['Total Izin', STATE.rekapSummary.izin]);
  rows.push(['Total Sakit', STATE.rekapSummary.sakit]);
  rows.push(['Total Alpa', STATE.rekapSummary.alpa]);
  rows.push(['Total Catatan Presensi', dataToExport.length]);
  rows.push([]); // blank row

  // 3. Kolom Tabel Presensi (Nama Peserta, NIK & Waktu Presensi)
  rows.push(['No', 'Nama Peserta', 'NIK', 'Tanggal', 'Jam Masuk', 'Jam Keluar', 'Status / Kategori', 'Keterangan']);

  // 4. Data Rows
  dataToExport.forEach((item, index) => {
    rows.push([
      index + 1,
      item.resolvedNama || item.nama || 'Peserta',
      item.resolvedNik || item.nik || '-',
      item.resolvedTanggal || item.tanggal || item.date || '-',
      item.resolvedJamMasuk || item.jam_masuk || item.jamMasuk || '-',
      item.resolvedJamKeluar || item.jam_keluar || item.jamKeluar || '-',
      item.status || item.kategori || 'Hadir',
      item.keterangan || item.alasan || '-'
    ]);
  });

  // Konversi array of arrays menjadi Sheet
  const worksheet = XLSX.utils.aoa_to_sheet(rows);

  // Styling Lebar Kolom (column widths)
  worksheet['!cols'] = [
    { wch: 6 },  // No
    { wch: 28 }, // Nama Peserta
    { wch: 20 }, // NIK
    { wch: 15 }, // Tanggal
    { wch: 14 }, // Jam Masuk
    { wch: 14 }, // Jam Keluar
    { wch: 18 }, // Status
    { wch: 32 }  // Keterangan
  ];

  // Buat Workbook baru
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Rekap Presensi');

  // Trigger Download File .xlsx
  const fileName = `Rekap_Presensi_${sanitizeName}_${datePartFilename}.xlsx`;
  XLSX.writeFile(workbook, fileName);

  showToast(`File Excel berhasil diunduh: ${fileName}`, 'success');
}

// ============================================================================
// 7b. FITUR D: KELOLA & HAPUS AKUN PESERTA DARI COLLECTION USERS
// ============================================================================

/**
 * Muat ulang data akun dari collection 'users' dan render tabel
 */
async function fetchAndRenderUserAccounts() {
  const tbody = document.getElementById('tableBodyUserAccounts');
  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="py-12 text-center text-slate-400">
          <i class="fa-solid fa-spinner fa-spin text-xl text-indigo-500 mb-2 block"></i>
          Menghubungkan ke collection users...
        </td>
      </tr>
    `;
  }

  await fetchUsers();
  renderUserAccountsTable();
}

/**
 * Render tabel Akun Peserta Magang dari collection 'users'
 */
function renderUserAccountsTable(customKeyword) {
  const tbody = document.getElementById('tableBodyUserAccounts');
  const searchInput = document.getElementById('searchUserAccount');
  const badgeCount = document.getElementById('userRowCountBadge');
  if (!tbody) return;

  const keyword = (customKeyword !== undefined ? customKeyword : (searchInput ? searchInput.value : '')).trim().toLowerCase();

  let list = STATE.userAccounts || [];
  if (keyword) {
    list = list.filter(item => {
      const nama = String(item.nama || '').toLowerCase();
      const nik = String(item.nik || '').toLowerCase();
      const email = String(item.email || '').toLowerCase();
      const id = String(item.id || '').toLowerCase();
      return nama.includes(keyword) || nik.includes(keyword) || email.includes(keyword) || id.includes(keyword);
    });
  }

  if (badgeCount) badgeCount.textContent = `${list.length} Akun`;

  if (list.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="py-12 text-center text-slate-400">
          <div class="inline-flex items-center justify-center w-12 h-12 rounded-full bg-slate-100 text-slate-400 mb-2">
            <i class="fa-solid fa-user-xmark text-xl"></i>
          </div>
          <p class="font-semibold text-slate-700">Tidak ada akun peserta ditemukan</p>
          <p class="text-xs text-slate-400 mt-0.5">${keyword ? `Pencarian "${keyword}" tidak cocok dengan akun manapun.` : 'Belum ada akun peserta terdaftar pada collection users.'}</p>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = list.map(user => {
    const nama = user.nama || 'Peserta Magang';
    const nik = user.nik && user.nik !== '-' ? user.nik : (user.no_nik || user.id || '-');
    const email = user.email || user.surel || '-';
    const hp = user.no_hp || user.hp || user.telepon || user.phone || '';
    const docId = user.id || user.uid || '-';

    return `
      <tr id="row-user-${docId}" class="hover:bg-slate-50/80 transition-colors">
        <td class="py-3.5 px-4 sm:px-6">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-700 border border-indigo-200/80 flex items-center justify-center font-bold text-xs flex-shrink-0">
              ${nama.charAt(0).toUpperCase()}
            </div>
            <div>
              <span class="font-bold text-slate-900 text-sm block">${nama}</span>
              <span class="text-xs text-slate-400 block">${email}</span>
            </div>
          </div>
        </td>
        <td class="py-3.5 px-4">
          <span class="inline-flex items-center px-2.5 py-1 rounded-lg font-mono text-xs font-semibold bg-slate-100 text-slate-800 border border-slate-200">
            ${nik}
          </span>
        </td>
        <td class="py-3.5 px-4 text-xs text-slate-600">
          ${hp ? `<span class="font-mono text-slate-700">${hp}</span>` : '<span class="text-slate-400 font-mono">-</span>'}
        </td>
        <td class="py-3.5 px-4 font-mono text-xs text-slate-500 max-w-[150px] truncate" title="${docId}">
          ${docId}
        </td>
        <td class="py-3.5 px-4 sm:px-6 text-center">
          <button 
            data-id="${docId}"
            class="btn-action-delete-user inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 transition active:scale-95 shadow-2xs"
            title="Hapus akun peserta dari collection users">
            <i class="fa-solid fa-trash-can text-[11px]"></i>
            <span>Hapus Akun</span>
          </button>
        </td>
      </tr>
    `;
  }).join('');

  // Bind click buttons
  tbody.querySelectorAll('.btn-action-delete-user').forEach(btn => {
    btn.addEventListener('click', () => {
      const docId = btn.getAttribute('data-id');
      const targetUser = list.find(u => u.id === docId || u.uid === docId);
      if (targetUser) {
        openModalDeleteUser(targetUser);
      }
    });
  });
}

/**
 * Buka dialog modal konfirmasi hapus akun
 */
function openModalDeleteUser(profile) {
  if (!profile) return;
  STATE.userToDelete = profile;

  const modal = document.getElementById('modalConfirmDeleteUser');
  const namaEl = document.getElementById('modalDeleteUserNama');
  const nikEl = document.getElementById('modalDeleteUserNik');
  const uidEl = document.getElementById('modalDeleteUserUid');

  if (namaEl) namaEl.textContent = profile.nama || 'Peserta';
  if (nikEl) nikEl.textContent = profile.nik || '-';
  if (uidEl) uidEl.textContent = profile.id || profile.uid || '-';

  if (modal) modal.classList.remove('hidden');
}

/**
 * Tutup dialog modal konfirmasi hapus akun
 */
function closeModalDeleteUser() {
  const modal = document.getElementById('modalConfirmDeleteUser');
  if (modal) modal.classList.add('hidden');
  STATE.userToDelete = null;

  const btnText = document.getElementById('btnExecuteDeleteText');
  const spinner = document.getElementById('spinnerExecuteDelete');
  const btn = document.getElementById('btnExecuteDeleteUser');
  if (btn) btn.disabled = false;
  if (btnText) btnText.textContent = 'Ya, Hapus Akun';
  if (spinner) spinner.classList.add('hidden');
}

/**
 * Eksekusi penghapusan akun dari collection users di Firestore
 */
async function executeDeleteUserAccount() {
  const target = STATE.userToDelete;
  if (!target) return;

  const btn = document.getElementById('btnExecuteDeleteUser');
  const btnText = document.getElementById('btnExecuteDeleteText');
  const spinner = document.getElementById('spinnerExecuteDelete');

  if (btn) btn.disabled = true;
  if (btnText) btnText.textContent = 'Menghapus...';
  if (spinner) spinner.classList.remove('hidden');

  const colName = target.collectionName || 'users';
  const docId = target.id;
  const targetNama = target.nama || 'Peserta';

  try {
    // 1. Hapus dokumen dari Firestore collection users
    const userDocRef = doc(db, colName, docId);
    await deleteDoc(userDocRef);

    // Jika UID berbeda dengan docId, coba bersihkan juga dokumen dengan ID uid
    if (target.uid && target.uid !== docId) {
      try {
        await deleteDoc(doc(db, colName, target.uid));
      } catch (_) { }
    }

    // 2. Bersihkan dari STATE lokal
    STATE.userAccounts = (STATE.userAccounts || []).filter(u => u.id !== docId && u.uid !== docId);
    if (target.nik) {
      STATE.usersByNik.delete(target.nik);
      STATE.usersByNik.delete(target.nik.toLowerCase());
      STATE.usersByNik.delete(String(target.nik).replace(/[\s\-]/g, ''));
    }
    STATE.usersByUid.delete(docId);
    if (target.uid) STATE.usersByUid.delete(target.uid);

    // 3. Update Badge Sidebar
    const badgeUserCount = document.getElementById('badgeUserCount');
    if (badgeUserCount) badgeUserCount.textContent = STATE.userAccounts.length;

    showToast(`Akun peserta "${targetNama}" berhasil dihapus dari collection ${colName}.`, 'success');
    closeModalDeleteUser();

    // 4. Render ulang tabel & refresh presensi
    renderUserAccountsTable();
    fetchPresensiHarian();
    fetchRekapIndividu();
  } catch (error) {
    console.error('Error deleteDoc user:', error);
    if (error.code === 'permission-denied' || (error.message && error.message.includes('permission'))) {
      showToast('Izin Ditolak: Aturan Firestore belum mengizinkan penghapusan akun users. Buka Firebase Console > Firestore Database > Rules dan set "allow write: if true;" untuk collection users.', 'error');
    } else {
      showToast(`Gagal menghapus akun: ${error.message}`, 'error');
    }
    if (btn) btn.disabled = false;
    if (btnText) btnText.textContent = 'Ya, Hapus Akun';
    if (spinner) spinner.classList.add('hidden');
  }
}

// ============================================================================
// 8. EVENT BINDINGS & APP INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  // 1. Inisialisasi Jam
  initClock();

  // 2. Inisialisasi Autentikasi
  initAuth();

  // 3. Inisialisasi Navigasi SPA & Responsive Sidebar
  initNavigation();

  // 4. Filter Button Presensi Harian
  const btnFilterPresensiHarian = document.getElementById('btnFilterPresensiHarian');
  if (btnFilterPresensiHarian) {
    btnFilterPresensiHarian.addEventListener('click', () => {
      fetchPresensiHarian();
    });
  }

  // 5. Modal Foto Close Events
  const btnCloseModalFoto = document.getElementById('btnCloseModalFoto');
  const btnTutupModalFotoFooter = document.getElementById('btnTutupModalFotoFooter');
  const modalFotoPresensi = document.getElementById('modalFotoPresensi');

  if (btnCloseModalFoto) btnCloseModalFoto.addEventListener('click', closeModalFoto);
  if (btnTutupModalFotoFooter) btnTutupModalFotoFooter.addEventListener('click', closeModalFoto);
  if (modalFotoPresensi) {
    modalFotoPresensi.addEventListener('click', (e) => {
      if (e.target === modalFotoPresensi) closeModalFoto();
    });
  }

  // 5b. Modal Foto Bukti Close & Action Events
  const btnCloseModalBukti = document.getElementById('btnCloseModalBukti');
  const btnTutupModalBuktiFooter = document.getElementById('btnTutupModalBuktiFooter');
  const modalFotoBukti = document.getElementById('modalFotoBukti');
  const modalBtnAccBukti = document.getElementById('modalBtnAccBukti');
  const modalBtnTolakBukti = document.getElementById('modalBtnTolakBukti');

  if (btnCloseModalBukti) btnCloseModalBukti.addEventListener('click', closeModalBukti);
  if (btnTutupModalBuktiFooter) btnTutupModalBuktiFooter.addEventListener('click', closeModalBukti);
  if (modalFotoBukti) {
    modalFotoBukti.addEventListener('click', (e) => {
      if (e.target === modalFotoBukti) closeModalBukti();
    });
  }

  if (modalBtnAccBukti) {
    modalBtnAccBukti.addEventListener('click', async () => {
      if (!currentBuktiItem) return;
      const item = currentBuktiItem;
      const docId = item.id;
      const nama = item.resolvedNama || extractNama(item) || 'Peserta';
      const colSource = item.collectionSource || 'leaves';
      closeModalBukti();
      await handleUpdateStatusPresensi(docId, 'approved', nama, null, colSource);
    });
  }

  if (modalBtnTolakBukti) {
    modalBtnTolakBukti.addEventListener('click', async () => {
      if (!currentBuktiItem) return;
      const item = currentBuktiItem;
      const docId = item.id;
      const nama = item.resolvedNama || extractNama(item) || 'Peserta';
      const colSource = item.collectionSource || 'leaves';
      closeModalBukti();
      await handleUpdateStatusPresensi(docId, 'rejected', nama, null, colSource);
    });
  }

  // 6. Search & Date Filter Rekap Events
  const btnCariRekap = document.getElementById('btnCariRekap');
  const btnResetRekap = document.getElementById('btnResetRekap');
  const searchNamaPeserta = document.getElementById('searchNamaPeserta');
  const filterRekapTglMulai = document.getElementById('filterRekapTglMulai');
  const filterRekapTglAkhir = document.getElementById('filterRekapTglAkhir');

  if (btnCariRekap) {
    btnCariRekap.addEventListener('click', () => {
      filterAndRenderRekap();
    });
  }

  if (searchNamaPeserta) {
    searchNamaPeserta.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') {
        filterAndRenderRekap();
      }
    });
  }

  if (filterRekapTglMulai) {
    filterRekapTglMulai.addEventListener('change', () => {
      filterAndRenderRekap();
    });
  }

  if (filterRekapTglAkhir) {
    filterRekapTglAkhir.addEventListener('change', () => {
      filterAndRenderRekap();
    });
  }

  if (btnResetRekap) {
    btnResetRekap.addEventListener('click', () => {
      if (searchNamaPeserta) searchNamaPeserta.value = '';
      if (filterRekapTglMulai) filterRekapTglMulai.value = '';
      if (filterRekapTglAkhir) filterRekapTglAkhir.value = '';
      filterAndRenderRekap();
      showToast('Pencarian dan filter tanggal di-reset.', 'info');
    });
  }

  // 7. Unduh Excel Event
  const btnUnduhExcel = document.getElementById('btnUnduhExcel');
  if (btnUnduhExcel) {
    btnUnduhExcel.addEventListener('click', exportRekapToExcel);
  }

  // 8. Kelola & Hapus Akun Peserta Events
  const searchUserAccount = document.getElementById('searchUserAccount');
  if (searchUserAccount) {
    searchUserAccount.addEventListener('input', (e) => {
      renderUserAccountsTable(e.target.value);
    });
  }

  const btnRefreshUsers = document.getElementById('btnRefreshUsers');
  if (btnRefreshUsers) {
    btnRefreshUsers.addEventListener('click', async () => {
      await fetchAndRenderUserAccounts();
      showToast('Data akun diperbarui dari collection users.', 'info');
    });
  }

  // Modal Konfirmasi Hapus Akun Events
  const btnCloseModalDeleteUser = document.getElementById('btnCloseModalDeleteUser');
  const btnBatalHapusUser = document.getElementById('btnBatalHapusUser');
  const btnExecuteDeleteUser = document.getElementById('btnExecuteDeleteUser');
  const modalConfirmDeleteUser = document.getElementById('modalConfirmDeleteUser');

  if (btnCloseModalDeleteUser) btnCloseModalDeleteUser.addEventListener('click', closeModalDeleteUser);
  if (btnBatalHapusUser) btnBatalHapusUser.addEventListener('click', closeModalDeleteUser);
  if (btnExecuteDeleteUser) btnExecuteDeleteUser.addEventListener('click', executeDeleteUserAccount);
  if (modalConfirmDeleteUser) {
    modalConfirmDeleteUser.addEventListener('click', (e) => {
      if (e.target === modalConfirmDeleteUser) closeModalDeleteUser();
    });
  }

  // Tombol Hapus Akun dari Summary Rekapitulasi
  const btnHapusAkunDariRekap = document.getElementById('btnHapusAkunDariRekap');
  if (btnHapusAkunDariRekap) {
    btnHapusAkunDariRekap.addEventListener('click', () => {
      const searchInput = document.getElementById('searchNamaPeserta');
      const keyword = searchInput ? searchInput.value.trim().toLowerCase() : '';
      let targetUser = null;

      if (keyword) {
        targetUser = STATE.userAccounts.find(u => {
          return String(u.nama || '').toLowerCase().includes(keyword) ||
            String(u.nik || '').toLowerCase().includes(keyword);
        });

        if (!targetUser && STATE.rekapFilteredList && STATE.rekapFilteredList.length > 0) {
          const first = STATE.rekapFilteredList[0];
          targetUser = first.userProfile || {
            id: first.uid || first.userId || first.id,
            nama: first.resolvedNama || first.nama,
            nik: first.resolvedNik || first.nik,
            collectionName: 'users'
          };
        }
      }

      if (targetUser) {
        openModalDeleteUser(targetUser);
      } else {
        showToast('Tidak ada data akun peserta yang terpilih.', 'warning');
      }
    });
  }
});
