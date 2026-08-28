export async function stopAdminConnectionRun(runId) {
  const response = await fetch(`/api/admin/linkedin/connection-runs/${encodeURIComponent(runId)}/stop`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.message || body.error || `Request failed: ${response.status}`)
  return body
}
