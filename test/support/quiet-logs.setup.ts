// Runs in every e2e worker before any suite (jest `setupFiles`). The apps the
// suites boot log through pino; keep the run quiet unless a caller asks for a
// level explicitly (design.md: `LOG_LEVEL=fatal` in the test bootstrap).
process.env.LOG_LEVEL ??= 'fatal';
