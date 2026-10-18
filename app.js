const CONFIG = {
  supabaseUrl: 'https://wwscfwbheozraoakmapp.supabase.co',
  publishableKey: 'sb_publishable_nUTBqEWdev5zHUnEjOTHeQ_C0ZF31CP'
};

const appEl = document.getElementById('app');
const toastEl = document.getElementById('toast');
const modalRoot = document.getElementById('modalRoot');
const modeToggleBtn = document.getElementById('modeToggleBtn');
const modeToggleLabel = document.getElementById('modeToggleLabel');
const modeToggleIcon = document.getElementById('modeToggleIcon');
const teamAccessMenu = document.getElementById('teamAccessMenu');
const logoutBtn = document.getElementById('logoutBtn');
const themeToggleBtn = document.getElementById('themeToggleBtn');

let session = readSession();
let me = null;
let adminCases = [];
let adminUpdates = [];
let adminCasesView = 'cards';
let pendingManageNumber = '';
const preparedUpdateImages = new Map();
const currentCaseMedia = new Map();

function updateImagePrefix(id) { return 'editImage' + String(id).replace(/[^A-Za-z0-9]/g, ''); }

function applyTheme(theme) {
  const chosen = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = chosen;
  try { localStorage.setItem('case_tracker_theme', chosen); } catch {}
  if (themeToggleBtn) themeToggleBtn.textContent = chosen === 'dark' ? '☀ الوضع النهاري' : '☾ الوضع الليلي';
}

function initTheme() {
  let saved = 'light';
  try { saved = localStorage.getItem('case_tracker_theme') || 'light'; } catch {}
  applyTheme(saved);
}

const statusLabels = {
  NEW: 'معلومات أولية',
  IN_PROGRESS: 'قيد المتابعة',
  WAITING_INFORMATION: 'معلقة / بانتظار معلومات',
  REFERRED_TO_AUTHORITY: 'لدى الأمن / الجهة المختصة',
  IN_CUSTODY: 'في قبضة الأمن',
  FOLLOW_UP: 'قيد المتابعة',
  RESOLVED: 'تم الحل',
  CLOSED_NO_FURTHER_ACTION: 'مغلقة دون إجراء إضافي',
  WITHDRAWN: 'مسحوبة'
};

const sourceLabels = {
  RESEARCHER: 'الباحث',
  VICTIM: 'صاحب البلاغ',
  AUTHORITY: 'جهة مختصة',
  OFFICIAL_POST: 'منشور رسمي',
  OTHER: 'مصدر آخر'
};

const verifyLabels = {
  PRELIMINARY: 'معلومة أولية',
  UNDER_VERIFICATION: 'جارٍ التحقق',
  VERIFIED_SOURCE: 'موثقة من مصدر',
  OFFICIAL_STATEMENT: 'بيان رسمي'
};

const visibilityLabels = {
  PUBLIC: 'عام',
  PRIVATE: 'خاص',
  HIDDEN: 'مخفي',
  ARCHIVED: 'أرشيفي'
};

const publicationLabels = {
  DRAFT: 'مسودة',
  REVIEW: 'مسودة',
  PUBLISHED: 'منشور',
  WITHDRAWN: 'مسحوب'
};

const kindLabels = {
  INITIAL: 'المنشور الأول',
  UPDATE: 'تحديث',
  CORRECTION: 'تصحيح',
  RESPONSE: 'رد/توضيح',
  WITHDRAWAL_NOTICE: 'إشعار سحب'
};

function byId(id) {
  return document.getElementById(id);
}

function esc(value = '') {
  return String(value).replace(/[&<>'"]/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[ch]));
}

function fmtDate(value) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('ar-YE', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function isMeaningfullyEdited(row) {
  if (!row?.created_at || !row?.updated_at) return false;
  return Math.abs(new Date(row.updated_at) - new Date(row.created_at)) > 5000;
}

function seenPostKey(row) {
  return 'case_tracker_seen:' + String(row.public_case_number) + ':' + String(row.last_update_at || row.opened_at || '');
}

function hasSeenPost(row) {
  try { return localStorage.getItem(seenPostKey(row)) === '1'; } catch { return false; }
}

function markPostSeen(row) {
  try { localStorage.setItem(seenPostKey(row), '1'); } catch {}
}


async function signImagePath(path) {
  if (!path) return null;
  const encoded = String(path).split('/').map(encodeURIComponent).join('/');
  const response = await fetchWithTimeout(CONFIG.supabaseUrl + '/storage/v1/object/sign/case-images/' + encoded, {
    method: 'POST',
    headers: authHeaders(false),
    body: JSON.stringify({ expiresIn: 3600 })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.signedURL) throw new Error(data.message || 'تعذر تجهيز معاينة الصورة');
  return /^https?:\/\//i.test(data.signedURL) ? data.signedURL : CONFIG.supabaseUrl + '/storage/v1' + data.signedURL;
}

async function prepareImage(file, rect = { x: 0, y: 0, w: 1, h: 1 }) {
  if (!file) return null;
  if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) throw new Error('اختر صورة بصيغة JPG أو PNG أو WebP');
  if (file.size > 500 * 1024 * 1024) throw new Error('حجم الصورة الأصلية يتجاوز الحد الآمن للمعالجة (500 ميجابايت)');
  const bitmap = await createImageBitmap(file);
  const x = Math.max(0, Math.min(1, Number(rect.x) || 0));
  const y = Math.max(0, Math.min(1, Number(rect.y) || 0));
  const w = Math.max(0.02, Math.min(1 - x, Number(rect.w) || 1));
  const h = Math.max(0.02, Math.min(1 - y, Number(rect.h) || 1));
  const sx = Math.round(bitmap.width * x), sy = Math.round(bitmap.height * y);
  const sw = Math.max(1, Math.min(bitmap.width - sx, Math.round(bitmap.width * w)));
  const sh = Math.max(1, Math.min(bitmap.height - sy, Math.round(bitmap.height * h)));
  const scale = Math.min(1, 1600 / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const context = canvas.getContext('2d', { alpha: false });
  context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const toBlob = quality => new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
  let blob = await toBlob(0.84);
  for (const quality of [0.76, 0.68, 0.58]) {
    if (blob && blob.size <= 2 * 1024 * 1024) break;
    blob = await toBlob(quality);
  }
  if (!blob) throw new Error('تعذر ضغط الصورة في هذا المتصفح');
  if (blob.size > 50 * 1024 * 1024) throw new Error('تعذر ضغط الصورة إلى أقل من 50 ميجابايت');
  return blob;
}

function bindImagePicker(prefix, onPrepared) {
  const fileInput = byId(prefix + 'ImageFile');
  const cropPad = byId(prefix + 'CropPad'), cropSource = byId(prefix + 'CropSource'), cropFrame = byId(prefix + 'CropFrame');
  const preview = byId(prefix + 'ImagePreview'), status = byId(prefix + 'ImageStatus');
  let chosenFile = null, sourceUrl = null, previewUrl = null;
  let rect = { x: 0, y: 0, w: 1, h: 1 }, dragStart = null, dragging = false, generation = 0;
  function updateCropFrame() {
    if (!cropPad || !cropSource || !cropFrame || !chosenFile || !cropSource.naturalWidth) return;
    cropFrame.style.left = (rect.x * 100) + '%';
    cropFrame.style.top = (rect.y * 100) + '%';
    cropFrame.style.width = (rect.w * 100) + '%';
    cropFrame.style.height = (rect.h * 100) + '%';
  }
  async function process() {
    const current = ++generation;
    if (!chosenFile) { onPrepared(null); if (preview) preview.classList.add('hidden'); if (status) status.textContent = 'اختر صورة ثم اسحب على الصورة لتحديد الجزء المطلوب، أو تابع دون صورة.'; return; }
    if (status) status.textContent = 'جارٍ تجهيز معاينة الجزء المحدد…';
    try {
      const blob = await prepareImage(chosenFile, rect);
      if (current !== generation) return;
      onPrepared(blob);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(blob);
      if (preview) { preview.src = previewUrl; preview.classList.remove('hidden'); }
      if (status) status.textContent = 'المعاينة جاهزة — يمكنك سحب تحديد جديد بحرية. الحجم بعد الضغط: ' + (blob.size / 1024 / 1024).toFixed(2) + ' ميجابايت';
    } catch (error) { onPrepared(null); if (preview) preview.classList.add('hidden'); if (status) status.textContent = friendlyErrorMessage(error.message); }
  }
  if (fileInput) fileInput.onchange = () => {
    chosenFile = fileInput.files?.[0] || null;
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    sourceUrl = chosenFile ? URL.createObjectURL(chosenFile) : null;
    if (cropSource) cropSource.src = sourceUrl || '';
    if (cropPad) cropPad.classList.toggle('hidden', !chosenFile);
    rect = { x: 0, y: 0, w: 1, h: 1 };
    if (!chosenFile) { process(); return; }
    if (cropSource) cropSource.onload = () => { updateCropFrame(); process(); };
  };
  if (cropPad) {
    cropPad.onpointerdown = event => {
      if (!chosenFile || !cropSource?.naturalWidth) return;
      const box = cropPad.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width));
      const y = Math.max(0, Math.min(1, (event.clientY - box.top) / box.height));
      dragStart = { x, y }; rect = { x, y, w: 0.02, h: 0.02 }; dragging = true;
      cropPad.setPointerCapture?.(event.pointerId); updateCropFrame(); event.preventDefault();
    };
    cropPad.onpointermove = event => {
      if (!dragging || !dragStart) return;
      const box = cropPad.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width));
      const y = Math.max(0, Math.min(1, (event.clientY - box.top) / box.height));
      const left = Math.min(dragStart.x, x), top = Math.min(dragStart.y, y);
      rect = { x: left, y: top, w: Math.max(0.02, Math.abs(x - dragStart.x)), h: Math.max(0.02, Math.abs(y - dragStart.y)) };
      rect.w = Math.min(rect.w, 1 - rect.x); rect.h = Math.min(rect.h, 1 - rect.y);
      updateCropFrame();
    };
    const finishDrag = () => { if (dragging) { dragging = false; dragStart = null; process(); } };
    cropPad.onpointerup = finishDrag; cropPad.onpointercancel = finishDrag;
  }
}

async function uploadCaseImage(blob, caseId, updateId, caption, publish) {
  if (!blob || !session?.user?.id) return;
  const uid = session.user.id;
  const fileName = (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(16).slice(2)) + '.webp';
  const path = uid + '/' + caseId + '/' + fileName;
  const response = await fetchWithTimeout(CONFIG.supabaseUrl + '/storage/v1/object/case-images/' + path.split('/').map(encodeURIComponent).join('/'), {
    method: 'POST',
    headers: { apikey: CONFIG.publishableKey, Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'image/webp', 'x-upsert': 'false' },
    body: blob
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || result.error || 'تعذر رفع الصورة');
  await rest('media', {
    method: 'POST',
    body: {
      case_id: caseId, update_id: updateId || null, file_path: path, media_type: 'IMAGE',
      caption: caption || null, public_visibility: Boolean(publish), approved_for_publication: Boolean(publish), created_by: uid
    },
    prefer: 'return=minimal'
  });
  return path;
}

function sourceMarkup(item) {
  const name = String(item.source_name || '').trim();
  const reference = String(item.source_reference || '').trim();
  if (!name && !reference) return '';
  const referenceHtml = /^https?:\/\//i.test(reference)
    ? '<a href="' + esc(reference) + '" target="_blank" rel="noopener noreferrer">فتح المصدر الأصلي</a>'
    : (reference ? '<span>' + esc(reference) + '</span>' : '');
  return '<div class="source-line"><strong>المصدر:</strong> ' + (name ? esc(name) : 'لم يُذكر اسم المصدر') +
    (referenceHtml ? ' <span class="source-separator">·</span> ' + referenceHtml : '') + '</div>';
}

function imagePickerMarkup(prefix) {
  return '<div class="field full"><label>صورة مرفقة (اختياري)</label>' +
    '<input id="' + prefix + 'ImageFile" type="file" accept="image/jpeg,image/png,image/webp">' +
    '<div id="' + prefix + 'CropPad" class="crop-pad hidden" role="application" aria-label="اسحب على الصورة لتحديد أي مساحة تريد قصها بحرية"><img id="' + prefix + 'CropSource" alt="الصورة الأصلية لتحديد مساحة القص الحر"><div id="' + prefix + 'CropFrame" class="crop-frame" aria-hidden="true"></div></div>' +
    '<img id="' + prefix + 'ImagePreview" class="image-preview hidden" alt="معاينة الصورة بعد القص الحر والضغط">' +
    '<small id="' + prefix + 'ImageStatus" class="muted tiny">اسحب بإصبعك فوق الصورة لتحديد أي مساحة حرة دون نسب أو قوالب جاهزة. إرفاق الصورة اختياري.</small>' +
    '<div class="field"><label>وصف الصورة (اختياري)</label><input id="' + prefix + 'ImageCaption" maxlength="240" placeholder="وصف موجز للصورة"></div></div>';
}

function statusClass(status) {
  return ({
    NEW: 'new',
    IN_PROGRESS: 'progress',
    WAITING_INFORMATION: 'wait',
    REFERRED_TO_AUTHORITY: 'authority',
    IN_CUSTODY: 'custody',
    FOLLOW_UP: 'progress',
    RESOLVED: 'resolved',
    CLOSED_NO_FURTHER_ACTION: 'closed',
    WITHDRAWN: 'closed'
  })[status] || 'closed';
}

function statusBadge(status) {
  return '<span class="badge ' + statusClass(status) + '">' + esc(statusLabels[status] || status) + '</span>';
}

function visibilityBadge(value) {
  const cls = value === 'PUBLIC' ? 'public' : 'private';
  return '<span class="badge ' + cls + '">' + esc(visibilityLabels[value] || value) + '</span>';
}

function publicationBadge(value) {
  const cls = value === 'PUBLISHED' ? 'public' : value === 'WITHDRAWN' ? 'closed' : 'private';
  return '<span class="badge ' + cls + '">' + esc(publicationLabels[value] || value) + '</span>';
}

function sourceBadge(source) {
  return '<span class="badge source">' + esc(sourceLabels[source] || source) + '</span>';
}

function verifyBadge(level) {
  const cls = level === 'OFFICIAL_STATEMENT' ? 'official' : 'verify';
  return '<span class="badge ' + cls + '">' + esc(verifyLabels[level] || level) + '</span>';
}

function toast(message, ms = 3600) {
  toastEl.textContent = message;
  toastEl.classList.remove('hidden');
  clearTimeout(toastEl._timer);
  toastEl._timer = setTimeout(() => toastEl.classList.add('hidden'), ms);
}

function loading() {
  appEl.innerHTML = '<div class="spinner" aria-label="جار التحميل"></div>';
}

function readSession() {
  try {
    return JSON.parse(localStorage.getItem('case_tracker_session') || 'null');
  } catch {
    return null;
  }
}

function saveSession(next) {
  session = next;
  if (next) localStorage.setItem('case_tracker_session', JSON.stringify(next));
  else localStorage.removeItem('case_tracker_session');
  updateNav();
}

function closeTeamAccessMenu() {
  if (!teamAccessMenu) return;
  teamAccessMenu.classList.add('hidden');
  modeToggleBtn?.setAttribute('aria-expanded', 'false');
}

function updateNav() {
  const logged = Boolean(session?.access_token);
  const route = currentRoute();
  const inAdmin = route.view === 'admin';

  logoutBtn.classList.toggle('hidden', !logged);

  if (!logged) {
    modeToggleLabel.textContent = 'دخول الفريق';
    modeToggleIcon.textContent = '◆';
    modeToggleBtn.classList.remove('authenticated');
    return;
  }

  closeTeamAccessMenu();
  modeToggleBtn.classList.add('authenticated');

  if (inAdmin) {
    modeToggleLabel.textContent = 'واجهة الزائر';
    modeToggleIcon.textContent = '◉';
  } else {
    modeToggleLabel.textContent = me?.is_admin ? 'لوحة الإدارة' : 'لوحة الفريق';
    modeToggleIcon.textContent = '◆';
  }
}

function handleModeToggle() {
  if (session?.access_token) {
    closeTeamAccessMenu();
    const route = currentRoute();
    if (route.view === 'admin') navigate('home');
    else navigate('admin', 'overview');
    return;
  }

  const willOpen = teamAccessMenu.classList.contains('hidden');
  teamAccessMenu.classList.toggle('hidden', !willOpen);
  modeToggleBtn.setAttribute('aria-expanded', String(willOpen));
}

function authHeaders(useUser = true) {
  const token = useUser && session?.access_token ? session.access_token : CONFIG.publishableKey;
  return {
    apikey: CONFIG.publishableKey,
    Authorization: 'Bearer ' + token,
    'Content-Type': 'application/json'
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('انتهت مهلة الاتصال. تحقق من الإنترنت وحاول مرة أخرى.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function rest(path, { method = 'GET', body = null, prefer = '', auth = true } = {}) {
  const headers = authHeaders(auth);
  if (prefer) headers.Prefer = prefer;

  const response = await fetchWithTimeout(CONFIG.supabaseUrl + '/rest/v1/' + path, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(data?.message || data?.error_description || data?.hint || ('HTTP ' + response.status));
  }
  return data;
}

async function rpc(name, body = {}, { auth = true } = {}) {
  return rest('rpc/' + name, {
    method: 'POST',
    body,
    auth
  });
}

async function edgeFunction(name, body, { auth = true } = {}) {
  const response = await fetchWithTimeout(CONFIG.supabaseUrl + '/functions/v1/' + name, {
    method: 'POST',
    headers: authHeaders(auth),
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.detail || data?.error || ('HTTP ' + response.status));
  return data;
}

async function getBootstrapStatus() {
  const response = await fetchWithTimeout(CONFIG.supabaseUrl + '/functions/v1/bootstrap-admin', {
    method: 'GET',
    headers: authHeaders(false)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.detail || data?.error || ('HTTP ' + response.status));
  return data;
}

function friendlyErrorMessage(message) {
  const raw = String(message || '').trim();
  if (!raw) return 'تعذر إكمال العملية. حاول مرة أخرى.';
  const exact = {
    'authentication required': 'انتهت جلسة الدخول أو لم يتم تسجيل الدخول. سجّل الدخول مجددًا.',
    'active membership required': 'هذا الحساب غير مفعّل ضمن أعضاء المنصة.',
    'missing create permission': 'لا تملك صلاحية إنشاء القضايا.',
    'missing publish permission': 'لا تملك صلاحية النشر للعامة.',
    'missing add update permission': 'لا تملك صلاحية إضافة التحديثات.',
    'missing edit permission for status change': 'لا تملك صلاحية تغيير حالة القضية.',
    'case not found': 'القضية غير موجودة أو غير متاحة لهذا الحساب.',
    'Failed to fetch': 'تعذر الاتصال بالخادم. تحقق من اتصال الإنترنت ثم أعد المحاولة.'
  };
  if (exact[raw]) return exact[raw];
  if (/failed to fetch|networkerror|network request failed|fetch failed|load failed/i.test(raw)) return 'تعذر الاتصال بالخادم. تحقق من اتصال الإنترنت ثم أعد المحاولة.';
  if (/jwt|token.*expired|session.*expired|invalid refresh token/i.test(raw)) return 'انتهت جلسة الدخول. سجّل الدخول مجددًا.';
  if (/row-level security|permission denied|not authorized|unauthorized|missing .*permission|permission.*denied/i.test(raw)) return 'ليست لديك الصلاحية اللازمة لتنفيذ هذه العملية.';
  if (/duplicate key|unique constraint|already exists/i.test(raw)) return 'توجد بيانات مماثلة مسجلة بالفعل. تحقق من البيانات ثم أعد المحاولة.';
  if (/violates check constraint|check constraint/i.test(raw)) return 'البيانات لا تتوافق مع قواعد التحقق. راجع الحالة ومصدر المعلومة ودرجة التحقق.';
  if (/50.?mb|file size|payload too large|entity too large/i.test(raw)) return 'حجم الصورة بعد المعالجة ما زال أكبر من الحد المسموح. اختر صورة أصغر أو قصّها.';
  if (/[\u0600-\u06FF]/.test(raw)) return raw;
  if (/^HTTP 5\d\d/.test(raw)) return 'الخادم يواجه مشكلة مؤقتة. أعد المحاولة لاحقًا.';
  return 'تعذر إكمال العملية. حاول مرة أخرى، وإذا استمرت المشكلة تواصل مع مدير المنصة.';
}

function bootstrapErrorMessage(message) {
  const map = {
    ADMIN_ALREADY_INITIALIZED: 'تم إنشاء المدير الرئيسي مسبقًا. استخدم تسجيل الدخول.',
    SETUP_WINDOW_CLOSED: 'نافذة تهيئة المدير الرئيسي مغلقة حاليًا.',
    SETUP_ALREADY_CLAIMED: 'تم استخدام تهيئة المدير الرئيسي بالفعل.',
    PASSWORD_TOO_SHORT: 'كلمة المرور يجب أن تكون 10 أحرف على الأقل.',
    INVALID_EMAIL: 'أدخل بريدًا إلكترونيًا صحيحًا.',
    INVALID_ORIGIN: 'لا يمكن تنفيذ التهيئة من هذا العنوان.',
    MISSING_FIELDS: 'أدخل بريد المدير وكلمة المرور.'
  };
  return map[message] || friendlyErrorMessage(message);
}

async function refreshBootstrapSetupNotice() {
  const notice = byId('bootstrapSetupNotice');
  if (!notice) return;

  try {
    const status = await getBootstrapStatus();
    notice.classList.toggle('hidden', !status.open);
  } catch {
    notice.classList.add('hidden');
  }
}

async function signIn(email, password) {
  const response = await fetchWithTimeout(CONFIG.supabaseUrl + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: {
      apikey: CONFIG.publishableKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email, password })
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data?.msg || data?.error_description || 'تعذر تسجيل الدخول');

  saveSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + ((data.expires_in || 3600) * 1000),
    user: data.user
  });
  return data;
}


async function getAuthSettings() {
  const response = await fetchWithTimeout(CONFIG.supabaseUrl + '/auth/v1/settings', {
    headers: { apikey: CONFIG.publishableKey }
  }, 8000);
  if (!response.ok) throw new Error('AUTH_SETTINGS_UNAVAILABLE');
  return response.json();
}

async function refreshGoogleLoginAvailability() {
  const button = byId('googleLoginButton');
  const note = byId('googleLoginNote');
  if (!button || !note) return;

  try {
    const settings = await getAuthSettings();
    const enabled = Boolean(settings?.external?.google);
    button.disabled = !enabled;
    note.textContent = enabled
      ? 'يمكنك الدخول بحساب Google إذا كان بريده مطابقًا لبريد عضويتك في الفريق.'
      : 'الدخول عبر Google جاهز في التطبيق لكنه يحتاج تفعيل Google Provider مرة واحدة في Supabase.';
  } catch {
    button.disabled = true;
    note.textContent = 'تعذر التحقق من إعداد Google حاليًا.';
  }
}

function startGoogleSignIn() {
  const redirectTo = 'https://naseerak.com/';
  const url = CONFIG.supabaseUrl +
    '/auth/v1/authorize?provider=google&redirect_to=' + encodeURIComponent(redirectTo);
  const button = byId('googleLoginButton');
  if (button) { button.disabled = true; button.textContent = 'جارٍ فتح تسجيل Google…'; }
  location.assign(url);
}

async function consumeOAuthCallback() {
  // Supabase implicit OAuth returns access/refresh tokens in the URL fragment.
  // Some provider/error paths return parameters in the query string instead.
  const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
  const queryParams = new URLSearchParams(location.search);
  const params = new URLSearchParams([...queryParams.entries(), ...hashParams.entries()]);
  const hasOAuthTokens = Boolean(params.get('access_token') && params.get('refresh_token'));
  const isCallback = location.pathname.endsWith('/auth/callback');
  if (!isCallback && !hasOAuthTokens && !params.get('error') && !params.get('error_description')) return false;

  const oauthError = params.get('error_description') || params.get('error');

  if (oauthError) {
    history.replaceState({}, '', '/#login');
    toast('تعذر تسجيل الدخول عبر Google: ' + oauthError, 6000);
    return false;
  }

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  const expiresIn = Number(params.get('expires_in') || 3600);

  if (!accessToken || !refreshToken) {
    history.replaceState({}, '', '/#login');
    toast('لم تكتمل جلسة Google. حاول مرة أخرى.', 6000);
    return false;
  }

  const response = await fetchWithTimeout(CONFIG.supabaseUrl + '/auth/v1/user', {
    headers: {
      apikey: CONFIG.publishableKey,
      Authorization: 'Bearer ' + accessToken
    }
  });

  const user = await response.json();
  if (!response.ok || !user?.id) {
    history.replaceState({}, '', '/#login');
    toast('تعذر قراءة حساب Google بعد تسجيل الدخول.', 6000);
    return false;
  }

  saveSession({
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: Date.now() + (expiresIn * 1000),
    user
  });

  await loadMeWithRetry(3);

  const activationParams = new URLSearchParams(location.search);
  const activationCode = activationParams.get('code');
  const activationEmail = (activationParams.get('email') || '').trim().toLowerCase();
  if (location.pathname === '/activate' && activationCode && activationEmail) {
    try {
      if (String(user.email || '').trim().toLowerCase() !== activationEmail) {
        throw new Error('INVITED_GOOGLE_EMAIL_MISMATCH');
      }
      await edgeFunction('accept-staff-invite', {
        inviteCode: activationCode,
        email: activationEmail,
        displayName: activationParams.get('displayName') || user.user_metadata?.full_name || null
      });
      await loadMeWithRetry(3);
      if (!me?.is_active) throw new Error('INVITE_ACTIVATION_FAILED');
      const username = activationParams.get('username') || '';
      if (username) await rpc('update_my_profile', { p_username: username });
      history.replaceState({}, '', '/admin#overview');
      toast('تم تفعيل الدعوة لحساب Google المدعو بنجاح.');
      return true;
    } catch (error) {
      saveSession(null);
      me = null;
      const retryUrl = '/activate?email=' + encodeURIComponent(activationEmail) +
        '&code=' + encodeURIComponent(activationCode) +
        '&username=' + encodeURIComponent(activationParams.get('username') || '') +
        '&displayName=' + encodeURIComponent(activationParams.get('displayName') || '');
      history.replaceState({}, '', retryUrl);
      toast(error.message === 'INVITED_GOOGLE_EMAIL_MISMATCH' || error.message === 'INVALID_OR_EXPIRED_INVITE' || error.message === 'INVITE_ALREADY_USED'
        ? 'قم بتسجيل الدخول عبر حسابك الذي دُعيت له عبر قوقل'
        : friendlyErrorMessage(error.message), 7000);
      return false;
    }
  }

  if (!me?.is_active) {
    saveSession(null);
    history.replaceState({}, '', '/#login');
    toast('هذا البريد ليس عضوًا نشطًا في فريق المنصة.', 6000);
    return false;
  }

  history.replaceState({}, '', '/admin#overview');
  return true;
}

async function refreshIfNeeded() {
  if (!session?.refresh_token) return false;
  if ((session.expires_at || 0) - Date.now() > 120000) return true;

  const response = await fetchWithTimeout(CONFIG.supabaseUrl + '/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    headers: {
      apikey: CONFIG.publishableKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ refresh_token: session.refresh_token })
  });

  if (!response.ok) {
    saveSession(null);
    return false;
  }

  const data = await response.json();
  saveSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + ((data.expires_in || 3600) * 1000),
    user: data.user
  });
  return true;
}

async function loadMe() {
  if (!session?.user?.id) return null;
  await refreshIfNeeded();
  if (!session?.user?.id) return null;
  const rows = await rest('staff_permissions?user_id=eq.' + encodeURIComponent(session.user.id) + '&select=*');
  me = rows?.[0] || null;
  return me;
}

async function loadMeWithRetry(attempts = 3) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const profile = await loadMe();
      if (profile) return profile;
    } catch (error) {
      lastError = error;
    }
    if (attempt + 1 < attempts) {
      await new Promise(resolve => setTimeout(resolve, 350 * (attempt + 1)));
    }
  }
  if (lastError) throw lastError;
  return me;
}

function can(name) {
  return Boolean(me?.is_admin || me?.[name]);
}

function navigate(view, param = '') {
  const isWeb = location.protocol === 'http:' || location.protocol === 'https:';

  if (isWeb) {
    if (view === 'home') history.pushState({}, '', '/');
    else if (view === 'case') history.pushState({}, '', '/case/' + encodeURIComponent(param));
    else if (view === 'admin') history.pushState({}, '', '/admin#' + encodeURIComponent(param || 'overview'));
    else history.pushState({}, '', '/#' + view + (param ? '/' + encodeURIComponent(param) : ''));
    render();
    return;
  }

  location.hash = param ? '#' + view + '/' + encodeURIComponent(param) : '#' + view;
}

function currentRoute() {
  const path = location.pathname.replace(/\/+$/, '');
  const caseMatch = path.match(/\/case\/([^/]+)$/);

  if (caseMatch) return { view: 'case', param: decodeURIComponent(caseMatch[1]) };
  if (path.endsWith('/activate')) return { view: 'activate', param: '' };
  if (path.endsWith('/admin')) {
    return { view: 'admin', param: decodeURIComponent(location.hash.replace(/^#/, '') || 'overview') };
  }

  const raw = location.hash.replace(/^#/, '') || 'home';
  const [view, ...restParts] = raw.split('/');
  return { view, param: decodeURIComponent(restParts.join('/')) };
}

function bindGlobalNav() {
  if (themeToggleBtn) themeToggleBtn.onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  document.querySelectorAll('[data-nav]').forEach(button => {
    button.onclick = () => {
      closeTeamAccessMenu();
      navigate(button.dataset.nav);
    };
  });

  modeToggleBtn.onclick = handleModeToggle;

  logoutBtn.onclick = () => {
    closeTeamAccessMenu();
    saveSession(null);
    me = null;
    navigate('home');
    toast('تم تسجيل الخروج');
  };
}

function closeModal() {
  modalRoot.innerHTML = '';
  document.body.style.overflow = '';
}

function openModal(content, wide = false) {
  modalRoot.innerHTML =
    '<div class="modal-backdrop" id="activeModalBackdrop">' +
      '<div class="modal ' + (wide ? 'wide' : '') + '" role="dialog" aria-modal="true">' +
        content +
      '</div>' +
    '</div>';

  document.body.style.overflow = 'hidden';
  byId('activeModalBackdrop').addEventListener('click', event => {
    if (event.target === event.currentTarget) closeModal();
  });
  document.querySelectorAll('[data-close-modal]').forEach(button => {
    button.onclick = closeModal;
  });
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  area.remove();
}

async function render() {
  initTheme();
  updateNav();
  const { view, param } = currentRoute();

  try {
    if (view === 'home') return renderHome();
    if (view === 'case') return renderCase(param);
    if (view === 'login') return renderLogin();
    if (view === 'activate') return renderActivate();
    if (view === 'setup') return renderSetup();
    if (view === 'admin') return renderAdmin(param || 'overview');
    navigate('home');
  } catch (error) {
    appEl.innerHTML =
      '<section class="card auth-card">' +
        '<div class="notice danger"><strong>تعذر إكمال العملية.</strong><br>' + esc(friendlyErrorMessage(error.message)) + '</div>' +
        '<div class="form-actions" style="margin-top:12px"><button class="soft-btn" data-nav="home">العودة للرئيسية</button></div>' +
      '</section>';
    bindGlobalNav();
  }
}

function renderHome() {
  appEl.innerHTML =
    '<section class="hero naseerak-dashboard-hero">' +
      '<div class="hero-inner">' +
        '<span class="hero-kicker">● لوحة متابعة القضايا</span>' +
        '<h1>كل مستجدات القضية في مكان واحد</h1>' +
        '<p>ابحث برقم القضية أو اسمها أو اسم الشخص أو المنطقة أو حالة المتابعة من خانة واحدة.</p>' +
        '<form class="hero-search unified-case-search" id="unifiedPublicSearchForm">' +
          '<div class="search-control"><span class="hash" aria-hidden="true">⌕</span><input id="unifiedPublicQuery" autocomplete="off" placeholder="رقم القضية، الاسم، المنطقة، أو الحالة…" aria-label="البحث برقم القضية أو الاسم أو الحالة" required></div>' +
          '<button type="submit">بحث</button>' +
        '</form>' +
        '<div class="dashboard-quick-links" aria-label="أقسام المتابعة">' +
          '<button type="button" data-dashboard-filter="all"><span class="quick-icon">▤</span><span><strong>القضايا المنشورة</strong><small>تصفح آخر القضايا العامة</small></span><span class="quick-arrow">←</span></button>' +
          '<button type="button" data-dashboard-filter="active"><span class="quick-icon blue">◷</span><span><strong>قضايا قيد المتابعة</strong><small>الوصول السريع للقضايا النشطة</small></span><span class="quick-arrow">←</span></button>' +
          '<button type="button" data-dashboard-filter="authority"><span class="quick-icon amber">!</span><span><strong>قضايا بيد الجهات المختصة</strong><small>القضايا التي تتابعها الجهات المختصة</small></span><span class="quick-arrow">←</span></button>' +
          '<button type="button" data-dashboard-filter="solved"><span class="quick-icon green">✓</span><span><strong>تم حل القضية</strong><small>عرض القضايا التي انتهت بحل</small></span><span class="quick-arrow">←</span></button>' +
        '</div>' +
      '</div>' +
    '</section>' +
    '<section class="section dashboard-cases-section" id="recentCasesSection">' +
      '<div class="section-head public-feed-heading"><h2 class="section-title"><span class="dot"></span>أحدث القضايا العامة</h2></div>' +
      '<div id="recentCasesGrid" class="case-grid"><div class="spinner"></div></div>' +
    '</section>';

  byId('unifiedPublicSearchForm').onsubmit = async event => {
    event.preventDefault();
    const query = byId('unifiedPublicQuery').value.trim();
    if (!query) return;
    if (/^#?\d+$/.test(query)) {
      navigate('case', query.replace(/^#/, ''));
      return;
    }
    const normalized = query.toLocaleLowerCase('ar');
    const stateMap = [
      ['تم حل القضية', 'SOLVED_ANY'], ['تم الحل', 'SOLVED_ANY'], ['محلولة', 'SOLVED_ANY'], ['مغلقة', 'SOLVED_ANY'],
      ['في قبضة الأمن', 'IN_CUSTODY'], ['قبض الأمن', 'IN_CUSTODY'],
      ['لدى الأمن', 'REFERRED_TO_AUTHORITY'], ['جهة مختصة', 'AUTHORITY_ANY'],
      ['مسحوبة', 'WITHDRAWN'], ['معلومات أولية', 'NEW'], ['جديدة', 'NEW'], ['عاجلة', 'NEW'],
      ['معلقة', 'WAITING_INFORMATION'], ['بانتظار معلومات', 'WAITING_INFORMATION'],
      ['قيد المتابعة', 'IN_PROGRESS'], ['جارية', 'IN_PROGRESS']
    ];
    const match = stateMap.find(([label]) => normalized.includes(label));
    await loadPublicSearchResults(match ? '' : query, match ? match[1] : '');
    byId('recentCasesSection')?.scrollIntoView({behavior:'smooth',block:'start'});
  };

  document.querySelectorAll('[data-dashboard-filter]').forEach(button => {
    button.onclick = async () => {
      const filter = button.dataset.dashboardFilter;
      const query = '';
      if (filter === 'all') await loadRecentPublicCases();
      else await loadPublicSearchResults(query, filter === 'active' ? 'IN_PROGRESS' : filter === 'authority' ? 'AUTHORITY_ANY' : filter === 'solved' ? 'SOLVED_ANY' : 'WAITING_INFORMATION');
      byId('recentCasesSection')?.scrollIntoView({behavior:'smooth',block:'start'});
    };
  });

  loadRecentPublicCases();
}

async function loadPublicSearchResults(query, status) {
  const grid = byId('recentCasesGrid');
  if (!grid) return;
  grid.innerHTML = '<div class="spinner"></div>';
  try {
    const rows = await rpc('search_public_cases', { p_query: query || null, p_status: status || null, p_limit: 50 }, { auth: false });
    if (!rows?.length) { grid.innerHTML = '<div class="card empty" style="grid-column:1/-1"><h2>لا توجد نتائج مطابقة</h2><p>جرّب اسمًا أو منطقة أو كلمة مختلفة.</p></div>'; return; }
    await renderPublicCaseCards(grid, rows);
  } catch (error) {
    grid.innerHTML = '<div class="notice danger" style="grid-column:1/-1">تعذر تنفيذ البحث: ' + esc(friendlyErrorMessage(error.message)) + '</div>';
  }
}

async function renderPublicCaseCards(grid, rows) {
  const thumbUrls = await Promise.all(rows.map(row => row.thumbnail_path ? signImagePath(row.thumbnail_path).catch(() => null) : Promise.resolve(null)));
  grid.innerHTML = rows.map((row, rowIndex) => {
    const last = row.last_update_at || row.opened_at;
    const unread = !hasSeenPost(row);
    return '<article class="public-card" data-case-number="' + esc(row.public_case_number) + '" tabindex="0" role="button">' +
      '<div class="public-card-top"><span class="case-chip">القضية #' + esc(row.public_case_number) + '</span>' + statusBadge(row.status) +
      (unread ? '<span class="badge new post-new-badge" aria-label="تحديث لم تتم رؤيته">منشور جديد</span>' : '') + '</div>' +
      (thumbUrls[rowIndex] ? '<img class="case-thumb" src="' + esc(thumbUrls[rowIndex]) + '" alt="صورة المنشور الأول للقضية" loading="lazy">' : '') +
      '<div><h3>' + esc(row.title) + '</h3>' + (row.region ? '<small class="muted">المنطقة: ' + esc(row.region) + '</small>' : '') + '</div>' +
      '<div class="public-card-bottom update-counter-row' + (unread ? ' is-unread' : '') + '"><span><strong class="updates-count">' + esc(row.updates_count || 0) + '</strong> تحديثات منشورة</span><span>' + esc(fmtDate(last)) + '</span></div>' +
      '</article>';
  }).join('');
  document.querySelectorAll('[data-case-number]').forEach(card => {
    const go = () => { const row = rows.find(item => String(item.public_case_number) === String(card.dataset.caseNumber)); if (row) markPostSeen(row); navigate('case', card.dataset.caseNumber); };
    card.onclick = go;
    card.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); go(); } };
  });
}

async function loadRecentPublicCases() {
  const grid = byId('recentCasesGrid');
  if (!grid) return;

  try {
    const rows = await rpc('get_recent_public_cases', { p_limit: 6 }, { auth: false });

    if (!rows?.length) {
      grid.innerHTML =
        '<div class="card empty" style="grid-column:1/-1">' +
          '<h2>لا توجد قضايا عامة منشورة بعد</h2>' +
          '<p>عند اعتماد أول قضية للنشر العام ستظهر هنا تلقائيًا.</p>' +
        '</div>';
      return;
    }

    await renderPublicCaseCards(grid, rows);
  } catch (error) {
    grid.innerHTML =
      '<div class="notice danger" style="grid-column:1/-1">تعذر تحميل القضايا العامة: ' + esc(friendlyErrorMessage(error.message)) + '</div>';
  }
}

async function renderCase(number) {
  if (!/^\d+$/.test(number || '')) {
    navigate('home');
    return;
  }

  loading();

  const [cases, updates, mediaRows] = await Promise.all([
    rpc('get_public_case_by_number', { p_number: Number(number) }, { auth: false }),
    rpc('get_public_case_updates', { p_number: Number(number) }, { auth: false }),
    rpc('get_public_case_media', { p_number: Number(number) }, { auth: false })
  ]);

  const caseRow = cases?.[0];
  if (!caseRow) {
    appEl.innerHTML =
      '<section class="card empty auth-card">' +
        '<h2>لم نجد قضية عامة بهذا الرقم</h2>' +
        '<p>تحقق من الرقم، أو قد تكون القضية خاصة أو لم تعتمد للنشر العام بعد.</p>' +
        '<div class="form-actions" style="justify-content:center"><button class="soft-btn" data-nav="home">بحث جديد</button></div>' +
      '</section>';
    bindGlobalNav();
    return;
  }

  const list = updates || [];
  const latest = list[list.length - 1] || null;
  const byUpdateId = new Map(list.map(item => [item.id, item]));
  const signedMedia = await Promise.all((mediaRows || []).map(async item => ({ ...item, url: await signImagePath(item.file_path).catch(() => null) })));
  const mediaByUpdate = new Map();
  signedMedia.forEach(item => { if (item.url) { const key = item.update_id || 'case'; if (!mediaByUpdate.has(key)) mediaByUpdate.set(key, []); mediaByUpdate.get(key).push(item); } });

  const timeline = list.length ? list.map((item, index) => {
    const correctionTarget = item.correction_of_update_id ? byUpdateId.get(item.correction_of_update_id) : null;
    const correctionNote = item.correction_of_update_id
      ? '<div class="correction"><strong>تصحيح شفاف:</strong> هذا التحديث يصحح تحديثًا سابقًا' +
        (correctionTarget ? ' منشورًا بتاريخ ' + esc(fmtDate(correctionTarget.published_at || correctionTarget.created_at)) : '') +
        '.</div>'
      : '';

    const editedNote = isMeaningfullyEdited(item)
      ? '<div class="edited-note">تم تعديل هذا السجل إداريًا بتاريخ ' + esc(fmtDate(item.updated_at)) + '.</div>'
      : '';

    return (
      '<article class="timeline-item" data-timeline-index="' + index + '">' +
        '<span class="timeline-index">' + (item.timeline_number || index + 1) + '</span>' +
        '<div class="timeline-card">' +
          '<div class="timeline-head">' +
            '<div class="timeline-badges">' +
              sourceBadge(item.source_type) +
              verifyBadge(item.verification_level) +
              '<span class="badge verify">' + esc(item.update_kind === 'INITIAL' ? 'المنشور الأول' : item.update_kind === 'UPDATE' ? 'تحديث ' + (item.timeline_number || index + 1) : (kindLabels[item.update_kind] || item.update_kind)) + '</span>' +
            '</div>' +
            '<span class="timeline-date">' + esc(fmtDate(item.published_at || item.created_at)) + '</span>' +
          '</div>' +
          '<p>' + esc(item.update_text) + '</p>' +
          sourceMarkup(item) +
          (mediaByUpdate.get(item.id) || []).map(media => '<figure class="timeline-media"><img src="' + esc(media.url) + '" alt="' + esc(media.caption || 'صورة مرفقة') + '" loading="lazy"><figcaption>' + esc(media.caption || '') + '</figcaption></figure>').join('') +
          correctionNote +
          editedNote +
        '</div>' +
      '</article>'
    );
  }).join('') : '<div class="empty">لا توجد تحديثات عامة منشورة لهذه القضية بعد.</div>';

  appEl.innerHTML =
    '<div class="case-toolbar">' +
      '<button class="back-btn" data-nav="home">← العودة للبحث</button>' +
      '<button class="primary-btn" id="shareCaseBtn">مشاركة القضية</button>' +
    '</div>' +

    '<section class="quick-status">' +
      '<div class="quick-grid">' +
        '<div class="quick-main">' +
          '<div class="quick-meta">' +
            '<span class="case-chip">القضية #' + esc(caseRow.public_case_number) + '</span>' +
            statusBadge(caseRow.status) +
            '<span class="timeline-date">تاريخ الفتح: ' + esc(fmtDate(caseRow.opened_at)) + '</span>' +
            (caseRow.region ? '<span class="badge">المنطقة: ' + esc(caseRow.region) + '</span>' : '') +
            (caseRow.subject_name ? '<span class="badge">الاسم المرتبط: ' + esc(caseRow.subject_name) + '</span>' : '') +
          '</div>' +
          '<h1>' + esc(caseRow.title) + '</h1>' +
        '</div>' +
        '<aside class="latest-box">' +
          '<small>آخر مستجد مباشر</small>' +
          '<strong>' + esc(latest?.update_text || 'لا توجد تحديثات منشورة بعد.') + '</strong>' +
          '<span>' + (latest ? 'تاريخ التحديث: ' + esc(fmtDate(latest.published_at || latest.created_at)) : '—') + '</span>' +
        '</aside>' +
      '</div>' +
    '</section>' +

    '<section class="card section">' +
      '<div class="section-head">' +
        '<h2 class="section-title"><span class="dot"></span>السجل الزمني للتحديثات</h2>' +
        '<span class="section-meta">' + list.length + ' تحديثات منشورة</span>' +
      '</div>' +
      '<div class="timeline-view-toggle"><button type="button" class="soft-btn active" id="showAllUpdates">عرض كل التحديثات</button><button type="button" class="soft-btn" id="showLatestUpdate">عرض آخر تحديث فقط</button></div>' +
      '<div class="timeline-wrap"><div class="timeline">' + timeline + '</div></div>' +
    '</section>';

  bindGlobalNav();
  byId('shareCaseBtn').onclick = () => openShareModal(number);
  const setTimelineMode = mode => {
    document.querySelectorAll('[data-timeline-index]').forEach((node, index) => node.classList.toggle('timeline-hidden', mode === 'latest' && index !== list.length - 1));
    byId('showAllUpdates')?.classList.toggle('active', mode === 'all');
    byId('showLatestUpdate')?.classList.toggle('active', mode === 'latest');
  };
  byId('showAllUpdates')?.addEventListener('click', () => setTimelineMode('all'));
  byId('showLatestUpdate')?.addEventListener('click', () => setTimelineMode('latest'));
  markPostSeen({ public_case_number: caseRow.public_case_number, last_update_at: caseRow.last_update_at || caseRow.opened_at });
}

function openShareModal(number) {
  const url = location.origin + '/case/' + encodeURIComponent(number);

  openModal(
    '<div class="modal-head"><h3>مشاركة القضية #' + esc(number) + '</h3><button class="modal-close" data-close-modal aria-label="إغلاق">×</button></div>' +
    '<div class="modal-body">' +
      '<p class="muted tiny">يمكن إرسال الرابط المباشر إلى المتابعين لفتح أحدث نسخة من السجل المنشور.</p>' +
      '<div class="field"><label>الرابط المباشر</label><input id="shareLinkInput" class="mono" readonly value="' + esc(url) + '"></div>' +
      '<div class="form-actions" style="margin-top:14px">' +
        '<button class="primary-btn" id="copyShareLink">نسخ الرابط</button>' +
        (navigator.share ? '<button class="soft-btn" id="nativeShareLink">مشاركة من الهاتف</button>' : '') +
      '</div>' +
    '</div>'
  );

  byId('copyShareLink').onclick = async () => {
    await copyText(url);
    toast('تم نسخ رابط القضية');
  };

  const native = byId('nativeShareLink');
  if (native) {
    native.onclick = async () => {
      try {
        await navigator.share({ title: 'القضية #' + number, url });
      } catch {}
    };
  }
}

function renderLogin() {
  appEl.innerHTML =
    '<div class="auth-layout auth-layout-login">' +
    '<section class="card auth-card">' +
      '<div class="auth-head"><h1>دخول فريق التحرير</h1><p>الدخول مخصص للمدير وأعضاء الفريق المدعوين. الصلاحيات محفوظة لكل حساب في قاعدة البيانات.</p></div>' +
      '<form id="loginForm" class="form-grid">' +
        '<div class="field full"><label>البريد الإلكتروني</label><input id="loginEmail" type="email" autocomplete="email" required></div>' +
        '<div class="field full"><label>كلمة المرور</label><input id="loginPassword" type="password" autocomplete="current-password" required></div>' +
        '<div class="form-actions field full"><button class="primary-btn" type="submit">دخول</button><button class="soft-btn" type="button" data-nav="activate">تفعيل دعوة عضو</button></div>' +
      '</form>' +
      '<div style="display:flex;align-items:center;gap:10px;margin:18px 0;color:var(--slate-400);font-size:11px"><span style="height:1px;background:var(--slate-200);flex:1"></span><span>أو</span><span style="height:1px;background:var(--slate-200);flex:1"></span></div>' +
      '<button class="soft-btn" id="googleLoginButton" type="button" style="width:100%;justify-content:center" disabled>الدخول عبر Google</button>' +
      '<p id="googleLoginNote" class="tiny muted" style="margin:7px 0 0">جارٍ التحقق من توفر تسجيل Google...</p>' +
      '<div id="bootstrapSetupNotice" class="notice warn hidden" style="margin-top:16px"><strong>هذه أول تهيئة للمنصة فقط.</strong> المدير الرئيسي لا يحتاج رمز دعوة. <button class="soft-btn" style="margin-right:6px" data-nav="setup">إنشاء المدير الرئيسي</button></div>' +
    '</section>' +
    '<aside class="auth-visual" aria-label="عن منصة نصيرك">' +
      '<div class="auth-visual-brand"><span class="auth-visual-shield" aria-hidden="true">ن</span><div><strong>نصيرك</strong><small>NASEERAK</small></div></div>' +
      '<div class="auth-visual-copy"><span class="auth-kicker">متابعة مسؤولة وموثوقة</span><h2>كل مستجد في مكان واحد.</h2><p>سجل زمني واضح لمستجدات قضايا الابتزاز المنشورة، مع توضيح مصدر المعلومة ودرجة التحقق.</p></div>' +
      '<div class="auth-visual-foot"><span>مصادر واضحة</span><span>سجل زمني</span><span>صلاحيات مضبوطة</span></div>' +
    '</aside>' +
    '</div>';

  bindGlobalNav();
  refreshBootstrapSetupNotice();
  refreshGoogleLoginAvailability();

  byId('googleLoginButton').onclick = startGoogleSignIn;

  byId('loginForm').onsubmit = async event => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;

    try {
      await signIn(byId('loginEmail').value.trim(), byId('loginPassword').value);
      await loadMeWithRetry(3);
      if (!me) throw new Error('الحساب موجود لكنه غير مخول لإدارة المنصة.');
      if (!me.is_active) throw new Error('عضوية هذا الحساب غير نشطة.');
      toast('تم تسجيل الدخول');
      navigate('admin');
    } catch (error) {
      saveSession(null);
      toast(friendlyErrorMessage(error.message), 5200);
    } finally {
      button.disabled = false;
    }
  };
}

function renderActivate() {
  const params = new URLSearchParams(location.search);
  const presetEmail = params.get('email') || '';
  const presetCode = params.get('code') || '';
  const presetUsername = params.get('username') || '';

  appEl.innerHTML =
    '<section class="card auth-card">' +
      '<div class="auth-head"><h1>تفعيل دعوة الفريق</h1><p>استخدم حساب Google نفسه الذي أُرسلت إليه الدعوة. لا يمكن تفعيل الدعوة ببريد آخر، ولا يمكن استخدام الرمز مرة ثانية.</p></div>' +
      (presetEmail && presetCode ? '<div class="notice success" style="margin-bottom:14px">دعوة مخصصة للبريد: <strong>' + esc(presetEmail) + '</strong>. يجب تسجيل الدخول عبر Google بهذا البريد نفسه.</div>' : '<div class="notice warning">افتح رابط الدعوة الأصلي المرسل إلى بريدك.</div>') +
      '<form id="activateForm" class="form-grid">' +
        '<div class="field full"><label>البريد المدعو (للمراجعة فقط)</label><input id="activateEmail" type="email" value="' + esc(presetEmail) + '" readonly required></div>' +
        '<div class="field full"><label>اسم المستخدم * (3–30 حرفًا إنجليزيًا أو رقمًا أو . _ -)</label><input id="activateUsername" required minlength="3" maxlength="30" pattern="[A-Za-z0-9_.-]{3,30}" autocomplete="username" value="' + esc(presetUsername) + '" placeholder="مثال: ahmed_researcher"></div>' +
        '<div class="field full"><label>الاسم الظاهر (اختياري)</label><input id="activateName" maxlength="100"></div>' +
        '<div class="form-actions field full"><button class="primary-btn" type="submit">تسجيل الدخول عبر Google وتفعيل الدعوة</button><button class="soft-btn" type="button" data-nav="login">لدي حساب بالفعل</button></div>' +
      '</form>' +
      '<p class="muted tiny">إذا ظهرت رسالة بأن الدعوة مستخدمة أو الحساب غير مطابق، فاضغط «لدي حساب بالفعل» وسجّل الدخول بالبريد الذي دُعيت إليه.</p>' +
    '</section>';

  bindGlobalNav();
  byId('activateForm').onsubmit = event => {
    event.preventDefault();
    const email = byId('activateEmail').value.trim().toLowerCase();
    const username = byId('activateUsername').value.trim();
    if (!email || !presetCode) { toast('رابط الدعوة غير مكتمل. افتح الرابط المرسل إلى بريدك.', 6000); return; }
    if (!/^[A-Za-z0-9_.-]{3,30}$/.test(username)) { toast('اسم المستخدم يجب أن يكون من 3 إلى 30 حرفًا إنجليزيًا أو رقمًا أو . _ -', 5000); return; }
    const displayName = byId('activateName').value.trim();
    const redirectTo = 'https://naseerak.com/activate?email=' + encodeURIComponent(email) +
      '&code=' + encodeURIComponent(presetCode) + '&username=' + encodeURIComponent(username) +
      '&displayName=' + encodeURIComponent(displayName);
    const url = CONFIG.supabaseUrl + '/auth/v1/authorize?provider=google&redirect_to=' + encodeURIComponent(redirectTo);
    const button = event.submitter;
    if (button) { button.disabled = true; button.textContent = 'جارٍ فتح تسجيل Google…'; }
    location.assign(url);
  };
}

function renderSetup() {
  appEl.innerHTML =
    '<section class="card auth-card">' +
      '<div id="setupAvailability"><div class="notice success"><strong>تهيئة المدير الرئيسي — مرة واحدة فقط.</strong> لا تحتاج إلى رمز دعوة. رموز الدعوة مخصصة فقط لأعضاء الفريق الذين ستضيفهم أنت لاحقًا.</div>' +
      '<div class="auth-head" style="margin-top:18px"><h1>إنشاء المدير الرئيسي</h1><p>أدخل اسمك وبريدك وكلمة مرور قوية. بعد نجاح إنشاء أول مدير تُغلق هذه التهيئة تلقائيًا.</p></div>' +
      '<form id="setupForm" class="form-grid">' +
        '<div class="field full"><label>اسم المدير</label><input id="setupName" autocomplete="name"></div>' +
        '<div class="field full"><label>بريد المدير</label><input id="setupEmail" type="email" autocomplete="email" required></div>' +
        '<div class="field full"><label>كلمة مرور قوية — 10 أحرف على الأقل</label><input id="setupPassword" type="password" minlength="10" autocomplete="new-password" required></div>' +
        '<div class="form-actions field full"><button class="primary-btn" id="setupSubmitBtn" type="submit" disabled>إنشاء المدير الرئيسي</button><button class="soft-btn" type="button" data-nav="login">رجوع</button></div>' +
      '</form></div>' +
    '</section>';

  bindGlobalNav();

  (async () => {
    try {
      const status = await getBootstrapStatus();
      if (!status.open) {
        byId('setupAvailability').innerHTML =
          '<div class="notice info"><strong>تم إغلاق تهيئة المدير الرئيسي.</strong><br>إذا تم إنشاء المدير سابقًا، استخدم تسجيل الدخول. أعضاء الفريق الجدد تتم إضافتهم لاحقًا من لوحة الإدارة بواسطة الدعوات.</div>' +
          '<div class="form-actions" style="margin-top:12px"><button class="soft-btn" data-nav="login">العودة لتسجيل الدخول</button></div>';
        bindGlobalNav();
        return;
      }
      byId('setupSubmitBtn').disabled = false;
    } catch {
      byId('setupAvailability').innerHTML =
        '<div class="notice danger">تعذر التحقق من حالة التهيئة الآن. أعد تحميل الصفحة وحاول مرة أخرى.</div>' +
        '<div class="form-actions" style="margin-top:12px"><button class="soft-btn" data-nav="login">رجوع</button></div>';
      bindGlobalNav();
    }
  })();

  byId('setupForm').onsubmit = async event => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;

    try {
      await edgeFunction('bootstrap-admin', {
        displayName: byId('setupName').value.trim() || null,
        email: byId('setupEmail').value.trim(),
        password: byId('setupPassword').value
      }, { auth: false });

      toast('تم إنشاء المدير الرئيسي بنجاح. سجل الدخول الآن.');
      navigate('login');
    } catch (error) {
      toast(bootstrapErrorMessage(error.message), 6000);
      button.disabled = false;
    }
  };
}

async function renderAdmin(section) {
  if (!session?.access_token) {
    navigate('login');
    return;
  }

  loading();
  await refreshIfNeeded();
  await loadMeWithRetry(3);

  if (!me?.is_active) {
    saveSession(null);
    me = null;
    navigate('login');
    toast('هذا الحساب غير مخول أو تم تعطيله.', 6000);
    return;
  }

  let profileRows = [];
  try { profileRows = await rest('member_profiles?user_id=eq.' + encodeURIComponent(session.user.id) + '&select=username&limit=1'); } catch {}
  if (!profileRows.length) section = 'profile';

  const tabs = [
    ['overview', 'نظرة عامة'],
    ['manage', 'إدارة قضية'],
    ['drafts', 'المسودات'],
    ['profile', 'ملفي الشخصي']
  ];
  if (me.is_admin) tabs.push(['team', 'الفريق والصلاحيات']);

  const tabIcons = {
    overview: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></svg>',
    manage: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5h6l2 2h8v9.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M4 8.5v-2a2 2 0 0 1 2-2h4l2 2h4"/></svg>',
    drafts: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></svg>',
    profile: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.7-3.1 3.2-5 7-5s6.3 1.9 7 5"/></svg>',
    team: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 19c.4-2.7 2.4-4.5 6-4.5s5.6 1.8 6 4.5"/><path d="M16 5.5a3 3 0 0 1 0 5.8M17 15c2.3.3 3.6 1.6 4 4"/></svg>'
  };
  appEl.innerHTML =
    '<div class="admin-layout">' +
      '<aside class="admin-sidebar">' +
        '<div class="admin-sidebar-head">' +
          '<span class="admin-sidebar-logo" aria-hidden="true">ن</span>' +
          '<div><strong>مساحة الفريق</strong><small>نصيرك · متابعة المستجدات</small></div>' +
        '</div>' +
        '<div class="admin-sidebar-label">التنقل</div>' +
        '<nav class="admin-tabs" aria-label="أقسام لوحة الفريق">' +
          tabs.map(([key, label]) =>
            '<button class="admin-tab ' + (section === key ? 'active' : '') + '" data-admin-section="' + key + '" aria-current="' + (section === key ? 'page' : 'false') + '">' +
              '<span class="admin-tab-icon" aria-hidden="true">' + tabIcons[key] + '</span><span>' + label + '</span>' +
            '</button>'
          ).join('') +
        '</nav>' +
        '' +
      '</aside>' +
      '<div class="admin-main">' +
        '<section class="admin-hero">' +
          '<div>' +
            '<div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap"><h1>لوحة متابعة القضايا</h1>' +
              (me.is_admin ? '<span class="badge admin">مدير</span>' : '') +
            '</div>' +
            '<p>' + esc(me.display_name || me.email) + ' — راجع المستجدات ومصادرها قبل النشر. الصلاحيات تُطبّق من قاعدة البيانات.</p>' +
          '</div>' +
          '<div class="admin-actions">' +
            (can('can_create_case') ? '<button class="primary-btn" id="newCaseAction">+ إنشاء قضية</button>' : '') +
            (can('can_add_update') ? '<button class="soft-btn" id="addUpdateAction">إضافة تحديث زمني</button>' : '') +
            (can('can_view_private') ? '<button class="soft-btn" id="auditAction">سجل التدقيق</button>' : '') +
          '</div>' +
        '</section>' +
        '<div id="adminBody"></div>' +
      '</div>' +
    '</div>';

  document.querySelectorAll('[data-admin-section]').forEach(button => {
    button.onclick = () => navigate('admin', button.dataset.adminSection);
  });

  const newCaseAction = byId('newCaseAction');
  if (newCaseAction) newCaseAction.onclick = openNewCaseModal;

  const addUpdateAction = byId('addUpdateAction');
  if (addUpdateAction) addUpdateAction.onclick = () => openAddUpdateModal();

  const auditAction = byId('auditAction');
  if (auditAction) auditAction.onclick = openAuditLogModal;

  if (section === 'new') {
    await adminOverview();
    openNewCaseModal();
    return;
  }

  if (section === 'update') {
    await adminOverview();
    openAddUpdateModal();
    return;
  }

  if (section === 'overview') return adminOverview();
  if (section === 'manage') return adminManage();
  if (section === 'drafts') return adminDrafts();
  if (section === 'profile') return adminProfile();
  if (section === 'team' && me.is_admin) return adminTeam();

  navigate('admin', 'overview');
}



async function deleteStoredImage(path) {
  if (!path) return;
  const encoded = String(path).split('/').map(encodeURIComponent).join('/');
  const response = await fetchWithTimeout(CONFIG.supabaseUrl + '/storage/v1/object/case-images/' + encoded, {
    method: 'DELETE',
    headers: { apikey: CONFIG.publishableKey, Authorization: 'Bearer ' + session.access_token }
  });
  if (!response.ok && response.status !== 404) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || 'تعذر حذف ملف الصورة');
  }
}

async function adminDrafts() {
  const body = byId('adminBody');
  body.innerHTML = '<div class="spinner"></div>';
  try {
    const [cases, updates, media] = await Promise.all([
      rest('cases?created_by=eq.' + encodeURIComponent(session.user.id) + '&publication_status=eq.DRAFT&select=id,public_case_number,title,status,created_at&order=created_at.desc&limit=100'),
      rest('case_updates?created_by=eq.' + encodeURIComponent(session.user.id) + '&publication_status=eq.DRAFT&select=id,case_id,update_kind,update_text,created_at&order=created_at.desc&limit=100'),
      rest('media?created_by=eq.' + encodeURIComponent(session.user.id) + '&select=id,case_id,file_path')
    ]);
    const ownCaseIds = new Set((cases || []).map(item => item.id));
    const draftUpdates = (updates || []).filter(item => !ownCaseIds.has(item.case_id));
    body.innerHTML =
      '<section class="card"><div class="section-head"><h2>مسوداتي</h2><span class="section-meta">لا تظهر هذه العناصر للزوار أو بقية الأعضاء</span></div>' +
      '<h3>مسودات القضايا (' + cases.length + ')</h3>' +
      (cases.length ? '<div class="member-list">' + cases.map(item =>
        '<article class="member-row"><div class="member-head"><div><h4>' + esc(item.title) + '</h4><p>رقم القضية #' + esc(item.public_case_number) + ' · ' + esc(fmtDate(item.created_at)) + '</p></div><span class="badge">مسودة</span></div>' +
        '<div class="form-actions" style="margin-top:10px"><button class="soft-btn" data-open-draft="' + esc(item.public_case_number) + '">تعديل المسودة</button>' +
        (can('can_publish_case') && can('can_publish_update') ? '<button class="primary-btn" data-publish-draft="' + esc(item.id) + '">نشر للعامة</button>' : '') +
        '<button class="danger-btn" data-delete-draft="' + esc(item.id) + '">حذف المسودة</button></div></article>'
      ).join('') + '</div>' : '<p class="muted">لا توجد مسودات قضايا.</p>') +
      '<h3 style="margin-top:20px">مسودات التحديثات المنفصلة (' + draftUpdates.length + ')</h3>' +
      (draftUpdates.length ? '<div class="member-list">' + draftUpdates.map(item =>
        '<article class="member-row"><div class="member-head"><div><h4>' + esc(kindLabels[item.update_kind] || item.update_kind) + '</h4><p>' + esc(item.update_text.slice(0,180)) + '</p><small class="muted">' + esc(fmtDate(item.created_at)) + '</small></div><span class="badge">مسودة</span></div>' +
        '<div class="form-actions" style="margin-top:10px"><button class="soft-btn" data-open-update-draft="' + esc(item.case_id) + '">فتح القضية وتعديل التحديث</button></div></article>'
      ).join('') + '</div>' : '<p class="muted">لا توجد مسودات تحديثات منفصلة.</p>') +
      '</section>';
    document.querySelectorAll('[data-open-draft]').forEach(button => button.onclick = () => { pendingManageNumber = button.dataset.openDraft; navigate('admin', 'manage'); });
    document.querySelectorAll('[data-open-update-draft]').forEach(button => button.onclick = async () => {
      const caseRows = await rest('cases?id=eq.' + encodeURIComponent(button.dataset.openUpdateDraft) + '&select=public_case_number&limit=1');
      if (caseRows?.[0]) { pendingManageNumber = String(caseRows[0].public_case_number); navigate('admin', 'manage'); }
    });
    document.querySelectorAll('[data-publish-draft]').forEach(button => button.onclick = async () => {
      button.disabled = true;
      try {
        const number = await rpc('publish_my_draft_case', { p_case_id: button.dataset.publishDraft });
        toast('تم نشر القضية رقم #' + (number || '—'));
        await adminDrafts();
      } catch (error) { toast(friendlyErrorMessage(error.message), 6000); button.disabled = false; }
    });
    document.querySelectorAll('[data-delete-draft]').forEach(button => button.onclick = async () => {
      if (!confirm('هل تريد حذف هذه المسودة نهائيًا؟ لا يمكن التراجع عن الحذف.')) return;
      button.disabled = true;
      try {
        const publishedUpdates = await rest('case_updates?case_id=eq.' + encodeURIComponent(button.dataset.deleteDraft) + '&publication_status=eq.PUBLISHED&select=id&limit=1');
        if (publishedUpdates?.length) throw new Error('تحتوي المسودة على تحديث منشور؛ اسحب التحديثات أولًا قبل حذفها');
        const paths = (media || []).filter(item => item.case_id === button.dataset.deleteDraft).map(item => item.file_path);
        for (const path of paths) await deleteStoredImage(path);
        await rpc('delete_my_draft_case', { p_case_id: button.dataset.deleteDraft });
        toast('تم حذف المسودة');
        await adminDrafts();
      } catch (error) { toast(friendlyErrorMessage(error.message), 6000); button.disabled = false; }
    });
  } catch (error) {
    body.innerHTML = '<section class="card"><div class="notice danger">تعذر تحميل المسودات: ' + esc(friendlyErrorMessage(error.message)) + '</div></section>';
  }
}

async function adminProfile() {
  const body = byId('adminBody');
  let rows = [];
  let ownPosts = [];
  let ownUpdates = [];
  let linkedCases = [];
  try { rows = await rest('member_profiles?user_id=eq.' + encodeURIComponent(session.user.id) + '&select=username,updated_at&limit=1'); } catch {}
  try { ownPosts = await rest('cases?created_by=eq.' + encodeURIComponent(session.user.id) + '&select=id,public_case_number,title,status,publication_status,created_at,last_update_at&order=updated_at.desc&limit=100'); } catch {}
  try { ownUpdates = await rest('case_updates?created_by=eq.' + encodeURIComponent(session.user.id) + '&select=id,case_id,update_kind,update_text,publication_status,created_at,published_at,timeline_number&order=created_at.desc&limit=100'); } catch {}
  const linkedCaseIds = [...new Set((ownUpdates || []).map(item => item.case_id).filter(Boolean))];
  if (linkedCaseIds.length) {
    try { linkedCases = await rest('cases?select=id,public_case_number,title&id=in.(' + linkedCaseIds.join(',') + ')'); } catch {}
  }
  const caseLookup = new Map([...(ownPosts || []), ...(linkedCases || [])].map(item => [item.id, item]));
  const profile = rows?.[0] || {};
  body.innerHTML =
    '<section class="card">' +
      '<h2>ملفي الشخصي</h2>' +
      '<p class="muted">اسم المستخدم إلزامي لعضوية الفريق، ويمكن تغييره لاحقًا. لا يظهر اسم المستخدم للزوار في المنشورات العامة.</p>' +
      '<form id="profileForm" class="form-grid" style="margin-top:14px">' +
        '<div class="field full"><label>اسم المستخدم</label><input id="profileUsername" required minlength="3" maxlength="30" pattern="[A-Za-z0-9_.-]{3,30}" autocomplete="username" value="' + esc(profile.username || '') + '" placeholder="مثال: ahmed_researcher"></div>' +
        '<div class="field full"><small class="muted">من 3 إلى 30 حرفًا: الحروف الإنجليزية والأرقام والنقطة والشرطة والشرطة السفلية.</small></div>' +
        '<div class="form-actions field full"><button class="primary-btn" type="submit">حفظ اسم المستخدم</button></div>' +
      '</form>' +
      '<hr style="border:0;border-top:1px solid var(--slate-200);margin:22px 0">' +
      '<div class="section-head"><h3>منشوراتي</h3><span class="section-meta">' + ownPosts.length + ' قضية</span></div>' +
      (ownPosts.length ? '<div class="member-list">' + ownPosts.map(item =>
        '<article class="member-row"><div class="member-head"><div><h4>' + esc(item.title) + '</h4><p>القضية #' + esc(item.public_case_number) + ' · آخر تحديث ' + esc(fmtDate(item.last_update_at || item.created_at)) + '</p></div><div style="display:flex;gap:5px;flex-wrap:wrap">' + statusBadge(item.status) + publicationBadge(item.publication_status) + '</div></div>' +
        '<div class="form-actions" style="margin-top:10px"><button class="soft-btn" data-profile-manage="' + esc(item.public_case_number) + '">مراجعة / تعديل المنشور</button></div></article>'
      ).join('') + '</div>' : '<p class="muted">لم تنشر أو تنشئ أي قضية بعد.</p>') +
      '<hr style="border:0;border-top:1px solid var(--slate-200);margin:22px 0">' +
      '<div class="section-head"><h3>التحديثات التي كتبتها</h3><span class="section-meta">' + (ownUpdates || []).length + ' تحديث</span></div>' +
      ((ownUpdates || []).length ? '<div class="member-list">' + ownUpdates.map(item => {
        const parent = caseLookup.get(item.case_id);
        const itemLabel = item.update_kind === 'INITIAL' ? 'المنشور الأول' : item.update_kind === 'UPDATE' ? 'تحديث ' + (item.timeline_number || 'قيد النشر') : (kindLabels[item.update_kind] || item.update_kind);
        return '<article class="member-row"><div class="member-head"><div><h4>' + esc(itemLabel) + (parent?.title ? ' — ' + esc(parent.title) : '') + '</h4><p>' + (parent?.public_case_number ? 'القضية #' + esc(parent.public_case_number) + ' · ' : '') + esc(fmtDate(item.published_at || item.created_at)) + '</p></div>' + publicationBadge(item.publication_status) + '</div>' +
          '<p class="tiny" style="white-space:pre-wrap;margin-top:8px">' + esc(String(item.update_text || '').slice(0, 180)) + '</p>' +
          (parent?.public_case_number ? '<div class="form-actions" style="margin-top:10px"><button class="soft-btn" data-profile-update-manage="' + esc(parent.public_case_number) + '">فتح القضية وتحديثاتها</button></div>' : '') +
          '</article>';
      }).join('') + '</div>' : '<p class="muted">لا توجد تحديثات كتبتها حتى الآن.</p>') +
    '</section>';
  document.querySelectorAll('[data-profile-manage]').forEach(button => button.onclick = () => { pendingManageNumber = button.dataset.profileManage; navigate('admin', 'manage'); });
  document.querySelectorAll('[data-profile-update-manage]').forEach(button => button.onclick = () => { pendingManageNumber = button.dataset.profileUpdateManage; navigate('admin', 'manage'); });
  byId('profileForm').onsubmit = async event => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try {
      await rpc('update_my_profile', { p_username: byId('profileUsername').value.trim() });
      toast('تم حفظ اسم المستخدم');
      navigate('admin', 'overview');
    } catch (error) {
      toast(friendlyErrorMessage(error.message), 6000);
      button.disabled = false;
    }
  };
}

async function adminOverview() {
  const body = byId('adminBody');
  body.innerHTML = '<div class="spinner"></div>';

  [adminCases, adminUpdates] = await Promise.all([
    rest('cases?select=id,public_case_number,title,summary,status,visibility,publication_status,opened_at,last_update_at,created_by&order=last_update_at.desc.nullslast,opened_at.desc&limit=500'),
    rest('case_updates?select=id,case_id,publication_status&limit=1500')
  ]);

  const published = adminCases.filter(item => item.publication_status === 'PUBLISHED').length;
  const drafts = adminCases.filter(item => item.publication_status === 'DRAFT' || item.publication_status === 'REVIEW').length;
  const statIcons = {
    cases: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5h6l2 2h8v8.8a1.7 1.7 0 0 1-1.7 1.7H5.7A1.7 1.7 0 0 1 4 18.3z"/><path d="M4 8V6a2 2 0 0 1 2-2h4l2 2h4"/></svg>',
    published: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="m8 12.3 2.6 2.6 5.5-5.5"/></svg>',
    drafts: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h8l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 20z"/><path d="M14 3.5V8h4M9 13h6M9 16.5h6"/></svg>',
    updates: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5h16M4 12h16M4 17.5h10"/><circle cx="18" cy="17.5" r="2.5"/></svg>'
  };
  body.innerHTML =
    '<div class="stats-grid">' +
      '<div class="stat stat-total"><div class="stat-top"><span>القضايا ضمن صلاحياتك</span><span class="stat-icon">' + statIcons.cases + '</span></div><strong>' + adminCases.length + '</strong><span class="stat-caption">قضايا متاحة للمراجعة</span></div>' +
      '<div class="stat stat-published"><div class="stat-top"><span>قضايا منشورة</span><span class="stat-icon">' + statIcons.published + '</span></div><strong>' + published + '</strong><span class="stat-caption">حالتها منشورة حاليًا</span></div>' +
      '<div class="stat stat-drafts"><div class="stat-top"><span>مسودات</span><span class="stat-icon">' + statIcons.drafts + '</span></div><strong>' + drafts + '</strong><span class="stat-caption">غير منشورة للعامة</span></div>' +
      '<div class="stat stat-updates"><div class="stat-top"><span>تحديثات مرئية للحساب</span><span class="stat-icon">' + statIcons.updates + '</span></div><strong>' + adminUpdates.length + '</strong><span class="stat-caption">بحسب نطاق العرض الحالي</span></div>' +
    '</div>' +
    '<section class="table-card section admin-cases-panel">' +
      '<div class="admin-list-heading"><div><h2>سجل القضايا</h2><p>ابحث وفلتر، ثم افتح القضية لمراجعة سجلها الزمني.</p></div></div>' +
      '<div class="table-toolbar">' +
        '<div class="admin-filters">' +
          '<input id="adminTableSearch" aria-label="البحث في القضايا" placeholder="تصفية برقم القضية أو العنوان...">' +
          '<select id="adminStatusFilter" aria-label="فلترة حسب الحالة"><option value="ALL">جميع الحالات</option>' + statusOptions() + '</select>' +
        '</div>' +
        '<div class="admin-toolbar-actions">' +
          '<div class="admin-view-toggle" role="group" aria-label="طريقة عرض القضايا">' +
            '<button type="button" id="adminViewCards" class="' + (adminCasesView === 'cards' ? 'active' : '') + '" aria-pressed="' + (adminCasesView === 'cards' ? 'true' : 'false') + '"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></svg>بطاقات</button>' +
            '<button type="button" id="adminViewTable" class="' + (adminCasesView === 'table' ? 'active' : '') + '" aria-pressed="' + (adminCasesView === 'table' ? 'true' : 'false') + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16M4 10h16M4 15h16M4 20h16M9 5v15M16 5v15"/></svg>جدول</button>' +
          '</div>' +
          '<button class="soft-btn" id="exportCsvBtn">تصدير CSV</button>' +
        '</div>' +
      '</div>' +
      '<div id="adminCasesDisplay" class="admin-cases-display" aria-live="polite"></div>' +
    '</section>';

  byId('adminTableSearch').oninput = renderAdminCasesTable;
  byId('adminStatusFilter').onchange = renderAdminCasesTable;
  byId('adminViewCards').onclick = () => setAdminCasesView('cards');
  byId('adminViewTable').onclick = () => setAdminCasesView('table');
  byId('exportCsvBtn').onclick = exportCasesCsv;
  setAdminCasesView(adminCasesView);
}

function setAdminCasesView(view) {
  adminCasesView = view === 'table' ? 'table' : 'cards';
  const cardsButton = byId('adminViewCards');
  const tableButton = byId('adminViewTable');
  if (cardsButton) {
    cardsButton.classList.toggle('active', adminCasesView === 'cards');
    cardsButton.setAttribute('aria-pressed', String(adminCasesView === 'cards'));
  }
  if (tableButton) {
    tableButton.classList.toggle('active', adminCasesView === 'table');
    tableButton.setAttribute('aria-pressed', String(adminCasesView === 'table'));
  }
  renderAdminCasesTable();
}

function renderAdminCasesTable() {
  const display = byId('adminCasesDisplay');
  if (!display) return;

  const search = (byId('adminTableSearch')?.value || '').trim().toLowerCase();
  const status = byId('adminStatusFilter')?.value || 'ALL';
  const updateCounts = new Map();
  for (const update of adminUpdates) {
    updateCounts.set(update.case_id, (updateCounts.get(update.case_id) || 0) + 1);
  }

  const rows = adminCases.filter(item => {
    const matchSearch =
      String(item.public_case_number).includes(search) ||
      String(item.title || '').toLowerCase().includes(search);
    const matchStatus = status === 'ALL' || item.status === status;
    return matchSearch && matchStatus;
  });

  if (!rows.length) {
    display.innerHTML = '<div class="empty"><h2>لا توجد نتائج مطابقة</h2><p>جرّب رقم قضية أو عنوانًا أو حالة مختلفة.</p></div>';
    return;
  }

  if (adminCasesView === 'cards') {
    display.innerHTML = '<div class="admin-case-grid">' + rows.map(item =>
      '<article class="admin-case-card">' +
        '<div class="admin-case-card-top"><span class="case-chip">القضية #' + esc(item.public_case_number) + '</span><span class="admin-case-time">آخر نشاط: ' + esc(fmtDate(item.last_update_at || item.opened_at)) + '</span></div>' +
        '<h3>' + esc(item.title) + '</h3>' +
        '<p class="admin-case-summary">' + esc(item.summary || 'لا يوجد ملخص إضافي مسجل.') + '</p>' +
        '<div class="admin-case-badges">' + statusBadge(item.status) + visibilityBadge(item.visibility) + publicationBadge(item.publication_status) + '</div>' +
        '<div class="admin-case-meta"><div><span>التحديثات المرتبطة</span><strong>' + (updateCounts.get(item.id) || 0) + '</strong></div><div><span>تاريخ بدء السجل</span><strong>' + esc(fmtDate(item.opened_at)) + '</strong></div></div>' +
        '<div class="admin-case-actions"><button class="primary-btn" data-manage-case="' + esc(item.public_case_number) + '">فتح وإدارة القضية</button>' +
          (can('can_add_update') ? '<button class="soft-btn" data-add-update-case="' + esc(item.id) + '">+ تحديث</button>' : '') +
        '</div>' +
      '</article>'
    ).join('') + '</div>';
  } else {
    display.innerHTML =
      '<div class="table-scroll"><table class="data-table">' +
        '<thead><tr><th>رقم القضية</th><th>العنوان والملخص</th><th>الحالة</th><th>الظهور</th><th>النشر</th><th>التحديثات</th><th>آخر نشاط</th><th style="text-align:center">الإجراءات</th></tr></thead>' +
        '<tbody id="adminCasesTbody">' + rows.map(item =>
          '<tr>' +
            '<td><span class="case-chip">#' + esc(item.public_case_number) + '</span></td>' +
            '<td><div class="row-title">' + esc(item.title) + '</div><div class="row-summary">' + esc(item.summary || '—') + '</div></td>' +
            '<td>' + statusBadge(item.status) + '</td>' +
            '<td>' + visibilityBadge(item.visibility) + '</td>' +
            '<td>' + publicationBadge(item.publication_status) + '</td>' +
            '<td class="mono">' + (updateCounts.get(item.id) || 0) + '</td>' +
            '<td class="tiny nowrap">' + esc(fmtDate(item.last_update_at || item.opened_at)) + '</td>' +
            '<td><div class="row-actions"><button class="icon-btn" data-manage-case="' + esc(item.public_case_number) + '">إدارة</button>' +
              (can('can_add_update') ? '<button class="icon-btn" data-add-update-case="' + esc(item.id) + '">+ تحديث</button>' : '') +
            '</div></td>' +
          '</tr>'
        ).join('') + '</tbody></table></div>';
  }

  document.querySelectorAll('[data-manage-case]').forEach(button => {
    button.onclick = () => {
      pendingManageNumber = button.dataset.manageCase;
      navigate('admin', 'manage');
    };
  });
  document.querySelectorAll('[data-add-update-case]').forEach(button => {
    button.onclick = () => openAddUpdateModal(button.dataset.addUpdateCase);
  });
}

function exportCasesCsv() {
  if (!adminCases.length) {
    toast('لا توجد بيانات لتصديرها');
    return;
  }

  const rows = [
    ['Public_ID', 'Title', 'Status', 'Visibility', 'Publication_Status', 'Opened_At'],
    ...adminCases.map(item => [
      item.public_case_number,
      item.title,
      item.status,
      item.visibility,
      item.publication_status,
      item.opened_at
    ])
  ];

  const csv = rows.map(row => row.map(value => '"' + String(value ?? '').replace(/"/g, '""') + '"').join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'cases-export-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast('تم تجهيز ملف CSV');
}

function statusOptions(selected = '') {
  return Object.entries(statusLabels)
    .map(([value, label]) => '<option value="' + value + '" ' + (selected === value ? 'selected' : '') + '>' + esc(label) + '</option>')
    .join('');
}

function sourceOptions(selected = 'RESEARCHER') {
  return Object.entries(sourceLabels)
    .map(([value, label]) => '<option value="' + value + '" ' + (selected === value ? 'selected' : '') + '>' + esc(label) + '</option>')
    .join('');
}

function verifyOptions(selected = 'PRELIMINARY') {
  return Object.entries(verifyLabels)
    .map(([value, label]) => '<option value="' + value + '" ' + (selected === value ? 'selected' : '') + '>' + esc(label) + '</option>')
    .join('');
}

function openNewCaseModal() {
  if (!can('can_create_case')) { toast('لا تملك صلاحية إنشاء القضايا'); return; }
  const mayPublishNow = can('can_publish_case') && can('can_publish_update');
  openModal(
    '<div class="modal-head"><h3>إنشاء بلاغ جديد</h3><button class="modal-close" data-close-modal aria-label="إغلاق">×</button></div>' +
    '<div class="modal-body"><form id="newCaseForm" class="form-grid">' +
      '<div class="field full"><label>عنوان القضية *</label><input id="newCaseTitle" maxlength="220" required placeholder="عنوان مختصر وواضح"></div>' +
      '<div class="field"><label>المنطقة / المحافظة</label><input id="newCaseRegion" maxlength="120" placeholder="مثال: صنعاء"></div>' +
      '<div class="field"><label>الاسم المرتبط بالقضية (اختياري)</label><input id="newCaseSubject" maxlength="160" placeholder="اسم الشخص أو الجهة المرتبطة"></div>' +
      '<div class="field"><label>الحالة</label><select id="newCaseStatus">' + statusOptions('IN_PROGRESS') + '</select></div>' +
      '<input id="newCaseMode" type="hidden" value="DRAFT">' +
      '<div class="field full"><label>المنشور الأول للقضية *</label><textarea id="newCaseInitial" required placeholder="النص الأول الذي يبدأ به السجل الزمني"></textarea></div>' +
      '<div class="field"><label>نوع المصدر</label><select id="newCaseSource">' + sourceOptions() + '</select></div>' +
      '<div class="field"><label>درجة التحقق</label><select id="newCaseVerify">' + verifyOptions() + '</select></div>' +
      '<div class="field full"><label>اسم الباحث / مصدر المعلومة</label><input id="newCaseSourceName" list="researcherSuggestions" maxlength="160" placeholder="اسم الباحث أو مصدر المعلومة"><datalist id="researcherSuggestions"><option value="أحمد غازي"></option></datalist></div>' +
      '<div class="field full"><label>رابط المنشور الأصلي أو مرجع المصدر</label><input id="newCaseSourceRef" maxlength="1000" placeholder="https://… أو مرجع واضح"></div>' +
      imagePickerMarkup('newCase') +
      '<div class="field full"><div class="notice info">سيُحفظ البلاغ كمسودة أولًا لتراجع معاينة المنشور قبل نشره للعامة. يمكنك نشره بصورة أو تأكيد النشر بدون صورة.</div></div>' +
      '<div class="form-actions field full"><button class="soft-btn" type="button" data-close-modal>إلغاء</button><button class="primary-btn" type="submit">معاينة المنشور</button></div>' +
    '</form></div>'
  );
  let preparedCaseImage = null;
  bindImagePicker('newCase', blob => { preparedCaseImage = blob; });
  const syncNewCaseVerification = () => {
    const status = byId('newCaseStatus').value;
    if (['RESOLVED', 'CLOSED_NO_FURTHER_ACTION'].includes(status) && !['VERIFIED_SOURCE', 'OFFICIAL_STATEMENT'].includes(byId('newCaseVerify').value)) byId('newCaseVerify').value = 'VERIFIED_SOURCE';
    if (byId('newCaseVerify').value === 'OFFICIAL_STATEMENT' && !['AUTHORITY','OFFICIAL_POST'].includes(byId('newCaseSource').value)) byId('newCaseSource').value = 'OFFICIAL_POST';
  };
  byId('newCaseVerify').addEventListener('change', syncNewCaseVerification);
  byId('newCaseSource').addEventListener('change', syncNewCaseVerification);
  byId('newCaseStatus').addEventListener('change', syncNewCaseVerification);
  byId('newCaseForm').onsubmit = async event => {
    event.preventDefault();
    const button = event.submitter; button.disabled = true;
    const values = {
      title: byId('newCaseTitle').value.trim(), region: byId('newCaseRegion').value.trim(),
      subject: byId('newCaseSubject').value.trim(), status: byId('newCaseStatus').value,
      initialText: byId('newCaseInitial').value.trim(), source: byId('newCaseSource').value,
      sourceName: byId('newCaseSourceName').value.trim(), sourceRef: byId('newCaseSourceRef').value.trim(),
      verify: byId('newCaseVerify').value, imageCaption: byId('newCaseImageCaption').value.trim()
    };
    try {
      const result = await rpc('create_case_with_initial_update', {
        p_title: values.title, p_summary: null, p_status: values.status, p_visibility: 'PRIVATE',
        p_region: values.region || null, p_subject_name: values.subject || null, p_initial_text: values.initialText,
        p_source_type: values.source, p_source_name: values.sourceName || null, p_source_reference: values.sourceRef || null,
        p_verification_level: values.verify, p_publish: false
      });
      const created = result?.[0];
      if (!created?.id) throw new Error('تعذر إنشاء مسودة البلاغ');
      closeModal();
      openNewCasePublishPreview({created, values, imageBlob: preparedCaseImage, mayPublishNow});
    } catch (error) { toast(friendlyErrorMessage(error.message), 6000); button.disabled = false; }
  };
}
function openNewCasePublishPreview({created, values, imageBlob, mayPublishNow}) {
  const imageUrl = imageBlob ? URL.createObjectURL(imageBlob) : null;
  openModal(
    '<div class="modal-head"><h3>معاينة البلاغ قبل النشر</h3><button class="modal-close" data-close-modal aria-label="إغلاق">×</button></div>' +
    '<div class="modal-body"><article class="draft-post-preview">' +
      '<div class="public-card-top"><span class="case-chip">القضية #' + esc(created.public_case_number) + '</span>' + statusBadge(values.status) + '</div>' +
      (imageUrl ? '<img class="draft-preview-image" src="' + esc(imageUrl) + '" alt="معاينة صورة المنشور الأول">' : '<div class="draft-preview-no-image">لم تُرفق صورة — يمكنك تأكيد النشر بدون صورة.</div>') +
      '<h3>' + esc(values.title) + '</h3>' + (values.region ? '<p class="muted">المنطقة: ' + esc(values.region) + '</p>' : '') +
      '<p class="draft-preview-text">' + esc(values.initialText).replace(/\n/g, '<br>') + '</p>' +
      '<div class="draft-preview-meta">' + esc(verifyLabels[values.verify] || values.verify) + (values.sourceName ? ' · المصدر: ' + esc(values.sourceName) : '') + '</div>' +
    '</article>' +
    (mayPublishNow ? (imageBlob
      ? '<div class="form-actions preview-actions"><button class="primary-btn" id="confirmPublishWithImage">نشر البلاغ بالصورة</button></div>'
      : '<div class="publish-without-image-confirm"><div class="notice warning" role="alert"><strong>تنبيه قبل النشر:</strong> هذا البلاغ لا يحتوي على صورة. تأكد من أن نشره دون صورة مقصود؛ يمكنك الرجوع وإرفاق صورة بدلًا من ذلك.</div><label class="publish-confirm-checkbox"><input type="checkbox" id="confirmPublishWithoutImage"> <span>أؤكد أنني أريد نشر هذا البلاغ دون صورة</span></label><div class="form-actions preview-actions"><button class="primary-btn" id="publishWithoutImageButton" disabled>نشر البلاغ بدون صورة</button></div></div>')
      : '<div class="notice info">حُفظ البلاغ كمسودة. لا تملك هذه العضوية صلاحية النشر؛ سيظهر البلاغ في قائمة المسودات للمخول بالنشر.</div>') +
    '<div class="form-actions"><button class="soft-btn" type="button" data-close-modal>إغلاق المعاينة</button></div></div>'
  );
  let imageUploaded = false, uploadedDraftImagePath = null;
  const publishDraft = async includeImage => {
    const button = byId(includeImage ? 'confirmPublishWithImage' : 'publishWithoutImageButton');
    if (button) button.disabled = true;
    try {
      if (includeImage && imageBlob && !imageUploaded) {
        const initialRows = await rest('case_updates?case_id=eq.' + encodeURIComponent(created.id) + '&update_kind=eq.INITIAL&created_by=eq.' + encodeURIComponent(session.user.id) + '&select=id&order=created_at.desc&limit=1');
        if (!initialRows?.[0]?.id) throw new Error('تعذر العثور على المنشور الأول لإرفاق الصورة');
        uploadedDraftImagePath = await uploadCaseImage(imageBlob, created.id, initialRows[0].id, values.imageCaption || null, false);
        imageUploaded = true;
      }
      if (!includeImage && imageUploaded && uploadedDraftImagePath) {
        const mediaRows = await rest('media?file_path=eq.' + encodeURIComponent(uploadedDraftImagePath) + '&select=id&limit=1');
        if (mediaRows?.[0]?.id) {
          await rpc('delete_case_media', { p_media_id: mediaRows[0].id });
          await deleteStoredImage(uploadedDraftImagePath);
        }
        imageUploaded = false;
        uploadedDraftImagePath = null;
      }
      const number = await rpc('publish_my_draft_case', { p_case_id: created.id });
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      closeModal(); toast('تم نشر القضية رقم #' + (number || created.public_case_number) + ' للعامة');
      if (currentRoute().view === 'admin') await adminOverview(); else await renderHome();
    } catch (error) { toast(friendlyErrorMessage(error.message), 6000); if (button) button.disabled = false; }
  };
  if (mayPublishNow && byId('confirmPublishWithImage')) byId('confirmPublishWithImage').onclick = () => publishDraft(true);
  const noImageAcknowledgement = byId('confirmPublishWithoutImage');
  const noImagePublishButton = byId('publishWithoutImageButton');
  if (noImageAcknowledgement && noImagePublishButton) {
    noImageAcknowledgement.addEventListener('change', () => {
      noImagePublishButton.disabled = !noImageAcknowledgement.checked;
    });
    noImagePublishButton.onclick = () => {
      if (!noImageAcknowledgement.checked) {
        toast('يرجى تأكيد أنك تريد نشر البلاغ دون صورة أولًا.', 5000);
        return;
      }
      publishDraft(false);
    };
  }
}async function openAddUpdateModal(preselectedCaseId = '') {
  if (!can('can_add_update')) {
    toast('لا تملك صلاحية إضافة التحديثات');
    return;
  }

  const cases = adminCases.length
    ? adminCases
    : await rest('cases?select=id,public_case_number,title,status,created_by,visibility,publication_status&order=opened_at.desc&limit=500');

  if (!cases.length) {
    toast('لا توجد قضية متاحة لك لإضافة تحديث إليها');
    return;
  }

  const options = cases.map(item =>
    '<option value="' + esc(item.id) + '" ' + (preselectedCaseId === item.id ? 'selected' : '') + '>#' +
    esc(item.public_case_number) + ' — ' + esc(item.title.slice(0, 60)) + '</option>'
  ).join('');

  openModal(
    '<div class="modal-head"><h3>إضافة تحديث زمني</h3><button class="modal-close" data-close-modal aria-label="إغلاق">×</button></div>' +
    '<div class="modal-body">' +
      '<form id="addUpdateForm" class="form-grid">' +
        '<div class="field full"><label>القضية *</label><select id="updateCaseId" required>' + options + '</select></div>' +
        '<div class="field full"><div class="notice info update-number-preview" id="updateNumberPreview">سيظهر رقم التحديث التالي بعد تحميل تسلسل القضية.</div></div>' +
        '<div class="field"><label>نوع التحديث</label><select id="updateKind"><option value="UPDATE">تحديث جديد</option><option value="CORRECTION">تصحيح شفاف</option><option value="RESPONSE">رد/توضيح</option><option value="WITHDRAWAL_NOTICE">إشعار سحب</option></select></div>' +
        '<div class="field"><label>تغيير حالة القضية</label><select id="updateNewStatus"><option value="">— دون تغيير —</option>' + statusOptions() + '</select></div>' +
        '<div class="field full"><label>نص التحديث *</label><textarea id="updateText" required placeholder="اكتب التطور الجديد كما سيحفظ في السجل"></textarea></div>' +
        '<div class="field"><label>المصدر</label><select id="updateSource">' + sourceOptions() + '</select></div>' +
        '<div class="field"><label>درجة التحقق</label><select id="updateVerify">' + verifyOptions('VERIFIED_SOURCE') + '</select></div>' +
        '<div class="field full"><label>اسم الباحث / مصدر المعلومة</label><input id="updateSourceName" list="researcherSuggestionsUpdate" maxlength="160" placeholder="اكتب اسم الباحث أو اختر أحمد غازي"><datalist id="researcherSuggestionsUpdate"><option value="أحمد غازي"></option></datalist></div>' +
        '<div class="field full"><label>رابط المنشور الأصلي أو مرجع المصدر</label><input id="updateSourceRef" maxlength="1000" placeholder="https://… أو مرجع واضح"></div>' +
        imagePickerMarkup('update') +
        '<div class="field full"><label>هل يصحح تحديثًا سابقًا؟</label><select id="updateCorrection"><option value="">لا — تحديث مستقل</option></select></div>' +
        (can('can_publish_update')
          ? '<label class="check-row field full"><input id="updatePublish" type="checkbox"><span>نشر التحديث فورًا للجمهور إذا كانت القضية عامة ومنشورة.</span></label>'
          : '') +
        '<div class="form-actions field full"><button class="soft-btn" type="button" data-close-modal>إلغاء</button><button class="primary-btn" type="submit">نشر التحديث</button></div>' +
      '</form>' +
    '</div>'
  );

  let preparedUpdateImage = null;
  bindImagePicker('update', blob => { preparedUpdateImage = blob; });
  const syncUpdateVerification = changed => {
    const status = byId('updateNewStatus').value;
    const verify = byId('updateVerify').value;
    const source = byId('updateSource').value;
    if (['RESOLVED', 'CLOSED_NO_FURTHER_ACTION'].includes(status) && !['VERIFIED_SOURCE', 'OFFICIAL_STATEMENT'].includes(verify)) {
      if (changed === 'verification') byId('updateNewStatus').value = 'IN_PROGRESS';
      else byId('updateVerify').value = 'VERIFIED_SOURCE';
    }
    if (byId('updateVerify').value === 'OFFICIAL_STATEMENT' && !['AUTHORITY','OFFICIAL_POST'].includes(source)) byId('updateSource').value = 'OFFICIAL_POST';
  };
  byId('updateVerify').addEventListener('change', () => syncUpdateVerification('verification'));
  byId('updateSource').addEventListener('change', () => syncUpdateVerification('source'));
  byId('updateNewStatus').addEventListener('change', () => syncUpdateVerification('status'));
  const refreshUpdateNumberPreview = async caseId => {
    const note = byId('updateNumberPreview');
    if (!note) return;
    note.textContent = 'جارٍ حساب رقم التحديث التالي…';
    try {
      const latest = await rest('case_updates?case_id=eq.' + encodeURIComponent(caseId) + '&publication_status=eq.PUBLISHED&select=timeline_number&order=timeline_number.desc&limit=1');
      const nextNumber = Number(latest?.[0]?.timeline_number || 0) + 1;
      note.textContent = 'التحديث التالي متوقع أن يحمل الرقم ' + nextNumber + '. يثبت الخادم الرقم النهائي عند النشر لمنع تكرار الأرقام.';
    } catch {
      note.textContent = 'سيُحدّد رقم التحديث تلقائيًا عند النشر، مع الحفاظ على التسلسل ومنع تكرار الأرقام.';
    }
  };
  const caseSelect = byId('updateCaseId');
  const syncUpdatePublishOption = () => {
    const publishOption = byId('updatePublish');
    if (!publishOption) return;
    const selected = cases.find(item => item.id === caseSelect.value);
    const canPublishSelected = can('can_publish_update') && selected?.visibility === 'PUBLIC' && selected?.publication_status === 'PUBLISHED';
    publishOption.disabled = !canPublishSelected;
    publishOption.checked = Boolean(canPublishSelected);
  };
  caseSelect.onchange = () => {
    loadCorrectionOptions(caseSelect.value);
    refreshUpdateNumberPreview(caseSelect.value);
    syncUpdatePublishOption();
  };
  await loadCorrectionOptions(caseSelect.value);
  await refreshUpdateNumberPreview(caseSelect.value);
  syncUpdatePublishOption();

  byId('addUpdateForm').onsubmit = async event => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;

    try {
      const selectedUpdateCase = cases.find(item => item.id === byId('updateCaseId').value);
      const publishUpdateNow = Boolean(byId('updatePublish')?.checked) && selectedUpdateCase?.visibility === 'PUBLIC' && selectedUpdateCase?.publication_status === 'PUBLISHED';
      const updateId = await rpc('add_case_update', {
        p_case_id: byId('updateCaseId').value,
        p_update_kind: byId('updateKind').value,
        p_update_text: byId('updateText').value.trim(),
        p_source_type: byId('updateSource').value,
        p_verification_level: byId('updateVerify').value,
        p_source_name: byId('updateSourceName').value.trim() || null,
        p_source_reference: byId('updateSourceRef').value.trim() || null,
        p_correction_of_update_id: byId('updateCorrection').value || null,
        p_new_status: byId('updateNewStatus').value || null,
        p_publish: publishUpdateNow
      });
      if (preparedUpdateImage) {
        try {
          await uploadCaseImage(preparedUpdateImage, byId('updateCaseId').value, updateId, byId('updateImageCaption').value.trim(), publishUpdateNow);
        } catch (imageError) { toast('تم حفظ التحديث، لكن تعذر إرفاق الصورة: ' + friendlyErrorMessage(imageError.message), 6000); }
      }

      closeModal();
      toast(publishUpdateNow ? 'تم نشر التحديث بنجاح' : 'تم حفظ مسودة التحديث');

      if (currentRoute().view === 'admin') {
        if (currentRoute().param === 'overview') await adminOverview();
        else if (currentRoute().param === 'manage' && byId('manageNumber')?.value) await loadManageCase();
      }
    } catch (error) {
      toast(friendlyErrorMessage(error.message), 6000);
      button.disabled = false;
    }
  };
}

async function loadCorrectionOptions(caseId) {
  const select = byId('updateCorrection');
  if (!select) return;

  try {
    const updates = await rest(
      'case_updates?case_id=eq.' + encodeURIComponent(caseId) +
      '&select=id,update_text,published_at,created_at,publication_status&order=created_at.desc&limit=100'
    );

    select.innerHTML = '<option value="">لا — تحديث مستقل</option>' + updates.map(item =>
      '<option value="' + esc(item.id) + '">' +
        esc(fmtDate(item.published_at || item.created_at)) + ' — ' +
        esc(item.update_text.slice(0, 70)) +
      '</option>'
    ).join('');
  } catch {
    select.innerHTML = '<option value="">لا — تحديث مستقل</option>';
  }
}

function adminManage() {
  const body = byId('adminBody');
  body.innerHTML =
    '<section class="card">' +
      '<h2 style="margin-bottom:5px">إدارة قضية</h2>' +
      '<p class="muted tiny">ابحث برقم القضية لعرضها وتعديلها ونشر تحديثاتها وفق صلاحيات حسابك.</p>' +
      '<div class="hero-search" style="margin:15px 0 0;max-width:520px">' +
        '<div class="search-control"><span class="hash">#</span><input id="manageNumber" inputmode="numeric" placeholder="رقم القضية"></div>' +
        '<button id="manageLoad" type="button">تحميل</button>' +
      '</div>' +
    '</section>' +
    '<div id="manageResult"></div>';

  byId('manageLoad').onclick = loadManageCase;

  if (pendingManageNumber) {
    byId('manageNumber').value = pendingManageNumber;
    pendingManageNumber = '';
    loadManageCase();
  }
}

async function loadManageCase() {
  const number = byId('manageNumber')?.value.trim();
  const output = byId('manageResult');
  if (!number || !output) return;

  output.innerHTML = '<div class="spinner"></div>';

  try {
    const cases = await rest('cases?public_case_number=eq.' + encodeURIComponent(number) + '&select=*&limit=1');
    const caseRow = cases?.[0];

    if (!caseRow) {
      output.innerHTML = '<section class="card empty"><h2>القضية غير موجودة أو غير متاحة لهذا الحساب.</h2></section>';
      return;
    }

    const updates = await rest(
      'case_updates?case_id=eq.' + encodeURIComponent(caseRow.id) + '&select=*&order=created_at.asc'
    );
    const mediaRows = await rest('media?case_id=eq.' + encodeURIComponent(caseRow.id) + '&select=id,update_id,file_path,caption,created_by&order=created_at.asc');
    const mediaWithUrls = await Promise.all((mediaRows || []).map(async item => ({ ...item, url: await signImagePath(item.file_path).catch(() => null) })));
    currentCaseMedia.clear();
    mediaWithUrls.forEach(item => currentCaseMedia.set(item.id, item));
    let memberProfiles = [];
    try { memberProfiles = await rest('member_profiles?select=user_id,username'); } catch {}
    const usernameById = new Map((memberProfiles || []).map(profile => [profile.user_id, profile.username]));
    caseRow.author_username = usernameById.get(caseRow.created_by) || '';
    updates.forEach(item => {
      item.author_username = usernameById.get(item.created_by) || '';
      item.attachedMedia = mediaWithUrls.filter(media => media.update_id === item.id);
    });

    const editable = can('can_edit_any') || (caseRow.created_by === session.user.id && can('can_edit_own'));

    output.innerHTML =
      '<section class="card">' +
        '<div class="section-head">' +
          '<div><span class="case-chip">القضية #' + esc(caseRow.public_case_number) + '</span><h2 style="margin:8px 0 0">' + esc(caseRow.title) + '</h2>' + (caseRow.author_username ? '<small class="muted">أنشأها: @' + esc(caseRow.author_username) + '</small>' : '') + '</div>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap">' + statusBadge(caseRow.status) + visibilityBadge(caseRow.visibility) + publicationBadge(caseRow.publication_status) + '</div>' +
        '</div>' +

        (editable
          ? '<div class="form-grid">' +
              '<div class="field full"><label>العنوان</label><input id="manageTitle" value="' + esc(caseRow.title) + '"></div>' +
              '<div class="field"><label>المنطقة / المحافظة</label><input id="manageRegion" maxlength="120" value="' + esc(caseRow.region || '') + '"></div>' +
              '<div class="field"><label>الاسم المرتبط بالقضية</label><input id="manageSubject" maxlength="160" value="' + esc(caseRow.subject_name || '') + '"></div>' +
                    '<div class="field"><label>الحالة</label><select id="manageStatus">' + statusOptions(caseRow.status) + '</select></div>' +
              '<div class="field"><label>الظهور</label><select id="manageVisibility">' +
                [['PUBLIC','نشر للعامة'],['PRIVATE','مسودة / خاص']].map(([value, label]) => '<option value="' + value + '" ' + (caseRow.visibility === value ? 'selected' : '') + '>' + esc(label) + '</option>').join('') +
              '</select></div>' +
              '<div class="form-actions field full"><button class="soft-btn" id="saveCaseMeta">نشر التعديلات</button></div>' +
            '</div>'
          : '') +

        ((me?.is_admin || can('can_delete_any') || (caseRow.created_by === session.user.id && can('can_delete_own')))
          ? '<div class="case-delete-action"><button class="danger-btn" id="deleteCasePermanently">حذف القضية نهائيًا</button><small>سيُطلب تأكيد قبل الحذف. يظهر الزر وفق صلاحيات حسابك.</small></div>'
          : '') +

        (can('can_publish_case') && (caseRow.publication_status !== 'DRAFT' || caseRow.created_by === session.user.id || me?.is_admin)
          ? '<div class="form-actions" style="margin-top:12px">' +
              (caseRow.publication_status === 'PUBLISHED'
                ? '<button class="danger-btn" id="withdrawCase">سحب القضية من النشر</button>'
                : '<button class="primary-btn" id="publishCase">نشر القضية</button>') +
            '</div>'
          : '') +
      '</section>' +

      '<section class="card">' +
        '<div class="section-head"><h3 class="section-title"><span class="dot"></span>التحديثات</h3>' +
          (can('can_add_update') ? '<button class="primary-btn" id="manageAddUpdate">+ إضافة تحديث</button>' : '') +
        '</div>' +
        '<div class="member-list">' +
          (updates.length ? updates.map(item => updateEditor(item)).join('') : '<div class="empty">لا توجد تحديثات.</div>') +
        '</div>' +
      '</section>';

    preparedUpdateImages.clear();
    updates.forEach(item => {
      const canEditItem = can('can_edit_any') || (item.created_by === session.user.id && can('can_edit_own'));
      if (canEditItem) bindImagePicker(updateImagePrefix(item.id), blob => { if (blob) preparedUpdateImages.set(item.id, blob); else preparedUpdateImages.delete(item.id); });
    });
    document.querySelectorAll('[data-delete-media]').forEach(button => button.onclick = () => removeCaseMedia(button.dataset.deleteMedia));

    if (editable) {
      byId('saveCaseMeta').onclick = async () => {
        try {
          await rest('cases?id=eq.' + encodeURIComponent(caseRow.id), {
            method: 'PATCH',
            body: {
              title: byId('manageTitle').value.trim(),
              region: byId('manageRegion').value.trim() || null,
              subject_name: byId('manageSubject').value.trim() || null,
              status: byId('manageStatus').value,
              visibility: byId('manageVisibility').value
            }
          });
          toast(caseRow.publication_status === 'PUBLISHED' ? 'تم نشر تعديلات بيانات القضية' : 'تم تحديث بيانات المسودة');
          await loadManageCase();
        } catch (error) {
          toast(friendlyErrorMessage(error.message), 6000);
        }
      };
    }

    const deleteCaseButton = byId('deleteCasePermanently');
    if (deleteCaseButton && (me?.is_admin || can('can_delete_any') || (caseRow.created_by === session.user.id && can('can_delete_own')))) {
      deleteCaseButton.onclick = async () => {
        const confirmed = confirm('هل أنت متأكد من حذف القضية #' + caseRow.public_case_number + ' نهائيًا؟ سيُحذف سجل القضية وتحديثاتها ووسائطها المرتبطة من قاعدة البيانات، ولا يمكن التراجع عن ذلك. اختر «إلغاء» للتراجع.');
        if (!confirmed) return;
        deleteCaseButton.disabled = true;
        try {
          const result = await edgeFunction('delete-case', { caseId: caseRow.id });
          toast(result.storageCleanup === 'pending'
            ? 'تم حذف القضية من قاعدة البيانات، لكن بقي ملف صورة يحتاج تنظيفًا إداريًا.'
            : 'تم حذف القضية نهائيًا.');
          pendingManageNumber = '';
          navigate('admin', 'overview');
        } catch (error) {
          deleteCaseButton.disabled = false;
          toast(friendlyErrorMessage(error.message), 6000);
        }
      };
    }

    const publishCase = byId('publishCase');
    if (publishCase) {
      publishCase.onclick = async () => {
        try {
          if (caseRow.publication_status === 'DRAFT') {
            const number = await rpc('publish_my_draft_case', { p_case_id: caseRow.id });
            toast('تم نشر القضية رقم #' + (number || caseRow.public_case_number) + ' للعامة');
          } else {
            await rest('cases?id=eq.' + encodeURIComponent(caseRow.id), {
              method: 'PATCH', body: { publication_status: 'PUBLISHED', published_at: new Date().toISOString() }
            });
            toast('تم تحديث حالة النشر');
          }
          await loadManageCase();
        } catch (error) {
          toast(friendlyErrorMessage(error.message), 6000);
        }
      };
    }

    const withdrawCase = byId('withdrawCase');
    if (withdrawCase) {
      withdrawCase.onclick = async () => {
        if (!confirm('سحب القضية من العرض العام؟ سيبقى السجل محفوظًا إداريًا.')) return;
        try {
          await rest('cases?id=eq.' + encodeURIComponent(caseRow.id), {
            method: 'PATCH',
            body: { publication_status: 'WITHDRAWN' }
          });
          toast('تم سحب القضية من العرض العام');
          await loadManageCase();
        } catch (error) {
          toast(friendlyErrorMessage(error.message), 6000);
        }
      };
    }

    const addButton = byId('manageAddUpdate');
    if (addButton) addButton.onclick = () => openAddUpdateModal(caseRow.id);

    document.querySelectorAll('[data-save-update]').forEach(button => {
      button.onclick = () => saveUpdate(button.dataset.saveUpdate);
    });

    document.querySelectorAll('[data-publish-update]').forEach(button => {
      button.onclick = () => publishUpdate(button.dataset.publishUpdate);
    });

    document.querySelectorAll('[data-withdraw-update]').forEach(button => {
      button.onclick = () => withdrawUpdate(button.dataset.withdrawUpdate);
    });

    document.querySelectorAll('[data-delete-update]').forEach(button => {
      button.onclick = () => deleteUpdate(button.dataset.deleteUpdate);
    });
  } catch (error) {
    output.innerHTML = '<section class="card"><div class="notice danger">' + esc(friendlyErrorMessage(error.message)) + '</div></section>';
  }
}

function updateEditor(item) {
  const editable = can('can_edit_any') || (item.created_by === session.user.id && can('can_edit_own'));
  const imagePrefix = updateImagePrefix(item.id);
  const deletable =
    item.publication_status !== 'PUBLISHED' &&
    (can('can_delete_any') || (item.created_by === session.user.id && can('can_delete_own')));

  return (
    '<article class="member-row">' +
      '<div class="member-head">' +
        '<div><h4>' + esc(kindLabels[item.update_kind] || item.update_kind) + '</h4><p>' + esc(fmtDate(item.published_at || item.created_at)) + '</p>' + (item.author_username ? '<small class="muted">نشره: @' + esc(item.author_username) + '</small>' : '') + '</div>' +
        '<div style="display:flex;gap:5px;flex-wrap:wrap">' + publicationBadge(item.publication_status) + verifyBadge(item.verification_level) + '</div>' +
      '</div>' +
      (editable
        ? '<div class="field" style="margin-top:10px"><label>نص المنشور</label><textarea id="update-text-' + esc(item.id) + '">' + esc(item.update_text) + '</textarea></div>' +
          '<div class="field"><label>اسم الباحث / مصدر المعلومة</label><input id="update-source-name-' + esc(item.id) + '" maxlength="160" value="' + esc(item.source_name || '') + '"></div>' +
          '<div class="field"><label>رابط / مرجع المصدر</label><input id="update-source-ref-' + esc(item.id) + '" maxlength="1000" value="' + esc(item.source_reference || '') + '"></div>' +
          (item.publication_status === 'PUBLISHED' ? '<div class="notice warn" style="margin-top:8px">هذا تحديث منشور. تعديل نصه مسموح فقط لصاحب الصلاحية وسيظهر للجمهور أنه تم تعديله، كما تسجل العملية في Audit Log.</div>' : '')
        : '<p class="tiny" style="white-space:pre-wrap">' + esc(item.update_text) + '</p>') +
      (item.attachedMedia?.length ? item.attachedMedia.map(media => '<figure class="timeline-media"><img src="' + esc(media.url || '') + '" alt="' + esc(media.caption || 'صورة مرفقة') + '" loading="lazy"><figcaption>' + esc(media.caption || '') + '</figcaption>' + (editable ? '<button class="danger-btn" type="button" data-delete-media="' + esc(media.id) + '">حذف الصورة المرفقة</button>' : '') + '</figure>').join('') : '') +
      (editable ? imagePickerMarkup(imagePrefix) : '') +
      '<div class="form-actions" style="margin-top:10px">' +
        (editable ? '<button class="soft-btn" data-save-update="' + esc(item.id) + '">نشر التعديل</button>' : '') +
        (can('can_publish_update') && (item.created_by === session.user.id || me?.is_admin) && item.publication_status !== 'PUBLISHED' ? '<button class="primary-btn" data-publish-update="' + esc(item.id) + '">نشر</button>' : '') +
        (can('can_publish_update') && item.publication_status === 'PUBLISHED' ? '<button class="danger-btn" data-withdraw-update="' + esc(item.id) + '">سحب من النشر</button>' : '') +
        (deletable ? '<button class="danger-btn" data-delete-update="' + esc(item.id) + '">حذف المسودة</button>' : '') +
      '</div>' +
    '</article>'
  );
}

async function removeCaseMedia(id) {
  const media = currentCaseMedia.get(id);
  if (!media) return;
  if (!confirm('هل تريد حذف الصورة المرفقة؟')) return;
  try {
    await deleteStoredImage(media.file_path);
    await rpc('delete_case_media', { p_media_id: id });
    toast('تم حذف الصورة المرفقة');
    await loadManageCase();
  } catch (error) { toast(friendlyErrorMessage(error.message), 6000); }
}

async function saveUpdate(id) {
  const input = byId('update-text-' + id);
  if (!input) return;

  const row = await rest('case_updates?id=eq.' + encodeURIComponent(id) + '&select=publication_status&limit=1');
  if (row?.[0]?.publication_status === 'PUBLISHED') {
    const approved = confirm('هذا التحديث منشور للعامة. هل تريد تعديل نصه؟ سيظهر تاريخ التعديل للجمهور وتبقى العملية في سجل التدقيق.');
    if (!approved) return;
  }

  try {
    await rest('case_updates?id=eq.' + encodeURIComponent(id), {
      method: 'PATCH',
      body: {
        update_text: input.value.trim(),
        source_name: byId('update-source-name-' + id)?.value.trim() || null,
        source_reference: byId('update-source-ref-' + id)?.value.trim() || null
      }
    });
    const replacementBlob = preparedUpdateImages.get(id);
    if (replacementBlob) {
      const oldMedia = Array.from(currentCaseMedia.values()).filter(media => media.update_id === id);
      const updateRows = await rest('case_updates?id=eq.' + encodeURIComponent(id) + '&select=case_id,publication_status&limit=1');
      const parentRows = await rest('cases?id=eq.' + encodeURIComponent(updateRows[0].case_id) + '&select=visibility,publication_status&limit=1');
      const parent = parentRows?.[0];
      const isPublic = updateRows[0].publication_status === 'PUBLISHED' && parent?.visibility === 'PUBLIC' && parent?.publication_status === 'PUBLISHED';
      await uploadCaseImage(replacementBlob, updateRows[0].case_id, id, byId(updateImagePrefix(id) + 'ImageCaption')?.value.trim(), isPublic);
      preparedUpdateImages.delete(id);
      for (const media of oldMedia) {
        await deleteStoredImage(media.file_path);
        await rpc('delete_case_media', { p_media_id: media.id });
      }
    }
    toast(row?.[0]?.publication_status === 'PUBLISHED' ? 'تم نشر التعديل' : 'تم تحديث مسودة التعديل');
    await loadManageCase();
  } catch (error) {
    toast(friendlyErrorMessage(error.message), 6000);
  }
}

async function publishUpdate(id) {
  try {
    await rpc('publish_case_update_with_media', { p_update_id: id });
    toast('تم نشر التحديث والصور المرفقة');
    await loadManageCase();
  } catch (error) {
    toast(friendlyErrorMessage(error.message), 6000);
  }
}

async function withdrawUpdate(id) {
  if (!confirm('سحب هذا التحديث من العرض العام؟ سيضيف النظام إشعارًا زمنيًا عامًا بالسحب بدل أن يختفي بلا أثر.')) return;

  try {
    await rpc('withdraw_case_update', { p_update_id: id });
    toast('تم سحب التحديث وإضافة إشعار زمني بالسحب');
    await loadManageCase();
  } catch (error) {
    toast(friendlyErrorMessage(error.message), 6000);
  }
}

async function deleteUpdate(id) {
  if (!confirm('حذف هذه المسودة نهائيًا؟ لا يمكن حذف تحديث منشور بهذه الطريقة.')) return;

  try {
    await rest('case_updates?id=eq.' + encodeURIComponent(id), { method: 'DELETE' });
    toast('تم حذف المسودة');
    await loadManageCase();
  } catch (error) {
    toast(friendlyErrorMessage(error.message), 6000);
  }
}

async function adminTeam() {
  const body = byId('adminBody');
  body.innerHTML = '<div class="spinner"></div>';

  const [team, invites] = await Promise.all([
    rest('staff_permissions?select=*&order=created_at.asc'),
    rest('pending_staff_invites?select=id,email,is_active,expires_at,used_at,created_at,email_sent_at,email_delivery_error&order=created_at.desc&limit=30')
  ]);

  body.innerHTML =
    '<section class="card">' +
      '<h2>دعوة عضو جديد</h2>' +
      '<p class="muted tiny">اكتب البريد الإلكتروني فقط، ثم اختر الصلاحيات. سيحاول النظام إرسال دعوة فعلية إلى البريد، مع إبقاء رمز الدعوة كخيار احتياطي.</p>' +
      '<form id="inviteForm" class="form-grid">' +
        '<div class="field full"><label>البريد الإلكتروني</label><input id="inviteEmail" type="email" autocomplete="email" required></div>' +
        '<div class="field full"><label>الصلاحيات</label><div class="permission-grid">' + permissionChecks('invite') + '</div></div>' +
        '<div class="form-actions field full"><button class="primary-btn" type="submit">إنشاء الدعوة وإرسال البريد</button></div>' +
      '</form>' +
      '<div id="inviteResult"></div>' +
    '</section>' +

    '<section class="card">' +
      '<div class="section-head"><h3 class="section-title"><span class="dot"></span>أعضاء الفريق</h3><span class="section-meta">' + team.length + ' حسابات</span></div>' +
      '<div class="member-list">' + (team.length ? team.map(memberRow).join('') : '<div class="empty">لا يوجد أعضاء.</div>') + '</div>' +
    '</section>' +

    '<section class="card">' +
      '<h3>الدعوات الأخيرة</h3>' +
      '<div class="member-list">' +
        (invites.length ? invites.map(item => {
          const inviteState = item.used_at ? 'مستخدمة' : item.is_active ? 'صالحة' : 'غير فعالة';
          const mailState = item.email_sent_at
            ? '<span class="badge resolved">أُرسل البريد</span>'
            : item.email_delivery_error
              ? '<span class="badge progress">تعذر البريد</span>'
              : '<span class="badge private">لم يُرسل بعد</span>';

          return '<div class="member-row"><div class="member-head"><div><h4>' + esc(item.email) + '</h4><p>تنتهي: ' + esc(fmtDate(item.expires_at)) + '</p></div>' +
            '<div style="display:flex;gap:5px;flex-wrap:wrap">' +
              '<span class="badge ' + (item.used_at ? 'closed' : item.is_active ? 'resolved' : 'closed') + '">' + inviteState + '</span>' +
              mailState +
            '</div></div>' +
            (item.email_delivery_error ? '<p class="tiny muted" style="margin:8px 0 0">سبب تعذر البريد: ' + esc(friendlyErrorMessage(item.email_delivery_error)) + '</p>' : '') +
          '</div>';
        }).join('') : '<div class="empty">لا توجد دعوات.</div>') +
      '</div>' +
    '</section>';

  byId('inviteForm').onsubmit = async event => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;

    try {
      const result = await edgeFunction('create-staff-invite', {
        email: byId('inviteEmail').value.trim(),
        ...collectPermissions('invite')
      });

      const mailMessage = result.emailSent
        ? '<div class="notice success" style="margin-top:12px"><strong>تم إنشاء الدعوة وإرسال بريد إلى ' + esc(result.email) + '.</strong><p class="tiny">يمكن للعضو فتح رسالة البريد أو استخدام الرمز أدناه. الرمز صالح حتى ' + esc(fmtDate(result.expiresAt)) + '.</p>'
        : '<div class="notice warn" style="margin-top:12px"><strong>تم إنشاء الدعوة، لكن تعذر إرسال البريد إلى ' + esc(result.email) + '.</strong><p class="tiny">يمكنك مشاركة الرمز مؤقتًا. للإرسال التلقائي إلى أي بريد يجب تفعيل Custom SMTP في Supabase.</p>';

      byId('inviteResult').innerHTML =
        mailMessage +
          '<div class="case-chip mono" style="display:inline-block;font-size:16px;margin-top:4px">' + esc(result.inviteCode) + '</div>' +
          '<div class="form-actions">' +
            '<button class="soft-btn" id="copyInviteCode">نسخ الرمز</button>' +
            '<button class="soft-btn" id="copyActivationLink">نسخ رابط التفعيل</button>' +
          '</div>' +
        '</div>';

      byId('copyInviteCode').onclick = async () => {
        await copyText(result.inviteCode);
        toast('تم نسخ رمز الدعوة');
      };

      byId('copyActivationLink').onclick = async () => {
        await copyText(result.activationUrl);
        toast('تم نسخ رابط التفعيل');
      };

      byId('inviteForm').reset();
    } catch (error) {
      const friendly = error.message === 'ALREADY_TEAM_MEMBER'
        ? 'هذا البريد عضو في الفريق بالفعل.'
        : friendlyErrorMessage(error.message);
      toast(friendly, 6000);
    } finally {
      button.disabled = false;
    }
  };

  document.querySelectorAll('[data-save-member]').forEach(button => {
    button.onclick = () => saveMember(button.dataset.saveMember);
  });
}

function permissionChecks(prefix, values = {}) {
  const items = [
    ['is_admin', 'مدير كامل'],
    ['can_create_case', 'إنشاء قضية'],
    ['can_publish_case', 'نشر/سحب قضية'],
    ['can_add_update', 'إضافة تحديث'],
    ['can_publish_update', 'نشر/سحب تحديث'],
    ['can_edit_own', 'تعديل ما أنشأه'],
    ['can_edit_any', 'تعديل أي سجل'],
    ['can_delete_own', 'حذف مسوداته'],
    ['can_delete_any', 'حذف أي مسودة'],
    ['can_manage_media', 'إدارة الوسائط'],
    ['can_view_private', 'عرض القضايا والبيانات الداخلية']
  ];

  return items.map(([key, label]) =>
    '<label class="permission-item"><input type="checkbox" id="' + prefix + '-' + key + '" data-permission="' + key + '" ' + (values[key] ? 'checked' : '') + '><span>' + esc(label) + '</span></label>'
  ).join('');
}

function collectPermissions(prefix) {
  const output = {};
  document.querySelectorAll('[id^="' + prefix + '-"][data-permission]').forEach(input => {
    output[input.dataset.permission] = input.checked;
  });
  return output;
}

function memberRow(member) {
  return (
    '<article class="member-row">' +
      '<div class="member-head">' +
        '<div><h4>' + esc(member.display_name || member.email) + ' ' + (member.is_admin ? '<span class="badge admin">مدير</span>' : '') + '</h4><p>' + esc(member.email) + '</p></div>' +
        '<span class="badge ' + (member.is_active ? 'resolved' : 'closed') + '">' + (member.is_active ? 'نشط' : 'موقوف') + '</span>' +
      '</div>' +
      '<details style="margin-top:9px"><summary class="tiny" style="cursor:pointer;font-weight:800">تعديل الصلاحيات</summary>' +
        '<div class="permission-grid" style="margin-top:9px">' +
          permissionChecks('member-' + member.user_id, member) +
          '<label class="permission-item"><input id="member-' + member.user_id + '-active" type="checkbox" ' + (member.is_active ? 'checked' : '') + '><span>الحساب نشط</span></label>' +
        '</div>' +
        '<div class="form-actions"><button class="soft-btn" data-save-member="' + esc(member.user_id) + '">حفظ الصلاحيات</button></div>' +
      '</details>' +
    '</article>'
  );
}

async function saveMember(userId) {
  const prefix = 'member-' + userId;
  const permissions = collectPermissions(prefix);
  const active = byId(prefix + '-active').checked;

  try {
    await rest('staff_permissions?user_id=eq.' + encodeURIComponent(userId), {
      method: 'PATCH',
      body: { ...permissions, is_active: active }
    });
    toast('تم تحديث صلاحيات العضو');
    await adminTeam();
  } catch (error) {
    toast(friendlyErrorMessage(error.message), 6000);
  }
}

async function openAuditLogModal() {
  if (!can('can_view_private')) {
    toast('لا تملك صلاحية عرض سجل التدقيق');
    return;
  }

  openModal(
    '<div class="modal-head"><h3>سجل التدقيق الرقمي</h3><button class="modal-close" data-close-modal aria-label="إغلاق">×</button></div>' +
    '<div class="modal-body"><div id="auditLogBody"><div class="spinner"></div></div></div>',
    true
  );

  try {
    const logs = await rest('audit_log?select=id,actor_id,action,entity_type,entity_id,case_id,created_at&order=created_at.desc&limit=100');
    const body = byId('auditLogBody');
    if (!logs.length) {
      body.innerHTML = '<div class="empty">لا توجد عمليات مسجلة بعد.</div>';
      return;
    }

    const actionLabels = { INSERT: 'إنشاء', UPDATE: 'تعديل', DELETE: 'حذف' };
    const entityLabels = {
      cases: 'قضية',
      case_updates: 'تحديث',
      staff_permissions: 'صلاحيات عضو'
    };

    body.innerHTML =
      '<p class="muted tiny">يعرض آخر 100 عملية. تفاصيل القيم القديمة والجديدة محفوظة في قاعدة البيانات ولا تعرض هنا افتراضيًا لتقليل كشف البيانات الحساسة.</p>' +
      '<div class="audit-list">' +
        logs.map(item =>
          '<div class="audit-row">' +
            '<span><strong>' + esc(actionLabels[item.action] || item.action) + '</strong> — ' + esc(entityLabels[item.entity_type] || item.entity_type) +
              (item.case_id ? ' <span class="mono tiny">' + esc(String(item.case_id).slice(0, 8)) + '…</span>' : '') +
            '</span>' +
            '<time>' + esc(fmtDate(item.created_at)) + '</time>' +
          '</div>'
        ).join('') +
      '</div>';
  } catch (error) {
    byId('auditLogBody').innerHTML = '<div class="notice danger">' + esc(friendlyErrorMessage(error.message)) + '</div>';
  }
}

window.addEventListener('hashchange', render);
window.addEventListener('popstate', render);
document.addEventListener('DOMContentLoaded', async () => {
  // Do not perform client-side host redirects here: Cloudflare Pages handles
  // domain routing, and a browser-side redirect can compound host-level redirects.
  const oauthPending = location.pathname.endsWith('/auth/callback') ||
    new URLSearchParams(location.hash.replace(/^#/, '')).has('access_token') ||
    new URLSearchParams(location.search).has('error');
  if (oauthPending) {
    loading();
    appEl.setAttribute('aria-busy', 'true');
  }
  bindGlobalNav();
  updateNav();

  document.addEventListener('click', event => {
    if (!teamAccessMenu || teamAccessMenu.classList.contains('hidden')) return;
    const wrap = modeToggleBtn.closest('.mode-switch-wrap');
    if (wrap && !wrap.contains(event.target)) closeTeamAccessMenu();
  });

  try {
    await consumeOAuthCallback();
  } catch (error) {
    toast(friendlyErrorMessage(error.message) || 'تعذر إكمال تسجيل Google.', 6000);
  } finally {
    appEl.removeAttribute('aria-busy');
  }

  render();
});
