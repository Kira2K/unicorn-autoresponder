// Read-only projection of backend state. Never creates, starts or retries a feature job.
export const automationFeatures = { invitations: 'Приглашения', posts: 'Посты', comments: 'Комментарии', withdrawals: 'Отзыв приглашений' }
export const automationStates = { planned: 'Ожидает запуска', starting: 'Запускается', running: 'Выполняется', monitoring: 'Монитор включён', completed: 'Завершено', blocked: 'Нужна проверка', cancelled: 'Отменено', missed: 'Пропущено' }
export const timeMsk = at => at ? new Date(at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) : '—'
export const latestRuns = runs => [...(runs || [])].sort((a, b) => b.updatedAt - a.updatedAt)

export function automationOverview(account, snapshot, diagnostics, now = Date.now()) {
  const setting = snapshot?.settings?.find(s => s.account === account)
  const runs = latestRuns(diagnostics?.runs?.filter(r => r.account === account))
  const latestByFeature = new Map()
  for (const run of runs) {
    if ((!['planned', 'cancelled', 'missed'].includes(run.state) || (run.state === 'planned' && run.commentMode === 'continuous')) && !latestByFeature.has(run.feature)) latestByFeature.set(run.feature, run)
  }
  const recent = [...latestByFeature.values()]
  const problem = recent.find(r => r.state === 'blocked')
  const active = recent.find(r => ['starting', 'running'].includes(r.state))
  const monitor = recent.find(r => r.state === 'monitoring')
  const run = problem || active || monitor || recent[0]
  const upcoming = setting?.enabled ? runs.filter(r => r.state === 'planned' && r.closesAt > now &&
    setting.slots.some(s => s.id === r.slotId && s.features.includes(r.feature))).sort((a, b) => a.plannedAt - b.plannedAt) : []
  const slot = snapshot?.preview?.filter(p => p.account === account && p.end > now).sort((a, b) => a.start - b.start)[0]
  const next = !setting?.slots.length ? 'Расписание не задано' : !setting.enabled ? 'Автоматизация выключена' :
    upcoming[0] ? `${automationFeatures[upcoming[0].feature]} · ${timeMsk(upcoming[0].plannedAt)}` :
      slot ? `Ближайший слот · ${timeMsk(slot.start)}` : 'Ожидает планирования'
  return { setting, enabled: Boolean(setting?.enabled), attention: Boolean(problem), active: Boolean(active), run, upcoming, next,
    features: [...new Set(setting?.slots.flatMap(s => s.features) || [])],
    current: run ? `${automationFeatures[run.feature]} · ${run.stopRequested ? 'Остановка запрошена' : automationStates[run.state] || run.state}` :
      setting?.enabled ? 'Ожидает расписания' : 'Нет активных автозапусков',
    description: run?.description || '', monitor }
}

export function automationToggleItems(accounts, settings, enabled) {
  return accounts.map(account => {
    const current = settings.find(s => s.account === account)
    return { account, revision: current?.revision || 0, settings: { ...(current || { timezone: 'Europe/Moscow', slots: [] }), enabled } }
  })
}
