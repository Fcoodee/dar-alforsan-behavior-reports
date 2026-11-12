#!/usr/bin/env node
/**
 * يبني apps-script/Index.html: نسخة مفردة الملف من الواجهة تُخدَم من تطبيق Apps Script.
 *  - الصور (assets/*.png): افتراضياً (وضع خفيف) تُحمَّل من رابط GitHub Pages (--base لتغييره)، ومع --embed تُضمَّن base64 (ملف أكبر).
 *    المسارات النسبية لا تعمل داخل Apps Script، فيُعاد كتابتها عبر مراقب DOM صغير.
 *  - تضبط window.DEMO = {year} فقط (لا بيانات تجريبية، ولا access.js).
 *  - تعمّي السكربت الرئيسي.
 * الاستعمال: NODE_PATH=<node_modules فيه acorn وescodegen وestraverse وeslint-scope> node tools/build-gas.js
 */
const fs = require('fs'), path = require('path');
const { obfuscate } = require('./obfuscate');
const root = path.join(__dirname, '..');
let src = fs.readFileSync(path.join(root, '_src', 'index.src.html'), 'utf8');

const tags = '<script src="data.js"></script>\n<script src="access.js"></script>';
if (!src.includes(tags)) throw new Error('لم أجد وسمي data.js وaccess.js');
const embed = process.argv.includes('--embed');
const bi = process.argv.indexOf('--base');
const BASE = (bi > 0 ? process.argv[bi + 1] : 'https://fcoodee.github.io/dar-alforsan-behavior-reports/').replace(/\/?$/, '/');
const imgs = {};
fs.readdirSync(path.join(root, 'assets')).filter(f => f.endsWith('.png')).forEach(f => {
  imgs['assets/' + f] = embed ? 'data:image/png;base64,' + fs.readFileSync(path.join(root, 'assets', f)).toString('base64') : BASE + 'assets/' + f;
});
const shim = '<script>window.DEMO={year:"1448-1449"};(function(){var M=' + JSON.stringify(imgs) +
  ';window.__ASSETS=M;function fix(n){if(n.nodeType!==1)return;if(n.tagName==="IMG"){var s=n.getAttribute("src");if(M[s])n.setAttribute("src",M[s]);}' +
  'var l=n.querySelectorAll?n.querySelectorAll("img"):[];for(var i=0;i<l.length;i++)fix(l[i]);}' +
  'new MutationObserver(function(ms){ms.forEach(function(m){m.addedNodes.forEach(fix);});}).observe(document.documentElement,{childList:true,subtree:true});})();</script>';
src = src.replace(tags, shim);

const re = /<script>([\s\S]*?)<\/script>/g;
const blocks = [...src.matchAll(re)];
const main = blocks.filter(b => b[1].includes('const LOGIN_MODE'));
if (main.length !== 1) throw new Error('السكربت الرئيسي غير محدد');
const out = src.replace(main[0][0], () => '<script>' + obfuscate(main[0][1]) + '</script>');
fs.writeFileSync(path.join(root, 'apps-script', 'Index.html'), out);
console.log('بُني apps-script/Index.html', (out.length / 1024).toFixed(0) + 'KB');
