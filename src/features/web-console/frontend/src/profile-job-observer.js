export function createProfileJobObserver({ read, onValue, onError, onTerminal, isTerminal,
  schedule = setTimeout, cancel = clearTimeout }) {
  let version = 0
  let timer
  function stop() { version += 1; cancel(timer); timer = undefined }
  async function refresh(id, token) {
    let delay = 1000
    try {
      const value = await read(id)
      if (token !== version) return
      onValue(value)
      if (isTerminal(value)) { await onTerminal?.(value); return }
    } catch (error) {
      if (token !== version) return
      onError(error)
      delay = 5000
    }
    if (token === version) timer = schedule(() => refresh(id, token), delay)
  }
  return { stop, start(id) { stop(); void refresh(id, version) } }
}
