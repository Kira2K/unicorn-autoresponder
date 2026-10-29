const {test}=require('node:test');const assert=require('node:assert/strict');
const {switchCaptchaToEnglish}=require('./playwright-adapter.ts');
test('modern HH English target switches the image once',async()=>{
 let clicks=0;const page={locator:()=>({isVisible:async()=>true,innerText:async()=> 'English',click:async()=>clicks++}),evaluate:()=>assert.fail('legacy fallback')};
 assert.equal(await switchCaptchaToEnglish(page),true);assert.equal(clicks,1);
});
test('modern Russian target means the English image is already selected',async()=>{
 let clicks=0;const page={locator:()=>({isVisible:async()=>true,innerText:async()=> 'Русский',click:async()=>clicks++}),evaluate:()=>assert.fail('legacy fallback')};
 assert.equal(await switchCaptchaToEnglish(page),false);assert.equal(clicks,0);
});
