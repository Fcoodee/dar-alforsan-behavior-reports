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
const crypto = require('crypto'); const cacheMap = new Map();
global.CacheService = { getScriptCache: () => ({ get: k => cacheMap.has(k) ? cacheMap.get(k) : null, put: (k, v) => { cacheMap.set(k, v); }, remove: k => { cacheMap.delete(k); } }) };
global.SpreadsheetApp = { getActive: () => ({ getSheetByName: n => sheets[n] || (data[n] ? (sheets[n] = new Sheet(n)) : null), insertSheet: n => sheets[n] = new Sheet(n) }) };
global.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
global.Utilities = { getUuid: () => crypto.randomUUID(), formatDate: d => d.toISOString(), DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
  computeDigest: (alg, t) => Array.from(crypto.createHash('sha256').update(t, 'utf8').digest()).map(b => b > 127 ? b - 256 : b) };
global.Logger = { log() {} }; global.HtmlService = {};
eval(fs.readFileSync(path.join(root, 'apps-script', 'Code.gs'), 'utf8') + '\n;global.__api={checkSetup,setup,selfTest,api_users,api_login,api_logout,api_me,api_students,api_library,api_getReport,api_saveReport,api_transition,api_stats,api_audit};');
__api.setup();
const DEMO = JSON.parse(fs.readFileSync(path.join(root, 'data.js'), 'utf8').match(/window\.DEMO=(\{.*\});/s)[1]);
const AR = { primary: 'ابتدائي', middle: 'متوسط', secondary: 'ثانوي' };
['primary', 'middle', 'secondary'].forEach(st => DEMO.students.filter(s => s.stage === st).slice(0, 12).forEach(s =>
  data.Students.push([s.id, 'الأهلي', AR[st], s.grade, s.section, s.name, '', 'نعم'])));
DEMO.library.forEach(l => data.Library.push([l.id, l.category, l.text, 'all', 'TRUE']));
[['موجه الابتدائي', 'موجه الابتدائي', 'الأهلي', '', '1111'], ['وكيل الابتدائي', 'وكيل الابتدائي', 'الأهلي', '', '2222'], ['وكيل المتوسط', 'وكيل المتوسط', 'الأهلي', '', '3333'],
 ['مدير المدرسة', 'مدير المدرسة', 'الكل', 'الكل', '4444'], ['مدير النظام', 'مدير النظام', 'الكل', 'الكل', '5555']].forEach(r => data.Staff.push([...r, 'نعم', '', '']));

const chk = __api.checkSetup();
ok(!chk.some(l => l.startsWith('راجع')), 'checkSetup: لا بنود «راجع» على بيانات سليمة');
ok(chk.some(l => l.startsWith('تنبيه')), 'checkSetup: ينبّه إلى مرحلة بلا موجه/وكيل أو رمز صريح');
ok(!chk.join(' ').includes('1111'), 'checkSetup لا يطبع الرموز');
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
  const login = async (user, pin) => {
    await p.goto('file://' + path.join(root, 'apps-script', 'Index.html'));
    await p.evaluate(() => sessionStorage.clear()); await p.reload();
    await p.waitForSelector('#gu'); await p.selectOption('#gu', user); await p.fill('#gp', pin); await p.click('#lf button'); await p.waitForTimeout(700);
  };

  await p.goto('file://' + path.join(root, 'apps-script', 'Index.html')); await p.waitForSelector('#gu');
  const names = await p.$$eval('#gu option', e => e.map(x => x.textContent));
  ok(names.join('|') === 'موجه الابتدائي|وكيل الابتدائي|وكيل المتوسط|مدير المدرسة|مدير النظام', 'قائمة المستخدمين: أسماء الأدوار فقط (بلا رموز)');
  ok(!(await p.content()).includes('1111') && !(await p.content()).includes('5555'), 'الرموز لا تظهر في الصفحة');
  await login('موجه الابتدائي', 'خطأ');
  ok((await p.textContent('#lerr')).includes('غير صحيحة') && await p.$('.hero') === null, 'رمز خاطئ يُرفض ولا تُعرض بيانات');
  for (let i = 0; i < 5; i++) { await p.fill('#gp', 'x' + i); await p.click('#lf button'); await p.waitForTimeout(250); }
  await p.fill('#gp', '1111'); await p.click('#lf button'); await p.waitForTimeout(400);
  ok((await p.textContent('#lerr')).includes('محاولات كثيرة'), 'قفل بعد 5 محاولات خاطئة حتى مع الرمز الصحيح');
  cacheMap.clear();

  await login('موجه الابتدائي', '1111'); await p.waitForSelector('.hero');
  ok((await p.textContent('.hero')).includes('موجه الابتدائي'), 'الموجه يدخل بحساب الدور ورمزه');
  const cls = await p.$$eval('[data-cls]', e => e.map(x => x.textContent));
  ok(cls.length > 0 && cls.every(c => /الابتدائي/.test(c)), 'كل الشعب ابتدائية فقط: ' + cls.join(' | ').slice(0, 80));
  ok((await p.$$eval('[data-stu]', e => e.length)) > 0, 'قائمة الطلاب تُحمَّل من الشيت');
  ok(await p.evaluate(() => [...document.images].every(i => !/^assets\//.test(i.getAttribute('src') || ''))), 'الصور لا تستعمل مسارات نسبية داخل Apps Script');
  const id = await p.evaluate(() => S.students[0].id);
  await p.evaluate(async () => { await pick(S.students[0].id); await toggle('strength', S.lib.find(l => l.category === 'strength').text); await toggle('improve', S.lib.find(l => l.category === 'improve').text); await toggle('recommend', S.lib.find(l => l.category === 'recommend').text); });
  await p.click('[data-go=SUBMITTED]'); await p.waitForTimeout(500);
  ok((await p.textContent('.badge.b-SUBMITTED')) === 'بانتظار الوكيل', 'الموجه يرسل التقرير فيُحفظ في ورقة Reports');
  ok(data.Reports.length === 2 && data.Items.length === 4, 'كُتب صف في Reports وثلاثة بنود في Items (+الرأس)');
  ok(data.Reports[1].includes('موجه الابتدائي'), 'منشئ التقرير مسجّل باسم الدور');
  ok(data.Items.slice(1).every(r => !String(r.join()).includes('طالب')), 'ورقة Items لا تحوي اسم الطالب (الربط بالرقم الداخلي فقط)');
  await p.click('#logout'); await p.waitForSelector('#gu');
  ok(await p.$('.hero') === null, 'تسجيل الخروج يعيد شاشة الدخول');
  await login('وكيل الابتدائي', '2222'); await p.waitForSelector('.hero');
  ok((await p.textContent('.hero .pl.act b')) === '1', 'شارة وكيل الابتدائي: بانتظارك 1 (من api_stats)');
  await p.click('[data-flt=todo]'); await p.waitForTimeout(200);
  ok((await p.$$eval('[data-stu]', e => e.length)) === 1, 'فلتر «بانتظار إجرائي» يعرض التقرير المرسل');
  await p.click('[data-stu="' + id + '"]'); await p.waitForTimeout(300); await p.click('[data-go=REVIEWED]'); await p.waitForTimeout(500);
  await login('وكيل المتوسط', '3333'); await p.waitForSelector('.hero');
  ok((await p.textContent('.hero .pl.act b')) === '0' && (await p.$$eval('[data-cls]', e => e.every(x => /المتوسط/.test(x.textContent)))), 'وكيل المتوسط معزول عن الابتدائي');
  await login('مدير المدرسة', '4444'); await p.waitForSelector('.hero');
  const allc = await p.$$eval('[data-cls]', e => e.map(x => x.textContent).join('|'));
  ok(/الابتدائي/.test(allc) && /المتوسط/.test(allc) && /الثانوي/.test(allc), 'المدير يرى شعب المراحل الثلاث');
  await p.click('[data-flt=todo]'); await p.waitForTimeout(200); await p.click('[data-stu="' + id + '"]'); await p.waitForTimeout(300);
  await p.click('[data-go=APPROVED]'); await p.waitForTimeout(500);
  ok((await p.textContent('.badge.b-APPROVED')) === 'معتمد', 'المدير يعتمد');
  ok(await p.$('#audit') !== null, 'زر سجل التدقيق يظهر للمدير');
  await p.click('#audit'); await p.waitForTimeout(500);
  ok((await p.textContent('#auditBody')).includes('TRANSITION') && (await p.textContent('#auditBody')).includes('وكيل الابتدائي'), 'سجل التدقيق يُقرأ من ورقة Audit باسم الدور');
  await p.click('#auditDlg button');
  await login('مدير النظام', '5555'); await p.waitForSelector('.hero');
  const allc2 = await p.$$eval('[data-cls]', e => e.map(x => x.textContent).join('|'));
  ok(/الابتدائي/.test(allc2) && /المتوسط/.test(allc2) && /الثانوي/.test(allc2) && await p.$('#audit') !== null, 'مدير النظام: كل المراحل وسجل التدقيق');
  ok((await p.evaluate(() => getComputedStyle(document.querySelector('.sheet')).userSelect)) !== 'none', 'مدير النظام يستطيع التحديد');
  ok(errs.filter(e => !/ERR_TUNNEL|fonts/.test(e)).length === 0, 'لا أخطاء JavaScript ' + JSON.stringify(errs));
  console.log(out.join('\n')); await b.close(); process.exit(out.some(x => x.startsWith('فشل')) ? 1 : 0);
})().catch(e => { console.log(out.join('\n')); console.log('ERR', e.message); process.exit(1); });
