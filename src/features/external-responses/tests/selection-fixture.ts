import { createHash } from 'node:crypto'
import type { SelectionRules } from '../stack_classification/rules.ts'
import type { StackDecision } from '../stack_classification/index.ts'
import type { Position } from '../types.ts'

const text = 'Use fixture evidence to test persistence, not semantic model accuracy.'
export const selectionRules: SelectionRules = { version: 1, source: 'fixture:selection', text, sha256: createHash('sha256').update(text).digest('hex') }
export const assessGlobal = async (position: Position): Promise<StackDecision> => ({ decision: 'eligible', reasons: ['Fixture global pass'], evidence: [position.description] })
