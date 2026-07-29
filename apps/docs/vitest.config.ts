import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.test.ts"],
    // Extend the defaults rather than replace them: `include` walks the whole
    // package, and bare directory names would stop matching as soon as a build
    // artefact appeared one level down.
    exclude: [...configDefaults.exclude, "**/.next/**", "**/.open-next/**"],
  },
});
