<script setup>
import { computed } from 'vue'
import { profileRows, profileValue } from './profile-value-view.js'
const props = defineProps({ value: { default: undefined }, empty: { type: String, default: 'Нет данных' } })
const rows = computed(() => profileRows(props.value))
</script>
<template>
  <dl v-if="rows.length" class="profile-values">
    <template v-for="row in rows" :key="row.key"><dt>{{ row.label }}</dt><dd>{{ row.value }}</dd></template>
  </dl>
  <p v-else class="profile-value-text">{{ value == null ? empty : profileValue(value) }}</p>
</template>
