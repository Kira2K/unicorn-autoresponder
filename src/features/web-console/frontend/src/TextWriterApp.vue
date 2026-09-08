<script setup>
import { ref } from 'vue'
import PostWriterText from './PostWriterText.vue'
const token = ref(''), entered = ref(false)
</script>
<template>
  <main>
    <form v-if="!entered" @submit.prevent="entered = true">
      <h1>Post Writer</h1><p>Отдельный генератор текста. Не публикует в LinkedIn.</p>
      <label>Ключ доступа <input v-model="token" type="password" autocomplete="off" required minlength="24" /></label>
      <button>Открыть</button>
    </form>
    <template v-else><button @click="entered = false; token = ''">Выйти</button><PostWriterText :token="token" /></template>
  </main>
</template>
<style>body { font-family: system-ui, sans-serif; color: #1e293b; background: #f8fafc; } form { max-width: 500px; margin: 4rem auto; } input, button { padding: .7rem; }</style>
