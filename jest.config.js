export default {
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  collectCoverageFrom: ["src/**/*.{js,jsx}", "!src/index.js"],
  moduleNameMapper: {
    "^#application/(.*)$": "<rootDir>/src/application/$1",
    "^#domain/(.*)$": "<rootDir>/src/domain/$1",
    "^#infrastructure/(.*)$": "<rootDir>/src/infrastructure/$1",
    "^#interfaces/(.*)$": "<rootDir>/src/interfaces/$1",
    "^#application$": "<rootDir>/src/application",
    "^#domain$": "<rootDir>/src/domain",
    "^#infrastructure$": "<rootDir>/src/infrastructure",
    "^#interfaces$": "<rootDir>/src/interfaces",
  },
};

