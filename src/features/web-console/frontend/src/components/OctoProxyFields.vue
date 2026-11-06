<script setup>
import { ref } from 'vue'
import {parseProxyLine} from '../proxy-line.js'
const props=defineProps({ modelValue: { type: Object, required: true }, prefix: { type: String, default: 'octo' },guided:{type:Boolean,default:false},errors:{type:Object,default:()=>({})},singleLine:{type:Boolean,default:false},saveLabel:{type:String,default:'Сохранить прокси'},linePlaceholder:{type:String,default:'адрес:порт:логин:пароль'} })
const showPassword = ref(false)
const proxyLine=ref(''),lineError=ref(''),lineParsed=ref(false)
function splitLine(){
 lineError.value='';lineParsed.value=false
 if(!proxyLine.value)return
 try{
  const fields=parseProxyLine(proxyLine.value)
  Object.assign(props.modelValue,fields);lineParsed.value=true
 }catch(error){
  lineError.value=error.message==='proxy_line_port'?'Порт прокси должен быть числом от 1 до 65535.'
   :error.message==='proxy_line_protocol'?'Для ввода одной строкой поддерживается только SOCKS5.'
   :'Не удалось разобрать строку. Используй адрес:порт:логин:пароль или socks5://логин:пароль@адрес:порт.'
 }
}
</script>
<template>
  <p v-if="guided" class="proxy-entry-note"><strong>Введи данные прокси здесь.</strong> В приложении Octo Browser менять прокси не нужно. После заполнения нажми «Проверить и подключить прокси».</p>
  <p v-else class="proxy-entry-note"><strong>Введите данные прокси здесь, в форме нашей веб-консоли.</strong> В приложении Octo Browser прокси вводить или менять не нужно. После заполнения полей нажмите кнопку под формой.</p>
  <div v-if="singleLine" class="proxy-single-line">
    <label>Прокси одной строкой (SOCKS5)<input v-model="proxyLine" type="password" autocomplete="new-password" spellcheck="false" :placeholder="linePlaceholder" :data-testid="`${prefix}-line`" :aria-invalid="!!lineError" :aria-describedby="`${prefix}-line-help`" @input="splitLine" @keydown.enter.prevent="splitLine" @blur="lineParsed && (proxyLine='')"></label>
    <small :id="`${prefix}-line-help`">Только SOCKS5. Вставь строку — поля ниже заполнятся автоматически, тип прокси станет SOCKS5. Для сохранения нажми «{{saveLabel}}».</small>
    <p v-if="lineError" class="field-error" role="alert" :data-testid="`${prefix}-line-error`">{{lineError}}</p>
    <p v-else-if="lineParsed" role="status">Поля SOCKS5 заполнены. Для сохранения нажми «{{saveLabel}}».</p>
  </div>
  <label>Тип прокси<select v-model="modelValue.type" :data-testid="`${prefix}-type`"><option value="http">HTTP</option><option value="https">HTTPS</option><option value="socks4">SOCKS4</option><option value="socks5">SOCKS5</option></select></label>
  <label>Адрес прокси<input v-model="modelValue.host" aria-label="Адрес прокси" required autocomplete="off" spellcheck="false" :placeholder="guided ? 'gate.example.com' : undefined" :aria-invalid="!!errors.host" :data-testid="`${prefix}-host`"><small v-if="errors.host" class="field-error" role="alert">{{errors.host}}</small></label>
  <label>Порт прокси<input v-model="modelValue.port" aria-label="Порт прокси" type="number" min="1" max="65535" required :placeholder="guided ? '1080' : undefined" :aria-invalid="!!errors.port" :data-testid="`${prefix}-port`"><small v-if="errors.port" class="field-error" role="alert">{{errors.port}}</small></label>
  <label>Логин прокси<input v-model="modelValue.login" aria-label="Логин прокси" autocomplete="off" spellcheck="false" :placeholder="guided ? 'Логин от провайдера' : undefined" :aria-invalid="!!errors.login" :data-testid="`${prefix}-login`"><small v-if="errors.login" class="field-error" role="alert">{{errors.login}}</small></label>
  <div class="proxy-password">
    <label :for="`${prefix}-password`">Пароль прокси</label>
    <div class="proxy-password-input">
      <input :id="`${prefix}-password`" v-model="modelValue.password" aria-label="Пароль прокси" :type="showPassword ? 'text' : 'password'" autocomplete="new-password" :placeholder="guided ? 'Пароль от провайдера' : undefined" :aria-invalid="!!errors.password" :class="{'guided-password':guided}" :data-testid="`${prefix}-password`">
      <button type="button" :aria-label="showPassword ? 'Скрыть пароль прокси' : 'Показать пароль прокси'" :aria-pressed="showPassword" @click="showPassword = !showPassword">{{ showPassword ? 'Скрыть' : 'Показать' }}</button>
    </div>
    <small v-if="errors.password" class="field-error" role="alert">{{errors.password}}</small>
  </div>
  <label>URL смены IP (необязательно)<input v-model="modelValue.changeIpUrl" aria-label="URL смены IP (необязательно)" type="url" autocomplete="off" :placeholder="guided ? 'https://example.com/change-ip' : undefined" :aria-invalid="!!errors.changeIpUrl" :data-testid="`${prefix}-change-ip-url`"><small v-if="errors.changeIpUrl" class="field-error" role="alert">{{errors.changeIpUrl}}</small></label>
</template>
<style scoped>
.proxy-entry-note { grid-column: 1 / -1; margin: 0; }
.proxy-single-line{grid-column:1 / -1;min-width:0}.proxy-single-line small{display:block;margin-top:6px}.proxy-single-line p{margin:6px 0 0}
label { display: grid; gap: 6px; font-weight: 600; }
input,select { width: 100%; min-width: 0; padding: 10px; border: 1px solid var(--p-content-border-color,#cbd5e1); border-radius: 6px; font: inherit; color: inherit; background: var(--p-content-background,#fff); }
.proxy-password { display: grid; gap: 6px; }
.proxy-password-input { display: flex; gap: 8px; }
.proxy-password-input input { flex: 1; width: 0; }
.proxy-password-input button { flex: none; cursor: pointer; padding: 10px; border: 1px solid var(--p-content-border-color,#cbd5e1); border-radius: 6px; font: inherit; color: inherit; background: var(--p-content-background,#fff); }
.field-error{color:#b91c1c;font-weight:400}input[aria-invalid=true]{border-color:#b91c1c}.proxy-password{min-width:0}.proxy-password-input{min-width:0}.proxy-password-input input.guided-password{min-width:120px}@media(max-width:640px){.proxy-password-input input.guided-password{width:100%;flex:1}}
</style>
