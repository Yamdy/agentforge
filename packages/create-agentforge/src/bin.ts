#!/usr/bin/env node

import { run } from './index.js';

run(process.argv.slice(2)).catch((err: unknown) => {
  console.error('Failed to scaffold project:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
