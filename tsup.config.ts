import { defineConfig, Options } from "tsup";

const commonConfig: Options = {
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  target: "esnext",
  bundle: true,
  splitting: true,
  treeshake: true,
  external: ["pino", "ulidx", "@msgpack/msgpack", "yamux-js", "stream", "pino-pretty", "pino-caller"],
  platform: 'node',
};

export default defineConfig([
  {
    ...commonConfig,
    clean: true,
    dts: true,
    minify: false,
    outDir: "dist",
  },
  {
    ...commonConfig,
    clean: false,
    dts: false,
    minify: true,
    outDir: "dist",
    outExtension({ format }) {
      return {
        js: format === 'esm' ? '.min.mjs' : '.min.js',
      }
    },
  },
]);
