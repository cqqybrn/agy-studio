import { setupSettings } from "./setup-settings.js";
import { ensureGlobalRules } from "../src/ensureGlobalRules.js";

setupSettings();
const gr = ensureGlobalRules();
if (gr.ok) console.log(`[antigravity-gemini] global rule → ${gr.path}${gr.updated ? " (updated)" : ""}`);
else console.warn(`[antigravity-gemini] global rule install skipped: ${gr.error}`);
