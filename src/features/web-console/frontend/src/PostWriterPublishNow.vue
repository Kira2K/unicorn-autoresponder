<script setup>
import { ref, watch } from 'vue'
const props = defineProps({ post: Object, disabled: Boolean, reason: String, clientName: String })
const emit = defineEmits(['publish'])
const confirming = ref(false)
watch(() => JSON.stringify([props.post, props.disabled, props.reason]), () => { confirming.value = false })
function publish() { confirming.value = false; emit('publish', { ...props.post }) }
</script>
<template>
  <div class="publish-now">
    <Button label="Опубликовать сейчас" icon="pi pi-send" :disabled="disabled || Boolean(reason)"
      data-testid="post-prepared-publish" @click="confirming = true" />
    <small v-if="reason">{{ reason }}</small>
    <small v-else>Сначала подготовим мем. Затем отправим текст и картинку вместе.</small>
    <section v-if="confirming" class="publish-confirm" role="alertdialog" aria-label="Подтвердить публикацию"
      data-testid="post-prepared-confirm">
      <strong>Опубликовать сейчас для {{ clientName }}?</strong>
      <p>Берём сохранённый текст за {{ post.date }}. После создания мема пост отправится в LinkedIn.
        По расписанию этот день повторно не выйдет.</p>
      <div>
        <Button label="Да, опубликовать" icon="pi pi-send" :disabled="disabled"
          data-testid="post-prepared-confirm-send" @click="publish" />
        <Button label="Отмена" outlined data-testid="post-prepared-cancel" @click="confirming = false" />
      </div>
    </section>
  </div>
</template>
<style scoped>
.publish-now { display: grid; gap: .6rem; } small { color: #64748b; line-height: 1.45; }
.publish-confirm { padding: 1rem; border: 1px solid #b9dfd2; border-radius: 12px; background: #f0faf6; }
.publish-confirm p { line-height: 1.5; margin: .6rem 0 1rem; }
.publish-confirm div { display: flex; flex-wrap: wrap; gap: .5rem; }
</style>
