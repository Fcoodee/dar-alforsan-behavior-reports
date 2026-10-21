/**
 * أداة تعمية JavaScript بلا اعتماديات خارجية (acorn + eslint-scope + estraverse + escodegen).
 * تفعل: (1) إعادة تسمية المتغيرات المحلية، (2) ترميز النصوص في مصفوفة مشفّرة بـ XOR+base64،
 * (3) إخراج مضغوط بلا تعليقات. تُبقي أسماء المتغيرات العامة كما هي (تحتاجها الاختبارات والمعالجات).
 * ⚠ التعمية تُصعّب القراءة فقط ولا تحمي أي سر؛ الكود كله يصل المتصفح ويمكن فكّه.
 */
const acorn = require('acorn'), escodegen = require('escodegen'), estraverse = require('estraverse'), eslintScope = require('eslint-scope');

function obfuscate(code, opts = {}) {
  const ast = acorn.parse(code, { ecmaVersion: 2022, sourceType: 'script', ranges: true });

  // 1) فكّ الخصائص المختصرة {a} حتى لا تنكسر عند إعادة التسمية
  estraverse.traverse(ast, { enter(n) {
    if (n.type === 'Property' && n.shorthand) {
      n.shorthand = false;
      const cp = x => ({ ...x });   // نسخة مستقلة تحتفظ بالمواضع (range) التي يحتاجها eslint-scope
      n.key = cp(n.key);
      n.value = n.value.type === 'AssignmentPattern' ? { ...n.value, left: cp(n.value.left) } : cp(n.value);
    }
  } });

  // 2) إعادة تسمية المتغيرات غير العامة
  const sm = eslintScope.analyze(ast, { ecmaVersion: 2022, sourceType: 'script' });
  let c = 0; const rnd = () => '_0x' + (0x1a2b + (c++) * 7).toString(16);
  sm.scopes.forEach(sc => {
    if (sc.type === 'global') return;
    sc.variables.forEach(v => {
      if (v.name === 'arguments') return;
      const nn = rnd();
      v.identifiers.forEach(id => { id.name = nn; });
      v.references.forEach(r => { r.identifier.name = nn; });
    });
  });

  // 3) ترميز النصوص
  const key = (opts.key || 'dfa').split('').map(ch => ch.charCodeAt(0));
  const table = [], index = new Map();
  const enc = str => { const b = Buffer.from(str, 'utf8'); for (let i = 0; i < b.length; i++) b[i] ^= key[i % key.length]; return b.toString('base64'); };
  const fn = '_0xs' + (c++).toString(16), arr = '_0xa' + (c++).toString(16);
  const parentOf = new Map();
  estraverse.traverse(ast, { enter(n, p) { parentOf.set(n, p); } });
  estraverse.replace(ast, { enter(n, p) {
    if (n.type !== 'Literal' || typeof n.value !== 'string') return;
    if (p && p.type === 'ExpressionStatement' && p.directive) return;           // "use strict"
    if (p && p.type === 'Property' && p.key === n && !p.computed) return;       // مفاتيح الكائنات
    if (p && p.type === 'MethodDefinition') return;
    let i = index.get(n.value);
    if (i === undefined) { i = table.length; table.push(enc(n.value)); index.set(n.value, i); }
    return { type: 'CallExpression', callee: { type: 'Identifier', name: fn }, arguments: [{ type: 'Literal', value: i }], optional: false };
  } });

  const body = escodegen.generate(ast, { format: { compact: true, semicolons: true, quotes: 'double', escapeless: false, parentheses: true } });
  const prelude = 'var ' + arr + '=' + JSON.stringify(table) + ',' + fn + '=function(i){var s=atob(' + arr + '[i]),k=' + JSON.stringify(key) + ',b=new Uint8Array(s.length),j;for(j=0;j<s.length;j++)b[j]=s.charCodeAt(j)^k[j%k.length];return new TextDecoder().decode(b)};';
  return prelude + body;
}
module.exports = { obfuscate };
