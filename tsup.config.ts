import { defineConfig, Options } from "tsup";

const commonConfig: Options = {
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "esnext",
  bundle: true,
  splitting: true,
  treeshake: true,
  external: ["pino", "ulidx", "@msgpack/msgpack", "@stateforward/yamux.ts"],
  platform: 'node',
  outExtension() {
    return {
      js: ".mjs",
    };
  },
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
