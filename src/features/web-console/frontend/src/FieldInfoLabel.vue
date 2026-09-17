<script setup>
import informationIcon from './assets/free-icon-information-17317532.png'

defineProps({
  label: {
    type: String,
    required: true
  },
  tooltip: {
    type: String,
    required: true
  },
  testId: {
    type: String,
    required: true
  }
})
</script>

<template>
  <span class="field-info-label">
    <span>{{ label }}</span>
    <span
      class="field-info-trigger"
      :data-testid="testId"
      :aria-label="`${label}: ${tooltip}`"
      tabindex="0"
    >
      <img :src="informationIcon" alt="" aria-hidden="true" />
      <span class="field-info-tooltip" role="tooltip">{{ tooltip }}</span>
    </span>
  </span>
</template>

<style scoped>
.field-info-label {
  display: inline-flex;
  align-items: center;
  gap: 0.3em;
}

.field-info-trigger {
  position: relative;
  display: inline-flex;
  width: 1em;
  height: 1em;
  flex: 0 0 1em;
  cursor: help;
  outline-offset: 2px;
}

.field-info-trigger img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.field-info-tooltip {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 6px);
  z-index: 20;
  padding: 5px 8px;
  border-radius: 5px;
  background: #172033;
  color: #ffffff;
  font-size: 0.75rem;
  font-weight: 600;
  line-height: 1.2;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  transform: translate(-50%, 2px);
  transition: opacity 120ms ease, transform 120ms ease, visibility 120ms ease;
}

.field-info-trigger:hover .field-info-tooltip,
.field-info-trigger:focus .field-info-tooltip {
  opacity: 1;
  visibility: visible;
  transform: translate(-50%, 0);
}
</style>
