const {withTransientReadRetry}=require('./read-retry.cjs');
const methods=['getAutomationTargets','getAutomationTargetByName','getHHAuthCredentialsByClientName','getHHAuthCredentialsByCommonChatId','getStudentTelegramRecords','getProxyRequiredClients'];
function createRetriedAppDb(create,options){
 let current=create();const result={...current};
 for(const name of methods)if(typeof current[name]==='function')result[name]=(...args)=>withTransientReadRetry(async()=>{try{return await current[name](...args)}catch(error){if(['postgres_read_unavailable','postgres_connection_failed'].includes(error.code??error.message))current=create();throw error;}},options);
 return result;
}
function install(){const db=require('../../../platform/db/index.ts'),create=db.createAppDb;db.createAppDb=()=>createRetriedAppDb(create);}
module.exports={createRetriedAppDb,install};
