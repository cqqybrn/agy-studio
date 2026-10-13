/**
 * Install bundled global Antigravity rule (破甲) → ~/.gemini/config/AGENTS.md
 * Called from root postinstall and manually via npm run setup-global-rules.
 */
import { ensureGlobalRules } from '../backend/src/integrations/agy/global-rules.js';

const r = await ensureGlobalRules();
if (r.updated) {
  console.log(`[agy-studio] global rule installed → ${r.path}`);
} else if (r.ok) {
  console.log(`[agy-studio] global rule up to date → ${r.path}`);
} else {
  console.warn(`[agy-studio] global rule skipped: ${r.error ?? r.warning ?? 'unknown'}`);
  process.exitCode = 1;
}
