<script setup>
const props = defineProps({ value: { type: Object, required: true } })
const emit = defineEmits(['change'])
const text = items => (items || []).map(item => typeof item === 'string' ? item : item.name).join('\n')

function set(key, value) {
  emit('change', { ...props.value, [key]: value || undefined })
}
function setList(key, value) {
  set(key, value.split(/[\n,]/).map(item => item.trim()).filter(Boolean))
}
</script>

<template>
  <fieldset class="profile-open-editor">
    <legend>Open to Work</legend>
    <label><span>Job titles</span>
      <textarea :value="text(value.job_titles)" @input="setList('job_titles', $event.target.value)" />
    </label>
    <label><span>Locations</span>
      <textarea :value="text(value.locations)" @input="setList('locations', $event.target.value)" />
    </label>
    <label><span>Workplace types</span>
      <input :value="(value.workplace_types || []).join(', ')"
        @input="setList('workplace_types', $event.target.value.toUpperCase())" />
    </label>
    <label><span>Employment types</span>
      <input :value="(value.employment_types || []).join(', ')"
        @input="setList('employment_types', $event.target.value.toUpperCase())" />
    </label>
    <label><span>Start</span>
      <select :value="value.start_date || ''" @change="set('start_date', $event.target.value)">
        <option value="">Not specified</option><option value="IMMEDIATELY">Immediately</option>
        <option value="FLEXIBLE">Flexible</option>
      </select>
    </label>
    <label><span>Visibility</span>
      <select :value="value.visibility || ''" @change="set('visibility', $event.target.value)">
        <option value="">Choose</option><option value="RECRUITERS_ONLY">Recruiters only</option>
        <option value="ALL">All LinkedIn members</option>
      </select>
    </label>
  </fieldset>
</template>
