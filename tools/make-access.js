#!/usr/bin/env node
/**
 * يولّد access.txt و access.js في جذر المستودع من قائمة مستخدمين، مع تخزين كلمات المرور مملّحة ومجزّأة (PBKDF2-SHA256).
 * الاستعمال (لا تحفظ كلمات المرور في أي ملف داخل المستودع):
 *   node tools/make-access.js "المعرف|كلمة المرور|الدور|المرحلة|الاسم" "..."
 * الأدوار: counselor, deputy, principal, admin
 * المراحل: primary, middle, secondary، أو دمج بـ + مثل middle+secondary، أو all
 * ⚠ هذا قفل في المتصفح وليس خادماً: يردع الاطلاع العابر فقط، ولا يحمي كلمات المرور الضعيفة من التخمين دون اتصال.
 */
const crypto = require('crypto'), fs = require('fs'), path = require('path');
const ROLES = ['counselor', 'deputy', 'principal', 'admin'];
const lines = [];
process.argv.slice(2).forEach(spec => {
  const [u, pw, role, stage, ...nm] = spec.split('|');
  if (!u || !pw || !ROLES.includes(role) || !stage) throw new Error('صيغة غير صحيحة: ' + spec.replace(pw || '', '***'));
  const salt = crypto.randomBytes(8).toString('hex');
  const ITER = 150000;
  const h = crypto.pbkdf2Sync(pw, salt, ITER, 32, 'sha256').toString('hex');
  lines.push([u, 'pbkdf2:' + ITER + ':' + salt + ':' + h, role, stage, nm.join('|') || u].join(','));
});
const head = '# ملف الصلاحيات — تقرير الأداء السلوكي والأكاديمي (دار الفرسان)\n' +
  '# الصيغة: المعرف,pbkdf2:التكرارات:الملح:البصمة,الدور,المرحلة,الاسم\n' +
  '# يُولَّد بـ tools/make-access.js. لا تضع كلمات مرور صريحة هنا.\n' +
  '# ⚠ قفل متصفح لا خادم: أي زائر يستطيع تنزيل هذا الملف. لا يصلح لحماية بيانات حقيقية.\n\n';
const txt = head + lines.join('\n') + '\n';
const out = path.join(__dirname, '..');
fs.writeFileSync(path.join(out, 'access.txt'), txt);
fs.writeFileSync(path.join(out, 'access.js'), 'window.ACCESS_TXT=' + JSON.stringify(txt) + ';\n');
console.log('كُتب', lines.length, 'مستخدماً');
