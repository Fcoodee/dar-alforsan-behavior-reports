/**
 * تقرير الأداء السلوكي والأكاديمي — الخلفية (Google Sheets + Apps Script)
 *
 * سكربت مرتبط بالشيت (Container-bound). الشيت يملكه مدير النظام فقط ولا يُشارك مع المعلمين؛
 * الجميع يدخل عبر تطبيق الويب أو عبر صفحة GitHub Pages التي تستدعي doPost (الوصول: أي شخص، بلا تسجيل Google)؛ الحماية في رمز كل دور، والتصفية حسب القسم والمرحلة تتم هنا في الخادم.
 *
 * الدخول: بحساب دور (اسم المستخدم = اسم الدور مثل «وكيل الابتدائي») ورمز دخول من ورقة Staff،
 * بلا بريد إلكتروني. تُعطى جلسة (token) تُحفظ في CacheService لست ساعات.
 * لاحقاً يمكن إضافة مستخدمين بأسمائهم الشخصية بصفوف جديدة دون تغيير الكود.
 *
 * الأعمدة تُقرأ بأسمائها (عربية أو إنجليزية)، فلا يتعطل السكربت لو تغيّر ترتيبها أو أُضيف عمود.
 * لا يحتوي هذا الملف أي بيانات طلاب أو رموز دخول. البيانات تُدخل في الشيت فقط.
 */

var YEAR = '1448-1449';
// الفترات: دورتان في كل فصل دراسي. الفترة الحالية تُضبط من ورقة Config (المفتاح «الفترة الحالية»)؛ الافتراضي S1P1.
var PERIODS = { S1P1: { semester: 'الفصل الدراسي الأول', label: 'الفترة الأولى' }, S1P2: { semester: 'الفصل الدراسي الأول', label: 'الفترة الثانية' },
                S2P1: { semester: 'الفصل الدراسي الثاني', label: 'الفترة الأولى' }, S2P2: { semester: 'الفصل الدراسي الثاني', label: 'الفترة الثانية' } };
var DEFAULT_PERIOD = 'S1P1';
var ROLES = ['counselor', 'deputy', 'principal', 'admin'];
var STAGES = ['primary', 'middle', 'secondary'];
var CATS = ['strength', 'improve', 'recommend'];
var MAX = { strength: 4, improve: 4, recommend: 3 };
var MAX_CUSTOM_LEN = 120;
var SESSION_SECONDS = 6 * 3600;
var MAX_FAILS = 5;
var LOCK_SECONDS = 60;
var MAX_FAILS_ALL = 40;   // حدّ عام للمحاولات الخاطئة في الدقيقة عبر كل الحسابات (يحدّ من التخمين الموزّع)

// أسماء الأعمدة المقبولة لكل مفتاح داخلي (الأولى هي الاسم المعتمد عند الإنشاء)
var HDR = {
  Students: { id: ['رقم الطالب (داخلي)', 'id'], department: ['القسم', 'department'], stage: ['المرحلة', 'stage'], grade: ['الصف', 'grade'],
              section: ['الشعبة', 'section'], name: ['الاسم بالعربية', 'name'], name_en: ['الاسم بالإنجليزية', 'name_en'], active: ['فعّال', 'active'] },
  Staff:    { username: ['اسم المستخدم', 'username'], role: ['الدور', 'role'], department: ['القسم', 'department'], stage: ['المرحلة', 'stage'],
              pin: ['رمز الدخول', 'pin'], active: ['فعّال', 'active'], name: ['الاسم', 'name'], email: ['البريد (اختياري)', 'البريد (دومين المدرسة)', 'email'] },
  Library:  { id: ['id'], category: ['category'], text: ['text'], stage: ['stage'], active: ['active'], lang: ['lang', 'اللغة'] },
  Config:   { key: ['المفتاح', 'key'], value: ['القيمة', 'value'], note: ['ملاحظة', 'note'] },
  Reports:  { id: ['id'], studentId: ['studentId'], year: ['year'], period: ['period'], status: ['status'], createdBy: ['createdBy'], createdAt: ['createdAt'],
              updatedAt: ['updatedAt'], reviewedBy: ['reviewedBy'], approvedBy: ['approvedBy'], pdfUrl: ['pdfUrl'] },
  Items:    { reportId: ['reportId'], category: ['category'], text: ['text'], source: ['source'], order: ['order'] },
  Audit:    { ts: ['ts'], email: ['email'], action: ['action'], target: ['target'], detail: ['detail'] }
};
var HDR_ORDER = {
  Students: ['id', 'department', 'stage', 'grade', 'section', 'name', 'name_en', 'active'],
  Staff: ['username', 'role', 'department', 'stage', 'pin', 'active', 'name', 'email'],
  Library: ['id', 'category', 'text', 'stage', 'active', 'lang'],
  Config: ['key', 'value', 'note'],
  Reports: ['id', 'studentId', 'year', 'period', 'status', 'createdBy', 'createdAt', 'updatedAt', 'reviewedBy', 'approvedBy', 'pdfUrl'],
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
                'وكيل الابتدائي': ['deputy', 'primary'], 'وكيل المتوسط': ['deputy', 'middle'], 'وكيل الثانوي': ['deputy', 'secondary'],
                'موجه المتوسط والثانوي': ['counselor', ['middle', 'secondary']], 'وكيل المتوسط والثانوي': ['deputy', ['middle', 'secondary']],
                'موجه قسم الدبلوما': ['counselor', ['primary', 'middle', 'secondary'], 'diploma'], 'وكيل قسم الدبلوما': ['deputy', ['primary', 'middle', 'secondary'], 'diploma'],
                'موجه قسم التربية الخاصة': ['counselor', ['primary', 'middle', 'secondary'], 'special'], 'وكيل قسم التربية الخاصة': ['deputy', ['primary', 'middle', 'secondary'], 'special'] };

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
function period_() {
  var cache = CacheService.getScriptCache(), c = cache.get('cfg_period');
  if (c && PERIODS[c]) return c;
  var p = DEFAULT_PERIOD;
  try {
    var row = table_('Config').filter(function (r) { return ['الفترة الحالية', 'period'].indexOf(trim_(r.key)) >= 0; })[0];
    if (row && PERIODS[trim_(row.value)]) p = trim_(row.value);
  } catch (e) {}
  cache.put('cfg_period', p, 60);
  return p;
}
function periodInfo_() { var c = period_(); return { code: c, semester: PERIODS[c].semester, label: PERIODS[c].label }; }
function repOf_(r, P) { return r.year === YEAR && (trim_(r.period) || DEFAULT_PERIOD) === P; }

function norm_(map, v) { var t = trim_(v); return map[t] || t.toLowerCase(); }
function list_(map, v) { return trim_(v).split(/[+،,]/).map(trim_).filter(Boolean).map(function (x) { return norm_(map, x); }); }
function truthy_(v) { return v === true || ['نعم', 'true', 'yes', 'y', '1'].indexOf(trim_(v).toLowerCase()) >= 0; }
function roleInfo_(text) {
  var t = trim_(text);
  var m = POS_MAP[t];
  if (m) { var st = [].concat(m[1]); return { role: m[0], stage: st[0], stages: st, dept: m[2] || null }; }
  return { role: norm_(ROLE_MAP, t), stage: null, stages: [], dept: null };
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

/* ───────────── ذاكرة مؤقتة (تقلّل قراءة الأوراق) ─────────────
   Staff 60ث · Students 300ث · Library 600ث · Reports 90ث (وتُمسح عند كل كتابة). تعديل الورقة يدوياً يظهر خلال هذه المدد، أو شغّل refreshCache(). */
var CHUNK = 40000;
function cget_(key) {
  var c = CacheService.getScriptCache(), n = parseInt(c.get(key + '#n') || '0', 10);
  if (!n) return null;
  var keys = []; for (var i = 0; i < n; i++) keys.push(key + '#' + i);
  var m = c.getAll(keys), str = '';
  for (var j = 0; j < n; j++) { if (m[keys[j]] === undefined || m[keys[j]] === null) return null; str += m[keys[j]]; }
  try { return JSON.parse(str); } catch (e) { return null; }
}
function cput_(key, val, ttl) {
  var str = JSON.stringify(val), o = {}, n = 0;
  for (var i = 0; i < str.length; i += CHUNK) { o[key + '#' + n] = str.slice(i, i + CHUNK); n++; }
  o[key + '#n'] = String(n);
  try { CacheService.getScriptCache().putAll(o, ttl); } catch (e) {}
}
function cdel_(key) {
  var c = CacheService.getScriptCache(), n = parseInt(c.get(key + '#n') || '0', 10), keys = [key + '#n'];
  for (var i = 0; i < n; i++) keys.push(key + '#' + i);
  try { c.removeAll(keys); } catch (e) {}
}
function tableC_(name, ttl) {
  var k = 'tbl_' + name, v = cget_(k);
  if (v) return v;
  v = table_(name); cput_(k, v, ttl); return v;
}
function bust_(name) { cdel_('tbl_' + name); }
function bustAll_() { ['Staff', 'Students', 'Library', 'Reports'].forEach(bust_); CacheService.getScriptCache().remove('cfg_period'); }
/** شغّلها من المحرر بعد تعديل الأوراق يدوياً لتظهر التغييرات فوراً. */
function refreshCache() { bustAll_(); Logger.log('تم مسح الذاكرة المؤقتة.'); }

/** صفوف بنود تقرير معيّن (مرتبة تصاعدياً): TextFinder إن توفّر، وإلا مسح الورقة. */
function itemRows_(sh, head, id) {
  var c = 0; head.forEach(function (h, j) { if (HDR.Items.reportId.indexOf(trim_(h)) >= 0) c = j + 1; });
  var lr = sh.getLastRow(); if (lr < 2 || !c) return [];
  try {
    var rg = sh.getRange(2, c, lr - 1, 1);
    if (typeof rg.createTextFinder === 'function') {
      return rg.createTextFinder(id).matchEntireCell(true).findAll().map(function (r) { return r.getRow(); }).sort(function (a, b) { return a - b; });
    }
  } catch (e) {}
  return table_('Items').filter(function (i) { return i.reportId === id; }).map(function (i) { return i._row; }).sort(function (a, b) { return a - b; });
}

/** يكتب بنود التقرير دفعة واحدة: يعيد استعمال صفوفه القديمة، ويضيف الباقي في آخر الورقة، ويُفرغ الزائد. */
function writeItems_(id, clean) {
  var sh = SpreadsheetApp.getActive().getSheetByName('Items');
  var head = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0], width = head.length;
  var old = itemRows_(sh, head, id), targets = old.slice(0, clean.length), next = sh.getLastRow() + 1, writes = {};
  while (targets.length < clean.length) targets.push(next++);
  function rowArr(c) {
    return head.map(function (h) {
      var t = trim_(h), v = '';
      Object.keys(HDR.Items).forEach(function (k) { if (HDR.Items[k].indexOf(t) >= 0 && c[k] !== undefined) v = c[k]; });
      return v;
    });
  }
  clean.forEach(function (c, i) { c.reportId = id; writes[targets[i]] = rowArr(c); });
  var blank = head.map(function () { return ''; });
  old.slice(clean.length).forEach(function (r) { writes[r] = blank; });
  var rows = Object.keys(writes).map(Number).sort(function (a, b) { return a - b; }), i = 0;
  while (i < rows.length) {
    var j = i; while (j + 1 < rows.length && rows[j + 1] === rows[j] + 1) j++;
    var vals = []; for (var k = i; k <= j; k++) vals.push(writes[rows[k]]);
    sh.getRange(rows[i], 1, vals.length, width).setValues(vals);
    i = j + 1;
  }
}

/** يضبط عدة خلايا في صف بقراءة الرأس مرة واحدة. */
function setCells_(name, row, obj) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  var head = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0];
  Object.keys(obj).forEach(function (k) {
    var c = 0; head.forEach(function (h, j) { if (HDR[name][k].indexOf(trim_(h)) >= 0) c = j + 1; });
    if (!c) throw new Error('العمود غير موجود: ' + name + '.' + k);
    sh.getRange(row, c).setValue(obj[k]);
  });
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

/** يضيف حسابات الأدوار الناقصة إلى Staff (بلا رموز؛ المدير والمهندس يُضافان يدوياً برمز). آمنة للتكرار. */
function addMissingStaff() {
  var roles = [['موجه الابتدائي', 'الأهلي'], ['وكيل الابتدائي', 'الأهلي'], ['موجه المتوسط والثانوي', 'الأهلي'], ['وكيل المتوسط والثانوي', 'الأهلي'],
               ['موجه قسم الدبلوما', 'الدبلوما الأمريكية'], ['وكيل قسم الدبلوما', 'الدبلوما الأمريكية'],
               ['موجه قسم التربية الخاصة', 'التربية الخاصة'], ['وكيل قسم التربية الخاصة', 'التربية الخاصة']];
  var have = {}; table_('Staff').forEach(function (x) { have[trim_(x.username)] = 1; });
  var added = [];
  roles.forEach(function (r) {
    if (have[r[0]]) return;
    appendObj_('Staff', { username: r[0], role: r[0], department: r[1], stage: '', pin: '', active: 'نعم' }); added.push(r[0]);
  });
  Logger.log(added.length ? 'أُضيف: ' + added.join('، ') : 'كل حسابات الأدوار موجودة.');
}

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
  var cf = ss.getSheetByName('Config');
  if (cf && cf.getLastRow() <= 1) { cf.appendRow(['الفترة الحالية', DEFAULT_PERIOD, 'S1P1 أولى/أول · S1P2 ثانية/أول · S2P1 أولى/ثاني · S2P2 ثانية/ثاني']); }
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
  return tableC_('Staff', 60).filter(function (s) { return trim_(s.username) === u && truthy_(s.active); })[0] || null;
}

/** يبني سياق المستخدم من صف Staff. */
function ctxFor_(username) {
  var s = staffRow_(username);
  if (!s) throw new Error('الحساب غير مصرّح له.');
  return ctxOfRow_(s);
}

function ctxOfRow_(s) {
  var ri = roleInfo_(s.role);
  if (ROLES.indexOf(ri.role) < 0) throw new Error('دور غير معروف في Staff.');
  var stages = list_(STAGE_MAP, s.stage), depts = list_(DEPT_MAP, s.department);
  if (!stages.length && ri.stages.length) stages = ri.stages.slice();
  if (['principal', 'admin'].indexOf(ri.role) >= 0) { if (!stages.length) stages = ['all']; if (!depts.length) depts = ['all']; }
  else if (!depts.length) depts = [ri.dept || 'ahli'];
  if (!stages.length) throw new Error('حساب بلا مرحلة.');
  return { email: trim_(s.username), username: trim_(s.username), name: trim_(s.name) || trim_(s.username), role: ri.role, departments: depts, stages: stages };
}

function ctx_(token) {
  var raw = token ? CacheService.getScriptCache().get('tok_' + token) : null;
  if (!raw) throw new Error('انتهت الجلسة، سجّل الدخول من جديد.');
  return ctxFor_(JSON.parse(raw).username);
}

/** الرمز مطلوب لمدير المدرسة ومدير النظام فقط؛ الموجه والوكيل بلا رمز (قرار المالك). */
function needsPin_(s) { var r = roleInfo_(s.role).role; return r === 'principal' || r === 'admin'; }

/** قائمة الدخول: الاسم والدور والقسم، وهل يلزم رمز، وهل القسم/الدور مهيّأ (فيه طلاب ضمن صلاحيته). */
function api_users() {
  var studs = tableC_('Students', 300).filter(function (x) { return truthy_(x.active); });
  return tableC_('Staff', 60).filter(function (s) { return truthy_(s.active) && trim_(s.username); })
    .map(function (s) {
      var ready = false, dept = 'all';
      try {
        var c = ctxOfRow_(s); dept = c.departments.length === 1 ? c.departments[0] : 'all';
        ready = c.role === 'principal' || c.role === 'admin' || studs.some(function (x) { return canSee_(c, x); });
      } catch (e) {}
      return { username: trim_(s.username), role: trim_(s.role), needsPin: needsPin_(s), dept: dept, ready: ready };
    });
}

function api_login(username, pin) {
  var cache = CacheService.getScriptCache(), key = 'fail_' + trim_(username);
  var fails = parseInt(cache.get(key) || '0', 10);
  if (fails >= MAX_FAILS) throw new Error('محاولات كثيرة. حاول بعد دقيقة.');
  var failsAll = parseInt(cache.get('fail_all') || '0', 10);
  if (failsAll >= MAX_FAILS_ALL) throw new Error('محاولات كثيرة على النظام. حاول بعد دقيقة.');
  var s = staffRow_(username);
  if (!s || (needsPin_(s) && !pinOk_(s.pin, pin))) {
    cache.put(key, String(fails + 1), LOCK_SECONDS);
    cache.put('fail_all', String(failsAll + 1), LOCK_SECONDS);
    throw new Error('بيانات الدخول غير صحيحة.');
  }
  cache.remove(key);
  var ctx = ctxFor_(username);
  if (ctx.role !== 'principal' && ctx.role !== 'admin' && !tableC_('Students', 300).some(function (x) { return truthy_(x.active) && canSee_(ctx, x); }))
    throw new Error('القسم المطلوب قيد عمليات تهيئة قواعد البيانات.');
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
  var s = tableC_('Students', 300).filter(function (x) { return trim_(x.id) === studentId && truthy_(x.active); })[0];
  if (!s || !canSee_(ctx, s)) throw new Error('الطالب غير متاح.');
  return s;
}

function stageOf_(s) { return norm_(STAGE_MAP, s.stage); }

/* ───────────── واجهة برمجية (تُستدعى من الصفحة؛ الوسيط الأول دائماً token) ───────────── */

function api_me(token) { var c = ctx_(token); return { name: c.name, role: c.role, stage: c.stages.join('+'), department: c.departments.join('+'), period: periodInfo_() }; }

function api_students(token) { return listStudents_(ctx_(token)); }

function statusMap_() {
  var P = period_(), m = {};
  tableC_('Reports', 90).filter(function (r) { return repOf_(r, P); }).forEach(function (r) { m[r.studentId] = r.status; });
  return m;
}
function visibleStudents_(ctx) { return tableC_('Students', 300).filter(function (s) { return truthy_(s.active) && canSee_(ctx, s); }); }

function listStudents_(ctx, studs, reports) {
  reports = reports || statusMap_();
  return (studs || visibleStudents_(ctx))
    .map(function (s) {
      return { id: trim_(s.id), name: trim_(s.name), name_en: trim_(s.name_en), department: trim_(s.department), stage: stageOf_(s),
               grade: trim_(s.grade), section: trim_(s.section), class: (trim_(s.grade) + ' ' + trim_(s.section)).trim(), status: reports[trim_(s.id)] || 'NONE' };
    });
}

/** إحصاءات المتابعة لكل مرحلة ضمن صلاحية المستخدم. */
function api_stats(token) { return stats_(ctx_(token)); }

function stats_(ctx, studs, status) {
  var out = {};
  STAGES.forEach(function (st) { out[st] = { total: 0, NONE: 0, DRAFT: 0, SUBMITTED: 0, REVIEWED: 0, APPROVED: 0, PUBLISHED: 0 }; });
  status = status || statusMap_();
  (studs || visibleStudents_(ctx)).forEach(function (s) {
    var st = stageOf_(s); if (!out[st]) return;
    var k = status[trim_(s.id)] || 'NONE';
    out[st].total++; out[st][k]++;
  });
  Object.keys(out).forEach(function (st) { if (!out[st].total) delete out[st]; });
  return { stages: out };
}

/** العبارات الإنجليزية (lang = en) تُعاد لمن يرى الدبلوما فقط (موجه/وكيل الدبلوما والمدير والمهندس). الفارغ = عربي. */
function library_(ctx) {
  var en = !ctx || ctx.role === 'principal' || ctx.role === 'admin' || ctx.departments.indexOf('diploma') >= 0 || ctx.departments.indexOf('all') >= 0;
  return tableC_('Library', 600).filter(function (l) { return truthy_(l.active) && (en || (trim_(l.lang) || 'ar') !== 'en'); })
    .map(function (l) { return { id: l.id, category: trim_(l.category), text: trim_(l.text), stage: l.stage, lang: trim_(l.lang) || 'ar' }; });
}
function api_library(token) { return library_(ctx_(token)); }

/** كل ما تحتاجه الواجهة بعد الدخول في استدعاء واحد (بدل me + students + library + stats). */
function api_boot(token) {
  var ctx = ctx_(token), studs = visibleStudents_(ctx), st = statusMap_();
  return { user: { name: ctx.name, role: ctx.role, stage: ctx.stages.join('+'), department: ctx.departments.join('+'), period: periodInfo_() },
           students: listStudents_(ctx, studs, st), library: library_(ctx), stats: stats_(ctx, studs, st) };
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
  var P = period_();
  var rep = tableC_('Reports', 90).filter(function (r) { return r.studentId === studentId && repOf_(r, P); })[0];
  if (!rep) return { status: 'NONE', items: [] };
  var items = cget_('itm_' + rep.id);
  if (!items) {
    items = table_('Items').filter(function (i) { return i.reportId === rep.id; })
      .sort(function (a, b) { return a.order - b.order; })
      .map(function (i) { return { category: i.category, text: i.text, source: i.source }; });
    cput_('itm_' + rep.id, items, 600);
  }
  return { id: rep.id, status: rep.status, items: items, pdfUrl: rep.pdfUrl };
}

/** items: [{category, text}] */
function api_saveReport(token, studentId, items) { return saveReport_(ctx_(token), studentId, items); }

function saveReport_(ctx, studentId, items) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    studentFor_(ctx, studentId);
    var rep = table_('Reports').filter(function (r) { return r.studentId === studentId && repOf_(r, period_()); })[0];
    if (rep && !EDITABLE[rep.status]) throw new Error('التقرير مقفل بحالته الحالية.');
    if (['counselor', 'deputy', 'admin'].indexOf(ctx.role) < 0) throw new Error('لا صلاحية للتعديل.');

    var counts = { strength: 0, improve: 0, recommend: 0 };
    var libTexts = {};
    tableC_('Library', 600).forEach(function (l) { libTexts[trim_(l.text)] = true; });
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
      appendObj_('Reports', { id: id, studentId: studentId, year: YEAR, period: period_(), status: 'DRAFT', createdBy: ctx.username, createdAt: now, updatedAt: now });
    } else {
      id = rep.id;
      setCell_('Reports', rep._row, 'updatedAt', now);
    }
    writeItems_(id, clean);
    cput_('itm_' + id, clean.map(function (c) { return { category: c.category, text: c.text, source: c.source }; }), 600);
    bust_('Reports');
    audit_(ctx.username, 'SAVE', id, clean.length + ' بنود');
    return { id: id, status: rep ? rep.status : 'DRAFT', stats: stats_(ctx) };
  } finally { lock.releaseLock(); }
}

function api_transition(token, studentId, to, reason) { return transition_(ctx_(token), studentId, to, reason); }

function transition_(ctx, studentId, to, reason) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    studentFor_(ctx, studentId);
    var rep = table_('Reports').filter(function (r) { return r.studentId === studentId && repOf_(r, period_()); })[0];
    if (!rep) throw new Error('لا يوجد تقرير.');
    var allowed = (TRANSITIONS[rep.status] || {})[to];
    if (!allowed || allowed.indexOf(ctx.role) < 0) throw new Error('هذه النقلة غير مسموحة لدورك.');
    if (to === 'DRAFT' && !trim_(reason)) throw new Error('سبب الإعادة مطلوب.');
    if (to === 'SUBMITTED') {
      var got = { strength: 0, improve: 0, recommend: 0 };
      (cget_('itm_' + rep.id) || table_('Items').filter(function (i) { return i.reportId === rep.id; })).forEach(function (i) { got[i.category]++; });
      if (!got.strength || !got.improve || !got.recommend) throw new Error('أكمل نقطة قوة وتحسين وتوصية على الأقل.');
    }
    var upd = { status: to, updatedAt: new Date() };
    if (to === 'REVIEWED') upd.reviewedBy = ctx.username;
    if (to === 'APPROVED') upd.approvedBy = ctx.username;
    setCells_('Reports', rep._row, upd);
    bust_('Reports');
    audit_(ctx.username, 'TRANSITION', rep.id, rep.status + ' -> ' + to + (reason ? ' | ' + reason : ''));
    return { status: to, pdfUrl: '', stats: stats_(ctx) };
  } finally { lock.releaseLock(); }
}

function audit_(who, action, target, detail) {
  appendObj_('Audit', { ts: new Date(), email: who, action: action, target: target, detail: detail || '' });
}


/* ───────────── تشخيص (آمن: لا أسماء طلاب ولا رموز) ───────────── */

/** شغّلها إن لم تظهر أسماء الطلاب: تطبع كيف تُقرأ الأعمدة وكم طالباً يرى كل مستخدم. */
function diagnose() {
  var log = [], sh = SpreadsheetApp.getActive().getSheetByName('Students');
  var head = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0];
  log.push('رؤوس Students → مفتاح: ' + head.map(function (h) {
    var t = trim_(h), k = '؟';
    Object.keys(HDR.Students).forEach(function (key) { if (HDR.Students[key].indexOf(t) >= 0) k = key; });
    return '«' + t + '»→' + k;
  }).join(' | '));
  var rows = table_('Students');
  log.push('صفوف Students المقروءة: ' + rows.length + ' | الفعّالة: ' + rows.filter(function (r) { return truthy_(r.active); }).length);
  if (rows.length) log.push('مثال: فعّال=«' + rows[0].active + '» (' + typeof rows[0].active + ') | القسم=«' + rows[0].department + '» | المرحلة=«' + rows[0].stage + '»');
  var by = {};
  rows.forEach(function (r) { var k = norm_(DEPT_MAP, r.department) + '/' + norm_(STAGE_MAP, r.stage) + (truthy_(r.active) ? '' : ' (غير فعّال)'); by[k] = (by[k] || 0) + 1; });
  log.push('التوزيع: ' + Object.keys(by).map(function (k) { return k + '=' + by[k]; }).join('، '));
  table_('Staff').forEach(function (st) {
    try { var c = ctxFor_(st.username); log.push(trim_(st.username) + ' → ' + c.role + ' | أقسام=' + c.departments.join('+') + ' | مراحل=' + c.stages.join('+') + ' | يرى ' + listStudents_(c).length + ' طالباً'); }
    catch (e) { log.push(trim_(st.username) + ' → خطأ: ' + e.message); }
  });
  Logger.log(log.join('\n'));
  return log;
}

/* ───────────── فحص الإعداد (آمن: لا يطبع رمزاً ولا اسم طالب) ───────────── */

/**
 * شغّل checkSetup() بعد ملء Staff وقبل selfTest. يفحص صيغة الأوراق ويطبع في السجل «سليم / راجع / تنبيه»
 * بأرقام الصفوف وأعدادها فقط، فيمكن إرسال السجل لمهندس النظام دون كشف بيانات.
 */
function checkSetup() {
  var log = [], bad = 0, pass = 0;
  // لا تُطبع البنود السليمة (سجل Apps Script يُقتطع إن كبر)؛ تُعدّ فقط، وتُطبع المخالفات والتنبيهات والملخص
  function ok(c, m) { if (c) pass++; else { log.push('راجع: ' + m); bad++; } }
  function warn(m) { log.push('تنبيه: ' + m); }
  var staff = table_('Staff'), studs = table_('Students'), lib = table_('Library');

  ok(staff.length > 0, 'ورقة Staff فارغة');
  log.push('عدد المستخدمين في Staff: ' + staff.length);
  var seen = {}, activeRoles = {}, cover = {};
  staff.forEach(function (s) {
    var n = 'Staff صف ' + s._row, u = trim_(s.username), ri = roleInfo_(s.role);
    ok(!!u, n + ': اسم المستخدم موجود');
    ok(!seen[u], n + ': اسم المستخدم غير مكرر'); seen[u] = 1;
    ok(ROLES.indexOf(ri.role) >= 0, n + ': الدور معروف («' + trim_(s.role) + '»)');
    var ds = list_(DEPT_MAP, s.department), ss = list_(STAGE_MAP, s.stage);
    if (!ss.length && ri.stages.length) ss = ri.stages.slice();
    if (!ds.length && ['counselor', 'deputy'].indexOf(ri.role) >= 0) ds = [ri.dept || 'ahli'];
    ok(ds.every(function (d) { return ['ahli', 'diploma', 'special', 'all'].indexOf(d) >= 0; }), n + ': القسم معروف («' + trim_(s.department) + '»)');
    ok(ss.length > 0 && ss.every(function (x) { return STAGES.indexOf(x) >= 0 || x === 'all'; }), n + ': المرحلة معروفة («' + trim_(s.stage) + '»)');
    if (needsPin_(s)) ok(trim_(s.pin).length >= 4, n + ': رمز الدخول موجود (4 خانات فأكثر)');
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
    ok(!!trim_(s.name) && !!trim_(s.grade), 'Students صف ' + s._row + ': الاسم والصف معبّأان');
    if (truthy_(s.active)) perStage[st] = (perStage[st] || 0) + 1;
  });
  log.push('عدد الطلاب الفعّالين: ' + Object.keys(perStage).map(function (k) { return k + '=' + perStage[k]; }).join('، '));
  STAGES.forEach(function (st) {
    if (perStage[st]) ['counselor', 'deputy'].forEach(function (r) { if (!cover[r + '|' + st]) warn('لا يوجد ' + r + ' فعّال للأهلي/' + st + ' (طلابها لن يظهروا لأحد غير المدير)'); });
  });

  var cats = {}; lib.forEach(function (l) { if (truthy_(l.active)) cats[trim_(l.category)] = (cats[trim_(l.category)] || 0) + 1; });
  CATS.forEach(function (c) { ok((cats[c] || 0) >= MAX[c], 'المكتبة: ' + c + ' = ' + (cats[c] || 0) + ' (الحد الأدنى ' + MAX[c] + ')'); });
  log.push('عدد الفحوص السليمة: ' + pass);
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
  appendObj_('Staff', { username: 'TEST_موجه م/ث', role: 'موجه المتوسط والثانوي', department: '', stage: '', pin: '', active: 'نعم' });
  appendObj_('Staff', { username: 'TEST_موجه خاصة', role: 'موجه قسم التربية الخاصة', department: '', stage: '', pin: '', active: 'نعم' });
  appendObj_('Staff', { username: 'TEST_وكيل دبلوما', role: 'وكيل قسم الدبلوما', department: '', stage: '', pin: '', active: 'نعم' });
  appendObj_('Students', { id: 'TEST-1', department: 'الأهلي', stage: 'ابتدائي', grade: 'الثالث الابتدائي', section: 'أ', name: 'TEST_طالب ابتدائي', active: 'نعم' });
  appendObj_('Students', { id: 'TEST-2', department: 'الأهلي', stage: 'متوسط', grade: 'الأول المتوسط', section: 'أ', name: 'TEST_طالب متوسط', active: 'نعم' });
  appendObj_('Students', { id: 'TEST-3', department: 'الدبلوما الأمريكية', stage: 'ابتدائي', grade: 'Grade 3', section: 'A', name: 'TEST_طالب دبلوما', active: 'نعم' });
  bustAll_();
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
    ok(ids(ctxFor_('TEST_موجه م/ث')) === 'TEST-2', 'موجه المتوسط والثانوي يرى المتوسط (أهلي) فقط');
    ok(ids(ctxFor_('TEST_وكيل دبلوما')) === 'TEST-3', 'وكيل قسم الدبلوما يرى الدبلوما فقط');
    throws(function () { api_login('TEST_موجه خاصة', ''); }, 'قسم التربية الخاصة بلا طلاب: رسالة قيد التهيئة');
    var us = api_users(); function uf(n) { return us.filter(function (u) { return u.username === n; })[0]; }
    ok(uf('TEST_موجه خاصة').ready === false && uf('TEST_موجه خاصة').dept === 'special' && uf('TEST_موجه م/ث').ready === true, 'api_users تعيد ready وdept');
    var lg = api_login('TEST_موجه ابتدائي', '');
    ok(!!lg.token && lg.user.role === 'counselor', 'الموجه يدخل بلا رمز ويحصل على جلسة');
    ok(api_users().filter(function (u) { return u.username === 'TEST_مدير'; })[0].needsPin === true && api_users().filter(function (u) { return u.username === 'TEST_موجه ابتدائي'; })[0].needsPin === false, 'الرمز مطلوب للمدير فقط');
    ok(api_me(lg.token).stage === 'primary', 'الجلسة تعيد مرحلة المستخدم');
    ok(api_me(lg.token).period.code === period_() && !!PERIODS[period_()], 'الجلسة تعيد الفترة الحالية (' + period_() + ')');
    throws(function () { api_login('TEST_مدير', 'خطأ'); }, 'رمز المدير الخاطئ مرفوض');
    throws(function () { api_login('TEST_مدير', ''); }, 'دخول المدير بلا رمز مرفوض');
    throws(function () { api_students('رمز-جلسة-وهمي'); }, 'جلسة غير صالحة مرفوضة');
    api_logout(lg.token);
    throws(function () { api_me(lg.token); }, 'الخروج يُنهي الجلسة');
    var items = [{ category: 'strength', text: 'يشارك بفاعلية أثناء الحصة الدراسية.' }, { category: 'improve', text: 'عبارة مخصصة للاختبار' }, { category: 'recommend', text: 'تنمية مهارات التواصل والحوار الإيجابي' }];
    var sv = saveReport_(c, 'TEST-1', items);
    ok(!!sv.stats && !!sv.stats.stages.primary, 'الحفظ يعيد الإحصاءات (بلا استدعاء إضافي)');
    var bt = api_boot(lg.token);
    ok(bt.user.role === 'counselor' && !!bt.user.period && bt.students.some(function (x) { return x.id === 'TEST-1' && x.status === 'DRAFT'; }) && !!bt.stats.stages.primary, 'api_boot يعيد المستخدم والطلاب والمكتبة والإحصاءات في استدعاء واحد، وحالة الحفظ تظهر رغم الذاكرة المؤقتة');
    ok(getReport_(c, 'TEST-1').items.length === 3 && getReport_(c, 'TEST-1').items.length === 3, 'قراءة بنود التقرير (من الذاكرة) صحيحة');
    saveReport_(c, 'TEST-1', items.slice(0, 2));
    ok(getReport_(c, 'TEST-1').items.length === 2 && table_('Items').filter(function (i) { return i.reportId === sv.id; }).length === 2, 'إعادة الحفظ تُفرغ البنود الزائدة ولا تكرّرها');
    saveReport_(c, 'TEST-1', items);
    throws(function () { saveReport_(c, 'TEST-1', items.concat([1, 2, 3, 4, 5].map(function () { return { category: 'strength', text: 'x' }; }))); }, 'تجاوز حد النقاط مرفوض');
    var rp = table_('Reports').filter(function (r) { return r.studentId === 'TEST-1'; })[0];
    ok(!!rp && trim_(rp.period) === period_(), 'التقرير يُخزَّن بفترته (' + (rp ? trim_(rp.period) : '-') + ')');
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
  bustAll_();
  Logger.log(log.join('\n'));
  return log;
}


/* ───────────── واجهة JSON للصفحة المستضافة على GitHub Pages ───────────── */

// الدوال المسموح استدعاؤها عن بعد (قائمة بيضاء). الوسيط الأول للمحمية دائماً token.
var API_MAP = { api_users: api_users, api_login: api_login, api_logout: api_logout, api_me: api_me, api_students: api_students,
                api_library: api_library, api_getReport: api_getReport, api_saveReport: api_saveReport, api_transition: api_transition,
                api_stats: api_stats, api_audit: api_audit, api_boot: api_boot };

/**
 * يستقبل POST بنص JSON: {"fn":"api_login","args":["اسم","رمز"]} (Content-Type: text/plain لتجنّب طلب preflight)
 * ويعيد {ok:true,value} أو {ok:false,error}. لا يُسرَّب أي أثر خطأ.
 */
function doPost(e) {
  var out;
  try {
    var raw = (e && e.postData && e.postData.contents) || '';
    if (raw.length > 200000) throw new Error('الطلب كبير.');
    var req = JSON.parse(raw || '{}');
    if (!req.fn || !Object.prototype.hasOwnProperty.call(API_MAP, req.fn)) throw new Error('طلب غير مسموح.');
    out = { ok: true, value: API_MAP[req.fn].apply(null, Array.isArray(req.args) ? req.args : []) };
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/* ───────────── تطبيق الويب ───────────── */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index').setTitle('تقارير الأداء — دار الفرسان')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}
