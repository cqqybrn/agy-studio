import type { QuotaSnapshot } from '@agy-studio/contracts';

export interface QuotaProbePort {
  /**
   * Run `/usage` (and optionally `/credits`) in pseudo-terminal and parse into QuotaSnapshot.
   */
  probe(
    accountName: string | null,
    env?: Record<string, string | undefined>,
  ): Promise<QuotaSnapshot>;
}
