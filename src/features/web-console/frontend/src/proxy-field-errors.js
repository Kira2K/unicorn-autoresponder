export function proxyFieldErrors(draft) {
 const errors = {}, host = String(draft.host || '').trim(), port = Number(draft.port)
 if (!['http','https','socks4','socks5'].includes(draft.type)) errors.type = 'Выбери тип прокси из списка.'
 if (!host || host.length > 253 || /[\s/@?#]/.test(host) || host.includes('://')) errors.host = 'Введи IP или домен без протокола и порта, например gate.example.com.'
 if (!String(draft.port || '').trim() || !Number.isInteger(port) || port < 1 || port > 65535) errors.port = 'Введи порт от 1 до 65535, например 1080.'
 for (const field of ['login','password']) if (String(draft[field] || '').length > 255 || /[\r\n]/.test(String(draft[field] || ''))) errors[field] = 'Убери переносы строк; максимум 255 символов.'
 if (draft.changeIpUrl) try { if (!['http:','https:'].includes(new URL(draft.changeIpUrl).protocol)) throw Error() } catch { errors.changeIpUrl = 'Введи полный адрес, например https://example.com/change-ip, или оставь поле пустым.' }
 return errors
}
