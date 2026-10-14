import type { ApiErrorResponse, EndpointContracts } from "./api-types.js";
export type { BestProxyInput, BestProxyResponse, RequiredLocation, OwnProxyInput } from "./api-types.js";

export class ProxyApiError extends Error {
  status: number;
  detail: ApiErrorResponse["detail"];
  constructor(status: number, detail: ApiErrorResponse["detail"]) {
    super(detail.message);
    this.status = status;
    this.detail = detail;
  }
}

/** baseUrl: /api through a frontend dev/server proxy; direct URL only server-side.
 * Pass location.region/city catalogue codes verbatim; never normalize or slugify them.
 */
export async function callProxyApi<P extends keyof EndpointContracts>(
  baseUrl: string,
  path: P,
  body: EndpointContracts[P]["request"],
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<EndpointContracts[P]["response"]> {
  const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const data = await response.json();
  if (!response.ok) throw new ProxyApiError(response.status, data.detail);
  return data;
}
