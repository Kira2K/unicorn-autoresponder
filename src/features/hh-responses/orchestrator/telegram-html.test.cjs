const {test}=require('node:test');
const assert=require('node:assert/strict');
const {truncateTelegramHtml}=require('./telegram-html.ts');

function validateGeneratedHtml(html) {
  const tags=[];
  for(const token of html.match(/<[^>]*>|[^<]+/g)||[]){
    if(token.startsWith('<')){
      const match=token.match(/^<(\/?)([a-z]+)(?:\s[^>]*)?>$/i);
      assert.ok(match,'complete tag');
      if(match[1])assert.equal(tags.pop(),match[2]);else tags.push(match[2]);
    }else{
      assert.doesNotMatch(token.replace(/&(?:amp|lt|gt|quot|#\d+);/g,''),/&/);
      assert.doesNotMatch(token,/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    }
  }
  assert.deepEqual(tags,[]);
}

test('truncation at every boundary preserves nested HTML, links, entities and emoji',()=>{
  const input='<b>Report</b>\n<blockquote expandable>Long <a href="https://hh.ru/search?text=a&amp;b=c">link &amp; 😀 '.repeat(1)+'z'.repeat(120)+'</a>\nlast line</blockquote>';
  for(let limit=20;limit<input.length;limit++){
    const result=truncateTelegramHtml(input,limit);
    assert.ok(result.length<=limit);
    assert.match(result,/\.\.\.truncated$/);
    validateGeneratedHtml(result);
  }
  assert.equal(truncateTelegramHtml(input,input.length),input);
});

test('long error report remains valid when truncation reaches a recent-URL anchor',()=>{
  const {formatClientErrorLog}=require('./telegram-reporting.ts');
  const status={clientName:'Test',stack:'GO',dolphinProfileId:123,lifecycleEvents:[],autoResponderStopReason:'orchestrator_idle_timeout',autoResponderStopReasonDetails:'No confirmed progress '+ 'x'.repeat(2700),pageUrl:'https://hh.ru/search/vacancy?text='+ 'y'.repeat(1800),recentUrls:[{url:'https://hh.ru/search/vacancy?text='+ 'a'.repeat(1600)+'&from=test',ts:1}]};
  const result=formatClientErrorLog(status);
  assert.match(result,/\.\.\.truncated$/);
  assert.ok(result.length<=3900);
  validateGeneratedHtml(result);
});
