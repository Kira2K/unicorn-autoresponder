<script setup>
import { ref } from 'vue'
defineProps({ disabled: Boolean })
const emit = defineEmits(['change'])
const name = ref(''), error = ref('')
async function select(event) {
  const file = event.target.files?.[0]
  if (!file) return
  error.value = ''
  if (file.size > 15 * 1024 * 1024 || !/\.(pdf|docx)$/i.test(file.name)) {
    error.value = 'Нужен PDF или DOCX размером до 15 МБ.'; return
  }
  const reader = new FileReader()
  reader.onerror = () => { error.value = 'Не удалось прочитать файл.' }
  reader.onload = () => {
    name.value = `${file.name} · ${Math.ceil(file.size / 1024)} КБ`
    emit('change', { mimeType: /\.pdf$/i.test(file.name) ? 'application/pdf' :
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    data: String(reader.result).split(',')[1] })
  }
  reader.readAsDataURL(file)
}
function clear() { name.value = ''; error.value = ''; emit('change', undefined) }
</script>
<template>
  <div>
    <label>CV для этого запуска <input type="file" accept=".pdf,.docx" :disabled="disabled"
      data-testid="post-cv" @change="select" /></label>
    <p v-if="name">{{ name }} <button type="button" :disabled="disabled" @click="clear">Убрать</button></p>
    <p v-if="error" role="alert">{{ error }}</p>
    <small>Выбор файла не запускает генерацию. Максимум 15 МБ.</small>
  </div>
</template>
