<script setup>
import { ref } from 'vue'
defineProps({ run: Object, disabled: Boolean })
const emit = defineEmits(['action'])
const confirming = ref(false)
</script>
<template>
  <section v-if="run.canRetryMeme" data-testid="post-meme-recovery">
    <p>Не удалось подготовить описание мема. Текст сохранён, отправка не начиналась.</p>
    <Button label="Продолжить с мемом" :disabled="disabled" data-testid="post-meme-retry"
      @click="confirming = true" />
    <div v-if="confirming" role="alertdialog" aria-label="Продолжить публикацию">
      <p>Подготовим мем заново в этом же задании. Текст не изменится.
        {{ run.mode === 'approval_required' ? 'Перед публикацией покажем результат.' : 'После подготовки пост будет опубликован.' }}</p>
      <Button label="Да, продолжить" :disabled="disabled" data-testid="post-meme-retry-confirm"
        @click="confirming = false; emit('action', run, 'retry-meme')" />
      <Button label="Отмена" outlined @click="confirming = false" />
    </div>
  </section>
</template>
