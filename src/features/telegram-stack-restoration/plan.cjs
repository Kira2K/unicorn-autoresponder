const {buildPlan,hash}=require('../telegram-group-restoration/plan.cjs');
function notice(title){return `Привет! Мы восстановили общий чат «${title}» и доступную историю за последние полгода. Даты и теги в восстановленных сообщениях помогут ориентироваться в переписке.\n\nПо всем вопросам пиши @unicorn_service.`;}
function stackPlan(input){const old=buildPlan({...input,group:{...input.group,id:input.stack.key},notice:notice(input.group.chat.title)});const {clientId,planHash,...rest}=old;const result={...rest,stackKey:input.stack.key,endDate:input.endDate,currentPinnedId:input.currentPinnedId};return{...result,planHash:hash(JSON.stringify(result))};}
module.exports={stackPlan,notice};
