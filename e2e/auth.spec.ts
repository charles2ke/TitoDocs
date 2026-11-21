import { authFile, expect, snap, test, USERS } from './fixtures.ts';

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('sends visitors to sign in and lets them create an account', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    await page.getByRole('link', { name: 'Create an account' }).click();
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
    await page.getByLabel('Username').fill(`nia${Date.now().toString(36)}`);
    await page.getByLabel('Display name').fill('Nia Newcomer');
    await page.getByLabel('Password').fill('a-long-password');
    await snap(page, 'auth-register');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByRole('heading', { name: 'Start something new' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Account: Nia Newcomer' })).toBeVisible();
    await expect(page.getByText('Nothing here yet')).toBeVisible();
    await snap(page, 'home-empty');
  });

  test('rejects a wrong password, then signs in and out', async ({ page }) => {
    const victor = USERS.victor;
    await page.goto('/login');
    await page.getByLabel('Username').fill(victor.username);
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toHaveText('Incorrect username or password.');
    await snap(page, 'auth-wrong-password');

    await page.getByLabel('Password').fill(victor.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    const account = page.getByRole('button', { name: `Account: ${victor.displayName}` });
    await expect(account).toBeVisible();

    await account.click();
    await page.getByTestId('sign-out').click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('returns to the requested file after signing in', async ({ page, playwright, baseURL }) => {
    const owner = await playwright.request.newContext({ baseURL, storageState: authFile('maria') });
    const response = await owner.post('/api/files', { data: { type: 'doc', title: 'Deep link' } });
    const { file } = await response.json();
    await owner.dispose();

    await page.goto(`/d/${file.id}`);
    await expect(page).toHaveURL(`/login?next=${encodeURIComponent(`/d/${file.id}`)}`);
    await page.getByLabel('Username').fill(USERS.maria.username);
    await page.getByLabel('Password').fill(USERS.maria.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(`/d/${file.id}`);
    await expect(page.getByRole('textbox', { name: 'File name' })).toHaveValue('Deep link');
  });
});
