export const EMAIL = process.env.E2E_EMAIL ?? 'owner@example.com';
export const PASSWORD = process.env.E2E_PASSWORD ?? 'change-me-please-123';
export const unique = (prefix: string) => `${prefix} ${Date.now().toString(36)}`;
