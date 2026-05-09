import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    verify: 'src/verify.ts',
    mcp: 'src/mcp.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  outDir: 'dist',
  splitting: false,
  treeshake: true,
});
