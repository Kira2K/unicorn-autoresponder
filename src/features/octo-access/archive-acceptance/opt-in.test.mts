import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareOwner, verifyOnOwner } from './owner.mts';
test('all live entrypoints refuse missing opt-in before files, network or desktop access', async () => {
  await assert.rejects(prepareOwner('must-not-be-created.json', {}), { code: 'archive_owner_opt_in_required' });
  await assert.rejects(verifyOnOwner({ requestPath: 'missing', preflightPath: 'missing' }, {}),
    { code: 'archive_owner_opt_in_required' });
});
