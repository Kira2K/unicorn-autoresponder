<script setup>
import { ref, watch } from 'vue'
import { usePostText } from './use-post-text'
import PostWriterCv from './PostWriterCv.vue'
import PostWriterMeme from './PostWriterMeme.vue'
const props = defineProps({ token: { type: String, default: '' } })
const text = usePostText(() => props.token)
const globalRules = ref('')
watch(() => text.data.value.forbiddenTopics.join('\n'), value => { globalRules.value = value })
const labels = { queued: 'В очереди', generating: 'Готовим текст', ready: 'Текст готов — не опубликован',
  blocked: 'Нужна проверка', cancelled: 'Остановлено', retrying: 'Ожидание повторной попытки' }
</script>
<template>
  <section class="post-text" data-testid="post-text-workspace">
    <h2>Post Writer · Без публикации</h2>
    <p>Загрузите CV и задайте тему или оставьте выбор Writer. Noco и LinkedIn для этого режима не нужны.</p>
    <p v-if="!text.data.value.writable" role="status">Генерация выключена: LINKEDIN_POST_TEXT_ENABLED=true включает её на сервере.</p>
    <p v-if="text.error.value" role="alert">{{ text.error.value }}</p>
    <label>Автор <select :value="text.selected.value" :disabled="text.busy.value" @change="text.choose($event.target.value)">
      <option v-for="author in text.data.value.authors" :key="author.id" :value="author.id">{{ author.name }}</option>
      <option v-if="!text.data.value.authors.some(a => a.id === text.selected.value)" :value="text.selected.value">Новый автор</option>
    </select></label>
    <button type="button" :disabled="text.busy.value" @click="text.newAuthor">Новый автор</button>
    <fieldset :disabled="text.busy.value || !text.data.value.writable">
      <legend>Контекст автора</legend>
      <label>Имя <input v-model="text.author.value.name" maxlength="500" data-testid="post-text-name" /></label>
      <label>Роль <input v-model="text.author.value.role" maxlength="500" data-testid="post-text-role" /></label>
      <label>Уровень <input v-model="text.author.value.level" maxlength="500" /></label>
      <label>Стек через запятую <input v-model="text.stack.value" /></label>
      <label>Аудитория <input v-model="text.author.value.audience" maxlength="500" /></label>
      <label>Стиль <input v-model="text.author.value.style" maxlength="500" /></label>
      <label>Личные запреты — одна тема на строку <textarea v-model="text.bans.value" rows="3" /></label>
      <label><input v-model="text.author.value.memes" type="checkbox" data-testid="post-text-memes"
        :disabled="!text.data.value.memesAvailable && !text.author.value.memes" /> Подготовить мем вместе с текстом</label>
      <small v-if="!text.data.value.memesAvailable">Генерация изображений на сервере выключена.</small>
      <PostWriterCv :key="text.selected.value" @change="text.cv.value = $event" />
      <small v-if="text.author.value.cvRef">CV сохранено. Замена файла не стирает историю автора.</small>
      <button type="button" @click="text.save">Сохранить автора</button>
      <label>Своя тема — необязательно <input v-model="text.topic.value" maxlength="500" data-testid="post-text-topic" /></label>
      <button type="button" data-testid="post-text-start" :disabled="text.job.value && text.active(text.job.value)"
        @click="text.start">Подготовить текст</button>
      <small>Будет вызвана модель. Публикации и лайков в этом режиме нет.</small>
    </fieldset>
    <details><summary>Общие запреты этого текстового пространства</summary>
      <textarea v-model="globalRules" rows="4" :disabled="text.busy.value || !text.data.value.writable" />
      <button :disabled="text.busy.value || !text.data.value.writable" @click="text.savePolicy(globalRules)">Сохранить запреты</button>
    </details>
    <section v-if="text.job.value" aria-live="polite">
      <h3>{{ labels[text.job.value.status] }}</h3>
      <p v-if="text.job.value.nextActionAt">Следующая попытка: {{ new Date(text.job.value.nextActionAt).toLocaleString('ru-RU') }}</p>
      <p v-if="text.job.value.errorCode">{{ text.job.value.errorCode }}</p>
      <p v-for="issue in text.job.value.checkpoint?.issues" :key="issue">{{ issue }}</p>
      <textarea v-if="text.job.value.checkpoint?.draft" :value="text.job.value.checkpoint.draft.text" readonly rows="12" aria-label="Готовый текст для копирования" />
      <PostWriterMeme v-if="text.job.value.meme?.status === 'ready'" :meme="text.job.value.meme" :token="token"
        :version="text.job.value.meme.asset.sha256" :url="`/api/post-writer/text/jobs/${text.job.value.id}/meme`" />
      <p v-else-if="text.job.value.authorSnapshot.memes">Мем: {{ text.job.value.meme?.errorCode || text.job.value.meme?.status || 'в очереди' }}</p>
      <p v-if="text.job.value.meme?.blockingReason">{{ text.job.value.meme.blockingReason }}</p>
      <button v-if="text.active(text.job.value)" :disabled="text.busy.value" @click="text.stop">Остановить</button>
    </section>
    <button :disabled="text.busy.value" @click="text.refresh">Обновить статус</button>
    <details><summary>История автора</summary>
      <article v-for="job in text.data.value.jobs.filter(x => x.author === text.selected.value)" :key="job.id">
        <p>{{ new Date(job.createdAt).toLocaleString('ru-RU') }} · {{ labels[job.status] }}</p>
        <pre v-if="job.checkpoint?.draft">{{ job.checkpoint.draft.text }}</pre>
      </article>
    </details>
  </section>
</template>
<style scoped>
.post-text { display: grid; gap: .75rem; max-width: 950px; margin: auto; padding: 1rem; }
fieldset { display: grid; gap: .65rem; border: 1px solid #cbd5e1; }
label { display: grid; gap: .25rem; } input, textarea, select, button { font: inherit; padding: .5rem; }
textarea { width: 100%; box-sizing: border-box; } pre { white-space: pre-wrap; }
button { cursor: pointer; } [role=alert] { color: #b91c1c; }
</style>
