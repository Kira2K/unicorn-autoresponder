<script setup>
import { ref, watch } from 'vue'
import PostWriterIntervals from './PostWriterIntervals.vue'
import PostWriterCv from './PostWriterCv.vue'
const props = defineProps({ settings: Object, disabled: Boolean, memesAvailable: Boolean })
const emit = defineEmits(['save', 'start'])
const draft = ref({ days: [] })
const topic = ref(''), cv = ref(), exclusions = ref('')
watch(() => JSON.stringify(props.settings && [props.settings.scheduled, props.settings.days,
  props.settings.likes, props.settings.memes, props.settings.manualMode, props.settings.intervals, props.settings.forbiddenTopics]), () => {
  if (props.settings) {
    draft.value = { ...props.settings, days: [...props.settings.days],
      intervals: (props.settings.intervals ?? [{ start: '10:00', end: '15:00' }]).map(x => ({ ...x })) }
    exclusions.value = (props.settings.forbiddenTopics ?? []).join('\n')
  }
}, { immediate: true })
const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
</script>
<template>
  <section class="post-settings">
    <h3>Расписание</h3>
    <label><input v-model="draft.scheduled" type="checkbox" :disabled="disabled" data-testid="post-scheduled" /> Автопубликация</label>
    <div class="post-days">
      <label v-for="(day, index) in days" :key="day"><input v-model="draft.days" type="checkbox" :value="index + 1"
        :disabled="disabled" :data-testid="`post-day-${index + 1}`" /> {{ day }}</label>
    </div>
    <PostWriterIntervals v-model="draft.intervals" :disabled="disabled" />
    <label>Не писать на темы (личные запреты, одна тема на строку)
      <textarea v-model="exclusions" rows="3" :disabled="disabled" data-testid="post-forbidden-topics" /></label>
    <label><input v-model="draft.likes" type="checkbox" :disabled="disabled" data-testid="post-likes" /> Лайки от других учеников</label>
    <p>После публикации: 6–7 подключённых учеников. Выключение не удаляет уже поставленные лайки.</p>
    <h3>Ручной запуск</h3>
    <label><input v-model="draft.memes" type="checkbox" :disabled="disabled || (!memesAvailable && !draft.memes)"
      data-testid="post-memes" /> Добавлять мем к посту</label>
    <small>Действует и для расписания. Сначала сохраните настройки. В режиме с подтверждением просмотр обязателен;
      без подтверждения мем публикуется автоматически после проверок.</small>
    <small v-if="!memesAvailable">Генерация изображений на сервере выключена.</small>
    <label>Своя тема — необязательно <input v-model="topic" :disabled="disabled" maxlength="500"
      placeholder="Пусто — Writer выберет тему" data-testid="post-custom-topic" /></label>
    <PostWriterCv :disabled="disabled" @change="cv = $event" />
    <small>Без файла используем финальное CV из Noco. Загруженное CV не заменяет его.</small>
    <label>Публикация <select v-model="draft.manualMode" :disabled="disabled" data-testid="post-manual-mode">
      <option value="approval_required">С подтверждением</option><option value="automatic">Без подтверждения</option>
    </select></label>
    <p>Доступен в любое время. Выбор подтверждения не влияет на расписание.</p>
    <div class="post-actions">
      <Button label="Сохранить настройки" :disabled="disabled || (draft.scheduled && !draft.days.length)"
        data-testid="post-save" @click="emit('save', { ...draft, forbiddenTopics: exclusions.split('\n').map(x => x.trim()).filter(Boolean) })" />
      <Button label="Создать пост сейчас" outlined :disabled="disabled || Boolean(draft.memes) !== Boolean(settings?.memes)" data-testid="post-start"
        @click="emit('start', { mode: draft.manualMode, topic, cv })" />
    </div>
  </section>
</template>
<style scoped>
.post-settings { display: grid; gap: .75rem; }
.post-settings h3, .post-settings p { margin: 0; }
.post-settings p { color: #526176; font-size: .9rem; }
.post-days, .post-actions { display: flex; flex-wrap: wrap; gap: 1rem; }
select { padding: .5rem; border: 1px solid #a9b8cc; border-radius: .3rem; }
input { accent-color: #10b981; }
textarea { width: 100%; }
</style>
