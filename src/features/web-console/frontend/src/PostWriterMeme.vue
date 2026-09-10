<script setup>
import { ref, watch, useId } from 'vue'
const props = defineProps({ meme: Object, url: String, version: String, token: String })
const emit = defineEmits(['loaded'])
const loaded = ref(false), failed = ref(false), source = ref(''), preview = ref()
const dialogTitle = useId()
watch(() => [props.url, props.version, props.token], async (_, __, cleanup) => {
  loaded.value = false
  failed.value = false
  source.value = ''
  preview.value?.close()
  emit('loaded', false)
  const controller = new AbortController()
  let objectUrl
  cleanup(() => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) })
  if (!props.url) return
  try {
    const response = await fetch(props.url, { credentials: 'include', signal: controller.signal,
      headers: props.token ? { Authorization: `Bearer ${props.token}` } : {} })
    if (!response.ok || !response.headers.get('Content-Type')?.startsWith('image/png')) throw new Error('image')
    const blob = await response.blob()
    if (controller.signal.aborted) return
    objectUrl = URL.createObjectURL(blob)
    source.value = objectUrl
  } catch { if (!controller.signal.aborted) failed.value = true }
}, { immediate: true })
function imageLoaded() { loaded.value = true; emit('loaded', true) }
function imageFailed() { loaded.value = false; failed.value = true; emit('loaded', false) }
</script>
<template>
  <section class="post-meme" data-testid="post-meme">
    <h4>Мем к посту</h4>
    <p v-if="failed" role="alert">Не удалось открыть мем. Подтверждение недоступно — откройте окно заново.</p>
    <p v-else-if="!loaded">Загружаем изображение…</p>
    <button v-if="source && !failed" type="button" class="image-button" aria-label="Открыть мем крупно"
      @click="preview.showModal()" :disabled="!loaded">
      <img :src="source" :alt="meme?.asset?.altText || 'Мем к посту'" @load="imageLoaded" @error="imageFailed" />
    </button>
    <p v-if="loaded"><small>Нажмите на изображение, чтобы рассмотреть его.</small></p>
    <dialog ref="preview" :aria-labelledby="dialogTitle" @keydown.esc.stop>
      <header><h4 :id="dialogTitle">Мем к посту</h4><button type="button" @click="preview.close()">Закрыть</button></header>
      <img class="large" :src="source" :alt="meme?.asset?.altText || 'Мем к посту'" />
    </dialog>
  </section>
</template>
<style scoped>
.post-meme { margin: 1rem 0; }
.image-button { display: block; border: 1px solid #cbd5e1; background: transparent; padding: 0; cursor: zoom-in; }
img { display: block; width: min(320px, 100%); height: auto; }
.large { width: auto; max-width: 100%; max-height: 80vh; margin: auto; }
dialog { max-width: 95vw; max-height: 95vh; border: 1px solid #cbd5e1; border-radius: .5rem; padding: 1rem; }
dialog::backdrop { background: #0f172acc; }
header { display: flex; align-items: center; justify-content: space-between; gap: 2rem; }
</style>
