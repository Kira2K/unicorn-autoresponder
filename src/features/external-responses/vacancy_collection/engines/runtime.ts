import { getQuickJS, shouldInterruptAfterDeadline } from 'quickjs-emscripten'
import { validateEngineInput, validateEngineResult } from './schema.ts'
import type { EngineInput, EngineResult, EngineRuntimeOptions } from './types.ts'

const MAX_CODE_BYTES = 256 * 1024
const MAX_INPUT_BYTES = 2 * 1024 * 1024

function options(value: EngineRuntimeOptions) {
  if (!Number.isInteger(value.timeoutMs) || value.timeoutMs < 1 || value.timeoutMs > 15_000) throw Error('engine_invalid_timeout')
  if (!Number.isInteger(value.memoryLimitBytes) || value.memoryLimitBytes < 1024 * 1024 || value.memoryLimitBytes > 128 * 1024 * 1024) throw Error('engine_invalid_memory_limit')
}

/**
 * Evaluate generated collection logic in QuickJS. The guest receives only a
 * copied, frozen JSON snapshot and returns JSON; no host functions are exposed.
 */
export async function evaluateEngine(code: string, input: EngineInput, limits: EngineRuntimeOptions): Promise<EngineResult> {
  options(limits)
  if (typeof code !== 'string' || !code.trim()) throw Error('engine_code_required')
  if (Buffer.byteLength(code) > MAX_CODE_BYTES) throw Error('engine_code_too_large')
  const safeInput = validateEngineInput(input)
  const inputJson = JSON.stringify(safeInput)
  if (Buffer.byteLength(inputJson) > MAX_INPUT_BYTES) throw Error('engine_input_too_large')
  const literal = JSON.stringify(inputJson)
  const program = `(() => {
    "use strict";
    const process=undefined, require=undefined, fetch=undefined, XMLHttpRequest=undefined,
      WebSocket=undefined, Deno=undefined, Bun=undefined, console=undefined;
    const freeze=value=>{
      if(value && typeof value==="object" && !Object.isFrozen(value)){
        Object.freeze(value);
        for(const key of Object.keys(value)) freeze(value[key]);
      }
      return value;
    };
    const input=freeze(JSON.parse(${literal}));
    ${code}
    const hasPlan=typeof plan==="function", hasParse=typeof parse==="function";
    if(hasPlan===hasParse) throw new Error("engine_must_define_exactly_one_of_plan_or_parse");
    const kind=hasPlan ? "plan" : "parse";
    const value=(hasPlan ? plan : parse)(input);
    if(value && typeof value.then==="function") throw new Error("engine_async_result_forbidden");
    return JSON.stringify({kind,value});
  })()`
  const QuickJS = await getQuickJS()
  let dumped: unknown
  try {
    dumped = QuickJS.evalCode(program, {
      shouldInterrupt: shouldInterruptAfterDeadline(Date.now() + limits.timeoutMs),
      memoryLimitBytes: limits.memoryLimitBytes
    })
  } catch (cause) {
    const guest = cause && typeof cause === 'object' ? cause as { name?: unknown; message?: unknown } : undefined
    const message = cause instanceof Error ? cause.message : typeof guest?.message === 'string' ? `${String(guest.name ?? 'Error')}: ${guest.message}` : String(cause)
    if (/interrupted/i.test(message)) throw Error('engine_timeout', { cause })
    if (/memory|allocation|out of memory/i.test(message)) throw Error('engine_memory_limit', { cause })
    throw Error(`engine_execution_failed:${message}`, { cause })
  }
  if (typeof dumped !== 'string') throw Error('engine_result_not_json_string')
  let parsed: unknown
  try { parsed = JSON.parse(dumped) } catch (cause) { throw Error('engine_result_invalid_json', { cause }) }
  return validateEngineResult(parsed)
}
