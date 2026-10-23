function createGate({load,save,now=Date.now,sleep,delay=60000}){
 let tail=Promise.resolve();
 return async action=>{
  let release;const previous=tail;tail=new Promise(r=>release=r);await previous;
  try{await sleep(Math.max(0,(await load()||0)-now()));return await action();}
  finally{await save(now()+delay);release();}
 };
}
module.exports={createGate};
