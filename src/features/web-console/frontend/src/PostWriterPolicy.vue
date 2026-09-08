<script setup>
import { ref } from 'vue'
import { postApi } from './post-writer-api'
const props = defineProps({ disabled: Boolean })
const text = ref(''), loaded = ref(false), busy = ref(false), message = ref('')
const emit = defineEmits(['changed'])
async function load() {
  if (loaded.value) return
  try { text.value = (await postApi.policy()).join('\n'); loaded.value = true }
  catch (e) { message.value = e.message }
}
async function save() {
  if (busy.value || props.disabled) return
  busy.value = true
  try {
    await postApi.savePolicy(text.value.split('\n').map(x => x.trim()).filter(Boolean))
    message.value = 'Общие запреты сохранены. Неопубликованные тексты пройдут повторную проверку.'
    emit('changed')
  } catch (e) { message.value = e.message }
  finally { busy.value = false }
}
</script>
<template>
  <details @toggle="($event.target.open && load())">
    <summary>Общие запреты для всех учеников</summary>
    <label>Одна тема на строку <textarea v-model="text" rows="4" :disabled="disabled || busy || !loaded" /></label>
    <button type="button" :disabled="disabled || busy || !loaded" @click="save">Сохранить общие запреты</button>
    <p role="status">{{ message }}</p>
  </details>
</template>
<style scoped>textarea { width: 100%; } summary, button { cursor: pointer; }</style>
