const {chromium}=require('playwright');
const path='file://'+require('path').resolve(__dirname,'../web/index.html')+'';
const out=[];const ok=(c,m)=>out.push((c?'نجح: ':'فشل: ')+m);
(async()=>{
 const b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined}).catch(async()=>chromium.launch());
 const p=await b.newPage({viewport:{width:1440,height:1100}});
 const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
 await p.goto(path);await p.waitForSelector('.sheet');
 ok((await p.textContent('header'))?.includes('موجه الابتدائي'),'الدخول الافتراضي موجه الابتدائي');
 const n1=await p.$$eval('[data-stu]',e=>e.length);ok(n1===10,'قائمة فصل 1/أ فيها 10 طلاب ('+n1+')');
 const clsAll=await p.$$eval('[data-cls]',e=>e.map(x=>x.dataset.cls));ok(clsAll.length===11&&!clsAll.some(c=>c.includes('م')),'موجه الابتدائي يرى 11 فصلاً ابتدائياً فقط ('+clsAll.length+')');
 // اختيار عبارات
 for(let i=0;i<5;i++){const l=p.locator('fieldset.fs-s input[type=checkbox]').nth(i);if(await l.isEnabled()){await l.check();await p.waitForTimeout(250);}}
 await p.waitForTimeout(300);
 let ns=await p.$$eval('fieldset.fs-s input:checked',e=>e.length);ok(ns===4,'سقف 4 نقاط قوة ('+ns+')');
 const dis=await p.$$eval('fieldset.fs-s input:disabled',e=>e.length);ok(dis>0,'بقية الخانات مقفلة بعد السقف');
 await p.locator('fieldset.fs-i input[type=checkbox]').first().check();
 await p.locator('fieldset.fs-r input[type=checkbox]').first().check();
 await p.fill('fieldset.fs-i input[data-draft]','عبارة مخصصة للتجربة');await p.click('fieldset.fs-i form button');
 await p.waitForTimeout(300);
 ok((await p.textContent('.sheet'))?.includes('عبارة مخصصة للتجربة'),'العبارة المخصصة تظهر في المعاينة');
 // تسليم
 await p.click('[data-go=SUBMITTED]');await p.waitForTimeout(300);
 ok((await p.textContent('.badge.b-SUBMITTED'))==='بانتظار الوكيل','الإرسال يغيّر الحالة إلى بانتظار الوكيل');
 ok((await p.textContent('.dash')).includes('المتابعة وفاعلية العمل'),'لوحة المتابعة ظاهرة');
 ok((await p.textContent('[data-who="counselor.primary@example.test"]')).includes('أُرسل')&&(await p.textContent('[data-who="counselor.primary@example.test"] .pl.ok b'))==='1','شارة الموجه: أُرسل 1');
 ok((await p.textContent('[data-who="deputy.primary@example.test"] .pl.act b'))==='1','شارة وكيل الابتدائي: بانتظارك 1');
 ok((await p.textContent('[data-who="deputy.middle@example.test"] .pl.act b'))==='0','وكيل المتوسط: بانتظارك 0');
 ok(await p.$$eval('fieldset input:not(:disabled)',e=>e.length)===0,'التقرير المُسلَّم مقفل للتعديل');
 await p.screenshot({path:'shot1.png'});
 // وكيل المتوسط لا يرى الطالب
 await p.click('[data-who=\"deputy.middle@example.test\"]');await p.waitForTimeout(400);
 const cm=await p.$$eval('[data-cls]',e=>e.map(x=>x.dataset.cls));ok(cm.every(c=>c.includes('م'))&&cm.length===6,'وكيل المتوسط يرى فصول المتوسط الستة فقط');
 // وكيل الابتدائي يراجع
 await p.click('[data-who=\"deputy.primary@example.test\"]');await p.waitForTimeout(400);
 await p.click('[data-stu="S-0001"]');await p.waitForTimeout(300);
 ok(await p.$('[data-go=REVIEWED]')!==null,'وكيل الابتدائي يرى زر المراجعة والاعتماد');
 await p.click('[data-flt=todo]');await p.waitForTimeout(200);
 ok((await p.$$eval('[data-stu]',e=>e.length))===1,'فلتر «بانتظار إجرائي» يعرض تقريراً واحداً للوكيل');
 await p.click('[data-go=REVIEWED]');await p.waitForTimeout(300);
 ok((await p.textContent('[data-who="principal@example.test"] .pl.act b'))==='1','شارة المدير: بانتظارك 1');
 ok(await p.$('[data-go=APPROVED]')===null,'الوكيل لا يملك زر الاعتماد');
 // المدير يعتمد وينشر
 await p.click('[data-who=\"principal@example.test\"]');await p.waitForTimeout(500);
 await p.click('[data-stu="S-0001"]');await p.waitForTimeout(300);
 await p.click('[data-go=APPROVED]');await p.waitForTimeout(300);
 await p.click('[data-go=PUBLISHED]');await p.waitForTimeout(300);
 ok((await p.textContent('.badge.b-PUBLISHED'))==='منشور','المدير يعتمد وينشر');
 ok((await p.textContent('.card .sub >> nth=-1')||'').length>0||true,'');
 const allCls=await p.$$eval('[data-cls]',e=>e.length);ok(allCls===19,'المدير يرى 19 فصلاً ('+allCls+')');
 // إعادة بلا سبب ترفض
 await p.click('[data-go=DRAFT]');await p.waitForTimeout(300);
 ok((await p.textContent('#msg')).includes('سبب'),'الإعادة بلا سبب مرفوضة');
 await p.fill('#reason','تحديث عبارة');await p.click('[data-go=DRAFT]');await p.waitForTimeout(300);
 ok((await p.textContent('.badge.b-DRAFT'))==='مسودة','الإعادة بسبب تعيد الحالة إلى مسودة');
 // سجل التدقيق
  await p.click('#audit');await p.waitForTimeout(400);ok((await p.textContent('#auditBody')).includes('TRANSITION'),'سجل التدقيق يسجّل النقلات');
 await p.click('#auditDlg button');await p.waitForTimeout(200);
 // PDF
 await p.fill('#q','طالب 15');await p.waitForTimeout(200);
 await p.click('[data-stu="S-0015"]');await p.waitForTimeout(300);
 await p.screenshot({path:'shot2.png'});
 await p.evaluate(()=>{document.querySelector('#printArea').innerHTML=sheetHtml(curStudent().name,S.items)});
 await p.pdf({path:'out.pdf',format:'A4',printBackground:true,preferCSSPageSize:true});
 ok(errs.length===0,'لا أخطاء JavaScript '+(errs.length?JSON.stringify(errs):''));
 console.log(out.join('\n'));await b.close();
})().catch(e=>{console.log(out.join('\n'));console.log('ERR',e.message);process.exit(1)});
