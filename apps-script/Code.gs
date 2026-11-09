/**
 * تقرير الأداء السلوكي والأكاديمي — الخلفية (Google Sheets + Apps Script)
 *
 * سكربت مرتبط بالشيت (Container-bound). الشيت يملكه مدير النظام فقط ولا يُشارك مع المعلمين؛
 * الجميع يدخل عبر تطبيق الويب المقيّد بدومين المدرسة، والتصفية حسب القسم والمرحلة تتم هنا في الخادم.
 *
 * الدخول: بحساب دور (اسم المستخدم = اسم الدور مثل «وكيل الابتدائي») ورمز دخول من ورقة Staff،
 * بلا بريد إلكتروني. تُعطى جلسة (token) تُحفظ في CacheService لست ساعات.
 * لاحقاً يمكن إضافة مستخدمين بأسمائهم الشخصية بصفوف جديدة دون تغيير الكود.
 *
 * الأعمدة تُقرأ بأسمائها (عربية أو إنجليزية)، فلا يتعطل السكربت لو تغيّر ترتيبها أو أُضيف عمود.
 * لا يحتوي هذا الملف أي بيانات طلاب أو رموز دخول. البيانات تُدخل في الشيت فقط.
 */

var YEAR = '1448-1449';
var ROLES = ['counselor', 'deputy', 'principal', 'admin'];
var STAGES = ['primary', 'middle', 'secondary'];
var CATS = ['strength', 'improve', 'recommend'];
var MAX = { strength: 4, improve: 4, recommend: 3 };
var MAX_CUSTOM_LEN = 120;
var SESSION_SECONDS = 6 * 3600;
var MAX_FAILS = 5;
var LOCK_SECONDS = 60;

// أسماء الأعمدة المقبولة لكل مفتاح داخلي (الأولى هي الاسم المعتمد عند الإنشاء)
var HDR = {
  Students: { id: ['رقم الطالب (داخلي)', 'id'], department: ['القسم', 'department'], stage: ['المرحلة', 'stage'], grade: ['الصف', 'grade'],
              section: ['الشعبة', 'section'], name: ['الاسم بالعربية', 'name'], name_en: ['الاسم بالإنجليزية', 'name_en'], active: ['فعّال', 'active'] },
  Staff:    { username: ['اسم المستخدم', 'username'], role: ['الدور', 'role'], department: ['القسم', 'department'], stage: ['المرحلة', 'stage'],
              pin: ['رمز الدخول', 'pin'], active: ['فعّال', 'active'], name: ['الاسم', 'name'], email: ['البريد (اختياري)', 'البريد (دومين المدرسة)', 'email'] },
  Library:  { id: ['id'], category: ['category'], text: ['text'], stage: ['stage'], active: ['active'] },
  Reports:  { id: ['id'], studentId: ['studentId'], year: ['year'], status: ['status'], createdBy: ['createdBy'], createdAt: ['createdAt'],
              updatedAt: ['updatedAt'], reviewedBy: ['reviewedBy'], approvedBy: ['approvedBy'], pdfUrl: ['pdfUrl'] },
  Items:    { reportId: ['reportId'], category: ['category'], text: ['text'], source: ['source'], order: ['order'] },
  Audit:    { ts: ['ts'], email: ['email'], action: ['action'], target: ['target'], detail: ['detail'] }
};
var HDR_ORDER = {
  Students: ['id', 'department', 'stage', 'grade', 'section', 'name', 'name_en', 'active'],
  Staff: ['username', 'role', 'department', 'stage', 'pin', 'active', 'name', 'email'],
  Library: ['id', 'category', 'text', 'stage', 'active'],
  Reports: ['id', 'studentId', 'year', 'status', 'createdBy', 'createdAt', 'updatedAt', 'reviewedBy', 'approvedBy', 'pdfUrl'],
  Items: ['reportId', 'category', 'text', 'source', 'order'],
  Audit: ['ts', 'email', 'action', 'target', 'detail']
};

var DEPT_MAP = { 'الأهلي': 'ahli', 'الاهلي': 'ahli', 'ahli': 'ahli', 'الدبلوما الأمريكية': 'diploma', 'الدبلوما': 'diploma', 'diploma': 'diploma',
                 'التربية الخاصة': 'special', 'special': 'special', 'الكل': 'all', 'all': 'all' };
var STAGE_MAP = { 'ابتدائي': 'primary', 'primary': 'primary', 'متوسط': 'middle', 'middle': 'middle', 'ثانوي': 'secondary', 'secondary': 'secondary', 'الكل': 'all', 'all': 'all' };
var ROLE_MAP = { 'موجه طلابي': 'counselor', 'counselor': 'counselor', 'وكيل شؤون الطلاب': 'deputy', 'deputy': 'deputy',
                 'مدير المدرسة': 'principal', 'principal': 'principal', 'مدير النظام': 'admin', 'admin': 'admin' };
// أدوار بمسمى الوظيفة والمرحلة معاً (اسم الدور = اسم المستخدم): تُستنتج المرحلة منها إن تُركت خانة المرحلة فارغة
var POS_MAP = { 'موجه الابتدائي': ['counselor', 'primary'], 'موجه المتوسط': ['counselor', 'middle'], 'موجه الثانوي': ['counselor', 'secondary'],
                'وكيل الابتدائي': ['deputy', 'primary'], 'وكيل المتوسط': ['deputy', 'middle'], 'وكيل الثانوي': ['deputy', 'secondary'] };

// الحالة الحالية -> { الحالة التالية: الأدوار المسموح لها بالنقلة }
var TRANSITIONS = {
  DRAFT:     { SUBMITTED: ['counselor', 'deputy', 'admin'] },
  SUBMITTED: { REVIEWED: ['deputy', 'admin'], DRAFT: ['deputy', 'principal', 'admin'] },
  REVIEWED:  { APPROVED: ['principal', 'admin'], DRAFT: ['deputy', 'principal', 'admin'] },
  APPROVED:  { PUBLISHED: ['principal', 'admin'], DRAFT: ['principal', 'admin'] },
  PUBLISHED: { DRAFT: ['principal', 'admin'] }
};
var EDITABLE = { DRAFT: true };

/* ───────────── أدوات الأعمدة والقيم ───────────── */

function trim_(v) { return String(v === null || v === undefined ? '' : v).trim(); }
function norm_(map, v) { var t = trim_(v); return map[t] || t.toLowerCase(); }
function list_(map, v) { return trim_(v).split(/[+،,]/).map(trim_).filter(Boolean).map(function (x) { return norm_(map, x); }); }
function truthy_(v) { return v === true || ['نعم', 'true', 'yes', 'y', '1'].indexOf(trim_(v).toLowerCase()) >= 0; }
function roleInfo_(text) {
  var t = trim_(text);
  if (POS_MAP[t]) return { role: POS_MAP[t][0], stage: POS_MAP[t][1] };
  return { role: norm_(ROLE_MAP, t), stage: null };
}

/** يقرأ ورقة كمصفوفة كائنات بمفاتيح داخلية، مع رقم الصف _row. */
function table_(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('الورقة غير موجودة: ' + name);
  var v = sh.getDataRange().getValues();
  if (!v.length) return [];
  var head = v.shift(), keyAt = [];
  head.forEach(function (h, j) {
    var t = trim_(h), found = null;
    Object.keys(HDR[name]).forEach(function (k) { if (HDR[name][k].indexOf(t) >= 0) found = k; });
    keyAt[j] = found;
  });
  var out = [];
  v.forEach(function (r, i) {
    var o = { _row: i + 2 }, any = false;
    keyAt.forEach(function (k, j) { if (k) { o[k] = r[j]; if (trim_(r[j]) !== '') any = true; } });
    if (any) out.push(o);
  });
  return out;
}

/** رقم عمود مفتاح داخلي في ورقة (1-based) أو 0 إن لم يوجد. */
function colOf_(name, key) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  var head = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0];
  for (var j = 0; j < head.length; j++) if (HDR[name][key].indexOf(trim_(head[j])) >= 0) return j + 1;
  return 0;
}

function setCell_(name, row, key, value) {
  var c = colOf_(name, key);
  if (!c) throw new Error('العمود غير موجود: ' + name + '.' + key);
  SpreadsheetApp.getActive().getSheetByName(name).getRange(row, c).setValue(value);
}

/** يضيف صفاً بحسب ترتيب الأعمدة الفعلي في الورقة. */
function appendObj_(name, obj) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  var head = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0];
  var row = head.map(function (h) {
    var t = trim_(h), val = '';
    Object.keys(HDR[name]).forEach(function (k) { if (HDR[name][k].indexOf(t) >= 0 && obj[k] !== undefined) val = obj[k]; });
    return val;
  });
  sh.appendRow(row);
}

function deleteRows_(name, rows) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  rows.sort(function (a, b) { return b - a; }).forEach(function (r) { sh.deleteRow(r); });
}

/* ───────────── الإعداد (يُشغَّل مرة واحدة من مدير النظام) ───────────── */

function setup() {
  var ss = SpreadsheetApp.getActive(), msgs = [];
  Object.keys(HDR_ORDER).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var heads = HDR_ORDER[name].map(function (k) { return HDR[name][k][0]; });
    // ورقة فارغة، أو Staff بلا صفوف بيانات: اكتب الرؤوس المعتمدة
    if (sh.getLastRow() === 0 || (name === 'Staff' && sh.getLastRow() <= 1)) {
      sh.getRange(1, 1, 1, heads.length).setValues([heads]).setFontWeight('bold');
      sh.setFrozenRows(1);
      if (name === 'Staff') msgs.push('كُتبت رؤوس Staff الجديدة: ' + heads.join(' | '));
    }
  });
  msgs.push('تم التأكد من الأوراق. أضف مستخدمي الأدوار في Staff (اسم المستخدم، الدور، القسم، المرحلة، رمز الدخول، فعّال).');
  Logger.log(msgs.join('\n'));
  return msgs;
}

/* ───────────── رمز الدخول والجلسات ───────────── */

function sha256hex_(t) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, t, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

/** شغّلها من المحرر: hashPin('رمز') تطبع سطراً تلصقه في عمود «رمز الدخول» بدل الرمز الصريح. */
function hashPin(pin) {
  var salt = Utilities.getUuid().slice(0, 8);
  var line = 'sha256:' + salt + ':' + sha256hex_(salt + ':' + trim_(pin));
  Logger.log(line);
  return line;
}

function pinOk_(stored, pin) {
  var s = trim_(stored), p = trim_(pin);
  if (!s || !p) return false;
  if (s.indexOf('sha256:') === 0) { var q = s.split(':'); return sha256hex_(q[1] + ':' + p) === q[2]; }
  return s === p;
}

function staffRow_(username) {
  var u = trim_(username);
  return table_('Staff').filter(function (s) { return trim_(s.username) === u && truthy_(s.active); })[0] || null;
}

/** يبني سياق المستخدم من صف Staff. */
function ctxFor_(username) {
  var s = staffRow_(username);
  if (!s) throw new Error('الحساب غير مصرّح له.');
  var ri = roleInfo_(s.role);
  if (ROLES.indexOf(ri.role) < 0) throw new Error('دور غير معروف في Staff.');
  var stages = list_(STAGE_MAP, s.stage), depts = list_(DEPT_MAP, s.department);
  if (!stages.length && ri.stage) stages = [ri.stage];
  if (['principal', 'admin'].indexOf(ri.role) >= 0) { if (!stages.length) stages = ['all']; if (!depts.length) depts = ['all']; }
  else if (!depts.length) depts = ['ahli'];
  if (!stages.length) throw new Error('حساب بلا مرحلة.');
  return { email: trim_(s.username), username: trim_(s.username), name: trim_(s.name) || trim_(s.username), role: ri.role, departments: depts, stages: stages };
}

function ctx_(token) {
  var raw = token ? CacheService.getScriptCache().get('tok_' + token) : null;
  if (!raw) throw new Error('انتهت الجلسة، سجّل الدخول من جديد.');
  return ctxFor_(JSON.parse(raw).username);
}

function api_users() {
  return table_('Staff').filter(function (s) { return truthy_(s.active) && trim_(s.username); })
    .map(function (s) { return { username: trim_(s.username), role: trim_(s.role) }; });
}

function api_login(username, pin) {
  var cache = CacheService.getScriptCache(), key = 'fail_' + trim_(username);
  var fails = parseInt(cache.get(key) || '0', 10);
  if (fails >= MAX_FAILS) throw new Error('محاولات كثيرة. حاول بعد دقيقة.');
  var s = staffRow_(username);
  if (!s || !pinOk_(s.pin, pin)) {
    cache.put(key, String(fails + 1), LOCK_SECONDS);
    throw new Error('بيانات الدخول غير صحيحة.');
  }
  cache.remove(key);
  var ctx = ctxFor_(username);
  var token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  cache.put('tok_' + token, JSON.stringify({ username: ctx.username }), SESSION_SECONDS);
  audit_(ctx.username, 'LOGIN', '-', '');
  return { token: token, user: { name: ctx.name, role: ctx.role, stage: ctx.stages.join('+'), department: ctx.departments.join('+') } };
}

function api_logout(token) { if (token) CacheService.getScriptCache().remove('tok_' + token); return true; }

/* ───────────── الصلاحيات ───────────── */

function canSee_(ctx, s) {
  if (ctx.role === 'principal' || ctx.role === 'admin') return true;
  var d = norm_(DEPT_MAP, s.department), st = norm_(STAGE_MAP, s.stage);
  return (ctx.departments.indexOf('all') >= 0 || ctx.departments.indexOf(d) >= 0) && (ctx.stages.indexOf('all') >= 0 || ctx.stages.indexOf(st) >= 0);
}

function studentFor_(ctx, studentId) {
  var s = table_('Students').filter(function (x) { return trim_(x.id) === studentId && truthy_(x.active); })[0];
  if (!s || !canSee_(ctx, s)) throw new Error('الطالب غير متاح.');
  return s;
}

function stageOf_(s) { return norm_(STAGE_MAP, s.stage); }

/* ───────────── واجهة برمجية (تُستدعى من الصفحة؛ الوسيط الأول دائماً token) ───────────── */

function api_me(token) { var c = ctx_(token); return { name: c.name, role: c.role, stage: c.stages.join('+'), department: c.departments.join('+') }; }

function api_students(token) { return listStudents_(ctx_(token)); }

function listStudents_(ctx) {
  var reports = {};
  table_('Reports').filter(function (r) { return r.year === YEAR; }).forEach(function (r) { reports[r.studentId] = r.status; });
  return table_('Students')
    .filter(function (s) { return truthy_(s.active) && canSee_(ctx, s); })
    .map(function (s) {
      return { id: trim_(s.id), name: trim_(s.name), name_en: trim_(s.name_en), department: trim_(s.department), stage: stageOf_(s),
               grade: trim_(s.grade), section: trim_(s.section), class: trim_(s.grade) + ' ' + trim_(s.section), status: reports[trim_(s.id)] || 'NONE' };
    });
}

/** إحصاءات المتابعة لكل مرحلة ضمن صلاحية المستخدم. */
function api_stats(token) { return stats_(ctx_(token)); }

function stats_(ctx) {
  var out = {};
  STAGES.forEach(function (st) { out[st] = { total: 0, NONE: 0, DRAFT: 0, SUBMITTED: 0, REVIEWED: 0, APPROVED: 0, PUBLISHED: 0 }; });
  var status = {};
  table_('Reports').filter(function (r) { return r.year === YEAR; }).forEach(function (r) { status[r.studentId] = r.status; });
  table_('Students').filter(function (s) { return truthy_(s.active) && canSee_(ctx, s); }).forEach(function (s) {
    var st = stageOf_(s); if (!out[st]) return;
    var k = status[trim_(s.id)] || 'NONE';
    out[st].total++; out[st][k]++;
  });
  Object.keys(out).forEach(function (st) { if (!out[st].total) delete out[st]; });
  return { stages: out };
}

function api_library(token) {
  ctx_(token);
  return table_('Library').filter(function (l) { return truthy_(l.active); })
    .map(function (l) { return { id: l.id, category: trim_(l.category), text: trim_(l.text), stage: l.stage }; });
}

function api_audit(token) {
  var ctx = ctx_(token);
  if (['principal', 'admin'].indexOf(ctx.role) < 0) throw new Error('غير مصرّح.');
  return table_('Audit').slice(-60).reverse().map(function (a) {
    var ts = a.ts instanceof Date ? Utilities.formatDate(a.ts, 'Asia/Riyadh', "yyyy-MM-dd'T'HH:mm:ss") : trim_(a.ts);
    return { ts: ts, email: a.email, action: a.action, target: a.target, detail: a.detail };
  });
}

function api_getReport(token, studentId) { return getReport_(ctx_(token), studentId); }

function getReport_(ctx, studentId) {
  studentFor_(ctx, studentId);
  var rep = table_('Reports').filter(function (r) { return r.studentId === studentId && r.year === YEAR; })[0];
  if (!rep) return { status: 'NONE', items: [] };
  var items = table_('Items').filter(function (i) { return i.reportId === rep.id; })
    .sort(function (a, b) { return a.order - b.order; })
    .map(function (i) { return { category: i.category, text: i.text, source: i.source }; });
  return { id: rep.id, status: rep.status, items: items, pdfUrl: rep.pdfUrl };
}

/** items: [{category, text}] */
function api_saveReport(token, studentId, items) { return saveReport_(ctx_(token), studentId, items); }

function saveReport_(ctx, studentId, items) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    studentFor_(ctx, studentId);
    var rep = table_('Reports').filter(function (r) { return r.studentId === studentId && r.year === YEAR; })[0];
    if (rep && !EDITABLE[rep.status]) throw new Error('التقرير مقفل بحالته الحالية.');
    if (['counselor', 'deputy', 'admin'].indexOf(ctx.role) < 0) throw new Error('لا صلاحية للتعديل.');

    var counts = { strength: 0, improve: 0, recommend: 0 };
    var libTexts = {};
    table_('Library').forEach(function (l) { libTexts[trim_(l.text)] = true; });
    var clean = items.map(function (it, i) {
      if (CATS.indexOf(it.category) < 0) throw new Error('فئة غير صالحة.');
      var t = trim_(it.text);
      if (!t) throw new Error('عبارة فارغة.');
      var source = libTexts[t] ? 'library' : 'custom';
      if (source === 'custom' && t.length > MAX_CUSTOM_LEN) throw new Error('العبارة المخصصة أطول من ' + MAX_CUSTOM_LEN + ' حرفاً.');
      counts[it.category]++;
      if (counts[it.category] > MAX[it.category]) throw new Error('تجاوز الحد الأقصى للفئة.');
      return { category: it.category, text: t, source: source, order: i + 1 };
    });

    var now = new Date(), id;
    if (!rep) {
      id = 'R-' + Utilities.getUuid().slice(0, 8);
      appendObj_('Reports', { id: id, studentId: studentId, year: YEAR, status: 'DRAFT', createdBy: ctx.username, createdAt: now, updatedAt: now });
    } else {
      id = rep.id;
      setCell_('Reports', rep._row, 'updatedAt', now);
      deleteRows_('Items', table_('Items').filter(function (i) { return i.reportId === id; }).map(function (i) { return i._row; }));
    }
    clean.forEach(function (c) { c.reportId = id; appendObj_('Items', c); });
    audit_(ctx.username, 'SAVE', id, clean.length + ' بنود');
    return { id: id, status: rep ? rep.status : 'DRAFT' };
  } finally { lock.releaseLock(); }
}

function api_transition(token, studentId, to, reason) { return transition_(ctx_(token), studentId, to, reason); }

function transition_(ctx, studentId, to, reason) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    studentFor_(ctx, studentId);
    var rep = table_('Reports').filter(function (r) { return r.studentId === studentId && r.year === YEAR; })[0];
    if (!rep) throw new Error('لا يوجد تقرير.');
    var allowed = (TRANSITIONS[rep.status] || {})[to];
    if (!allowed || allowed.indexOf(ctx.role) < 0) throw new Error('هذه النقلة غير مسموحة لدورك.');
    if (to === 'DRAFT' && !trim_(reason)) throw new Error('سبب الإعادة مطلوب.');
    if (to === 'SUBMITTED') {
      var got = { strength: 0, improve: 0, recommend: 0 };
      table_('Items').filter(function (i) { return i.reportId === rep.id; }).forEach(function (i) { got[i.category]++; });
      if (!got.strength || !got.improve || !got.recommend) throw new Error('أكمل نقطة قوة وتحسين وتوصية على الأقل.');
    }
    setCell_('Reports', rep._row, 'status', to);
    setCell_('Reports', rep._row, 'updatedAt', new Date());
    if (to === 'REVIEWED') setCell_('Reports', rep._row, 'reviewedBy', ctx.username);
    if (to === 'APPROVED') setCell_('Reports', rep._row, 'approvedBy', ctx.username);
    audit_(ctx.username, 'TRANSITION', rep.id, rep.status + ' -> ' + to + (reason ? ' | ' + reason : ''));
    return { status: to, pdfUrl: '' };
  } finally { lock.releaseLock(); }
}

function audit_(who, action, target, detail) {
  appendObj_('Audit', { ts: new Date(), email: who, action: action, target: target, detail: detail || '' });
}

/* ───────────── فحص الإعداد (آمن: لا يطبع رمزاً ولا اسم طالب) ───────────── */

/**
 * شغّل checkSetup() بعد ملء Staff وقبل selfTest. يفحص صيغة الأوراق ويطبع في السجل «سليم / راجع / تنبيه»
 * بأرقام الصفوف وأعدادها فقط، فيمكن إرسال السجل لمهندس النظام دون كشف بيانات.
 */
function checkSetup() {
  var log = [], bad = 0;
  function ok(c, m) { log.push((c ? 'سليم: ' : 'راجع: ') + m); if (!c) bad++; }
  function warn(m) { log.push('تنبيه: ' + m); }
  var staff = table_('Staff'), studs = table_('Students'), lib = table_('Library');

  ok(staff.length > 0, 'عدد المستخدمين في Staff: ' + staff.length);
  var seen = {}, activeRoles = {}, cover = {};
  staff.forEach(function (s) {
    var n = 'Staff صف ' + s._row, u = trim_(s.username), ri = roleInfo_(s.role);
    ok(!!u, n + ': اسم المستخدم موجود');
    ok(!seen[u], n + ': اسم المستخدم غير مكرر'); seen[u] = 1;
    ok(ROLES.indexOf(ri.role) >= 0, n + ': الدور معروف («' + trim_(s.role) + '»)');
    var ds = list_(DEPT_MAP, s.department), ss = list_(STAGE_MAP, s.stage);
    if (!ss.length && ri.stage) ss = [ri.stage];
    if (!ds.length && ['counselor', 'deputy'].indexOf(ri.role) >= 0) ds = ['ahli'];
    ok(ds.every(function (d) { return ['ahli', 'diploma', 'special', 'all'].indexOf(d) >= 0; }), n + ': القسم معروف («' + trim_(s.department) + '»)');
    ok(ss.length > 0 && ss.every(function (x) { return STAGES.indexOf(x) >= 0 || x === 'all'; }), n + ': المرحلة معروفة («' + trim_(s.stage) + '»)');
    ok(trim_(s.pin).length >= 4, n + ': رمز الدخول موجود (4 خانات فأكثر)');
    if (trim_(s.pin) && trim_(s.pin).indexOf('sha256:') !== 0) warn(n + ': الرمز مخزّن صريحاً؛ الأفضل hashPin()');
    ok(['نعم', 'لا'].indexOf(trim_(s.active)) >= 0, n + ': «فعّال» نعم أو لا');
    if (truthy_(s.active)) {
      activeRoles[ri.role] = (activeRoles[ri.role] || 0) + 1;
      if (['counselor', 'deputy'].indexOf(ri.role) >= 0 && ds.indexOf('ahli') >= 0) ss.forEach(function (x) { cover[ri.role + '|' + x] = true; });
    }
  });
  ok(activeRoles.principal >= 1, 'يوجد مدير مدرسة فعّال');
  ok(activeRoles.admin >= 1, 'يوجد مدير نظام فعّال');

  var ids = {}, perStage = {};
  studs.forEach(function (s) {
    var id = trim_(s.id), st = norm_(STAGE_MAP, s.stage);
    ok(!!id && !ids[id], 'Students صف ' + s._row + ': رقم داخلي موجود وغير مكرر'); ids[id] = 1;
    ok(STAGES.indexOf(st) >= 0, 'Students صف ' + s._row + ': المرحلة معروفة («' + trim_(s.stage) + '»)');
    ok(!!trim_(s.name) && !!trim_(s.grade) && !!trim_(s.section), 'Students صف ' + s._row + ': الاسم والصف والشعبة معبّأة');
    if (truthy_(s.active)) perStage[st] = (perStage[st] || 0) + 1;
  });
  log.push('عدد الطلاب الفعّالين: ' + Object.keys(perStage).map(function (k) { return k + '=' + perStage[k]; }).join('، '));
  STAGES.forEach(function (st) {
    if (perStage[st]) ['counselor', 'deputy'].forEach(function (r) { if (!cover[r + '|' + st]) warn('لا يوجد ' + r + ' فعّال للأهلي/' + st + ' (طلابها لن يظهروا لأحد غير المدير)'); });
  });

  var cats = {}; lib.forEach(function (l) { if (truthy_(l.active)) cats[trim_(l.category)] = (cats[trim_(l.category)] || 0) + 1; });
  CATS.forEach(function (c) { ok((cats[c] || 0) >= MAX[c], 'المكتبة: ' + c + ' = ' + (cats[c] || 0) + ' (الحد الأدنى ' + MAX[c] + ')'); });
  log.push(bad ? ('النتيجة: ' + bad + ' بند يحتاج مراجعة.') : 'النتيجة: كل البنود سليمة.');
  Logger.log(log.join('\n'));
  return log;
}

/* ───────────── اختبار الصلاحيات بمستخدمين وهميين ───────────── */

/**
 * شغّل selfTest() من المحرر. يُنشئ مستخدمين وطلاباً وهميين (TEST_) ثم يتحقق ويحذفها.
 * لا تضع بيانات حقيقية هنا.
 */
function selfTest() {
  var log = [];
  function ok(cond, msg) { log.push((cond ? 'نجح: ' : 'فشل: ') + msg); }
  function throws(fn, msg) { try { fn(); log.push('فشل: ' + msg); } catch (e) { log.push('نجح: ' + msg); } }

  appendObj_('Staff', { username: 'TEST_موجه ابتدائي', role: 'موجه الابتدائي', department: 'الأهلي', stage: '', pin: '9999', active: 'نعم' });
  appendObj_('Staff', { username: 'TEST_وكيل متوسط', role: 'وكيل المتوسط', department: 'الأهلي', stage: '', pin: '9999', active: 'نعم' });
  appendObj_('Staff', { username: 'TEST_موجه دبلوما', role: 'موجه طلابي', department: 'الدبلوما الأمريكية', stage: 'ابتدائي', pin: '9999', active: 'نعم' });
  appendObj_('Staff', { username: 'TEST_مدير', role: 'مدير المدرسة', department: 'الكل', stage: 'الكل', pin: '9999', active: 'نعم' });
  appendObj_('Staff', { username: 'TEST_معطّل', role: 'موجه الابتدائي', department: 'الأهلي', stage: '', pin: '9999', active: 'لا' });
  appendObj_('Students', { id: 'TEST-1', department: 'الأهلي', stage: 'ابتدائي', grade: 'الثالث الابتدائي', section: 'أ', name: 'TEST_طالب ابتدائي', active: 'نعم' });
  appendObj_('Students', { id: 'TEST-2', department: 'الأهلي', stage: 'متوسط', grade: 'الأول المتوسط', section: 'أ', name: 'TEST_طالب متوسط', active: 'نعم' });
  appendObj_('Students', { id: 'TEST-3', department: 'الدبلوما الأمريكية', stage: 'ابتدائي', grade: 'Grade 3', section: 'A', name: 'TEST_طالب دبلوما', active: 'نعم' });
  try {
    var c = ctxFor_('TEST_موجه ابتدائي'), d = ctxFor_('TEST_وكيل متوسط'), p = ctxFor_('TEST_مدير'), cd = ctxFor_('TEST_موجه دبلوما');
    var ids = function (ctx) { return listStudents_(ctx).filter(function (s) { return /^TEST-/.test(s.id); }).map(function (s) { return s.id; }).join(); };
    ok(c.role === 'counselor' && c.stages.join() === 'primary', 'اسم الدور «موجه الابتدائي» يُستنتج منه الدور والمرحلة');
    ok(ids(c) === 'TEST-1', 'موجه الأهلي/الابتدائي يرى TEST-1 فقط');
    ok(ids(d) === 'TEST-2', 'وكيل الأهلي/المتوسط يرى TEST-2 فقط');
    ok(ids(cd) === 'TEST-3', 'موجه الدبلوما يرى طلاب الدبلوما فقط');
    ok(ids(p) === 'TEST-1,TEST-2,TEST-3', 'المدير يرى كل الأقسام');
    throws(function () { getReport_(c, 'TEST-2'); }, 'موجه الابتدائي لا يقرأ طالباً من المتوسط');
    throws(function () { getReport_(c, 'TEST-3'); }, 'موجه الأهلي لا يقرأ طالباً من الدبلوما');
    throws(function () { ctxFor_('TEST_معطّل'); }, 'الحساب المعطّل مرفوض');
    throws(function () { ctxFor_('لا أحد'); }, 'حساب غير موجود مرفوض');
    // الدخول برمز
    var lg = api_login('TEST_موجه ابتدائي', '9999');
    ok(!!lg.token && lg.user.role === 'counselor', 'الدخول برمز صحيح يعيد جلسة');
    ok(api_me(lg.token).stage === 'primary', 'الجلسة تعيد مرحلة المستخدم');
    throws(function () { api_login('TEST_موجه ابتدائي', 'خطأ'); }, 'رمز خاطئ مرفوض');
    throws(function () { api_students('رمز-جلسة-وهمي'); }, 'جلسة غير صالحة مرفوضة');
    api_logout(lg.token);
    throws(function () { api_me(lg.token); }, 'الخروج يُنهي الجلسة');
    var items = [{ category: 'strength', text: 'يشارك بفاعلية أثناء الحصة الدراسية.' }, { category: 'improve', text: 'عبارة مخصصة للاختبار' }, { category: 'recommend', text: 'تنمية مهارات التواصل والحوار الإيجابي' }];
    saveReport_(c, 'TEST-1', items);
    throws(function () { saveReport_(c, 'TEST-1', items.concat([1, 2, 3, 4, 5].map(function () { return { category: 'strength', text: 'x' }; }))); }, 'تجاوز حد النقاط مرفوض');
    transition_(c, 'TEST-1', 'SUBMITTED');
    var stC = stats_(c), stD = stats_(d), stP = stats_(p);
    ok(Object.keys(stC.stages).join() === 'primary' && Object.keys(stD.stages).join() === 'middle', 'الإحصاءات مقيّدة بمرحلة المستخدم');
    ok(stC.stages.primary.SUBMITTED >= 1, 'الإرسال يظهر في الإحصاءات');
    ok(stP.stages.primary && stP.stages.middle, 'إحصاءات المدير تشمل المراحل');
    throws(function () { transition_(c, 'TEST-1', 'APPROVED'); }, 'الموجه لا يعتمد');
    throws(function () { saveReport_(c, 'TEST-1', items); }, 'التقرير المُرسَل مقفل للتعديل');
    throws(function () { transition_(d, 'TEST-1', 'REVIEWED'); }, 'وكيل المتوسط لا يراجع طالب الابتدائي');
  } catch (e) { log.push('خطأ غير متوقع: ' + e.message); }
  // تنظيف
  var rids = table_('Reports').filter(function (r) { return /^TEST-/.test(r.studentId); });
  deleteRows_('Items', table_('Items').filter(function (i) { return rids.some(function (r) { return r.id === i.reportId; }); }).map(function (i) { return i._row; }));
  deleteRows_('Reports', rids.map(function (r) { return r._row; }));
  deleteRows_('Audit', table_('Audit').filter(function (a) { return /^TEST_/.test(trim_(a.email)); }).map(function (a) { return a._row; }));
  deleteRows_('Staff', table_('Staff').filter(function (r) { return /^TEST_/.test(trim_(r.username)); }).map(function (r) { return r._row; }));
  deleteRows_('Students', table_('Students').filter(function (r) { return /^TEST-/.test(trim_(r.id)); }).map(function (r) { return r._row; }));
  Logger.log(log.join('\n'));
  return log;
}

/* ───────────── تطبيق الويب ───────────── */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index').setTitle('تقارير الأداء — دار الفرسان')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}
