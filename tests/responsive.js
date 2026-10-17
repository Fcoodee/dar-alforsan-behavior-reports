// اختبار التجاوب: node tests/responsive.js  (Chromium بمحاكاة أحجام وأجهزة؛ لا يغني عن تجربة Safari وFirefox الحقيقيين)
const {chromium}=require('playwright');const path=require('path');
const url='file://'+path.resolve(__dirname,'../index.html');
const out=[];const ok=(c,m)=>out.push((c?'نجح: ':'فشل: ')+m);
const SIZES=[['حاسوب 1440',{width:1440,height:900}],['حاسوب محمول 1280',{width:1280,height:720}],['لوحي عمودي 820',{width:820,height:1180,isMobile:true,hasTouch:true}],['لوحي أفقي 1180',{width:1180,height:820,isMobile:true,hasTouch:true}],['جوال 390',{width:390,height:844,isMobile:true,hasTouch:true,deviceScaleFactor:3}],['جوال صغير 360',{width:360,height:740,isMobile:true,hasTouch:true}]];
(async()=>{
 const b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined});
 for(const [name,vp] of SIZES){
  const ctx=await b.newContext({viewport:{width:vp.width,height:vp.height},isMobile:!!vp.isMobile,hasTouch:!!vp.hasTouch,deviceScaleFactor:vp.deviceScaleFactor||1});
  const p=await ctx.newPage();await p.goto(url);await p.waitForSelector('#lf');
  const ov=async()=>p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  ok((await ov())<=1,name+' · شاشة الدخول بلا تمرير أفقي');
  if(vp.width<768){const fs=await p.$eval('#lu',e=>parseFloat(getComputedStyle(e).fontSize));ok(fs>=16,name+' · حقل الدخول 16px فأكثر (يمنع تكبير iOS) = '+fs);}
  await p.screenshot({path:'resp-login-'+vp.width+'.png'});
  await p.fill('#lu','mgr');await p.fill('#lp','min');await p.click('#lf button');await p.waitForSelector('.hero');await p.waitForTimeout(500);
  ok((await ov())<=1,name+' · الصفحة الرئيسية بلا تمرير أفقي ('+await ov()+')');
  const g=await p.evaluate(()=>{const r=document.querySelector('.scaled').getBoundingClientRect(),w=document.querySelector('#pw').getBoundingClientRect();return{sw:r.width,ww:w.width,sc:getComputedStyle(document.documentElement).getPropertyValue('--sc')};});
  ok(g.sw<=g.ww+1,name+' · معاينة A4 تتسع للحاوية ('+Math.round(g.sw)+' ≤ '+Math.round(g.ww)+'، مقياس '+g.sc.trim()+')');
  const small=await p.$$eval('button.btn,.chip,.st',els=>els.filter(e=>e.offsetParent&&e.getBoundingClientRect().height<40).length);
  ok(small===0,name+' · أهداف اللمس ≥40px (المخالف: '+small+')');
  const cols=await p.evaluate(()=>[...document.querySelectorAll('.c1,.c2,.c3')].map(e=>Math.round(e.getBoundingClientRect().top)));
  ok(vp.width>=1280?(Math.max(...cols)-Math.min(...cols)<40):(vp.width<768?(cols[0]<cols[1]&&cols[1]<cols[2]):true),name+' · ترتيب الأعمدة مناسب '+JSON.stringify(cols));
  await p.screenshot({path:'resp-main-'+vp.width+'.png',fullPage:false});
  await ctx.close();
 }
 console.log(out.join('\n'));await b.close();process.exit(out.some(x=>x.startsWith('فشل'))?1:0);
})();
