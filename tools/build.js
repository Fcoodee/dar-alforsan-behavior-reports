#!/usr/bin/env node
/**
 * يبني index.html (المنشور) من _src/index.src.html بتعمية السكربت الداخلي.
 * الاستعمال: NODE_PATH=<مسار node_modules التي فيها acorn وescodegen وestraverse وeslint-scope> node tools/build.js
 * المصدر المقروء في _src/ (لا يُنشر على Pages بسبب _config.yml)، والناتج index.html.
 */
const fs = require('fs'), path = require('path');
const { obfuscate } = require('./obfuscate');
const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, '_src', 'index.src.html'), 'utf8');
const re = /<script>([\s\S]*?)<\/script>/g;
const blocks = [...src.matchAll(re)];
if (blocks.length !== 1) throw new Error('المتوقع سكربت داخلي واحد، وُجد ' + blocks.length);
const out = src.replace(re, () => '<script>' + obfuscate(blocks[0][1]) + '</script>')
  .replace('<head>', '<head>\n<!-- نسخة مبنية ومعمّاة: المصدر في _src -->');
fs.writeFileSync(path.join(root, 'index.html'), out);
console.log('بُني index.html', (out.length / 1024).toFixed(0) + 'KB');
