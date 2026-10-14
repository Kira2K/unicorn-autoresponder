export const OCTO_WELCOME_TEXT = 'Мы в процессе подключения более продвинутого браузера. Если у тебя уже есть готовый профиль в Dolphin - продолжай работать там. Если ты регистрируешь свой первый профиль - тебе нужно работать с Octobrowser (octobrowser.net). Если ты регистрируешь второй аккаунт после бана, пожалуйста, сначала удали свой аккаунт из Dolphin, а затем создавай новый в Octobrowser. Обрати внимание: в будущем планируется полная миграция всех профилей из Dolphin в Octobrowser. Хорошая новость: он не требует 2fa, а значит работа с ним будет ещё легче!'

export function browserWelcomeKey(clientId) {
  return `webConsole.octoWelcome.v1.${clientId}`
}

export function shouldShowBrowserWelcome(storage, clientId) {
  if (!clientId) return false
  try { return storage?.getItem(browserWelcomeKey(clientId)) !== 'closed' } catch { return true }
}

export function dismissBrowserWelcome(storage, clientId) {
  try { storage?.setItem(browserWelcomeKey(clientId), 'closed') } catch { /* The current view still closes if storage is unavailable. */ }
}

export function missingOctoLocales(status) {
  return (status.requiredLocales || []).filter(locale => !(status.profiles || []).some(profile => profile.locale === locale))
}

export function octoOnboardingBusy(status) {
  return ['queued', 'checking', 'provisioning'].includes(status.onboarding?.phase) ||
    ['preparing', 'queued', 'running', 'provisioning'].includes(status.provisioning?.phase)
}

export function canContinueOctoOnboarding(onboarding = {}) {
  return onboarding.phase === 'awaiting_confirmation' && Boolean(onboarding.id) &&
    ['own', 'dolphin'].includes(onboarding.source) && typeof onboarding.score === 'number' &&
    onboarding.score >= 0 && onboarding.score < 70 && !onboarding.error
}

// Fetch failure stays distinct from a successfully loaded empty list.
export function octoLocationComplete(location, lists) {
  return Boolean(location.country) && ['countries', 'regions', 'cities'].every(level =>
    lists[level]?.loaded === true && !lists[level]?.error) &&
    lists.countries.items.some(item => item.code === location.country) &&
    (!lists.regions.items.length || lists.regions.items.some(item => item.code === location.region)) &&
    (!lists.cities.items.length || lists.cities.items.some(item => item.code === location.city))
}

// Version checks prevent old country/region responses from restoring stale choices.
export function createOctoLocationPicker(fetchLocations, publish) {
  let version = 0
  const empty = () => ({ items: [], loaded: false, error: '', loading: false })
  let state = { location: { country: '', region: '', city: '' }, lists: { countries: empty(), regions: empty(), cities: empty() } }
  const emit = () => publish(structuredClone(state))
  async function load(level, currentVersion) {
    state.lists[level] = { ...empty(), loading: true }
    emit()
    try {
      const result = await fetchLocations(level, { ...state.location })
      if (version !== currentVersion) return false
      if (!Array.isArray(result.items)) throw new Error('invalid_locations')
      state.lists[level] = { items: result.items, loaded: true, error: '', loading: false }
      emit()
      return true
    } catch (error) {
      if (version !== currentVersion) return false
      state.lists[level] = { ...empty(), error: 'Не удалось загрузить список. Повторите попытку.' }
      emit()
      return false
    }
  }
  return {
    async countries() {
      state = { location: { country: '', region: '', city: '' }, lists: { countries: empty(), regions: empty(), cities: empty() } }
      return load('countries', ++version)
    },
    async country(country) {
      const currentVersion = ++version
      state.location = { country, region: '', city: '' }
      state.lists.regions = empty()
      state.lists.cities = empty()
      emit()
      if (country && await load('regions', currentVersion) && !state.lists.regions.items.length) await load('cities', currentVersion)
    },
    async region(region) {
      const currentVersion = ++version
      state.location.region = region
      state.location.city = ''
      state.lists.cities = empty()
      emit()
      if (region) await load('cities', currentVersion)
    },
    city(city) { state.location.city = city; emit() },
    async retryCities() { return load('cities', ++version) },
    cancel() { version += 1 }
  }
}
