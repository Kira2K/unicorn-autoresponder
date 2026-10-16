export type ClientMessageConfig = {
  instructionsUrl: string;
  hhInstructionsUrl: string;
  cabinetUrl: string;
  cabinetPassword: string;
  supportTag: string;
};

/** Validate injected settings; this pure module reads neither ENV nor SQL. */
export function readClientMessageConfig(input: Readonly<Partial<Record<keyof ClientMessageConfig, unknown>>>): ClientMessageConfig {
  const value = (key: keyof ClientMessageConfig) => {
    const text = typeof input[key] === 'string' ? input[key].trim() : '';
    if (!text) throw new Error("client_message_configuration_required:" + key);
    return text;
  };
  const url = (key: keyof ClientMessageConfig) => {
    const text = value(key);
    let parsed: URL;
    try { parsed = new URL(text); } catch { throw new Error("client_message_configuration_invalid:" + key); }
    if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || /\s/.test(text))
      throw new Error("client_message_configuration_invalid:" + key);
    return text;
  };
  const supportTag = value("supportTag");
  if (!/^@[A-Za-z0-9_]{5,32}$/.test(supportTag))
    throw new Error("client_message_configuration_invalid:supportTag");
  return {
    instructionsUrl: url("instructionsUrl"),
    hhInstructionsUrl: url("hhInstructionsUrl"),
    cabinetUrl: url("cabinetUrl"),
    cabinetPassword: value("cabinetPassword"),
    supportTag,
  };
}
