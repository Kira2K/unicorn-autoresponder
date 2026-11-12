const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {hydrateCaptchaImage}=require('./hydrate-image.ts');
function fixture({src='/captcha/picture?id=current',ok=true,type='image/png',changeDuringFetch=false}={}){
 let calls=0,observerCallback,disconnected=false;
 const canvas={setAttribute(){},getContext:()=>({drawImage(){}}),remove(){this.removed=true}};
 const image={tagName:'IMG',naturalWidth:0,isConnected:true,style:{display:''},getAttribute:()=>src,insertAdjacentElement(_where,value){this.canvas=value}};
 const environment={image,timeout:100,URL,AbortController,setTimeout,clearTimeout,location:{href:'https://hh.ru/vacancy/123',origin:'https://hh.ru'},document:{createElement:()=>canvas},fetch:async()=>{calls++;if(changeDuringFetch)src='/captcha/picture?id=new';return {ok,status:403,blob:async()=>({type,size:100})}},createImageBitmap:async()=>({width:250,height:90,close(){}}),MutationObserver:class{constructor(cb){observerCallback=cb}observe(){}disconnect(){disconnected=true}}};
 const picture={evaluate:(fn,timeout)=>vm.runInNewContext(`(${fn.toString()})(image, timeout)`,{...environment,timeout})};
 return {picture,image,canvas,calls:()=>calls,renew(){src='/captcha/picture?id=new';observerCallback()},disconnected:()=>disconnected};
}
test('same-browser fetch makes the reviewed challenge visible; renewal removes its cached canvas',async()=>{
 const f=fixture();assert.equal(await hydrateCaptchaImage(f.picture),true);assert.equal(f.calls(),1);assert.equal(f.image.style.display,'none');assert.equal(f.canvas.width,250);f.renew();assert.equal(f.canvas.removed,true);assert.equal(f.image.style.display,'');assert.equal(f.disconnected(),true);
});
test('cross-origin images never receive a credentialed fetch',async()=>{
 const f=fixture({src:'https://other.invalid/captcha/picture'});await assert.rejects(hydrateCaptchaImage(f.picture),/origin_not_allowed/);assert.equal(f.calls(),0);
});
test('an HTTP rejection preserves the original image and does not install pixels',async()=>{
 const f=fixture({ok:false});await assert.rejects(hydrateCaptchaImage(f.picture),/http_403/);assert.equal(f.image.style.display,'');assert.equal(f.image.canvas,undefined);
});
test('a changed challenge rejects the fetched picture instead of displaying stale pixels',async()=>{
 const f=fixture({changeDuringFetch:true});await assert.rejects(hydrateCaptchaImage(f.picture),/image_changed/);assert.equal(f.image.canvas,undefined);
});
