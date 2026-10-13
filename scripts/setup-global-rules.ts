/**
 * Install bundled global Antigravity rule (破甲) → ~/.gemini/config/AGENTS.md
 * Called from root postinstall and manually via npm run setup-global-rules.
 */
import { ensureGlobalRules } from '../backend/src/integrations/agy/global-rules.js';

const r = await ensureGlobalRules();
if (r.updated) {
  console.log(`[antigravity-gemini] global rule installed → ${r.path}`);
} else if (r.ok) {
  console.log(`[antigravity-gemini] global rule up to date → ${r.path}`);
} else {
  const detail = r.error ?? r.warning ?? 'unknown';
  console.warn(`[antigravity-gemini] global rule skipped: ${detail}`);
  // Missing bundled file = broken clone; fail so CI/postinstall catches it.
  // Write/permission errors: warn only so npm install still completes.
  if (r.error?.startsWith('missing bundled global rule')) {
    process.exitCode = 1;
  }
}
