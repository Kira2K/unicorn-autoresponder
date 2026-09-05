<script setup>
import { computed } from 'vue'
import ProfileEntryEditor from './ProfileEntryEditor.vue'
import ProfileOpenToWorkEditor from './ProfileOpenToWorkEditor.vue'

const props = defineProps({ modelValue: { type: Object, required: true } })
const emit = defineEmits(['update:modelValue'])
const profile = computed(() => props.modelValue.profile || {})
const clone = value => JSON.parse(JSON.stringify(value))

function updateProfile(key, value) {
  const next = clone(props.modelValue)
  next.profile ||= {}
  next.profile[key] = value
  emit('update:modelValue', next)
}

function updateEntry(section, index, value) {
  const next = clone(props.modelValue)
  next.profile[section][index] = value
  emit('update:modelValue', next)
}

function updateSkills(value) {
  const skills = clone(profile.value.skills || { target_count: 100 })
  skills.add = value.split(/[\n,]/).map(item => item.trim()).filter(Boolean)
  updateProfile('skills', skills)
}

function updateSkillTarget(value) {
  const skills = clone(profile.value.skills || { add: [] })
  skills.target_count = Number(value)
  updateProfile('skills', skills)
}
</script>

<template>
  <section class="profile-draft-editor" data-testid="profile-draft-editor">
    <h4>Редактирование нормализованного профиля</h4>
    <label><span>Заголовок</span>
      <input :value="profile.headline || ''" @input="updateProfile('headline', $event.target.value)" />
    </label>
    <label class="wide"><span>О себе</span>
      <textarea :value="profile.about || ''" @input="updateProfile('about', $event.target.value)" />
    </label>
    <label class="wide"><span>Основные навыки (по одному в строке)</span>
      <textarea :value="(profile.skills?.add || []).join('\n')" @input="updateSkills($event.target.value)" />
    </label>
    <label><span>Целевое количество навыков</span>
      <input type="number" min="95" max="103" :value="profile.skills?.target_count || 100"
        @input="updateSkillTarget($event.target.value)" />
    </label>
    <template v-for="section in ['experience', 'education']" :key="section">
      <fieldset v-for="(entry, index) in profile[section] || []" :key="`${section}-${index}`">
        <legend>{{ section === 'experience' ? 'Опыт работы' : 'Образование' }} {{ index + 1 }}</legend>
        <ProfileEntryEditor :kind="section" :entry="entry"
          @change="value => updateEntry(section, index, value)" />
      </fieldset>
    </template>
    <ProfileOpenToWorkEditor v-if="profile.open_to_work" :value="profile.open_to_work"
      @change="value => updateProfile('open_to_work', value)" />
  </section>
</template>
