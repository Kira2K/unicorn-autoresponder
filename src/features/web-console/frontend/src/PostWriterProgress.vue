<script setup>
import { ref, watch } from 'vue'
import PostWriterMeme from './PostWriterMeme.vue'
import { stages, engagementLabels, dateMsk, countdown, runActive } from './post-writer-view'
const props = defineProps({ run: Object, now: Number, disabled: Boolean, stopDisabled: Boolean })
const emit = defineEmits(['action'])
const memeLoaded = ref(false), memeReviewed = ref(false)
watch(() => `${props.run?.id}:${props.run?.hash}`, () => { memeReviewed.value = false; memeLoaded.value = false })
function onMemeLoaded(value) { memeLoaded.value = value; if (!value) memeReviewed.value = false }
</script>
<template>
  <section v-if="run" class="post-progress" data-testid="post-progress">
    <h3>{{ stages[run.status] || run.status }}</h3>
    <p>{{ run.trigger === 'scheduled' ? 'По расписанию — без подтверждения' : 'Ручной запуск' }}</p>
    <p v-if="run.nextActionAt">Следующая операция: {{ dateMsk(run.nextActionAt) }} · {{ countdown(run.nextActionAt, now) }}</p>
    <p v-if="run.topic"><strong>{{ run.topic.title }}</strong></p>
    <pre v-if="run.draft">{{ run.draft.text }}</pre>
    <PostWriterMeme v-if="run.memeEnabled && run.meme?.status === 'ready'" :meme="run.meme" :version="run.hash"
      :url="`/api/admin/linkedin/post-runs/${encodeURIComponent(run.id)}/meme`" @loaded="onMemeLoaded" />
    <p v-else-if="run.memeEnabled">Мем: {{ run.meme?.errorCode || run.meme?.status || 'ожидает подготовки' }}</p>
    <p v-if="run.meme?.blockingReason">{{ run.meme.blockingReason }}</p>
    <label v-if="run.memeEnabled && run.mode === 'approval_required' && run.status === 'awaiting_approval'">
      <input v-model="memeReviewed" type="checkbox" :disabled="disabled || !memeLoaded" data-testid="post-meme-reviewed" />
      Мем просмотрен. Подтверждаю текст и изображение вместе.
    </label>
    <ul v-if="run.issues.length"><li v-for="issue in run.issues" :key="issue">{{ issue }}</li></ul>
    <p v-if="run.errorCode" role="alert">{{ run.errorCode }}</p>
    <a v-if="run.url" :href="run.url" target="_blank" rel="noreferrer">Открыть опубликованный пост</a>
    <p>Лайки: {{ engagementLabels[run.engagement.status] }}<template v-if="run.engagement.target">
      · {{ run.engagement.items.filter(item => item.status === 'sent').length }} из {{ run.engagement.target }}</template></p>
    <div class="post-actions">
      <template v-if="run.status === 'awaiting_approval'">
        <Button label="Подтвердить и опубликовать" :disabled="disabled || (run.memeEnabled && (!memeLoaded || !memeReviewed))"
          data-testid="post-approve" @click="emit('action', run, 'approve', run.memeEnabled ? run.hash : undefined)" />
        <Button label="Отклонить" outlined :disabled="disabled" @click="emit('action', run, 'reject')" />
      </template>
      <Button v-if="runActive(run) && !run.stop" label="Stop" severity="danger" outlined :disabled="stopDisabled"
        data-testid="post-stop" @click="emit('action', run, 'stop')" />
      <p v-if="run.stop && runActive(run)">Новые отправки остановлены. Проверяем начатую операцию.</p>
    </div>
  </section>
</template>
<style scoped>
.post-progress { border-top: 1px solid #dce4ef; margin-top: 1rem; padding-top: 1rem; }
pre { white-space: pre-wrap; font: inherit; background: #f5f8fc; padding: 1rem; border-radius: .5rem; }
.post-actions { display: flex; flex-wrap: wrap; gap: .75rem; }
</style>
