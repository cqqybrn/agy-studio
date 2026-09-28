#!/usr/bin/env node
import process from 'node:process';
import { executeFakeAgy } from './src/runner.js';

const abortController = new AbortController();

const handleSignal = () => {
  abortController.abort();
  process.exit(0);
};

process.on('SIGINT', handleSignal);
process.on('SIGTERM', handleSignal);

try {
  const code = await executeFakeAgy(process.argv.slice(2), {}, undefined, abortController.signal);
  process.exit(code);
} catch (err) {
  console.error('[fake-agy] Error:', err);
  process.exit(1);
}
