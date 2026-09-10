<script setup>
import { ref } from 'vue'
import PostWriterText from './PostWriterText.vue'
const visible = ref(false)
</script>
<template>
  <Button label="Writer из своего CV" outlined data-testid="post-text-open" @click="visible = true" />
  <Dialog v-model:visible="visible" modal header="Отдельная подготовка текста"
    :style="{ width: '1000px', maxWidth: '95vw' }">
    <PostWriterText v-if="visible" />
  </Dialog>
</template>
