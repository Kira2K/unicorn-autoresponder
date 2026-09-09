import type { ProfileFillerMarket } from './types.ts'
import { profileFillerError } from './errors.ts'

const TITLE_MAP: Record<string, Record<ProfileFillerMarket, string[]>> = {
  python: {
    Ru: ['Старший Python разработчик / Senior Python Developer',
      'Старший Backend разработчик / Senior Backend Developer',
      'Старший FastAPI разработчик / Senior FastAPI Developer'],
    En: ['Senior Python Developer', 'Senior Backend Developer', 'Senior FastAPI Developer']
  },
  java: {
    Ru: ['Старший Java Разработчик / Senior Java Developer',
      'Старший Backend разработчик / Senior Backend Developer'],
    En: ['Senior Java Developer', 'Senior Backend Developer']
  },
  go: {
    Ru: ['Старший Go разработчик / Senior Go Developer',
      'Старший Golang разработчик / Senior Golang Developer',
      'Старший Бэкенд разработчик / Senior Backend Developer'],
    En: ['Senior Go Developer', 'Senior Golang Developer', 'Senior Backend Developer']
  },
  devops: {
    Ru: ['Старший DevOps инженер / Senior DevOps Engineer',
      'Старший DevOps разработчик / Senior DevOps Developer',
      'Старший Cloud DevOps инженер / Senior Cloud DevOps Engineer'],
    En: ['Senior DevOps Developer', 'Senior Cloud DevOps Engineer']
  },
  aqapython: {
    Ru: ['Старший AQA Python разработчик / Senior AQA Python Developer',
      'Старший Automation QA Python инженер / Senior Automation QA Python Engineer',
      'Старший Python Automation тестировщик / Senior Python Automation Tester'],
    En: ['Senior AQA Python Developer', 'Senior Automation QA Python Engineer',
      'Senior Python Automation Tester']
  },
  aqajava: {
    Ru: ['Старший AQA Java разработчик / Senior AQA Java Developer',
      'Старший Automation QA Java инженер / Senior Automation QA Java Engineer',
      'Старший Java Automation тестировщик / Senior Java Automation Tester'],
    En: ['Senior AQA Java Developer', 'Senior Automation QA Java Engineer',
      'Senior Java Automation Tester']
  },
  manualqa: {
    Ru: ['Старший Manual QA инженер / Senior Manual QA Engineer',
      'Старший QA инженер / Senior QA Engineer', 'Старший тестировщик / Senior QA Tester'],
    En: ['Senior Manual QA Engineer', 'Senior QA Engineer', 'Senior QA Tester']
  },
  frontend: {
    Ru: ['Старший фронтенд разработчик / Senior Frontend Developer',
      'Старший React разработчик / Senior React Developer',
      'Старший Fullstack разработчик / Senior Fullstack Developer'],
    En: ['Senior Frontend Developer', 'Senior React Developer', 'Senior Fullstack Developer']
  },
  fullstack: {
    Ru: ['Старший Fullstack разработчик / Senior Fullstack Developer',
      'Старший Backend разработчик / Senior Backend Developer',
      'Старший Frontend разработчик / Senior Frontend Developer'],
    En: ['Senior Fullstack Developer', 'Senior Backend Developer', 'Senior Frontend Developer']
  }
}

const ALIASES: Record<string, string> = {
  golang: 'go', qaautomationpython: 'aqapython', automationqapython: 'aqapython',
  qaautomationjava: 'aqajava', automationqajava: 'aqajava', manual: 'manualqa',
  qa: 'manualqa', front: 'frontend', fullstackdeveloper: 'fullstack'
}

export function normalizeStack(value: unknown): string {
  const key = String(value ?? '').trim().toLowerCase().replace(/[^a-zа-я0-9]+/gi, '')
  return ALIASES[key] ?? key
}

export function titlesForStack(stack: string, market: ProfileFillerMarket): string[] {
  const normalized = normalizeStack(stack)
  const titles = TITLE_MAP[normalized]?.[market]
  if (!titles?.length) {
    throw profileFillerError('profile_stack_unknown',
      `No HH resume title mapping for stack "${stack}" and market ${market}.`, 'resolve_stack')
  }
  return [...titles]
}

export const STACK_TITLE_MAP = TITLE_MAP
