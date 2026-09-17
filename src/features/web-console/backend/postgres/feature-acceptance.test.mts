import { test } from 'node:test';
import { combinedFixture } from './combined-fixture.mts';
import { featureAcceptance } from './feature-acceptance.mts';
test('shared SQL acceptance scenario passes against artificial fixtures before remote use', async () => {
  const f = combinedFixture(); await featureAcceptance(f.db, f.grant, 21);
});
