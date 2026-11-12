// Recover a never-loaded CAPTCHA image through the same browser/proxy/cookies.
// Keep the fetched picture visible as a canvas so subsequent SHA checks read
// exactly the reviewed pixels. A renewed challenge removes that canvas.
async function hydrateCaptchaImage(picture: any, timeoutMs = 8000): Promise<boolean> {
  return picture.evaluate(async (image: any, timeout: number) => {
    if (image.tagName !== 'IMG' || image.naturalWidth) return false
    const original = image.getAttribute('src')
    if (!original) throw Error('captcha_image_source_missing')
    const url = new URL(original, location.href)
    if (url.origin !== location.origin || !/^\/captcha\/picture(?:\/|$)/i.test(url.pathname)) {
      throw Error('captcha_image_origin_not_allowed')
    }
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), timeout)
    let bitmap: ImageBitmap | undefined
    try {
      const response = await fetch(url.href, {credentials: 'same-origin', cache: 'no-store', signal: abort.signal})
      if (!response.ok) throw Error(`captcha_image_http_${response.status}`)
      const blob = await response.blob()
      if (!/^image\/(png|jpeg|webp)$/i.test(blob.type) || blob.size > 2 * 1024 * 1024) {
        throw Error('captcha_image_payload_invalid')
      }
      bitmap = await createImageBitmap(blob)
      if (!image.isConnected || image.getAttribute('src') !== original) throw Error('captcha_image_changed')
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width; canvas.height = bitmap.height
      canvas.setAttribute('data-qa', 'account-captcha-hydrated')
      const context = canvas.getContext('2d')
      if (!context) throw Error('captcha_canvas_unavailable')
      context.drawImage(bitmap, 0, 0)
      const display = image.style.display
      image.insertAdjacentElement('afterend', canvas)
      image.style.display = 'none'
      const observer = new MutationObserver(() => {
        // HH may renew a challenge while reusing the same URL.
        canvas.remove(); image.style.display = display; observer.disconnect()
      })
      observer.observe(image, {attributes: true, attributeFilter: ['src']})
      return true
    } finally { clearTimeout(timer); abort.abort(); bitmap?.close() }
  }, Math.min(timeoutMs, 10000))
}
module.exports = {hydrateCaptchaImage}
