/**
 * تقرير الأداء السلوكي والأكاديمي — الخلفية (Google Sheets + Apps Script)
 *
 * سكربت مرتبط بالشيت (Container-bound). الشيت يملكه مدير النظام فقط ولا يُشارك مع المعلمين؛
 * الجميع يدخل عبر تطبيق الويب المقيّد بدومين المدرسة، والتصفية حسب المرحلة تتم هنا في الخادم.
 *
 * لا يحتوي هذا الملف أي بيانات طلاب أو رسائل بريد. البيانات تُدخل في الشيت فقط.
 */

var SHEETS = {
  Staff:    ['email', 'name', 'role', 'stage', 'active'],
  Students: ['id', 'name', 'stage', 'class', 'active'],
  Library:  ['id', 'category', 'text', 'stage', 'active'],
  Reports:  ['id', 'studentId', 'year', 'status', 'createdBy', 'createdAt', 'updatedAt', 'reviewedBy', 'approvedBy', 'pdfUrl'],
  Items:    ['reportId', 'category', 'text', 'source', 'order'],
  Audit:    ['ts', 'email', 'action', 'target', 'detail']
};
var ROLES = ['counselor', 'deputy', 'principal', 'admin'];
var STAGES = ['primary', 'middle', 'secondary'];
var CATS = ['strength', 'improve', 'recommend'];
var MAX = { strength: 4, improve: 4, recommend: 3 };
var MAX_CUSTOM_LEN = 120;
var YEAR = '1447-1448';

// الحالة الحالية -> { الحالة التالية: الأدوار المسموح لها بالنقلة }
var TRANSITIONS = {
  DRAFT:     { SUBMITTED: ['counselor', 'deputy', 'admin'] },
  SUBMITTED: { REVIEWED: ['deputy', 'admin'], DRAFT: ['deputy', 'principal', 'admin'] },
  REVIEWED:  { APPROVED: ['principal', 'admin'], DRAFT: ['deputy', 'principal', 'admin'] },
  APPROVED:  { PUBLISHED: ['principal', 'admin'], DRAFT: ['principal', 'admin'] },
  PUBLISHED: { DRAFT: ['principal', 'admin'] }
};
var EDITABLE = { DRAFT: true };

/* ───────────── الإعداد (يُشغَّل مرة واحدة من مدير النظام) ───────────── */

function setup() {
  var ss = SpreadsheetApp.getActive();
  Object.keys(SHEETS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, SHEETS[name].length).setValues([SHEETS[name]]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  });
  seedLibraryIfEmpty_();
  return 'تم إنشاء الأوراق. أضف الموظفين والطلاب يدوياً أو بالاستيراد.';
}

function seedLibraryIfEmpty_() {
  var sh = SpreadsheetApp.getActive().getSheetByName('Library');
  if (sh.getLastRow() > 1) return;
  var rows = [];
  function add(cat, arr) { arr.forEach(function (t, i) { rows.push([cat.charAt(0).toUpperCase() + '-' + (i + 1), cat, t, 'all', true]); }); }
  add('strength', ['يشارك بفاعلية أثناء الحصة الدراسية.', 'يتحلى بالهدوء وحسن الاستماع أثناء الشرح.', 'يتحلى بالأمانة والصدق في تعاملاته اليومية.', 'يحافظ على النظام داخل الفصل والطابور.']);
  add('improve', ['يعمل على تحسين مهارات الاستماع والإنصات.', 'يحرص على تنظيم وقته وإنجاز المهام المطلوبة.']);
  add('recommend', ['تنمية المهارات الشخصية والاجتماعية بالمشاركة في الأنشطة التطوعية والبرامج الهادفة.', 'استثمار الإجازة الصيفية في تنمية مهارات القراءة والتركيز.', 'تنمية مهارات التواصل والحوار الإيجابي']);
  sh.getRange(2, 1, rows.length, 5).setValues(rows);
  // ملاحظة: المكتبة الكاملة (40 + 40) تُستورد من ملف Excel الأصلي بنفس الأعمدة.
}

/* ───────────── الهوية والصلاحيات ───────────── */

function table_(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  var v = sh.getDataRange().getValues();
  var head = v.shift();
  return v.map(function (r, i) {
    var o = { _row: i + 2 };
    head.forEach(function (h, j) { o[h] = r[j]; });
    return o;
  });
}

/** يستخرج سياق المستخدم الحالي أو يرمي خطأ إن لم يكن موظفاً فعّالاً. */
function whoAmI_(emailOverride) {
  var email = (emailOverride || Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!email) throw new Error('تعذر تحديد الحساب.');
  var me = table_('Staff').filter(function (s) {
    return String(s.email).toLowerCase() === email && s.active === true;
  })[0];
  if (!me || ROLES.indexOf(me.role) < 0) throw new Error('الحساب غير مصرّح له.');
  return { email: email, name: me.name, role: me.role, stage: me.stage };
}

function canSeeStage_(ctx, stage) {
  return ctx.role === 'principal' || ctx.role === 'admin' || ctx.stage === 'all' || ctx.stage === stage;
}

function studentFor_(ctx, studentId) {
  var s = table_('Students').filter(function (x) { return x.id === studentId && x.active === true; })[0];
  if (!s || !canSeeStage_(ctx, s.stage)) throw new Error('الطالب غير متاح.');
  return s;
}

/* ───────────── واجهة برمجية (تُستدعى من الصفحة) ───────────── */

function api_me() { var c = whoAmI_(); return { name: c.name, role: c.role, stage: c.stage }; }

function api_students() { return listStudents_(whoAmI_()); }

function listStudents_(ctx) {
  var reports = {};
  table_('Reports').filter(function (r) { return r.year === YEAR; }).forEach(function (r) { reports[r.studentId] = r.status; });
  return table_('Students')
    .filter(function (s) { return s.active === true && canSeeStage_(ctx, s.stage); })
    .map(function (s) { return { id: s.id, name: s.name, stage: s.stage, class: s.class, status: reports[s.id] || 'NONE' }; });
}


/** إحصاءات المتابعة لكل مرحلة ضمن صلاحية المستخدم (للوحة المتابعة والأرقام بجانب المستخدم). */
function api_stats() { return stats_(whoAmI_()); }

function stats_(ctx) {
  var out = {};
  STAGES.forEach(function (st) {
    if (canSeeStage_(ctx, st)) out[st] = { total: 0, NONE: 0, DRAFT: 0, SUBMITTED: 0, REVIEWED: 0, APPROVED: 0, PUBLISHED: 0 };
  });
  var status = {};
  table_('Reports').filter(function (r) { return r.year === YEAR; }).forEach(function (r) { status[r.studentId] = r.status; });
  table_('Students').filter(function (s) { return s.active === true && out[s.stage]; }).forEach(function (s) {
    var k = status[s.id] || 'NONE';
    out[s.stage].total++;
    out[s.stage][k]++;
  });
  return { stages: out };
}

function api_library() { return table_('Library').filter(function (l) { return l.active === true; })
  .map(function (l) { return { id: l.id, category: l.category, text: l.text, stage: l.stage }; }); }

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

/** items: [{category, text, source:'library'|'custom'}] */
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
    table_('Library').forEach(function (l) { libTexts[l.text] = true; });
    var clean = items.map(function (it, i) {
      if (CATS.indexOf(it.category) < 0) throw new Error('فئة غير صالحة.');
      var t = String(it.text || '').trim();
      if (!t) throw new Error('عبارة فارغة.');
      var source = libTexts[t] ? 'library' : 'custom';
      if (source === 'custom' && t.length > MAX_CUSTOM_LEN) throw new Error('العبارة المخصصة أطول من ' + MAX_CUSTOM_LEN + ' حرفاً.');
      counts[it.category]++;
      if (counts[it.category] > MAX[it.category]) throw new Error('تجاوز الحد الأقصى للفئة.');
      return [null, it.category, t, source, i + 1];
    });

    var now = new Date();
    var reports = SpreadsheetApp.getActive().getSheetByName('Reports');
    var itemsSh = SpreadsheetApp.getActive().getSheetByName('Items');
    var id;
    if (!rep) {
      id = 'R-' + Utilities.getUuid().slice(0, 8);
      reports.appendRow([id, studentId, YEAR, 'DRAFT', ctx.email, now, now, '', '', '']);
    } else {
      id = rep.id;
      reports.getRange(rep._row, 7).setValue(now);
      // حذف البنود القديمة (من الأسفل للأعلى)
      table_('Items').filter(function (i) { return i.reportId === id; }).map(function (i) { return i._row; })
        .sort(function (a, b) { return b - a; }).forEach(function (r) { itemsSh.deleteRow(r); });
    }
    if (clean.length) {
      clean.forEach(function (c) { c[0] = id; });
      itemsSh.getRange(itemsSh.getLastRow() + 1, 1, clean.length, 5).setValues(clean);
    }
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
    if (to === 'DRAFT' && !String(reason || '').trim()) throw new Error('سبب الإعادة مطلوب.');
    if (to === 'SUBMITTED') {
      var got = { strength: 0, improve: 0, recommend: 0 };
      table_('Items').filter(function (i) { return i.reportId === rep.id; }).forEach(function (i) { got[i.category]++; });
      if (!got.strength || !got.improve || !got.recommend) throw new Error('أكمل نقطة قوة وتحسين وتوصية على الأقل.');
    }
    var sh = SpreadsheetApp.getActive().getSheetByName('Reports');
    sh.getRange(rep._row, 4).setValue(to);
    sh.getRange(rep._row, 7).setValue(new Date());
    if (to === 'REVIEWED') sh.getRange(rep._row, 8).setValue(ctx.email);
    if (to === 'APPROVED') sh.getRange(rep._row, 9).setValue(ctx.email);
    audit_(ctx.email, 'TRANSITION', rep.id, rep.status + ' -> ' + to + (reason ? ' | ' + reason : ''));
    return { status: to };
  } finally { lock.releaseLock(); }
}

function audit_(email, action, target, detail) {
  SpreadsheetApp.getActive().getSheetByName('Audit').appendRow([new Date(), email, action, target, detail || '']);
}

/* ───────────── اختبار الصلاحيات بمستخدمين وهميين (الخطوة 1) ───────────── */

/**
 * شغّل selfTest() من المحرر. يُنشئ ثلاثة موظفين وطلاباً وهميين بعلامة TEST_ ثم يتحقق ويحذفها.
 * استخدم عناوين example.test فقط، ولا تضع بيانات حقيقية هنا.
 */
function selfTest() {
  var log = [];
  function ok(cond, msg) { log.push((cond ? 'نجح: ' : 'فشل: ') + msg); }
  function throws(fn, msg) { try { fn(); log.push('فشل: ' + msg); } catch (e) { log.push('نجح: ' + msg); } }

  var staff = SpreadsheetApp.getActive().getSheetByName('Staff');
  var studs = SpreadsheetApp.getActive().getSheetByName('Students');
  var s0 = staff.getLastRow(), t0 = studs.getLastRow();
  staff.getRange(s0 + 1, 1, 4, 5).setValues([
    ['c.primary@example.test', 'TEST_موجه ابتدائي', 'counselor', 'primary', true],
    ['d.middle@example.test',  'TEST_وكيل متوسط',  'deputy',    'middle',  true],
    ['p@example.test',         'TEST_مدير',        'principal', 'all',     true],
    ['x.off@example.test',     'TEST_معطّل',       'counselor', 'primary', false]
  ]);
  studs.getRange(t0 + 1, 1, 2, 5).setValues([
    ['TEST-1', 'TEST_طالب ابتدائي', 'primary', '1/أ', true],
    ['TEST-2', 'TEST_طالب متوسط',   'middle',  '1م/أ', true]
  ]);
  try {
    var c = whoAmI_('c.primary@example.test'), d = whoAmI_('d.middle@example.test'), p = whoAmI_('p@example.test');
    ok(listStudents_(c).every(function (s) { return s.stage === 'primary'; }), 'موجه الابتدائي يرى الابتدائي فقط');
    ok(listStudents_(d).every(function (s) { return s.stage === 'middle'; }), 'وكيل المتوسط يرى المتوسط فقط');
    ok(listStudents_(p).some(function (s) { return s.id === 'TEST-1'; }) && listStudents_(p).some(function (s) { return s.id === 'TEST-2'; }), 'المدير يرى المرحلتين');
    throws(function () { getReport_(c, 'TEST-2'); }, 'موجه الابتدائي لا يقرأ طالباً من المتوسط');
    throws(function () { whoAmI_('x.off@example.test'); }, 'الحساب المعطّل مرفوض');
    throws(function () { whoAmI_('nobody@example.test'); }, 'حساب غير موجود مرفوض');
    var items = [{ category: 'strength', text: 'يشارك بفاعلية أثناء الحصة الدراسية.' }, { category: 'improve', text: 'عبارة مخصصة للاختبار' }, { category: 'recommend', text: 'تنمية مهارات التواصل والحوار الإيجابي' }];
    saveReport_(c, 'TEST-1', items);
    throws(function () { saveReport_(c, 'TEST-1', items.concat([1, 2, 3, 4, 5].map(function () { return { category: 'strength', text: 'x' }; }))); }, 'تجاوز حد النقاط مرفوض');
    transition_(c, 'TEST-1', 'SUBMITTED');
    throws(function () { transition_(c, 'TEST-1', 'APPROVED'); }, 'الموجه لا يعتمد');
    throws(function () { saveReport_(c, 'TEST-1', items); }, 'التقرير المُسلَّم مقفل للتعديل');
    var stC = stats_(c), stD = stats_(d), stP = stats_(p);
    ok(Object.keys(stC.stages).join() === 'primary' && Object.keys(stD.stages).join() === 'middle', 'الإحصاءات مقيّدة بمرحلة المستخدم');
    ok(Object.keys(stP.stages).length === 3, 'إحصاءات المدير تشمل المراحل الثلاث');
    ok(stC.stages.primary.SUBMITTED >= 1, 'الإرسال يظهر في إحصاءات الوكيل/الموجه');
    var dp = whoAmI_('d.middle@example.test');
    throws(function () { transition_(dp, 'TEST-1', 'REVIEWED'); }, 'وكيل المتوسط لا يراجع طالب الابتدائي');
  } catch (e) { log.push('خطأ غير متوقع: ' + e.message); }
  // تنظيف
  [['Staff', 'email', /example\.test$/], ['Students', 'id', /^TEST-/]].forEach(function (x) {
    var sh = SpreadsheetApp.getActive().getSheetByName(x[0]);
    table_(x[0]).filter(function (r) { return x[2].test(String(r[x[1]])); }).map(function (r) { return r._row; })
      .sort(function (a, b) { return b - a; }).forEach(function (r) { sh.deleteRow(r); });
  });
  var rid = table_('Reports').filter(function (r) { return r.studentId === 'TEST-1'; });
  rid.map(function (r) { return r._row; }).sort(function (a, b) { return b - a; })
    .forEach(function (r) { SpreadsheetApp.getActive().getSheetByName('Reports').deleteRow(r); });
  var its = SpreadsheetApp.getActive().getSheetByName('Items');
  rid.forEach(function (r) {
    table_('Items').filter(function (i) { return i.reportId === r.id; }).map(function (i) { return i._row; })
      .sort(function (a, b) { return b - a; }).forEach(function (row) { its.deleteRow(row); });
  });
  Logger.log(log.join('\n'));
  return log;
}

/* ───────────── اختبار توليد PDF (الخطوة 2) ───────────── */

/**
 * يولّد PDF تجريبياً من HTML بسيط (RTL) ويحفظه في مجلد Drive باسم عشوائي.
 * شغّله وافتح الملف: هل ظهر العربي متصلاً وبالاتجاه الصحيح؟ هل الجدول سليم؟
 * قبل التشغيل: اجعل الخاصية PDF_TEST_FOLDER_ID في Script Properties = معرّف مجلد خاص.
 * البيانات هنا وهمية بالكامل.
 */
function testPdf() {
  var folderId = PropertiesService.getScriptProperties().getProperty('PDF_TEST_FOLDER_ID');
  if (!folderId) throw new Error('اضبط PDF_TEST_FOLDER_ID في Script Properties.');
  var data = {
    name: 'طالب تجريبي', year: YEAR,
    strength: ['يشارك بفاعلية أثناء الحصة الدراسية.', 'يتحلى بالهدوء وحسن الاستماع أثناء الشرح.', 'يتحلى بالأمانة والصدق في تعاملاته اليومية.', 'يحافظ على النظام داخل الفصل والطابور.'],
    improve: ['يعمل على تحسين مهارات الاستماع والإنصات.', 'يحرص على تنظيم وقته وإنجاز المهام المطلوبة.'],
    recommend: ['تنمية المهارات الشخصية والاجتماعية بالمشاركة في الأنشطة التطوعية والبرامج الهادفة.', 'استثمار الإجازة الصيفية في تنمية مهارات القراءة والتركيز.', 'تنمية مهارات التواصل والحوار الإيجابي']
  };
  var blob = HtmlService.createHtmlOutput(reportHtml_(data)).getBlob().getAs('application/pdf')
    .setName('TEST-' + Utilities.getUuid().slice(0, 8) + '.pdf');
  var file = DriveApp.getFolderById(folderId).createFile(blob);
  Logger.log('الملف: ' + file.getUrl());
  return file.getUrl();
}

function esc_(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

/** قالب HTML مبسّط لاختبار التحويل. القالب البصري الكامل (الترويسة والشعار) يُضاف بعد نجاح الاختبار. */
function reportHtml_(d) {
  function rows(a, b) {
    var n = Math.max(a.length, b.length, 1), out = '';
    for (var i = 0; i < n; i++) out += '<tr><td>' + esc_(a[i] || '') + '</td><td>' + esc_(b[i] || '') + '</td></tr>';
    return out;
  }
  return '<html dir="rtl" lang="ar"><head><meta charset="utf-8"><style>' +
    'body{font-family:Arial,sans-serif;direction:rtl;text-align:right;font-size:13px;line-height:1.7}' +
    'h1{text-align:center;font-size:22px}table{width:100%;border-collapse:collapse;margin:8px 0}' +
    'th,td{border:1px solid #9fb0bd;padding:6px 10px}th{background:#eef3f6}p{text-align:justify}' +
    '</style></head><body dir="rtl">' +
    '<h1>الأداء السلوكي والأكاديمي للعام الدراسي ' + esc_(d.year) + 'ه</h1>' +
    '<p><b>شريكنا ولي أمر الطالب/ ' + esc_(d.name) + '</b></p>' +
    '<table><tr><th>النقاط الإيجابية ونقاط القوة</th><th>نقاط تحتاج إلى دعم وتحسين</th></tr>' + rows(d.strength, d.improve) + '</table>' +
    '<table><tr><th>التوصيات</th></tr>' + d.recommend.map(function (r) { return '<tr><td>' + esc_(r) + '</td></tr>'; }).join('') + '</table>' +
    '<p>حفظكم الله ورعاكم، وكل عام وأنتم بخير</p></body></html>';
}

/* ───────────── تطبيق الويب (صفحة اختبار مبدئية) ───────────── */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index').setTitle('تقارير الأداء');
}
