// Registers the test users once per run and saves their signed-in state (sign-ups are rate limited per address).
import { test as setup } from '@playwright/test';
import { authFile, expect, USERS, type UserName } from './fixtures.ts';

for (const name of Object.keys(USERS) as UserName[]) {
  setup(`register ${name}`, async ({ request }) => {
    const response = await request.post('/api/auth/register', { data: USERS[name] });
    expect(response.status(), await response.text()).toBe(201);
    await request.storageState({ path: authFile(name) });
  });
}
