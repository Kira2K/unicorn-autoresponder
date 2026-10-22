import assert from 'node:assert/strict';
import { test } from 'node:test';
import { workflowFixture } from './workflow-fixture.mts';
import { tableIds } from './tables.mts';

for (const mode of ['legacy', 'sql'] as const) {
  for (const [platformId, platform] of [[130, 'phone_ru'], [11, 'hh_ru'], [10, 'hh_en']] as const) {
    test(`${mode}: ${platform} preserves international phone codes on create and update`, async () => {
      const f = workflowFixture(), repo = f[mode];
      f.set(tableIds.platforms, platformId, { name: platform });
      const credentials = platform === 'phone_ru' ? {} : { login: 'test@example.invalid', password: 'test-password' };
      await repo.createPlatformAccount(7, { platformId, platform, phone: '+85620123456', ...credentials });
      const created = [...f.rows.get(tableIds.accounts)!.values()].find(a => a.account_label === platform)!;
      assert.equal(created.phone, '+85620123456');
      for (const phone of ['+15551234567', '+447700900123', '+375291234567', '+995555123456', '+79990000000']) {
        await repo.updatePlatformAccount(7, Number(created.Id), { phone, ...credentials });
        assert.equal(f.rows.get(tableIds.accounts)!.get(String(created.Id))!.phone, phone);
      }
    });
  }

  test(`${mode}: phone_ru is selectable and stores its phone in the existing account field`, async () => {
    const f = workflowFixture(), repo = f[mode];
    f.set(tableIds.platforms, 130, { name: 'phone_ru' });
    assert.ok((await repo.listPlatforms()).some(p => p.id === 130 && p.label === 'phone_ru'));
    await assert.rejects(repo.createPlatformAccount(7, { platformId: 130, platform: 'phone_ru', phone: '' }),
      { code: 'platform_account_required_fields_missing' });
    assert.equal(f.count(), 0);
    await repo.createPlatformAccount(7, { platformId: 130, platform: 'phone_ru', phone: '+79990000000' });
    const created = [...f.rows.get(tableIds.accounts)!.values()].find(a => a.account_label === 'phone_ru')!;
    assert.ok(created);
    assert.equal(created.platforms_id, 130);
    assert.equal(created.phone, '+79990000000');
    assert.equal(Object.hasOwn(created, 'phone_ru'), false);
    await repo.updatePlatformAccount(7, Number(created.Id), { phone: '+79990000001' });
    assert.equal(f.rows.get(tableIds.accounts)!.get(String(created.Id))!.phone, '+79990000001');
    await assert.rejects(repo.updatePlatformAccount(7, Number(created.Id), { phone: '+79990000001', password: 'unused' }),
      { code: 'platform_account_fields_not_allowed' });
    assert.equal(f.count(), 2);
  });
}
