<script setup>
import { computed, ref, watch } from 'vue'
import PostWriterIntervals from './PostWriterIntervals.vue'
import PostWriterCv from './PostWriterCv.vue'
import PostWriterPrepared from './PostWriterPrepared.vue'
import { writerSettings } from './post-settings-draft'
const props = defineProps({ settings: Object, disabled: Boolean, memesAvailable: Boolean, runs: Array, clientName: String })
const emit = defineEmits(['save', 'start', 'publish'])
const draft = ref(writerSettings()), topic = ref(''), cv = ref(), exclusions = ref('')
watch(() => JSON.stringify(writerSettings(props.settings)), () => {
  draft.value = writerSettings(props.settings)
  exclusions.value = draft.value.forbiddenTopics.join('\n')
}, { immediate: true })
const payload = computed(() => ({ ...draft.value, forbiddenTopics: exclusions.value.split('\n').map(x => x.trim()).filter(Boolean) }))
const dirty = computed(() => JSON.stringify(payload.value) !== JSON.stringify(writerSettings(props.settings)))
const prepared = computed(() => draft.value.contentMode === 'prepared')
const invalid = computed(() => (draft.value.scheduled && (prepared.value ? !props.memesAvailable : !draft.value.days.length)) ||
  draft.value.preparedPosts.some(post => Array.from(post.text).length > 3000))
const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
</script>
<template>
  <section class="post-settings">
    <div class="mode-heading">
      <label>Источник постов <select v-model="draft.contentMode" :disabled="disabled" data-testid="post-content-mode">
        <option value="generated">Генерация из CV</option><option value="prepared">Готовые посты на неделю</option>
      </select></label>
      <span class="save-state" :class="{ dirty }" data-testid="post-save-state">{{ dirty ? 'Есть несохранённые изменения' : 'Все изменения сохранены' }}</span>
    </div>
    <div class="settings-layout">
      <div class="content-panel">
        <PostWriterPrepared v-if="prepared" v-model="draft.preparedPosts" :disabled="disabled" :runs="runs" :dirty="dirty"
          :memes-available="memesAvailable" :client-name="clientName" @publish="emit('publish', $event)" />
        <section v-else class="generated-editor">
          <div><h3>Подготовить пост из CV</h3><p>Writer выберет тему или возьмёт вашу. Готовый текст можно проверить перед отправкой.</p></div>
          <label>Своя тема <input v-model="topic" :disabled="disabled" maxlength="500"
            placeholder="Необязательно — Writer может выбрать сам" data-testid="post-custom-topic" /></label>
          <div><PostWriterCv :disabled="disabled" @change="cv = $event" /><small>Без файла используем сохранённое финальное CV ученика.</small></div>
          <label class="check-row"><input v-model="draft.memes" type="checkbox" :disabled="disabled || (!memesAvailable && !draft.memes)"
            data-testid="post-memes" /> Добавлять мем к посту</label>
          <small>Настройка действует и для расписания.</small>
          <small v-if="!memesAvailable">Генерация изображений на сервере выключена.</small>
          <label>Ручная публикация <select v-model="draft.manualMode" :disabled="disabled" data-testid="post-manual-mode">
            <option value="approval_required">Сначала показать мне</option><option value="automatic">Публиковать автоматически</option>
          </select></label>
          <Button label="Создать пост сейчас" icon="pi pi-sparkles" :disabled="disabled || dirty" data-testid="post-start"
            @click="emit('start', { mode: draft.manualMode, topic, cv })" />
          <small v-if="dirty">Сначала сохраните настройки.</small>
        </section>
      </div>
      <aside class="schedule-panel">
        <h3>Расписание</h3>
        <label class="check-row"><input v-model="draft.scheduled" type="checkbox" :disabled="disabled" data-testid="post-scheduled" /> Автопубликация</label>
        <p>{{ prepared ? 'Отправим сохранённые тексты в выбранные дни. Можно оставить выключенным и публиковать вручную.' : 'Один пост в выбранный день. Расписание не ждёт подтверждения.' }}</p>
        <div v-if="!prepared" class="post-days">
          <label v-for="(day, index) in days" :key="day"><input v-model="draft.days" type="checkbox" :value="index + 1"
            :disabled="disabled" :data-testid="`post-day-${index + 1}`" /> {{ day }}</label>
        </div>
        <PostWriterIntervals v-model="draft.intervals" :disabled="disabled" />
        <hr />
        <label class="check-row"><input v-model="draft.likes" type="checkbox" :disabled="disabled" data-testid="post-likes" /> Лайки от других учеников</label>
        <small>После публикации: 6–7 подключённых учеников. Выключение не удаляет уже поставленные лайки.</small>
        <details class="topics-details"><summary>Запреты для этого ученика</summary>
          <label>Одна тема на строку <textarea v-model="exclusions" rows="3" :disabled="disabled" data-testid="post-forbidden-topics" /></label>
        </details>
      </aside>
    </div>
    <p v-if="prepared && !memesAvailable" class="writer-warning">Генерация мемов выключена. План можно сохранить, но публикация пока недоступна.</p>
    <footer class="save-bar">
      <small>Сохранение само по себе не публикует пост, если автопубликация выключена.</small>
      <Button label="Сохранить настройки" icon="pi pi-check" :disabled="disabled || invalid || !dirty"
        data-testid="post-save" @click="emit('save', payload)" />
    </footer>
  </section>
</template>
<style scoped src="./post-writer-settings.css"></style>
