import { z } from 'zod';

export const BinaryConfigSchema = z.object({
  candidates: z.array(z.string()).min(1),
});

export const ImageInputConfigSchema = z.object({
  supported: z.boolean(),
  template: z.union([z.string(), z.record(z.string(), z.unknown())]).nullable(),
});

export const PermissionEventConfigSchema = z.object({
  match: z.record(z.string(), z.unknown()),
  replyTemplate: z.union([z.string(), z.record(z.string(), z.unknown())]),
});

export const StreamConfigSchema = z.object({
  userFrameTemplate: z.union([z.string(), z.record(z.string(), z.unknown())]),
  multiTurnStdin: z.boolean(),
  eventTypeMap: z.record(z.string(), z.string()),
  permissionEvent: PermissionEventConfigSchema.nullable(),
  imageInput: ImageInputConfigSchema,
});

export const SettingsFileSchema = z.object({
  scope: z.enum(['user', 'workspace', 'global']),
  pathTemplate: z.string(),
});

export const AlwaysProceedConfigSchema = z.object({
  jsonPath: z.string(),
  value: z.unknown(),
});

export const StatuslineSettingsConfigSchema = z.object({
  jsonPath: z.string(),
});

export const SettingsConfigSchema = z.object({
  files: z.array(SettingsFileSchema).min(1),
  alwaysProceed: AlwaysProceedConfigSchema,
  statusline: StatuslineSettingsConfigSchema,
});

export const ArtifactRuleSchema = z.object({
  kind: z.enum(['task', 'implementation_plan', 'walkthrough', 'markdown', 'image', 'recording', 'other']),
  glob: z.string(),
  mimeType: z.string().optional(),
});

export const PathsConfigSchema = z.object({
  dataRoots: z.array(z.string()).min(1),
  conversationDirPattern: z.string(),
  transcriptRelPath: z.string(),
  artifactRules: z.array(ArtifactRuleSchema),
});

export const CredentialsConfigSchema = z.object({
  preferredIsolation: z.enum(['isolated_home', 'credential_snapshot']),
  homeEnvVars: z.array(z.string()).min(1),
  wincredTargetPatterns: z.array(z.string()),
  credentialFiles: z.array(z.string()),
});

export const LoginConfigSchema = z.object({
  argv: z.array(z.string()).min(1),
  authUrlPattern: z.string(),
  successPatterns: z.array(z.string()).min(1),
  failurePatterns: z.array(z.string()),
});

export const QuotaConfigSchema = z.object({
  statuslineInHeadless: z.boolean(),
  usageCommand: z.string(),
  creditsCommand: z.string().nullable().optional(),
  usageParser: z.string(),
});

export const CatalogConfigSchema = z.object({
  versionArgv: z.array(z.string()).min(1),
  modelsArgv: z.array(z.string()).min(1),
  modelsParser: z.string(),
  modes: z.array(z.string()),
});

export const AgyProfileSchema = z.object({
  agyVersion: z.string(),
  discoveredAt: z.string(),
  binary: BinaryConfigSchema,
  stream: StreamConfigSchema,
  paths: PathsConfigSchema,
  settings: SettingsConfigSchema,
  credentials: CredentialsConfigSchema,
  login: LoginConfigSchema,
  quota: QuotaConfigSchema,
  catalog: CatalogConfigSchema,
});

export type AgyProfile = z.infer<typeof AgyProfileSchema>;
export type BinaryConfig = z.infer<typeof BinaryConfigSchema>;
export type StreamConfig = z.infer<typeof StreamConfigSchema>;
export type PathsConfig = z.infer<typeof PathsConfigSchema>;
export type SettingsConfig = z.infer<typeof SettingsConfigSchema>;
export type CredentialsConfig = z.infer<typeof CredentialsConfigSchema>;
export type LoginConfig = z.infer<typeof LoginConfigSchema>;
export type QuotaConfig = z.infer<typeof QuotaConfigSchema>;
export type CatalogConfig = z.infer<typeof CatalogConfigSchema>;
