const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {visibleAuthFailure}=require('../hh-auth/visible-failure.cjs');
function page(rows){return {evaluate:fn=>vm.runInNewContext('('+fn.toString()+')()',{document:{querySelectorAll:()=>rows.map(r=>({textContent:r.text,getBoundingClientRect:()=>({width:r.visible?10:0,height:10})}))}})};}
test('login diagnostics return a typed category without raw credentials',async()=>{
 const result=await visibleAuthFailure(page([{visible:true,text:'Неправильные данные для входа user@example.test secret-password'}]));
 assert.equal(result,'invalid_credentials');assert.ok(!JSON.stringify(result).includes('secret'));
});
test('hidden historical warnings do not become a current login failure',async()=>{
 assert.equal(await visibleAuthFailure(page([{visible:false,text:'Неправильные данные для входа'}])),null);
});
