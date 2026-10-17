// اختبار المتصفح الشامل: node tests/e2e.js   (يتطلب playwright وChromium؛ CHROMIUM_PATH اختياري)
const {chromium}=require('playwright');const path=require('path');const http=require('http');const fs=require('fs');
const root=path.resolve(__dirname,'..');
const out=[];const ok=(c,m)=>out.push((c?'نجح: ':'فشل: ')+m);
function serve(){return new Promise(r=>{const s=http.createServer((q,res)=>{const f=path.join(root,decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/,'/index.html'));fs.readFile(f,(e,d)=>{if(e){res.writeHead(404);return res.end();}res.writeHead(200,{'content-type':f.endsWith('.html')?'text/html; charset=utf-8':f.endsWith('.txt')?'text/plain; charset=utf-8':f.endsWith('.js')?'text/javascript; charset=utf-8':'image/png'});res.end(d);});}).listen(0,()=>r(s));});}
async function login(p,u,pw){await p.fill('#lu',u);await p.fill('#lp',pw);await p.click('#lf button');await p.waitForTimeout(500);}
async function relog(p,url,u,pw){await p.evaluate(()=>sessionStorage.clear());await p.goto(url);await p.waitForSelector('#lf');await login(p,u,pw);await p.waitForSelector('.hero');await p.waitForTimeout(300);}
async function suite(b,url,tag){
 const ctx=await b.newContext({viewport:{width:1440,height:1100}});const p=await ctx.newPage();const errs=[];
 p.on('pageerror',e=>errs.push(e.message));
 await p.goto(url);await p.waitForSelector('#lf');
 ok(await p.$('.sheet')===null&&await p.$('.hero')===null,tag+' المحتوى مخفي قبل الدخول');
 await login(p,'dar0','خطأ');ok((await p.textContent('#lerr')).includes('غير صحيحة'),tag+' كلمة مرور خاطئة ترفض');
 // دخول الموجه
 await login(p,'dar0','048');await p.waitForSelector('.hero');
 ok((await p.textContent('.hero')).includes('موجه المرحلة الابتدائية'),tag+' دخول dar0 كموجه ابتدائي');
 ok((await p.$$eval('[data-cls]',e=>e.length))===11,tag+' الموجه يرى 11 فصلاً ابتدائياً فقط');
 ok(await p.$('.ub')===null,tag+' الموجه لا يرى شريط الفريق');
 // يحرر ويرسل S-0001
 await p.evaluate(async()=>{await pick('S-0001');await toggle('strength',S.lib.find(l=>l.category==='strength').text);await toggle('improve',S.lib.find(l=>l.category==='improve').text);await toggle('recommend',S.lib.find(l=>l.category==='recommend').text);});
 await p.click('[data-go=SUBMITTED]');await p.waitForTimeout(300);
 ok((await p.textContent('.badge.b-SUBMITTED'))==='بانتظار الوكيل',tag+' الموجه يرسل للوكيل');
 ok((await p.textContent('.hero .pl.ok b'))==='1',tag+' شارة الموجه بجانب اسمه: أُرسل 1');
 // وكيل الابتدائي (dep0/admin48)
 await relog(p,url,'dep0','admin48');
 ok((await p.textContent('.hero')).includes('الابتدائي')&&!(await p.textContent('.hero .badge')).includes('المتوسط'),tag+' dep0/admin48 وكيل الابتدائي');
 ok((await p.textContent('.hero .pl.act b'))==='1',tag+' شارة الوكيل: بانتظارك 1');
 await p.click('[data-flt=todo]');await p.waitForTimeout(200);
 ok((await p.$$eval('[data-stu]',e=>e.length))===1,tag+' فلتر «بانتظار إجرائي» يعرض تقريراً واحداً');
 await p.click('[data-stu="S-0001"]');await p.waitForTimeout(200);
 ok(await p.$('[data-go=APPROVED]')===null,tag+' الوكيل لا يعتمد نهائياً');
 await p.click('[data-go=REVIEWED]');await p.waitForTimeout(300);
 // موجه المتوسط والثانوي (dar1)
 await relog(p,url,'dar1','كلمة مرور');
 ok((await p.$$eval('[data-cls]',e=>e.length))===8,tag+' dar1 موجه المتوسط والثانوي يرى 8 فصول');
 ok(await p.$('.ub')===null,tag+' موجه المتوسط لا يرى شريط الفريق');
 // وكيل المتوسط والثانوي
 await relog(p,url,'dep1','admin148');
 const cl=await p.$$eval('[data-cls]',e=>e.map(x=>x.dataset.cls));
 ok(cl.length===8&&cl.every(c=>c.includes('م')||c.includes('ث')),tag+' dep1/admin148 وكيل المتوسط والثانوي: يرى 8 فصول');
 ok((await p.textContent('.hero .pl.act b'))==='0',tag+' وكيل المتوسط: بانتظارك 0');
 const stagesRows=await p.$$eval('.dt tbody tr',e=>e.length);ok(stagesRows===3,tag+' جدول المتابعة: المتوسط والثانوي + إجمالي');
 // المدير
 await relog(p,url,'mgr','min');
 ok((await p.$$eval('[data-cls]',e=>e.length))===19,tag+' المدير يرى 19 فصلاً');
 ok(await p.$('.ub')!==null,tag+' المدير يرى شريط الفريق');
 await p.click('[data-flt=todo]');await p.waitForTimeout(200);
 await p.click('[data-stu="S-0001"]');await p.waitForTimeout(300);
 await p.click('[data-go=DRAFT]');await p.waitForTimeout(300);
 ok((await p.textContent('#msg')).includes('سبب'),tag+' الإعادة للمسودة بلا سبب مرفوضة');
 await p.click('[data-go=APPROVED]');await p.waitForTimeout(300);await p.click('[data-go=PUBLISHED]');await p.waitForTimeout(300);
 ok((await p.textContent('.badge.b-PUBLISHED'))==='منشور',tag+' المدير يعتمد وينشر');
 await p.click('#audit').catch(()=>{});
 // معرّف مشترك قديم لم يعد مقبولاً
 await p.evaluate(()=>{sessionStorage.clear();localStorage.removeItem('dfa_try_v1');});await p.goto(url);await p.waitForSelector('#lf');
 await login(p,'admin','min');ok((await p.textContent('#lerr')).includes('غير صحيحة'),tag+' المعرّف المشترك admin لم يعد يعمل');
 // قفل المحاولات
 await p.evaluate(()=>{sessionStorage.clear();localStorage.removeItem('dfa_try_v1');});await p.goto(url);await p.waitForSelector('#lf');
 for(let i=0;i<5;i++){await login(p,'dar0','x'+i);}
 await login(p,'dar0','048');ok((await p.textContent('#lerr')).includes('محاولات كثيرة'),tag+' قفل بعد 5 محاولات خاطئة حتى مع كلمة صحيحة');
 ok(errs.filter(e=>!/ERR_TUNNEL|fonts/.test(e)).length===0,tag+' لا أخطاء JavaScript '+JSON.stringify(errs));
 await ctx.close();
}
(async()=>{
 const txt=fs.readFileSync(path.join(root,'access.txt'),'utf8');
 ok(!/,(048|admin48|admin148|min|كلمة مرور),/.test(txt),'access.txt لا يحوي كلمات مرور صريحة');
 const b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined});
 await suite(b,'file://'+path.join(root,'index.html'),'[file]');
 const srv=await serve();await suite(b,'http://127.0.0.1:'+srv.address().port+'/index.html','[http]');srv.close();
 console.log(out.join('\n'));
 await b.close();process.exit(out.some(x=>x.startsWith('فشل'))?1:0);
})().catch(e=>{console.log(out.join('\n'));console.log('ERR',e.message);process.exit(1)});
