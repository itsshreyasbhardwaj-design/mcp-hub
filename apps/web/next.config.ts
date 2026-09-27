import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript-compiled ESM; Next transpiles them so
  // a change in a package is picked up without a separate publish step.
  transpilePackages: ['@mcp-hub/ui'],
  // Native and WASM dependencies must stay outside the bundler.
  serverExternalPackages: ['@electric-sql/pglite', 'pg'],
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default config;
