require('dotenv').config()

const fs = require('node:fs')
const path = require('node:path')
const express = require('express')
const { createWebConsoleApp } = require('./app.ts') as {
  createWebConsoleApp(options?: any): import('express').Express
}

const isProduction = process.env.NODE_ENV === 'production'
const port = Number(process.env.PORT ?? process.env.WEB_CONSOLE_PORT ?? 4300)
const host = process.env.WEB_CONSOLE_HOST ?? (isProduction ? '0.0.0.0' : '127.0.0.1')
const staticDir = path.resolve(__dirname, '../../../../dist/web-console')
const app = createWebConsoleApp()

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

app.listen(port, host, () => {
  console.log(`Web console backend listening at http://${host}:${port}`)
  if (isProduction) {
    console.log(`Web console static files served from ${staticDir}`)
  }
})
