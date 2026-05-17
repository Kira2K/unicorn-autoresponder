const {
  printFreshStudentChats,
  writeFreshStudentChatBelongingsTxt
} = require('./tgChatIdChecker/index.ts') as {
  printFreshStudentChats(): Promise<unknown>
  writeFreshStudentChatBelongingsTxt(options?: {
    outputFile?: string
  }): Promise<unknown>
}

function parseCliArgs(args: string[]): {
  belongings: boolean
  outputFile?: string
} {
  const options: {
    belongings: boolean
    outputFile?: string
  } = {
    belongings: false
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    if (arg === '--belongings') {
      options.belongings = true
      continue
    }

    if (arg === '--output') {
      options.outputFile = args[index + 1]
      index += 1
      continue
    }

    if (arg.startsWith('--output=')) {
      options.outputFile = arg.slice('--output='.length)
    }
  }

  return options
}

const keepAlive = setInterval(() => undefined, 1000)
const options = parseCliArgs(process.argv.slice(2))

;(options.belongings
  ? writeFreshStudentChatBelongingsTxt({
      outputFile: options.outputFile
    })
  : printFreshStudentChats())
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => {
    clearInterval(keepAlive)
  })
