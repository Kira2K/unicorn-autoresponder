require('dotenv').config()

const fs = require('node:fs')
const path = require('node:path')
const express = require('express')

const isProduction = process.env.NODE_ENV === 'production'
const port = Number(process.env.PORT ?? process.env.WEB_CONSOLE_PORT ?? 4300)
const host = process.env.WEB_CONSOLE_HOST ?? (isProduction ? '0.0.0.0' : '127.0.0.1')
const staticDir = path.resolve(__dirname, '../../../../dist/web-console')
async function startBackend() {
  const { reserveConsolePort } = await import('./reserve-port.mts')
  const bound = await reserveConsolePort(port, host)
  let closeStorage: (() => Promise<void>) | undefined
  try {
    const { createConfiguredApp } = await import('./configured-app.mts')
    const runtime = await createConfiguredApp()
    const app = runtime.app
    closeStorage = runtime.closeStorage

    if (isProduction) {
      if (!fs.existsSync(staticDir)) {
        console.warn(`Web console static build was not found at ${staticDir}. Run npm run web:build before web:start.`)
      }

      app.use(express.static(staticDir))
      app.use((req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => {
        if (req.path.startsWith('/api')) {
          res.status(404).json({ error: 'not_found' })
          return
        }

        const indexPath = path.join(staticDir, 'index.html')
        if (!fs.existsSync(indexPath)) {
          next()
          return
        }

        res.sendFile(indexPath)
      })
    }

    bound.attach(app)
    console.log(`Web console backend listening at http://${host}:${port}`)
    void app.locals.recoverProfileVerification().catch(() => {
      console.error('Profile verification recovery could not be started; inspect safe Profile Filler logs.')
    })
    if (isProduction) console.log(`Web console static files served from ${staticDir}`)
  } catch (error) {
    await bound.close()
    await closeStorage?.()
    throw error
  }
}
void startBackend().catch((error: unknown) => {
  // SQL/provider errors may contain credentials. Expose only our known startup code.
  const code = (error as { code?: unknown })?.code
  console.error(typeof code === 'string' && /^(invalid_appdb_|tls_or_|postgres_id_|sql_|database_not_allowed|postgres_read_)/.test(code)
    ? `Web console startup blocked: ${code}` : 'Web console startup blocked; inspect configuration.')
  process.exitCode = 1
})
