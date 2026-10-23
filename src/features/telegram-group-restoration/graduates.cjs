const EXCEPTIONS=new Set(['74','3']);
const excludeGraduate=(id,status)=>status==='graduated'&&!EXCEPTIONS.has(String(id));
function markSkipped(state,status,now=Date.now()){
 if(state.channel||state.completedAt||state.complete)return false;
 if(!excludeGraduate(state.clientId,status))return false;
 if(state.steps?.create?.intentAt)throw Error('creation_must_be_reconciled_before_skip');
 Object.assign(state,{skipped:true,skipReason:'graduated',checkedStatus:status,skippedAt:new Date(now).toISOString()});delete state.lastError;delete state.lastFailure;return true;
}
function terminal(s){return !!(s&&(s.completedAt||s.complete||(s.skipped&&!s.channel&&s.skipReason==='graduated'&&excludeGraduate(s.clientId,s.checkedStatus))));}
function validateFinal(states){if(states.length!==114||new Set(states.map(s=>s?.clientId)).size!==114||states.some(s=>!terminal(s)))throw Error('all_groups_must_complete_or_be_excluded');return states.filter(s=>!s.skipped);}
module.exports={excludeGraduate,markSkipped,terminal,validateFinal};
