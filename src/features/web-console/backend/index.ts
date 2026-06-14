require('dotenv').config()

const { createWebConsoleApp } = require('./app.ts') as {
  createWebConsoleApp(options?: any): import('express').Express
}

const port = Number(process.env.WEB_CONSOLE_PORT ?? 4300)
const host = process.env.WEB_CONSOLE_HOST ?? '127.0.0.1'
const app = createWebConsoleApp()

app.listen(port, host, () => {
  console.log(`Web console backend listening at http://${host}:${port}`)
})
