<script setup>
import { computed } from 'vue'
import { useInvitationWithdrawal } from './use-invitation-withdrawal'
const props = defineProps({ account: Object })
const control = useInvitationWithdrawal(props.account)
const count = computed(() => control.preview.value?.items.filter(item => item.eligible).length || 0)
const statuses = { running: 'Отзыв выполняется', completed: 'Очередь завершена', stopped: 'Остановлено',
  failed: 'Очередь остановлена из-за ошибки', uncertain: 'Нужна проверка результата', interrupted: 'Прервано перезапуском' }
const status = computed(() => control.active.value && control.run.value?.retryAttempt
  ? 'Пауза: Unipile ограничил запросы (429)' : statuses[control.run.value?.status])
const reasons = { already_attempted: 'Уже была попытка: повтор запрещён', date_unknown: 'Нет надёжной даты — пропускаем',
  too_recent: 'Не старше 14 дней — оставляем' }
</script>
<template>
  <Button :label="control.run.value ? 'Открыть отзыв' : 'Отозвать старые приглашения'" size="small" severity="secondary" outlined
    :data-testid="`withdrawal-open-${account.platformAccountId}`" @click="control.open" />
  <small v-if="control.run.value && !control.visible.value" role="status"
    :data-testid="`withdrawal-summary-${account.platformAccountId}`">
    {{ status }}. Отозвано: {{ control.run.value.withdrawn }} из {{ control.run.value.total }}.
    <span v-if="control.error.value">{{ control.error.value }}</span>
  </small>
  <Dialog v-model:visible="control.visible.value" modal :header="`Отзыв приглашений — ${account.clientName}`"
    :style="{ width: '850px', maxWidth: '95vw' }" data-testid="withdrawal-dialog">
    <template #header><div class="withdrawal-dialog-header">
      <strong>Отзыв приглашений — {{ account.clientName }}</strong>
      <Button label="Свернуть" icon="pi pi-minus" size="small" severity="secondary" outlined
        data-testid="withdrawal-minimize" title="Очередь продолжит работу. Можно выбрать другого ученика."
        @click="control.minimize" />
    </div></template>
    <p>Проверяем все ожидающие приглашения этого аккаунта, включая отправленные вручную.
      Отзываем только старше 14 дней, по одному, со случайными паузами 2–13 секунд.</p>
    <p>«Свернуть» скрывает окно: очередь продолжит работу, можно выбрать другого ученика.
      После перезапуска backend она сама не продолжится.</p>
    <p v-if="control.error.value" role="alert">{{ control.error.value }}</p>
    <section v-if="control.run.value" data-testid="withdrawal-progress" aria-live="polite">
      <strong>{{ status }}</strong>
      <p>Подтверждено отзывов: {{ control.run.value.withdrawn }} из {{ control.run.value.total }}.
        Пропущено: {{ control.run.value.skipped }}.</p>
      <p v-if="control.run.value.nextActionAt">Пауза до {{ new Date(control.run.value.nextActionAt).toLocaleTimeString('ru-RU') }}</p>
      <p v-if="control.active.value && control.run.value.retryAttempt" data-testid="withdrawal-retry">
        После паузы проверка продолжится автоматически. Уже отправленный отзыв повторять не будем.
      </p>
      <p v-if="control.run.value.error" role="alert">{{ control.run.value.error }}</p>
      <p v-if="control.run.value.checkedAt && !control.needsCheck.value">Результат проверен. Оставшаяся очередь сама не запускается.</p>
      <Button v-if="control.needsCheck.value" label="Проверить результат" data-testid="withdrawal-recheck"
        :loading="control.busy.value" :disabled="control.busy.value" @click="control.recheck" />
      <p v-if="control.run.value.stopRequested && control.active.value">Останавливаемся. Проверяем уже начатую операцию.</p>
      <Button v-if="control.active.value" label="Остановить" severity="danger" data-testid="withdrawal-stop"
        :disabled="control.busy.value || control.run.value.stopRequested" @click="control.stop" />
    </section>
    <Button label="Загрузить все приглашения" data-testid="withdrawal-load" :loading="control.busy.value"
      :disabled="control.active.value || control.busy.value" @click="control.load" />
    <template v-if="control.preview.value">
      <p>Всего ожидают: {{ control.preview.value.items.length }}. Подходят для отзыва: {{ count }}.</p>
      <p v-if="!control.preview.value.writerEnabled">Backend работает только на чтение. Отзыв отключён.</p>
      <DataTable :value="control.preview.value.items" paginator :rows="20" data-key="id"
        :rows-per-page-options="[20, 50, 100]" data-testid="withdrawal-list">
        <Column field="name" header="Кому" />
        <Column header="Дата отправки"><template #body="{ data }">
          {{ data.ageDays === undefined ? 'Неизвестна' : new Date(data.createdAt).toLocaleString('ru-RU') }}
        </template></Column>
        <Column header="Прошло"><template #body="{ data }">
          {{ data.ageDays === undefined ? '—' : `${data.ageDays} дн.` }}
        </template></Column>
        <Column header="Действие"><template #body="{ data }">
          {{ data.eligible ? 'Отозвать' : reasons[data.reason] }}
        </template></Column>
      </DataTable>
      <Button :label="`Отозвать старше 14 дней (${count})`" severity="warn" data-testid="withdrawal-start"
        :disabled="!count || !control.preview.value.writerEnabled || control.active.value || control.needsCheck.value || control.busy.value"
        @click="control.start" />
    </template>
  </Dialog>
</template>
<style scoped>
.withdrawal-dialog-header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex: 1; }
</style>
