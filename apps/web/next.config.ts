import path from 'node:path';
import type { NextConfig } from 'next';

const apiUrl = process.env.API_INTERNAL_URL;
if (!apiUrl) throw new Error('API_INTERNAL_URL must be set (e.g. http://localhost:4000)');

/**
 * The browser only ever talks to this origin. /api/v1 and /health are proxied to the API,
 * so auth cookies stay first-party (SameSite=Strict). In production Caddy routes these
 * paths directly to the API with the same effect.
 */
const config: NextConfig = {
  output: 'standalone',
  // Trace files from the monorepo root so workspace packages are included in the standalone build.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  poweredByHeader: false,
  async rewrites() {
    return [
      { source: '/api/v1/:path*', destination: `${apiUrl}/api/v1/:path*` },
      { source: '/health', destination: `${apiUrl}/health` },
    ];
  },
};

export default config;
