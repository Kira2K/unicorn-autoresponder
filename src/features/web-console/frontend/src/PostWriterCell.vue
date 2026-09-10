<script setup>
import { usePostWriter } from './use-post-writer'
import PostWriterSettings from './PostWriterSettings.vue'
import PostWriterProgress from './PostWriterProgress.vue'
import PostWriterPolicy from './PostWriterPolicy.vue'
import { dateMsk, stages } from './post-writer-view'
const props = defineProps({ account: Object })
const writer = usePostWriter(props.account)
</script>
<template>
  <Button label="Post Writer" size="small" outlined :data-testid="`post-writer-${account.platformAccountId}`" @click="writer.open" />
  <small v-if="writer.run.value">{{ stages[writer.run.value.status] }}</small>
  <Dialog v-model:visible="writer.visible.value" modal :header="`Post Writer — ${account.clientName}`"
    :style="{ width: '900px', maxWidth: '95vw' }" data-testid="post-writer-dialog">
    <p>Можно закрыть окно — работа продолжится на сервере.</p>
    <Message v-if="writer.error.value" severity="error" :closable="false">{{ writer.error.value }}</Message>
    <template v-if="writer.data.value">
      <Message v-if="writer.data.value.mock" severity="info" :closable="false">Тестовый режим: NocoDB, OpenAI и LinkedIn не вызываются. Данные исчезнут после остановки mock-сервера.</Message>
      <Message v-if="!writer.data.value.writable" severity="warn" :closable="false">Запись отключена или хранилище недоступно.</Message>
      <p v-if="writer.data.value.storageRetryAt">Повтор сохранения: {{ dateMsk(writer.data.value.storageRetryAt) }}. Stop доступен.</p>
      <p>Следующий автозапуск: {{ writer.data.value.settings.scheduled && writer.data.value.settings.slot?.state === 'planned' ? dateMsk(writer.data.value.settings.slot.at) : 'Не назначен' }}</p>
      <p v-if="writer.data.value.settings.lastMissedSlot">Пропущено: {{ dateMsk(writer.data.value.settings.lastMissedSlot.at) }} — окно завершилось.</p>
      <PostWriterSettings :settings="writer.data.value.settings" :disabled="writer.busy.value || !writer.data.value.writable"
        :memes-available="writer.data.value.memesAvailable"
        @save="writer.save" @start="writer.start" />
      <PostWriterPolicy :disabled="writer.busy.value || !writer.data.value.writable" />
      <PostWriterProgress :run="writer.run.value" :now="writer.now.value"
        :stop-disabled="writer.busy.value || !writer.data.value.writerEnabled"
        :disabled="writer.busy.value || !writer.data.value.writable" @action="writer.action" />
      <details><summary>История</summary><div v-for="item in writer.data.value.runs" :key="item.id">
        {{ dateMsk(item.createdAt) }} — {{ stages[item.status] }}
        <a v-if="item.url" :href="item.url" target="_blank" rel="noreferrer">Пост</a>
      </div></details>
    </template>
  </Dialog>
</template>
