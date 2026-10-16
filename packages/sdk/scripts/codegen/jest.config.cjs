module.exports = {
  rootDir: "../..",
  roots: ["<rootDir>/scripts/codegen"],
  testEnvironment: "node",
  testMatch: ["**/*.test.ts"],
  transformIgnorePatterns: ["/node_modules/(?!\\.pnpm/|effect/)"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      { tsconfig: "<rootDir>/scripts/codegen/tsconfig.test.json" },
    ],
    "[/\\\\]node_modules[/\\\\]effect[/\\\\].+\\.js$":
      "<rootDir>/scripts/jest-effect-transform.cjs",
  },
};
