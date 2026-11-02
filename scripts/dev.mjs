#!/usr/bin/env node
/**
 * `npm run dev` — local development with hot reload, in one command.
 *
 * 1. Checks Node.js and Docker.
 * 2. Creates .env with local settings and fresh secrets (only if it does not exist yet).
 * 3. Starts PostgreSQL, Redis, MinIO and Mailpit in Docker (docker-compose.dev.yml).
 * 4. Installs dependencies (pnpm via corepack), builds shared packages, migrates and seeds.
 * 5. Runs the API, worker and web app with hot reload until you press Ctrl+C.
 *
 * Uses only Node built-ins so it works before anything is installed.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const COMPOSE = ['compose', '-f', 'docker-compose.dev.yml'];
const env = { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0', FORCE_COLOR: '1' };

function fail(message) {
  console.error(`\n\x1b[31m✖ ${message}\x1b[0m\n`);
  process.exit(1);
}

/** Runs a setup step to completion, streaming its output. Exits on failure. */
function step(label, command, args, hint) {
  console.log(`\n\x1b[36m▸ ${label}\x1b[0m`);
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit', shell: isWindows });
  if (result.status !== 0) fail(`${label} failed.${hint ? `\n  ${hint}` : ''}`);
}

// ── 1. Prerequisites ──────────────────────────────────────────────────────────
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 9)) {
  fail(`Node.js 22.9 or newer is required (you have ${process.versions.node}). Install it from https://nodejs.org`);
}
if (spawnSync('docker', ['info'], { stdio: 'ignore', shell: isWindows }).status !== 0) {
  fail('Docker is not running. Start Docker Desktop (or the Docker service) and run `npm run dev` again.');
}

// ── 2. .env ───────────────────────────────────────────────────────────────────
const envPath = path.join(root, '.env');
if (!existsSync(envPath)) {
  writeFileSync(
    envPath,
    `# Created by \`npm run dev\` for local development. Never commit this file.
APP_URL=http://localhost:3000
API_PUBLIC_URL=http://localhost:4000
NEXT_PUBLIC_API_URL=http://localhost:4000
COOKIE_SECURE=false
DATABASE_URL=postgresql://cfe:cfe@localhost:5432/cfe?schema=public
REDIS_URL=redis://localhost:6379/0
JWT_SECRET=${randomBytes(32).toString('base64')}
ENCRYPTION_KEY=${randomBytes(32).toString('base64')}
MINIO_ENDPOINT=http://localhost:9000
MINIO_PUBLIC_ENDPOINT=http://localhost:9000
MINIO_ACCESS_KEY=cfe-app
MINIO_SECRET_KEY=cfe-app-dev-password
MINIO_REGION=us-east-1
SHOPIFY_CLIENT_ID=not-configured-locally
SHOPIFY_CLIENT_SECRET=not-configured-locally
PRINTFUL_WEBHOOK_SECRET=${randomBytes(24).toString('hex')}
SMTP_URL=smtp://localhost:1025
MAIL_FROM="Cash Flow Engine <downloads@example.com>"
SEED_ORG_NAME="Cash Flow Engine"
SEED_ADMIN_EMAIL=owner@example.com
SEED_ADMIN_PASSWORD=local-password-123
`,
  );
  console.log('\x1b[36m▸ Created .env with local settings\x1b[0m');
}
const settings = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).replace(/^"|"$/g, '')]),
);

// ── 3–4. Dependencies, install, build, database ───────────────────────────────
const dockerHint = 'See the Docker message above. Common causes: a port already in use (5432, 6379, 9000, 9001, 1025, 8025) or no internet access to download images.';
step('Starting PostgreSQL, Redis, MinIO and Mailpit (first run builds MinIO, ~3 min)', 'docker', [...COMPOSE, 'up', '-d', '--wait', 'postgres', 'redis', 'minio', 'mailpit'], dockerHint);
step('Preparing storage buckets', 'docker', [...COMPOSE, 'run', '--rm', 'minio-init']);
step('Installing dependencies', 'corepack', ['pnpm', 'install', '--frozen-lockfile']);
step('Building shared packages', 'corepack', ['pnpm', '--filter', './packages/**', 'run', 'build']);
step('Applying database migrations', 'corepack', ['pnpm', 'db:deploy']);
step('Seeding the owner account', 'corepack', ['pnpm', 'db:seed']);
step('Building the worker', 'corepack', ['pnpm', '--filter', '@cfe/worker', 'run', 'build']);
step('Registering scheduled jobs', 'corepack', ['pnpm', '--filter', '@cfe/worker', 'run', 'dev:scheduler']);

// ── 5. Long-running processes with prefixed output ────────────────────────────
const processes = [
  { name: 'api', color: 35, args: ['pnpm', '--filter', '@cfe/api', 'run', 'dev'] },
  { name: 'worker', color: 33, args: ['pnpm', '--filter', '@cfe/worker', 'run', 'dev'] },
  { name: 'worker-tsc', color: 90, args: ['pnpm', '--filter', '@cfe/worker', 'run', 'dev:build'] },
  { name: 'web', color: 32, args: ['pnpm', '--filter', '@cfe/web', 'run', 'dev'] },
];
const width = Math.max(...processes.map((p) => p.name.length));
const children = [];
let stopping = false;

function stopAll(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null) continue;
    if (isWindows) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        // already exited
      }
    }
  }
  console.log('\nStopped. Databases keep running in Docker for a fast restart; stop them with:');
  console.log('  docker compose -f docker-compose.dev.yml down');
  process.exit(code);
}

for (const p of processes) {
  const child = spawn('corepack', p.args, { cwd: root, env, shell: isWindows, detached: !isWindows });
  const prefix = `\x1b[${p.color}m${p.name.padEnd(width)} │\x1b[0m `;
  for (const stream of [child.stdout, child.stderr]) {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) process.stdout.write(prefix + line + '\n');
    });
  }
  child.on('exit', (code) => {
    if (stopping) return;
    console.error(`\n\x1b[31m✖ ${p.name} exited (code ${code}). Stopping everything.\x1b[0m`);
    stopAll(1);
  });
  children.push(child);
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

console.log(`
\x1b[1mCash Flow Engine is starting\x1b[0m
  App     http://localhost:3000   sign in: ${settings.SEED_ADMIN_EMAIL} / ${settings.SEED_ADMIN_PASSWORD}
  API     http://localhost:4000/health
  Inbox   http://localhost:8025   (download-link emails)
  Files   http://localhost:9001   (MinIO console: cfe-admin / cfe-admin-dev-password)
Press Ctrl+C to stop.
`);
