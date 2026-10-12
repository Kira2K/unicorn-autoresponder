/** Live workflows that may hand off a verification challenge need a writable command channel. */
export function assertInteractiveHandoff(live: boolean, close: boolean, stdinIsTTY: boolean | undefined): void {
  if (live && !close && stdinIsTTY !== true) throw Error('interactive_verification_channel_required')
}
