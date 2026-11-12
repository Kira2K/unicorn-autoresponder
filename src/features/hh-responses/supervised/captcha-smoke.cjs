const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {loadConfiguration}=require('./config.cjs'),{createArtifacts}=require('./artifacts.cjs'),{createRecognizer}=require('./recognizer.cjs');
const {createPlaywrightCaptchaAdapters}=require('../captcha/playwright-adapter.ts'),{solveCaptcha}=require('../captcha/solve.ts');
async function main(args=process.argv.slice(2)){
  const config=loadConfiguration(args),image=require('sharp'),id='hh-supervised-smoke-'+randomUUID(),store=createArtifacts(config.root,id);
  config.recognitionRoot=store.dir;let browser,usage=null,artifact,proof;
  try{
    const recognizer=createRecognizer(config);await recognizer.inspect();
    const png=async text=>(await image(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="120"><rect width="600" height="120" fill="white"/><text x="20" y="80" font-family="Arial" font-size="52" fill="black">${text}</text></svg>`)).png().toBuffer()).toString('base64');
    const first=await png('начальный текст'),english=await png('harbor violet');
    const html=`<html><body><form id="challenge" data-qa="fixture-captcha"><img id="picture" src="data:image/png;base64,${first}"/><button type="button" data-qa="captcha-language">English</button><input name="captcha"/><button type="submit">Continue</button></form><script>
      window.fixture={switches:0,submits:0,accepted:false};
      document.querySelector('[data-qa="captcha-language"]').onclick=function(){document.querySelector('#picture').src='data:image/png;base64,${english}';this.innerText='На русском';window.fixture.switches++;};
      document.querySelector('form').onsubmit=function(event){event.preventDefault();window.fixture.submits++;if(this.querySelector('input').value==='harbor violet'){window.fixture.accepted=true;this.remove();}};
    </script></body></html>`;
    const {chromium}=require('../../../platform/browser/playwright.ts').loadPlaywright();
    browser=await chromium.launch({channel:process.env.HH_TEST_BROWSER_CHANNEL||'msedge',headless:true,timeout:15000,args:['--disable-background-networking']});
    const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();page.setDefaultTimeout(5000);
    const url='https://hh-fixture.invalid/';let unexpectedRequests=0;
    await context.route('**/*',async route=>{
      if(route.request().url()===url)await route.fulfill({contentType:'text/html',body:html});
      else{unexpectedRequests++;await route.abort();}
    });
    await page.goto(url,{waitUntil:'load',timeout:10000});
    const adapters=createPlaywrightCaptchaAdapters(page,{
      save:async(image,attempt)=>{artifact=store.save(image,attempt,1);return artifact;},
      recognize:async(bytes,c)=>recognizer.recognize(bytes,c,u=>{usage=u;})
    });
    const result=await solveCaptcha(adapters,{maxAttempts:1,timeoutMs:110000,signal:AbortSignal.timeout(115000)}),fixture=await page.evaluate(()=>window.fixture);
    if(!result.solved||result.attempts!==1||!fixture.accepted||fixture.switches!==1||fixture.submits!==1||unexpectedRequests)throw Error('hh_fixture_smoke_failed');
    proof={at:new Date().toISOString(),scope:'isolated local browser fixture; no HH application or student profile',model:config.model,result,fixture,unexpectedRequests,usage};
  }finally{
    try{if(browser)await browser.close();}finally{if(artifact)store.erase(artifact);store.close();}
  }
  proof.imagesRemoved=!fs.existsSync(store.dir);require('./services.cjs').writeJson(path.join(config.root,'logs',id+'.json'),proof);console.log(JSON.stringify(proof));
}
if(require.main===module)main().catch(error=>{console.error(/^[a-z][a-z0-9_]+$/.test(error.message)?error.message:'hh_fixture_smoke_failed');process.exitCode=1;});
module.exports={main};
