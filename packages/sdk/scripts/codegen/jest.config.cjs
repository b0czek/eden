module.exports = {
  rootDir: "../..",
  roots: ["<rootDir>/scripts/codegen"],
  testEnvironment: "node",
  testMatch: ["**/*.test.ts"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      { tsconfig: "<rootDir>/scripts/codegen/tsconfig.test.json" },
    ],
  },
};
