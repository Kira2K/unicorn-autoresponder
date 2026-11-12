// Return a category, never raw DOM text, field values or credentials.
async function visibleAuthFailure(page){
  return page.evaluate(()=>{
    const texts=[...document.querySelectorAll('[role="alert"],[data-qa*="error"],[data-qa*="warning"]')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;}).slice(0,12).map(e=>e.textContent||'');
    if(texts.some(t=>/неправильные данные для входа|invalid.credentials|incorrect.password/i.test(t)))return 'invalid_credentials';
    if(texts.some(t=>/аккаунт заблокирован|account.(?:is.)?blocked/i.test(t)))return 'account_blocked';
    return null;
  });
}
module.exports={visibleAuthFailure};
