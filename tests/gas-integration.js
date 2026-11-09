// اختبار تكامل: صفحة Apps Script (apps-script/Index.html) في Chromium + منطق Code.gs الحقيقي على شيت وهمي في الذاكرة.
// node tests/gas-integration.js  (بيانات افتراضية فقط)
const fs = require('fs'), path = require('path'), { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const out = []; const ok = (c, m) => out.push((c ? 'نجح: ' : 'فشل: ') + m);

// ───── شيت وهمي ─────
const data = {}, sheets = {};
function Sheet(name) { this.name = name; data[name] = data[name] || []; this.d = data[name]; }
Sheet.prototype = {
  getLastRow() { return this.d.length; }, getLastColumn() { return this.d.reduce((m, r) => Math.max(m, r.length), 0); },
  getRange(r, c, nr, nc) { const s = this; nr = nr || 1; nc = nc || 1; return {
    setValues(v) { v.forEach((row, i) => { s.d[r - 1 + i] = s.d[r - 1 + i] || []; row.forEach((x, j) => s.d[r - 1 + i][c - 1 + j] = x); }); return this; },
    setValue(v) { s.d[r - 1] = s.d[r - 1] || []; s.d[r - 1][c - 1] = v; return this; },
    getValues() { const o = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push((s.d[r - 1 + i] || [])[c - 1 + j] ?? ''); o.push(row); } return o; },
    setFontWeight() { return this; } }; },
  setFrozenRows() {}, appendRow(row) { this.d.push(row); }, deleteRow(r) { this.d.splice(r - 1, 1); },
  getDataRange() { const s = this; return { getValues() { const w = s.getLastColumn(); return s.d.map(r => { const x = r.slice(); while (x.length < w) x.push(''); return x.map(v => v === undefined ? '' : v); }); } }; }
};
let EMAIL = '';
global.SpreadsheetApp = { getActive: () => ({ getSheetByName: n => sheets[n] || (data[n] ? (sheets[n] = new Sheet(n)) : null), insertSheet: n => sheets[n] = new Sheet(n) }) };
global.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
global.Utilities = { getUuid: () => Math.random().toString(16).slice(2) + '0000000000', formatDate: d => d.toISOString() };
global.Session = { getActiveUser: () => ({ getEmail: () => EMAIL }) };
global.Logger = { log() {} }; global.HtmlService = {};
eval(fs.readFileSync(path.join(root, 'apps-script', 'Code.gs'), 'utf8') + '\n;global.__api={checkSetup,setup,api_me,api_students,api_library,api_getReport,api_saveReport,api_transition,api_stats,api_audit};');
__api.setup();
const DEMO = JSON.parse(fs.readFileSync(path.join(root, 'data.js'), 'utf8').match(/window\.DEMO=(\{.*\});/s)[1]);
const AR = { primary: 'ابتدائي', middle: 'متوسط', secondary: 'ثانوي' };
['primary', 'middle', 'secondary'].forEach(st => DEMO.students.filter(s => s.stage === st).slice(0, 12).forEach(s =>
  data.Students.push([s.id, 'الأهلي', AR[st], s.grade, s.section, s.name, '', 'نعم'])));
DEMO.library.forEach(l => data.Library.push([l.id, l.category, l.text, 'all', 'TRUE']));
[['c.p@example.test', 'موجه ابتدائي', 'موجه طلابي', 'الأهلي', 'ابتدائي'], ['d.p@example.test', 'وكيل ابتدائي', 'وكيل شؤون الطلاب', 'الأهلي', 'ابتدائي'],
 ['d.m@example.test', 'وكيل متوسط', 'وكيل شؤون الطلاب', 'الأهلي', 'متوسط'], ['p@example.test', 'مدير', 'مدير المدرسة', 'الكل', 'الكل'],
 ['sys@example.test', 'مهندس', 'مدير النظام', 'الكل', 'الكل']].forEach(r => data.Staff.push([...r, 'نعم']));

const chk = __api.checkSetup();
ok(!chk.some(l => l.startsWith('راجع')), 'checkSetup: لا بنود «راجع» على بيانات سليمة');
ok(chk.some(l => l.startsWith('تنبيه')), 'checkSetup: ينبّه إلى مرحلة بلا موجه/وكيل');
ok(!chk.join(' ').includes('@'), 'checkSetup لا يطبع بريداً');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.exposeFunction('__call', (fn, args) => { try { return { v: JSON.parse(JSON.stringify(__api[fn](...args) ?? null)) }; } catch (e) { return { e: e.message }; } });
  await p.addInitScript(() => {
    const mk = (ok, fail) => new Proxy({}, { get: (_, k) => k === 'withSuccessHandler' ? f => mk(f, fail) : k === 'withFailureHandler' ? f => mk(ok, f)
      : (...a) => { window.__call(k, a).then(r => r.e !== undefined ? fail && fail({ message: r.e }) : ok && ok(r.v)); } });
    window.google = { script: { run: mk(() => {}, () => {}) } };
  });
  const go = async email => { EMAIL = email; await p.goto('file://' + path.join(root, 'apps-script', 'Index.html')); await p.waitForTimeout(900); };

  EMAIL = 'nobody@example.test'; await go('nobody@example.test');
  ok((await p.textContent('body')).includes('الحساب غير مصرّح له'), 'حساب غير مدرج في Staff يُرفض برسالة واضحة');
  await go('c.p@example.test'); await p.waitForSelector('.hero');
  ok((await p.$$eval('[data-cls]', e => e.length)) > 0, 'الموجه يحمّل شعب القسم الأهلي/الابتدائي');
  const cls = await p.$$eval('[data-cls]', e => e.map(x => x.textContent));
  ok(cls.every(c => /الابتدائي/.test(c)), 'كل الشعب ابتدائية فقط: ' + cls.join(' | ').slice(0, 80));
  ok((await p.$$eval('[data-stu]', e => e.length)) > 0, 'قائمة الطلاب تُحمَّل من الشيت');
  const imgOk = await p.evaluate(() => [...document.images].every(i => !/^assets\//.test(i.getAttribute('src') || '')));
  ok(imgOk, 'الصور مضمّنة (لا مسارات assets/ داخل Apps Script)');
  // تحرير وإرسال
  const id = await p.evaluate(() => S.students[0].id);
  await p.evaluate(async () => { await pick(S.students[0].id); await toggle('strength', S.lib.find(l => l.category === 'strength').text); await toggle('improve', S.lib.find(l => l.category === 'improve').text); await toggle('recommend', S.lib.find(l => l.category === 'recommend').text); });
  await p.click('[data-go=SUBMITTED]'); await p.waitForTimeout(500);
  ok((await p.textContent('.badge.b-SUBMITTED')) === 'بانتظار الوكيل', 'الموجه يرسل التقرير فيُحفظ في ورقة Reports');
  ok(data.Reports.length === 2 && data.Items.length === 4, 'كُتب صف في Reports وثلاثة بنود في Items (+الرأس)');
  ok(data.Items.slice(1).every(r => !String(r.join()).includes('طالب')), 'ورقة Items لا تحوي اسم الطالب (الربط بالرقم الداخلي فقط)');
  // الوكيل
  await go('d.p@example.test'); await p.waitForSelector('.hero');
  ok((await p.textContent('.hero .pl.act b')) === '1', 'شارة الوكيل: بانتظارك 1 (من api_stats)');
  await p.click('[data-flt=todo]'); await p.waitForTimeout(200);
  ok((await p.$$eval('[data-stu]', e => e.length)) === 1, 'فلتر «بانتظار إجرائي» يعرض التقرير المرسل');
  await p.click('[data-stu="' + id + '"]'); await p.waitForTimeout(300); await p.click('[data-go=REVIEWED]'); await p.waitForTimeout(500);
  // وكيل المتوسط لا يرى
  await go('d.m@example.test'); await p.waitForSelector('.hero');
  ok((await p.textContent('.hero .pl.act b')) === '0' && (await p.$$eval('[data-cls]', e => e.every(x => /المتوسط/.test(x.textContent)))), 'وكيل المتوسط معزول عن الابتدائي');
  // المدير
  await go('p@example.test'); await p.waitForSelector('.hero');
  const allc = await p.$$eval('[data-cls]', e => e.map(x => x.textContent).join('|'));
  ok(/الابتدائي/.test(allc) && /المتوسط/.test(allc) && /الثانوي/.test(allc), 'المدير يرى شعب المراحل الثلاث');
  await p.click('[data-flt=todo]'); await p.waitForTimeout(200); await p.click('[data-stu="' + id + '"]'); await p.waitForTimeout(300);
  await p.click('[data-go=APPROVED]'); await p.waitForTimeout(500);
  ok((await p.textContent('.badge.b-APPROVED')) === 'معتمد', 'المدير يعتمد');
  ok(await p.$('#audit') !== null, 'زر سجل التدقيق يظهر للمدير');
  await p.click('#audit'); await p.waitForTimeout(500);
  ok((await p.textContent('#auditBody')).includes('TRANSITION'), 'سجل التدقيق يُقرأ من ورقة Audit');
  await p.click('#auditDlg button'); 
  // مدير النظام
  await go('sys@example.test'); await p.waitForSelector('.hero');
  const allc2 = await p.$$eval('[data-cls]', e => e.map(x => x.textContent).join('|'));
  ok(/الابتدائي/.test(allc2) && /المتوسط/.test(allc2) && /الثانوي/.test(allc2) && await p.$('#audit') !== null, 'مدير النظام: كل المراحل وسجل التدقيق');
  ok((await p.evaluate(() => getComputedStyle(document.querySelector('.sheet')).userSelect)) !== 'none', 'مدير النظام يستطيع التحديد');
  ok(errs.filter(e => !/ERR_TUNNEL|fonts/.test(e)).length === 0, 'لا أخطاء JavaScript ' + JSON.stringify(errs));
  console.log(out.join('\n')); await b.close(); process.exit(out.some(x => x.startsWith('فشل')) ? 1 : 0);
})().catch(e => { console.log(out.join('\n')); console.log('ERR', e.message); process.exit(1); });
