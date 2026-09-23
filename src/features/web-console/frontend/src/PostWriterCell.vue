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
    :style="{ width: '1180px', maxWidth: '96vw' }" data-testid="post-writer-dialog">
    <p class="writer-note">Тексты, мемы и публикации одного аккаунта. Можно закрыть окно — работа продолжится.</p>
    <Message v-if="writer.error.value" severity="error" :closable="false">{{ writer.error.value }}</Message>
    <template v-if="writer.data.value">
      <Message v-if="writer.data.value.mock" severity="info" :closable="false">Тестовый режим: NocoDB, OpenAI и LinkedIn не вызываются. Данные исчезнут после остановки mock-сервера.</Message>
      <Message v-if="!writer.data.value.writable" severity="warn" :closable="false">Запись отключена или хранилище недоступно.</Message>
      <p v-if="writer.data.value.storageRetryAt">Повтор сохранения: {{ dateMsk(writer.data.value.storageRetryAt) }}. Stop доступен.</p>
      <p class="writer-next">Следующий автозапуск: <strong>{{ writer.data.value.settings.scheduled && writer.data.value.settings.slot?.state === 'planned' ? dateMsk(writer.data.value.settings.slot.at) : 'Не назначен' }}</strong></p>
      <p v-if="writer.data.value.settings.lastMissedSlot">Пропущено: {{ dateMsk(writer.data.value.settings.lastMissedSlot.at) }} — окно завершилось.</p>
      <details v-if="writer.run.value" class="writer-result" open>
        <summary>Последний запуск · {{ stages[writer.run.value.status] }}</summary>
        <PostWriterProgress :run="writer.run.value" :now="writer.now.value"
          :stop-disabled="writer.busy.value || !writer.data.value.writerEnabled"
          :disabled="writer.busy.value || !writer.data.value.writable" @action="writer.action" />
      </details>
      <PostWriterSettings :settings="writer.data.value.settings" :disabled="writer.busy.value || !writer.data.value.writable"
        :memes-available="writer.data.value.memesAvailable" :runs="writer.data.value.runs" :client-name="account.clientName"
        @save="writer.save" @start="writer.start" @publish="writer.startPrepared" />
      <PostWriterPolicy :disabled="writer.busy.value || !writer.data.value.writable" />
      <details class="writer-history"><summary>История · {{ writer.data.value.runs.length }}</summary><div v-for="item in writer.data.value.runs" :key="item.id">
        {{ dateMsk(item.createdAt) }} — {{ stages[item.status] }}
        <a v-if="item.url" :href="item.url" target="_blank" rel="noreferrer">Пост</a>
      </div></details>
    </template>
  </Dialog>
</template>
<style scoped>
.writer-note { color: #64748b; font-size: .9rem; margin: 0 0 1rem; }
.writer-next { padding: .7rem .9rem; border-radius: 10px; background: #f5f8fa; font-size: .85rem; }
.writer-result { border: 1px solid #dce5eb; border-radius: 12px; padding: .8rem 1rem; margin-bottom: 1rem; }
.writer-result summary, .writer-history summary { cursor: pointer; font-weight: 600; font-size: .9rem; }
.writer-history { margin-top: 1rem; border-top: 1px solid #e2e8f0; padding-top: 1rem; }
.writer-history div { padding: .6rem 0; font-size: .85rem; }
</style>
