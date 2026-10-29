const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {createHash}=require('node:crypto');
const {createPlaywrightCaptchaAdapters}=require('./playwright-adapter.ts');
const loadedPixels=Buffer.from('decoded captcha image pixels');
function fixture({loaded=true,tainted=false,hang=false}={}){
 const element={tagName:'IMG',complete:loaded,naturalWidth:250,naturalHeight:80};
 let drawn=false,screenshots=0;
 const canvas={getContext:()=>({drawImage:image=>{assert.equal(image,element);drawn=true}}),toDataURL:()=>{
  if(tainted)throw Error('SecurityError: tainted canvas');
  return 'data:image/png;base64,'+loadedPixels.toString('base64');
 }};
 const picture={first(){return this},evaluate:async fn=>hang?new Promise(()=>{}):vm.runInNewContext('('+fn.toString()+')(element)',{element,document:{createElement:tag=>{assert.equal(tag,'canvas');return canvas}}}),screenshot:async()=>{screenshots++;return Buffer.from('compositor screenshot')}};
 const adapters=createPlaywrightCaptchaAdapters({locator:()=>picture},{save:async()=>{},recognize:async()=>''});
 return{adapters,canvas,drawn:()=>drawn,screenshots:()=>screenshots};
}
test('loaded image pixels are captured even if the compositor would show another page fragment',async()=>{
 const f=fixture();const image=await f.adapters.capture({timeoutMs:100});
 assert.deepEqual(image.bytes,loadedPixels);
 assert.equal(image.id,createHash('sha256').update(loadedPixels).digest('hex'));
 assert.equal(f.drawn(),true);assert.equal(f.screenshots(),0);
 assert.equal(f.canvas.width,250);assert.equal(f.canvas.height,80);
});
test('a cross-origin canvas restriction keeps the bounded screenshot fallback',async()=>{
 const f=fixture({tainted:true});const image=await f.adapters.capture({timeoutMs:100});
 assert.equal(image.bytes.toString(),'compositor screenshot');assert.equal(f.screenshots(),1);
});
test('an unloaded image is never replaced with a screenshot of unrelated page pixels',async()=>{
 const f=fixture({loaded:false});await assert.rejects(f.adapters.capture({timeoutMs:100}),/captcha_image_not_loaded/);
 assert.equal(f.screenshots(),0);
});
test('a stalled pixel read has a finite deadline and never falls back after timeout',async()=>{
 const f=fixture({hang:true});await assert.rejects(f.adapters.capture({timeoutMs:15}),/captcha_capture_timeout/);
 assert.equal(f.screenshots(),0);
});
