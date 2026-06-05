# Dolphin Profile Audit

Audits NocoDB client/profile bindings against existing Dolphin browser profiles.

Inputs:

- NocoDB `clients`
- NocoDB `dolphin_profiles`
- Existing Dolphin helpers via `noco/integrations/dolphin.ts`

Outputs:

- Reports expected/missing/conflicting profile bindings.
- Apply mode only creates or patches safe NocoDB profile bindings and adds safe binding tags in Dolphin.

Safety:

- Does not create Dolphin browser profiles.
- Does not delete or rename Dolphin profiles.
- External Dolphin calls are wrappers over existing project code.
