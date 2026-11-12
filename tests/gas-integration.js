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
global.CacheService = { getScriptCache: () => ({ get: k => cacheMap.has(k) ? cacheMap.get(k) : null, put: (k, v) => { cacheMap.set(k, v); }, remove: k => { cacheMap.delete(k); },
  getAll: ks => { const o = {}; ks.forEach(k => { if (cacheMap.has(k)) o[k] = cacheMap.get(k); }); return o; }, putAll: (o) => { Object.keys(o).forEach(k => { if (String(o[k]).length > 100000) throw new Error('value too large'); cacheMap.set(k, o[k]); }); }, removeAll: ks => { ks.forEach(k => cacheMap.delete(k)); } }) };
global.SpreadsheetApp = { getActive: () => ({ getSheetByName: n => sheets[n] || (data[n] ? (sheets[n] = new Sheet(n)) : null), insertSheet: n => sheets[n] = new Sheet(n) }) };
global.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
global.Utilities = { getUuid: () => crypto.randomUUID(), formatDate: d => d.toISOString(), DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
  computeDigest: (alg, t) => Array.from(crypto.createHash('sha256').update(t, 'utf8').digest()).map(b => b > 127 ? b - 256 : b) };
global.Logger = { log() {} }; global.HtmlService = {};
global.ContentService = { createTextOutput: t => ({ t, setMimeType() { return this; }, getContent() { return this.t; } }), MimeType: { JSON: 'json' } };
eval(fs.readFileSync(path.join(root, 'apps-script', 'Code.gs'), 'utf8') + '\n;global.__apiFns={checkSetup,setup,selfTest,api_users,api_login,api_logout,api_me,api_students,api_library,api_getReport,api_saveReport,api_transition,api_stats,api_audit,api_boot,api_getReports,api_bulkApply,doPost};');
global.__api = global.__apiFns;
global.__doPost = body => __apiFns.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).getContent();
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
const st = __api.selfTest(); ok(st.some(l => l.includes('التطبيق الجماعي مع التأكيد')) && st.some(l => l.includes('getReports')) && st.some(l => l.includes('api_boot')), 'selfTest: نُفّذت فحوص التطبيق الجماعي وgetReports وapi_boot كلها (' + st.length + ' سطراً)'); ok(Array.isArray(st) && st.length > 20 && !st.some(l => /^(فشل|خطأ)/.test(l)), 'selfTest على Code.gs: بلا فشل ' + (Array.isArray(st) ? st.filter(l => /^(فشل|خطأ)/.test(l)).join(' | ') : typeof st));
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
    await p.waitForSelector('#gu'); await p.selectOption('#gu', user); if (await p.isVisible('#gp')) await p.fill('#gp', pin); await p.click('#lf button'); await p.waitForTimeout(700);
  };

  await p.goto('file://' + path.join(root, 'apps-script', 'Index.html')); await p.waitForSelector('#gu');
  const names = await p.$$eval('#gu option', e => e.map(x => x.textContent));
  ok(names.join('|') === 'موجه الابتدائي|وكيل الابتدائي|موجه المتوسط والثانوي — قيد التهيئة|وكيل المتوسط والثانوي — قيد التهيئة|وكيل المتوسط|مدير المدرسة|مدير النظام', 'قائمة القسم الأهلي: الأدوار فقط (بلا رموز) مع وسم غير المهيّأ');
  ok((await p.$$('.dl img')).length === 3 && (await p.$$eval('#gd option', e => e.map(x => x.textContent))).join('|') === 'القسم الأهلي|قسم الدبلوما|قسم التربية الخاصة', 'ثلاثة شعارات أقسام وقائمة الأقسام');
  await p.selectOption('#gd', 'diploma');
  ok((await p.$$eval('#gu option', e => e.map(x => x.value))).join('|') === 'موجه قسم الدبلوما|وكيل قسم الدبلوما|مدير المدرسة|مدير النظام', 'قسم الدبلوما: دوراه + المدير والمهندس');
  ok((await p.textContent('#lerr')).includes('قيد عمليات تهيئة قواعد البيانات'), 'دور قسم غير مهيّأ: رسالة قيد التهيئة');
  await p.click('#lf button'); await p.waitForTimeout(300);
  ok(await p.$('.hero') === null && (await p.textContent('#lerr')).includes('قيد عمليات تهيئة'), 'لا دخول إلى قسم غير مهيّأ');
  await p.click('.dl[data-d=special]');
  ok(await p.inputValue('#gd') === 'special' && (await p.$$eval('#gu option', e => e.length)) === 4, 'النقر على شعار القسم يختار القسم');
  await p.selectOption('#gu', 'مدير المدرسة');
  ok((await p.textContent('#lerr')) === '' && await p.isVisible('#gp'), 'المدير متاح في كل قسم ويطلب رمزاً');
  await p.selectOption('#gd', 'ahli');
  ok(!(await p.content()).includes('1111') && !(await p.content()).includes('5555'), 'الرموز لا تظهر في الصفحة');
  await login('مدير المدرسة', 'خطأ');
  ok((await p.textContent('#lerr')).includes('غير صحيحة') && await p.$('.hero') === null, 'رمز المدير الخاطئ يُرفض ولا تُعرض بيانات');
  await p.selectOption('#gu', 'موجه الابتدائي');
  ok(!(await p.isVisible('#gp')), 'الموجه: حقل الرمز مخفي');
  await p.selectOption('#gu', 'مدير النظام');
  ok(await p.isVisible('#gp'), 'مدير النظام: حقل الرمز ظاهر');
  ok((await p.textContent('.notice')).includes('تم اختبار اتصال قاعدة بيانات القسم الأهلي لجميع المراحل بنجاح'), 'شاشة الدخول: سجل التحديثات يتضمن إدخال اليوم');
  await p.selectOption('#gu', 'مدير المدرسة');
  for (let i = 0; i < 5; i++) { await p.fill('#gp', 'x' + i); await p.click('#lf button'); await p.waitForTimeout(250); }
  await p.fill('#gp', '4444'); await p.click('#lf button'); await p.waitForTimeout(400);
  ok((await p.textContent('#lerr')).includes('محاولات كثيرة'), 'قفل بعد 5 محاولات خاطئة حتى مع الرمز الصحيح');
  cacheMap.clear();

  await login('موجه الابتدائي', ''); await p.waitForSelector('.hero');
  const shAr = await p.evaluate(() => sheetHtml('طالب', [], 'الثالث الابتدائي أ', 'الأهلي'));
  const shEn = await p.evaluate(() => sheetHtml('Anas Ahmed', [{ category: 'strength', text: 'Participates actively during lessons.' }], 'Grade 3', 'الدبلوما الأمريكية'));
  const shSp = await p.evaluate(() => sheetHtml('طالب', [], 'الرابع الابتدائي فصل المجد', 'التربية الخاصة'));
  ok(shAr.includes('شريكنا ولي أمر الطالب') && shAr.includes('dir="rtl"') && !shAr.includes('dlogo'), 'تقرير الأهلي: عربي RTL بلا شعار قسم إضافي');
  ok(shEn.includes('Dear Parent/Guardian') && shEn.includes('Positive Aspects') && shEn.includes('Recommendations') && shEn.includes('dir="ltr"') && shEn.includes('logo_diploma.png') && !/[\u0600-\u06FF]/.test(shEn.replace(/<[^>]*>/g, '')), 'تقرير الدبلوما: مترجم بالكامل إلى الإنجليزية LTR مع شعار القسم');
  const opt = await p.evaluate(() => { const b = { l: S.lib, c: S.cur, s: S.students }; S.students = [{ id: 'X', name: 'A', class: 'Grade 3', department: 'الدبلوما الأمريكية', stage: 'primary', status: 'NONE' }]; S.cur = 'X'; S.lib = [{ category: 'strength', text: 'Participates actively.' }, { category: 'strength', text: 'يشارك بفاعلية' }]; const h = optsHtml('strength') + '||' + heroDeptLogo(); S.lib = b.l; S.cur = b.c; S.students = b.s; return h; });
  ok(opt.includes('Participates actively.') && !opt.includes('يشارك بفاعلية') && opt.includes('logo_diploma.png'), 'طالب الدبلوما: خيارات العبارات الإنجليزية تظهر (حتى لو لم يعد الخادم lang) وشعار القسم في الترويسة');
  ok(shAr.includes('تقرير الفترة الأولى - الفصل الدراسي الأول') && shAr.includes('بتاريخ:') && shAr.includes('9 جمادى الآخرة 1448') && shAr.includes('19 نوفمبر 2026') && shAr.includes('يسعدنا أن نتوجه إليكم') && !shAr.includes('في ختام رحلة'), 'عنوان التقرير: «تقرير الفترة الأولى - الفصل الدراسي الأول» + بتاريخ (متغير) والمقدمة تبدأ بـ«يسعدنا أن نتوجه إليكم»');
  ok(shEn.includes('Period 1 Report - First Semester') && shEn.includes('Date: 19 November 2026 · 9 Jumada al-Thani 1448 AH') && !/BC|June/.test(shEn) && shEn.includes('We are pleased to extend'), 'تقرير الدبلوما: العنوان والتاريخ والمقدمة بالإنجليزية');
  ok((await p.$('form.add')) === null && (await p.$('input[data-draft]')) === null, 'v11.0: لا حقول لإضافة عبارات إضافية');
  ok((await p.textContent('#ver')).includes('v11.0'), 'رقم الإصدار v11.0 ظاهر في الشريط السفلي');
  const cust = await p.evaluate(async () => { try { await B.saveReport(S.cur, [{ category: 'strength', text: 'عبارة من خارج المكتبة' }]); return 'accepted'; } catch (e) { return e.message; } });
  ok(cust.includes('غير متاحة'), 'الخادم يرفض أي عبارة خارج المكتبة: ' + cust);
  ok(shSp.includes('logo_special.png') && shSp.includes('شريكنا'), 'تقرير التربية الخاصة: عربي مع شعار القسم بجانب شعار المدرسة');
  ok((await p.textContent('.hero')).includes('موجه الابتدائي'), 'الموجه يدخل بحساب الدور ورمزه');
  const cls = await p.$$eval('[data-cls]', e => e.map(x => x.textContent));
  ok(cls.length > 0 && cls.every(c => /الابتدائي/.test(c)), 'كل الشعب ابتدائية فقط: ' + cls.join(' | ').slice(0, 80));
  ok((await p.$$eval('[data-stu]', e => e.length)) > 0, 'قائمة الطلاب تُحمَّل من الشيت');
  ok(await p.evaluate(() => [...document.images].every(i => !/^assets\//.test(i.getAttribute('src') || ''))), 'الصور لا تستعمل مسارات نسبية داخل Apps Script');
  const id = await p.evaluate(() => S.students[0].id);
  await p.evaluate(async () => { await pick(S.students[0].id); await toggle('strength', S.lib.find(l => l.category === 'strength').text); await toggle('improve', S.lib.find(l => l.category === 'improve').text); await toggle('recommend', S.lib.find(l => l.category === 'recommend').text); });
  await p.click('[data-go=SUBMITTED]'); await p.waitForTimeout(500);
  ok((await p.textContent('.badge.b-SUBMITTED')) === 'بانتظار الوكيل', 'الموجه يرسل التقرير فيُحفظ في ورقة Reports');
  const nz = a => a.filter(r => r.some(v => v !== '' && v !== null && v !== undefined)).length;
  ok(nz(data.Reports) === 2 && nz(data.Items) === 4, 'كُتب صف في Reports وثلاثة بنود في Items (+الرأس)');
  ok(data.Reports[1].includes('موجه الابتدائي'), 'منشئ التقرير مسجّل باسم الدور');
  ok(data.Items.slice(1).every(r => !String(r.join()).includes('طالب')), 'ورقة Items لا تحوي اسم الطالب (الربط بالرقم الداخلي فقط)');
  await p.click('#logout'); await p.waitForSelector('#gu');
  ok(await p.$('.hero') === null, 'تسجيل الخروج يعيد شاشة الدخول');
  await login('وكيل الابتدائي', ''); await p.waitForSelector('.hero');
  ok((await p.textContent('.hero .pl.act b')) === '1', 'شارة وكيل الابتدائي: بانتظارك 1 (من api_stats)');
  await p.click('[data-flt=todo]'); await p.waitForTimeout(200);
  ok((await p.$$eval('[data-stu]', e => e.length)) === 1, 'فلتر «بانتظار إجرائي» يعرض التقرير المرسل');
  await p.click('[data-stu="' + id + '"]'); await p.waitForTimeout(300); await p.click('[data-go=REVIEWED]'); await p.waitForTimeout(500);
  await login('وكيل المتوسط', ''); await p.waitForSelector('.hero');
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

  // ───── صفحة GitHub Pages الرئيسية تقرأ من القاعدة عبر doPost (طلبات fetch مُعترَضة) ─────
  const pctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  const pp = await pctx.newPage(); const perrs = []; const seen = [];
  pp.on('pageerror', e => perrs.push(e.message));
  let slowMs = 0, blockBoot = false;
  await pctx.route(/script\.google\.com\/macros\/s\/.+\/exec/, async route => {
    if (slowMs) await new Promise(r => setTimeout(r, slowMs));
    if (blockBoot && /api_boot/.test(route.request().postData() || '')) return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: false, error: 'طلب غير مسموح.' }) });
    const req = route.request(); seen.push({ m: req.method(), ct: req.headers()['content-type'] || '' });
    if (req.method() !== 'POST') return route.fulfill({ status: 405, body: 'no' });
    const body = req.postData(); const res = __doPost(body);
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: res });
  });
  const http = require('http');
  const srv = http.createServer((q, res) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html')); fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); } else { res.writeHead(200, { 'Content-Type': f.endsWith('.png') ? 'image/png' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }); res.end(d); } }); }).listen(0);
  const pageUrl = 'http://127.0.0.1:' + srv.address().port + '/index.html';
  const plogin = async (user, pin) => { await pp.goto(pageUrl); await pp.evaluate(() => sessionStorage.clear()); await pp.reload(); await pp.waitForSelector('#gu'); await pp.selectOption('#gu', user); if (await pp.isVisible('#gp')) await pp.fill('#gp', pin); await pp.click('#lf button'); await pp.waitForTimeout(800); };
  await pp.goto(pageUrl); await pp.waitForSelector('#gu');
  ok(JSON.stringify(await pp.$$eval('#gu option', e => e.map(x => x.textContent))).includes('وكيل الابتدائي'), 'Pages: قائمة المستخدمين تُقرأ من ورقة Staff عبر doPost');
  ok(!(await pp.content()).includes('طالب 1') , 'Pages: لا بيانات تجريبية في الوضع الحي');
  await plogin('مدير المدرسة', 'خطأ');
  ok((await pp.textContent('#lerr')).includes('غير صحيحة'), 'Pages: رمز المدير الخاطئ يُرفض من الخادم');
  cacheMap.clear();
  blockBoot = true;
  await plogin('موجه الابتدائي', ''); await pp.waitForSelector('.hero');
  ok((await pp.$$eval('[data-stu]', e => e.length)) > 0, 'خادم قديم بلا api_boot: الواجهة تعود للاستدعاءات المنفصلة ويمكن الدخول');
  blockBoot = false;
  await pp.click('#logout'); await pp.waitForSelector('#gu');
  await plogin('موجه الابتدائي', ''); await pp.waitForSelector('.hero');
  slowMs = 900;
  const nxt = await pp.$$eval('[data-stu]', e => e.map(x => x.dataset.stu));
  if (nxt.length > 1) {
    await pp.click('[data-stu] >> nth=1').catch(() => {});
    await pp.waitForTimeout(500);
    ok(await pp.isVisible('.busy.on') && (await pp.textContent('.busy')).includes('فضلا الانتظار .. جاري العمل على قاعدة البيانات ..'), 'Pages: مربع الانتظار يظهر عند جلب بيانات طالب');
    await pp.waitForTimeout(1800);
    ok(!(await pp.isVisible('.busy.on')), 'Pages: مربع الانتظار يختفي بعد انتهاء العملية');
  } else ok(false, 'لا توجد أزرار طلاب لاختبار مربع الانتظار');
  slowMs = 1500;
  await pp.click('input[data-cat=strength] >> nth=1');
  await pp.waitForTimeout(250);
  ok(await pp.isChecked('input[data-cat=strength] >> nth=1') && !(await pp.isVisible('.busy.on')), 'حفظ متفائل: العبارة تُحدَّد فوراً دون مربع انتظار حاجب رغم بطء الخادم');
  await pp.waitForTimeout(2600);
  ok((await pp.textContent('#msg')).includes('تم الحفظ'), 'الحفظ يكتمل في الخلفية ويظهر «تم الحفظ»');
  slowMs = 0;
  const pc = await pp.$$eval('[data-cls]', e => e.map(x => x.textContent));
  ok(pc.length > 0 && pc.every(c => /الابتدائي/.test(c)), 'Pages: بعد الدخول تُقرأ شعب الابتدائي من القاعدة');
  ok((await pp.$$eval('[data-stu]', e => e.length)) > 0, 'Pages: قائمة الطلاب مقروءة من ورقة Students');
  const pid = await pp.evaluate(() => S.students[1].id);
  await pp.evaluate(async id => { await pick(id); await toggle('strength', S.lib.find(l => l.category === 'strength').text); await toggle('improve', S.lib.find(l => l.category === 'improve').text); await toggle('recommend', S.lib.find(l => l.category === 'recommend').text); }, pid);
  await pp.click('[data-go=SUBMITTED]'); await pp.waitForTimeout(600);
  ok((await pp.textContent('.badge.b-SUBMITTED')) === 'بانتظار الوكيل', 'Pages: الإرسال يُكتب في ورقتي Reports وItems');
  ok(seen.length > 5 && seen.every(x => x.m === 'POST' && /^text\/plain/.test(x.ct)), 'Pages: كل الطلبات POST بنوع text/plain (بلا preflight): ' + seen.length + ' طلباً');
  await pp.click('#logout'); await pp.waitForSelector('#gu');
  await plogin('وكيل الابتدائي', ''); await pp.waitForSelector('.hero');
  ok((await pp.textContent('.hero .pl.act b')) === '1', 'Pages: شارة الوكيل تعكس حالة القاعدة (بانتظارك 1)');
  // ───── الإجراءات الجماعية: تطبيق موحّد + تصدير PDF لكل طالب (وكيل الابتدائي على Pages) ─────
  const repsBefore = data.Reports.length, itemsBefore = data.Items.length;
  await pp.click('#bulk'); await pp.waitForSelector('#bulkDlg[open]');
  await pp.click('#bsall');
  const expected = await pp.evaluate(() => S.students.filter(s => s.class === S.bulk.cls && s.status === 'NONE').length);
  await pp.click('input[data-bt=strength] >> nth=0'); await pp.click('input[data-bt=improve] >> nth=0'); await pp.click('input[data-bt=recommend] >> nth=0');
  await pp.click('#bapply');
  ok(await pp.isVisible('#bgo'), 'التطبيق الجماعي: يطلب تأكيداً صريحاً قبل التنفيذ');
  await pp.click('#bgo'); await pp.waitForFunction(() => /طُبّقت/.test(document.querySelector('#bmsg').textContent), null, { timeout: 20000 });
  ok(expected > 1 && data.Reports.length === repsBefore + expected && data.Items.length === itemsBefore + 3 * expected, 'التطبيق الجماعي: كُتبت مسودة وثلاثة بنود لكل طالب دفعة واحدة (' + expected + ' طلاب)');
  ok((await pp.textContent('#bmsg')).includes('تخطّى'), 'التطبيق الجماعي: تُخطّى المرسَل/المعتمد ولا يُمَسّ');
  ok(data.Audit.filter(r => r.includes('BULK_APPLY')).length === expected, 'سجل التدقيق: سطر BULK_APPLY لكل طالب');
  const exp = await pp.evaluate(async () => {
    const j = await Exp.toJpeg(sheetHtml('طالب', [{ category: 'strength', text: 'يشارك بفاعلية أثناء الحصة الدراسية.' }], 'الثالث الابتدائي أ', 'الأهلي'));
    const pdf = Exp.pdf(j), z = Exp.zip([{ name: 'AHL-P-0001.pdf', data: pdf }, { name: 'AHL-P-0002.pdf', data: pdf }]);
    const b64 = u => { let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(s); };
    return { jpg: j.bytes.length, pdfHead: String.fromCharCode(...pdf.subarray(0, 8)), pdfTail: String.fromCharCode(...pdf.subarray(pdf.length - 6)), pdf64: b64(pdf), zip64: b64(z) };
  });
  fs.writeFileSync(path.join(require('os').tmpdir(), 'dfa-export.zip'), Buffer.from(exp.zip64, 'base64'));
  fs.writeFileSync(path.join(require('os').tmpdir(), 'dfa-export.pdf'), Buffer.from(exp.pdf64, 'base64'));
  ok(exp.jpg > 40000 && exp.pdfHead === '%PDF-1.4' && exp.pdfTail.includes('%%EOF'), 'التصدير: صورة التقرير غير فارغة (' + exp.jpg + 'B) وملف PDF سليم الهيكل');
  const runR = await pp.evaluate(async () => { const ids = S.students.filter(s => ['APPROVED', 'PUBLISHED'].includes(s.status)).map(s => s.id); const r = await Exp.run(ids.concat(['AHL-P-9999']), null, false); return { n: ids.length, count: r.count, skipped: r.skipped, name: r.name, size: r.blob.size }; });
  ok(runR.n >= 1 && runR.count === runR.n && runR.skipped === 1 && /\.pdf$|\.zip$/.test(runR.name), 'التصدير الجماعي: يشمل المعتمد/المنشور فقط ويتخطّى غيره (' + JSON.stringify(runR) + ')');
  ok(perrs.filter(e => !/ERR_TUNNEL|fonts/.test(e)).length === 0, 'Pages: لا أخطاء JavaScript ' + JSON.stringify(perrs));
  await pctx.close();
  srv.close();
  ok(errs.filter(e => !/ERR_TUNNEL|fonts/.test(e)).length === 0, 'لا أخطاء JavaScript ' + JSON.stringify(errs));
  console.log(out.join('\n')); await b.close(); process.exit(out.some(x => x.startsWith('فشل')) ? 1 : 0);
})().catch(e => { console.log(out.join('\n')); console.log('ERR', e.message); process.exit(1); });
