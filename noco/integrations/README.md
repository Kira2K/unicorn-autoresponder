# Noco Integrations

Thin adapters from Noco jobs to existing project services.

- `dolphin.ts` imports existing Dolphin helpers and exposes Noco-friendly names.
- `google-sheets.ts` imports existing Google Sheets helpers and exposes read helpers.

These files must not reimplement external APIs, auth, HTTP clients, or credentials.

