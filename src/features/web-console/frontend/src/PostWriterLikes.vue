<script setup>
import { ref } from 'vue'
defineProps({ run: Object, disabled: Boolean })
const emit = defineEmits(['action'])
const confirming = ref(false)
</script>
<template>
  <section v-if="run.canStartLikes || run.canResumeLikes" data-testid="post-manual-likes">
    <Button :label="run.canResumeLikes ? 'Продолжить лайки' : 'Запустить лайки'" outlined :disabled="disabled || (!run.canResumeLikes && run.selectedLikeAccountIds?.length === 0)" data-testid="post-likes-start"
      @click="confirming = true" />
    <section v-if="confirming" role="alertdialog" aria-label="Запустить лайки к посту">
      <p v-if="run.canResumeLikes">Продолжить сохранённую очередь? Уже поставленные лайки не повторятся.
        Недоступные аккаунты будут пропущены. Новые участники не добавляются.</p>
      <p v-else>Поставить лайки {{ run.selectedLikeAccountIds ? `от выбранных аккаунтов (${run.selectedLikeAccountIds.length})` : 'от 6–7 подключённых учеников по прежней настройке' }}? Этот пост не будет опубликован повторно.
        Настройки будущих постов не изменятся.</p>
      <small>Выбор аккаунтов — в настройках постов, раздел «Кто ставит лайки».</small>
      <Button :label="run.canResumeLikes ? 'Да, продолжить' : 'Да, запустить лайки'" :disabled="disabled" data-testid="post-likes-confirm"
        @click="confirming = false; emit('action', run, 'start-likes')" />
      <Button label="Отмена" outlined @click="confirming = false" />
    </section>
  </section>
</template>
