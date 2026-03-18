import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  outfile: 'lib/index.cjs',
  format: 'cjs',
  platform: 'node',
  external: [
    'koishi',
    '@aws-sdk/client-s3',
    '@aws-sdk/lib-storage',
    'axios',
    'github-markdown-css'
  ],
});
