import type { FastifyPluginAsync } from 'fastify';
import type {
  Capabilities,
  FeatureFlag,
  Health,
  WhoAmI,
} from '@agy-studio/contracts';
import type { ModelCatalogPort } from '../../services/ports/model-catalog.port.js';
import type { AgyProfile } from '../../integrations/agy/profile/schema.js';
import { findAgyBinary } from '../../integrations/agy/catalog.js';
import { getDefaultProfile } from '../../integrations/agy/settings.js';
import type { AccountsRepository } from '../../repositories/accounts.js';
import { AppError } from '../../utils/errors.js';

export interface SystemRoutesOptions {
  catalogPort: ModelCatalogPort;
  profile?: AgyProfile;
  accountsRepo?: AccountsRepository;
  supervisor?: { activeRuns(): Array<unknown> } | { getActiveRunsCount?(): number };
  startTime?: number;
  version?: string;
  binFinder?: (profile: AgyProfile, explicitBin?: string) => string | null;
}

/**
 * Derives feature flags for Capabilities based on agy profile configuration.
 */
export function deriveCapabilitiesFeatures(profile: AgyProfile): Record<FeatureFlag, boolean> {
  const eventTypeMap = profile.stream?.eventTypeMap ?? {};
  const hasThinking =
    'thinking' in eventTypeMap || Object.values(eventTypeMap).includes('thinking');
  const isIsolatedHome = profile.credentials?.preferredIsolation === 'isolated_home';

  return {
    mainThinkingStream: Boolean(hasThinking),
    multiTurnStdin: Boolean(profile.stream?.multiTurnStdin),
    nativeImageInput: Boolean(profile.stream?.imageInput?.supported),
    permissionEvents: Boolean(profile.stream?.permissionEvent),
    statuslineQuota: Boolean(profile.quota?.statuslineInHeadless),
    cliUsageProbe: Boolean(profile.quota?.usageCommand),
    credits: Boolean(profile.quota?.creditsCommand),
    isolatedHomes: isIsolatedHome,
    concurrentAccounts: isIsolatedHome,
  };
}

export const systemRoutes: FastifyPluginAsync<SystemRoutesOptions> = async (app, options) => {
  const { catalogPort, accountsRepo, supervisor } = options;
  const profile = options.profile ?? getDefaultProfile();
  const startTime = options.startTime ?? Date.now();
  const version = options.version ?? '0.1.0';
  const binFinder = options.binFinder ?? findAgyBinary;

  app.setErrorHandler((error, _request, reply) => {
    const appError = AppError.from(error);
    reply.status(appError.status).send(appError.toApiErrorResponse());
  });

  // GET /api/health
  app.get('/api/health', async (_request, reply) => {
    try {
      const defaultAccount = accountsRepo?.findDefault() ?? null;
      const currentAccountName = defaultAccount?.name ?? null;

      let activeRuns = 0;
      if (supervisor) {
        if ('activeRuns' in supervisor && typeof supervisor.activeRuns === 'function') {
          activeRuns = supervisor.activeRuns().length;
        } else if ('getActiveRunsCount' in supervisor && typeof supervisor.getActiveRunsCount === 'function') {
          activeRuns = supervisor.getActiveRunsCount();
        }
      }

      const uptimeSeconds = Math.max(0, Math.floor((Date.now() - startTime) / 1000));

      const whoami: WhoAmI & { name: string | null } = {
        activeProfile: currentAccountName,
        email: defaultAccount?.email ?? null,
        accountType: defaultAccount?.type ?? null,
        isolation: defaultAccount?.isolation ?? null,
        credentialPresent: Boolean(defaultAccount),
        name: currentAccountName,
      };

      const health: Health = {
        ok: true,
        version,
        uptimeSeconds,
        activeRuns,
        account: whoami as WhoAmI,
      };

      return reply.status(200).send(health);
    } catch (err) {
      const appError = AppError.from(err);
      return reply.status(appError.status).send(appError.toApiErrorResponse());
    }
  });

  // GET /api/capabilities
  app.get('/api/capabilities', async (_request, reply) => {
    try {
      let agyPath: string | null = null;
      let agyVersion: string | null = null;

      try {
        agyPath = binFinder(profile);
        if (agyPath) {
          agyVersion = await catalogPort.getVersion(agyPath);
        }
      } catch {
        agyPath = null;
        agyVersion = null;
      }

      const capabilities: Capabilities = {
        agyPath,
        agyVersion,
        profileAgyVersion: profile.agyVersion ?? null,
        autoApprove: true,
        modes: profile.catalog?.modes ?? [],
        features: deriveCapabilitiesFeatures(profile),
      };

      return reply.status(200).send(capabilities);
    } catch {
      // capabilities must NEVER return 500 when agy is missing/fails
      const capabilities: Capabilities = {
        agyPath: null,
        agyVersion: null,
        profileAgyVersion: profile.agyVersion ?? null,
        autoApprove: true,
        modes: profile.catalog?.modes ?? [],
        features: deriveCapabilitiesFeatures(profile),
      };
      return reply.status(200).send(capabilities);
    }
  });
};
