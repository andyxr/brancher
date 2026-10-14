/**
 * Builds a sample repository with a realistic branching story, for trying
 * Brancher without a repo of your own: `npm run demo [target-dir]`.
 */
import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { FixtureRepo } from '../test/fixtureRepo.ts';

const dir = path.resolve(process.argv[2] ?? path.join(homedir(), '.brancher', 'demo-repo'));
await rm(dir, { recursive: true, force: true });
const r = await FixtureRepo.create(dir);
// Start ~120 days ago so open branches look current.
r.time = Math.floor(Date.now() / 1000) - 120 * 86400;

await r.commit('Initial commit');
await r.commit('Add README');

await r.branch('develop');
await r.commit('Set up CI');

await r.branch('feature/auth');
await r.commit('Login form');
r.tick(20);
await r.commit('Session handling');
await r.branch('feature/auth-oauth');
r.tick(10);
await r.commit('OAuth provider');
await r.commit('OAuth callback');
await r.checkout('feature/auth');
r.tick(30);
await r.commit('Password reset');
await r.merge('feature/auth-oauth');
await r.checkout('develop');
r.tick(5);
await r.merge('feature/auth');
await r.deleteBranch('feature/auth-oauth');

await r.branch('feature/search');
r.tick(48);
await r.commit('Search index');
await r.commit('Search UI');
await r.checkout('develop');
await r.branch('spike/graphql');
r.tick(12);
await r.commit('Try GraphQL');
await r.checkout('develop');
r.tick(24);
await r.merge('feature/search');
await r.deleteBranch('feature/search');

await r.checkout('main');
r.tick(6);
await r.merge('develop');
await r.branch('hotfix/crash');
await r.commit('Fix crash on startup');
await r.checkout('main');
await r.merge('hotfix/crash');
await r.deleteBranch('hotfix/crash');

await r.checkout('develop');
await r.merge('main');
r.tick(24 * 20);
await r.branch('feature/payments');
for (const m of ['Stripe client', 'Checkout flow', 'Webhooks']) {
  r.tick(30);
  await r.commit(m);
}
await r.branch('feature/payments-refunds');
r.tick(12);
await r.commit('Refund API');
await r.checkout('feature/payments');
r.tick(10);
await r.commit('Receipts');
await r.checkout('develop');
r.tick(48);
await r.merge('feature/payments');
await r.checkout('main');
r.tick(10);
await r.merge('develop');

await r.checkout('develop');
r.tick(24 * 10);
await r.branch('feature/dark-mode');
await r.commit('Dark theme tokens');
r.tick(24);
await r.commit('Theme switcher');
await r.checkout('main');

console.log(`Demo repository written to:\n  ${dir}`);
