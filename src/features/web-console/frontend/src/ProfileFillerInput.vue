<script setup>
import { fileSize } from './profile-file'
import ProfileDraftEditor from './ProfileDraftEditor.vue'
defineProps({ filler: { type: Object, required: true } })
</script>
<template>
  <section class="profile-filler-input">
    <h2>Из какого CV подготовить профиль?</h2>
    <p class="profile-muted">Используйте подтверждённое английское резюме. LinkedIn пока не изменится.</p>
    <fieldset class="profile-source-options" :disabled="filler.busy.value">
      <legend class="profile-sr-only">Источник CV</legend>
      <label :class="{ selected: filler.source.value === 'drive' }">
        <input v-model="filler.source.value" type="radio" value="drive" name="profile-source" />
        <span><strong>Использовать финальное CV ученика</strong><small>Файл по сохранённой ссылке на Drive</small></span>
      </label>
      <label :class="{ selected: filler.source.value === 'upload' }">
        <input v-model="filler.source.value" type="radio" value="upload" name="profile-source"
          data-testid="profile-source-upload" />
        <span><strong>Загрузить PDF/DOCX</strong><small>Выбрать актуальное CV с компьютера</small></span>
      </label>
    </fieldset>
    <label v-if="filler.source.value === 'upload'" class="profile-file-drop" for="profile-cv-file"
      @dragover.prevent @drop="filler.dropGenerationFile" data-testid="profile-filler-cv-drop">
      <i class="pi pi-file-import" />
      <strong>{{ filler.cvFile.value ? 'Заменить выбранный файл' : 'Перетащите CV или выберите файл' }}</strong>
      <span>PDF/DOCX · до 20 МБ · без автоматического запуска</span>
      <input id="profile-cv-file" type="file" :disabled="filler.busy.value"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        data-testid="profile-filler-cv-file" @change="filler.chooseGenerationFile" />
    </label>
    <div v-if="filler.source.value === 'upload' && filler.cvFile.value" class="profile-file-selected"
      data-testid="profile-cv-selected"><i class="pi pi-file" /><strong>{{ filler.cvFile.value.name }}</strong>
      <span>{{ fileSize(filler.cvFile.value.size) }}</span>
    </div>
    <details class="profile-advanced" data-testid="profile-json-tools">
      <summary>Для специалиста: импорт JSON</summary>
      <fieldset :disabled="filler.busy.value">
        <p>Отдельный диагностический вход. Сгенерированный Preview нельзя редактировать через JSON.</p>
        <label class="profile-file-drop" for="profile-file" @dragover.prevent @drop="filler.dropFile"
          data-testid="profile-filler-drop"><strong>Выбрать profile.json</strong><span>До 250 КБ</span>
          <input id="profile-file" type="file" accept=".json,application/json"
            data-testid="profile-filler-file" @change="filler.chooseFile" />
        </label>
        <p v-if="filler.selectedFile.value">{{ filler.selectedFile.value.name }}</p>
        <ProfileDraftEditor v-if="filler.source.value === 'json' && filler.draft.value"
          :model-value="filler.draft.value" @update:model-value="filler.updateDraft" />
      </fieldset>
    </details>
  </section>
</template>
