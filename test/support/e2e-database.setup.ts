// Runs in every e2e worker before any suite (jest `setupFiles`), so every
// suite connects to the e2e database and never to the stack's `fiapx`, whose
// outbox the running relay would publish. The global setup applies the same
// rule first, so a refused name stops the run before any suite starts.

import { applyE2eDatabaseName } from './e2e-database-name';

applyE2eDatabaseName();
