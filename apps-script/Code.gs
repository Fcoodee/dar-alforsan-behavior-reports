/**
 * تقرير الأداء السلوكي والأكاديمي — الخلفية (Google Sheets + Apps Script)
 *
 * سكربت مرتبط بالشيت (Container-bound). الشيت يملكه مدير النظام فقط ولا يُشارك مع المعلمين؛
 * الجميع يدخل عبر تطبيق الويب المقيّد بدومين المدرسة، والتصفية حسب القسم والمرحلة تتم هنا في الخادم.
 *
 * الأعمدة تُقرأ بأسمائها (عربية أو إنجليزية)، فلا يتعطل السكربت لو تغيّر ترتيبها أو أُضيف عمود.
 * لا يحتوي هذا الملف أي بيانات طلاب أو رسائل بريد. البيانات تُدخل في الشيت فقط.
 */

var YEAR = '1448-1449';
var ROLES = ['counselor', 'deputy', 'principal', 'admin'];
var STAGES = ['primary', 'middle', 'secondary'];
var CATS = ['strength', 'improve', 'recommend'];
var MAX = { strength: 4, improve: 4, recommend: 3 };
var MAX_CUSTOM_LEN = 120;

// أسماء الأعمدة المقبولة لكل مفتاح داخلي (الأولى هي الاسم المعتمد عند الإنشاء)
var HDR = {
  Students: { id: ['رقم الطالب (داخلي)', 'id'], department: ['القسم', 'department'], stage: ['المرحلة', 'stage'], grade: ['الصف', 'grade'],
              section: ['الشعبة', 'section'], name: ['الاسم بالعربية', 'name'], name_en: ['الاسم بالإنجليزية', 'name_en'], active: ['فعّال', 'active'] },
  Staff:    { email: ['البريد (دومين المدرسة)', 'email'], name: ['الاسم', 'name'], role: ['الدور', 'role'], department: ['القسم', 'department'],
              stage: ['المرحلة', 'stage'], active: ['فعّال', 'active'] },
  Library:  { id: ['id'], category: ['category'], text: ['text'], stage: ['stage'], active: ['active'] },
  Reports:  { id: ['id'], studentId: ['studentId'], year: ['year'], status: ['status'], createdBy: ['createdBy'], createdAt: ['createdAt'],
              updatedAt: ['updatedAt'], reviewedBy: ['reviewedBy'], approvedBy: ['approvedBy'], pdfUrl: ['pdfUrl'] },
  Items:    { reportId: ['reportId'], category: ['category'], text: ['text'], source: ['source'], order: ['order'] },
  Audit:    { ts: ['ts'], email: ['email'], action: ['action'], target: ['target'], detail: ['detail'] }
};
var HDR_ORDER = {
  Students: ['id', 'department', 'stage', 'grade', 'section', 'name', 'name_en', 'active'],
  Staff: ['email', 'name', 'role', 'department', 'stage', 'active'],
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
  var ss = SpreadsheetApp.getActive();
  Object.keys(HDR_ORDER).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      var heads = HDR_ORDER[name].map(function (k) { return HDR[name][k][0]; });
      sh.getRange(1, 1, 1, heads.length).setValues([heads]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  });
  return 'تم التأكد من الأوراق. أضف الموظفين في Staff، وتأكد من اكتمال Students وLibrary.';
}

/* ───────────── الهوية والصلاحيات ───────────── */

/** يستخرج سياق المستخدم الحالي أو يرمي خطأ إن لم يكن موظفاً فعّالاً. */
function whoAmI_(emailOverride) {
  var email = (emailOverride || Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!email) throw new Error('تعذر تحديد الحساب.');
  var me = table_('Staff').filter(function (s) { return trim_(s.email).toLowerCase() === email && truthy_(s.active); })[0];
  var role = me ? norm_(ROLE_MAP, me.role) : '';
  if (!me || ROLES.indexOf(role) < 0) throw new Error('الحساب غير مصرّح له.');
  var depts = list_(DEPT_MAP, me.department), stages = list_(STAGE_MAP, me.stage);
  if (['principal', 'admin'].indexOf(role) < 0 && (!depts.length || !stages.length)) throw new Error('حساب بلا قسم أو مرحلة.');
  return { email: email, name: trim_(me.name), role: role, departments: depts, stages: stages };
}

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

/* ───────────── واجهة برمجية (تُستدعى من الصفحة) ───────────── */

function api_me() { var c = whoAmI_(); return { name: c.name, role: c.role, stage: c.stages.join('+'), department: c.departments.join('+') }; }

function api_students() { return listStudents_(whoAmI_()); }

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

/** إحصاءات المتابعة لكل مرحلة ضمن صلاحية المستخدم (للوحة المتابعة والأرقام بجانب المستخدم). */
function api_stats() { return stats_(whoAmI_()); }

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

function api_library() {
  return table_('Library').filter(function (l) { return truthy_(l.active); })
    .map(function (l) { return { id: l.id, category: trim_(l.category), text: trim_(l.text), stage: l.stage }; });
}

function api_audit() {
  var ctx = whoAmI_();
  if (['principal', 'admin'].indexOf(ctx.role) < 0) throw new Error('غير مصرّح.');
  return table_('Audit').slice(-60).reverse().map(function (a) {
    var ts = a.ts instanceof Date ? Utilities.formatDate(a.ts, 'Asia/Riyadh', "yyyy-MM-dd'T'HH:mm:ss") : trim_(a.ts);
    return { ts: ts, email: a.email, action: a.action, target: a.target, detail: a.detail };
  });
}

function api_getReport(studentId) { return getReport_(whoAmI_(), studentId); }

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
function api_saveReport(studentId, items) { return saveReport_(whoAmI_(), studentId, items); }

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
      appendObj_('Reports', { id: id, studentId: studentId, year: YEAR, status: 'DRAFT', createdBy: ctx.email, createdAt: now, updatedAt: now });
    } else {
      id = rep.id;
      setCell_('Reports', rep._row, 'updatedAt', now);
      deleteRows_('Items', table_('Items').filter(function (i) { return i.reportId === id; }).map(function (i) { return i._row; }));
    }
    clean.forEach(function (c) { c.reportId = id; appendObj_('Items', c); });
    audit_(ctx.email, 'SAVE', id, clean.length + ' بنود');
    return { id: id, status: rep ? rep.status : 'DRAFT' };
  } finally { lock.releaseLock(); }
}

function api_transition(studentId, to, reason) { return transition_(whoAmI_(), studentId, to, reason); }

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
    if (to === 'REVIEWED') setCell_('Reports', rep._row, 'reviewedBy', ctx.email);
    if (to === 'APPROVED') setCell_('Reports', rep._row, 'approvedBy', ctx.email);
    audit_(ctx.email, 'TRANSITION', rep.id, rep.status + ' -> ' + to + (reason ? ' | ' + reason : ''));
    return { status: to, pdfUrl: '' };
  } finally { lock.releaseLock(); }
}

function audit_(email, action, target, detail) {
  appendObj_('Audit', { ts: new Date(), email: email, action: action, target: target, detail: detail || '' });
}

/* ───────────── اختبار الصلاحيات بمستخدمين وهميين ───────────── */

/**
 * شغّل selfTest() من المحرر. يُنشئ موظفين وطلاباً وهميين (example.test) ثم يتحقق ويحذفها.
 * لا تضع بيانات حقيقية هنا.
 */
function selfTest() {
  var log = [];
  function ok(cond, msg) { log.push((cond ? 'نجح: ' : 'فشل: ') + msg); }
  function throws(fn, msg) { try { fn(); log.push('فشل: ' + msg); } catch (e) { log.push('نجح: ' + msg); } }

  appendObj_('Staff', { email: 'c.primary@example.test', name: 'TEST_موجه ابتدائي', role: 'موجه طلابي', department: 'الأهلي', stage: 'ابتدائي', active: 'نعم' });
  appendObj_('Staff', { email: 'd.middle@example.test', name: 'TEST_وكيل متوسط', role: 'وكيل شؤون الطلاب', department: 'الأهلي', stage: 'متوسط', active: 'نعم' });
  appendObj_('Staff', { email: 'c.diploma@example.test', name: 'TEST_موجه دبلوما', role: 'موجه طلابي', department: 'الدبلوما الأمريكية', stage: 'ابتدائي', active: 'نعم' });
  appendObj_('Staff', { email: 'p@example.test', name: 'TEST_مدير', role: 'مدير المدرسة', department: 'الكل', stage: 'الكل', active: 'نعم' });
  appendObj_('Staff', { email: 'x.off@example.test', name: 'TEST_معطّل', role: 'موجه طلابي', department: 'الأهلي', stage: 'ابتدائي', active: 'لا' });
  appendObj_('Students', { id: 'TEST-1', department: 'الأهلي', stage: 'ابتدائي', grade: 'الثالث الابتدائي', section: 'أ', name: 'TEST_طالب ابتدائي', active: 'نعم' });
  appendObj_('Students', { id: 'TEST-2', department: 'الأهلي', stage: 'متوسط', grade: 'الأول المتوسط', section: 'أ', name: 'TEST_طالب متوسط', active: 'نعم' });
  appendObj_('Students', { id: 'TEST-3', department: 'الدبلوما الأمريكية', stage: 'ابتدائي', grade: 'Grade 3', section: 'A', name: 'TEST_طالب دبلوما', active: 'نعم' });
  try {
    var c = whoAmI_('c.primary@example.test'), d = whoAmI_('d.middle@example.test'), p = whoAmI_('p@example.test'), cd = whoAmI_('c.diploma@example.test');
    var ids = function (ctx) { return listStudents_(ctx).filter(function (s) { return /^TEST-/.test(s.id); }).map(function (s) { return s.id; }).join(); };
    ok(ids(c) === 'TEST-1', 'موجه الأهلي/الابتدائي يرى TEST-1 فقط');
    ok(ids(d) === 'TEST-2', 'وكيل الأهلي/المتوسط يرى TEST-2 فقط');
    ok(ids(cd) === 'TEST-3', 'موجه الدبلوما يرى طلاب الدبلوما فقط');
    ok(ids(p) === 'TEST-1,TEST-2,TEST-3', 'المدير يرى كل الأقسام');
    throws(function () { getReport_(c, 'TEST-2'); }, 'موجه الابتدائي لا يقرأ طالباً من المتوسط');
    throws(function () { getReport_(c, 'TEST-3'); }, 'موجه الأهلي لا يقرأ طالباً من الدبلوما');
    throws(function () { whoAmI_('x.off@example.test'); }, 'الحساب المعطّل مرفوض');
    throws(function () { whoAmI_('nobody@example.test'); }, 'حساب غير موجود مرفوض');
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
  deleteRows_('Audit', table_('Audit').filter(function (a) { return /example\.test$/.test(trim_(a.email)); }).map(function (a) { return a._row; }));
  deleteRows_('Staff', table_('Staff').filter(function (r) { return /example\.test$/.test(trim_(r.email)); }).map(function (r) { return r._row; }));
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
