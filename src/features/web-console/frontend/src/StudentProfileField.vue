<script setup>
defineProps({ name: String, label: String, required: Boolean, automatic: Boolean, hint: String, error: String })
</script>
<template>
  <div class="student-field" :class="{ invalid: error }" :data-profile-field="name">
    <label :for="`student-${name}`">{{ label }}<span v-if="required" class="required-star" aria-hidden="true"> *</span><span v-if="automatic" class="auto-badge">авто</span></label>
    <slot :id="`student-${name}`" :invalid="Boolean(error)" :describedby="error ? `student-${name}-error` : hint ? `student-${name}-hint` : undefined" />
    <small v-if="hint" :id="`student-${name}-hint`" class="student-hint">{{ hint }}</small>
    <small v-if="error" :id="`student-${name}-error`" class="student-error">{{ error }}</small>
  </div>
</template>
