import type { QuotaBucket, QuotaGroup } from '@agy-studio/contracts';

export interface ParsedStatusline {
  email: string | null;
  planTier: string | null;
  groups: QuotaGroup[];
  buckets?: QuotaBucket[];
  contextUsage?: {
    usedTokens: number;
    maxTokens: number;
  } | null;
}

export interface StatuslineParserPort {
  /**
   * Parse statusline raw JSON into structured quota & account information.
   */
  parse(rawJson: unknown): ParsedStatusline;
}
