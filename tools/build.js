#!/usr/bin/env node
/**
 * يبني index.html (المنشور) من _src/index.src.html بتعمية السكربت الداخلي.
 * الاستعمال: NODE_PATH=<مسار node_modules التي فيها acorn وescodegen وestraverse وeslint-scope> node tools/build.js
 * المصدر المقروء في _src/ (لا يُنشر على Pages بسبب _config.yml)، والناتج index.html.
 */
const fs = require('fs'), path = require('path');
const { obfuscate } = require('./obfuscate');
const root = path.join(__dirname, '..');
// رابط واجهة JSON (نشر Apps Script). يمكن تغييره: node tools/build.js --api <URL> ؛ ولتعطيله (وضع تجريبي فقط): --api ''
const DEFAULT_API = 'https://script.google.com/macros/s/AKfycbwvWFDSz0iA1N1g42vQhe4h3_qLtW9Dkj_Yh9WH_bNQJdmAu8HpA_K0Lg70t_ioUlKd/exec';
const ai = process.argv.indexOf('--api');
const API = ai > 0 ? process.argv[ai + 1] || '' : (process.env.API_URL !== undefined ? process.env.API_URL : DEFAULT_API);
let src = fs.readFileSync(path.join(root, '_src', 'index.src.html'), 'utf8');
if (!src.includes("const API_URL='';")) throw new Error('لم أجد const API_URL');
src = src.replace("const API_URL='';", "const API_URL=" + JSON.stringify(API) + ";");
const re = /<script>([\s\S]*?)<\/script>/g;
const blocks = [...src.matchAll(re)];
if (blocks.length !== 1) throw new Error('المتوقع سكربت داخلي واحد، وُجد ' + blocks.length);
const out = src.replace(re, () => '<script>' + obfuscate(blocks[0][1]) + '</script>')
  .replace('<head>', '<head>\n<!-- نسخة مبنية ومعمّاة: المصدر في _src -->');
fs.writeFileSync(path.join(root, 'index.html'), out);
console.log('بُني index.html', (out.length / 1024).toFixed(0) + 'KB');
