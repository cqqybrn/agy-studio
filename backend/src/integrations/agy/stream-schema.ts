import { z } from 'zod';

/**
 * Token usage schema inside stream events.
 */
export const RawUsageSchema = z
  .object({
    input_tokens: z.number().optional().default(0),
    output_tokens: z.number().optional().default(0),
    thinking_tokens: z.number().optional().default(0),
    cache_read_tokens: z.number().optional().default(0),
    total_tokens: z.number().optional().default(0),
  })
  .passthrough();

export type RawUsage = z.infer<typeof RawUsageSchema>;

/**
 * Payload inside init event.
 */
export const RawInitDataSchema = z
  .object({
    cwd: z.string().optional(),
    tools: z.array(z.string()).optional(),
    permission_mode: z.string().optional(),
  })
  .passthrough();

export type RawInitData = z.infer<typeof RawInitDataSchema>;

/**
 * Top-level init event schema.
 */
export const RawInitEventSchema = z
  .object({
    event: z.string(),
    conversation_id: z.string().optional(),
    init: RawInitDataSchema.optional(),
  })
  .passthrough();

export type RawInitEvent = z.infer<typeof RawInitEventSchema>;

/**
 * Tool information inside step_update.
 */
export const RawToolInfoSchema = z
  .object({
    name: z.string().optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
    output: z.string().optional(),
  })
  .passthrough();

export type RawToolInfo = z.infer<typeof RawToolInfoSchema>;

/**
 * Individual subagent item inside subagent_info.
 */
export const RawSubagentItemSchema = z
  .object({
    type_name: z.string().optional(),
    role: z.string().optional(),
    initial_prompt: z.string().nullable().optional(),
    conversation_id: z.string().optional(),
    log_uri: z.string().optional(),
    workspace_uris: z.array(z.string()).optional(),
  })
  .passthrough();

export type RawSubagentItem = z.infer<typeof RawSubagentItemSchema>;

/**
 * Subagent info container.
 */
export const RawSubagentInfoSchema = z
  .object({
    subagents: z.array(RawSubagentItemSchema).optional().default([]),
  })
  .passthrough();

export type RawSubagentInfo = z.infer<typeof RawSubagentInfoSchema>;

/**
 * Step update body schema.
 */
export const RawStepUpdateBodySchema = z
  .object({
    conversation_id: z.string().optional(),
    step_index: z.number(),
    state: z.enum(['ACTIVE', 'DONE']),
    step_type: z.enum([
      'user_input',
      'agent_response',
      'tool',
      'subagent',
      'system_message',
      'error_message',
    ]),
    text_delta: z.string().optional(),
    /** error_message steps only; no recording yet, field names follow agy-auto. */
    content: z.unknown().optional(),
    error: z.unknown().optional(),
    duration_seconds: z.number().optional(),
    usage: RawUsageSchema.optional(),
    tool_name: z.string().optional(),
    tool_info: RawToolInfoSchema.optional(),
    subagent_info: RawSubagentInfoSchema.optional(),
  })
  .passthrough();

export type RawStepUpdateBody = z.infer<typeof RawStepUpdateBodySchema>;

/**
 * Top-level step_update event schema.
 */
export const RawStepUpdateEventSchema = z
  .object({
    event: z.string(),
    step_update: RawStepUpdateBodySchema,
  })
  .passthrough();

export type RawStepUpdateEvent = z.infer<typeof RawStepUpdateEventSchema>;

/**
 * Result event body schema.
 */
export const RawResultBodySchema = z
  .object({
    conversation_id: z.string().optional(),
    status: z.enum(['SUCCESS', 'ERROR']),
    response: z.string().optional(),
    duration_seconds: z.number().optional(),
    num_turns: z.number().optional(),
    usage: RawUsageSchema.optional(),
    error: z.string().optional(),
  })
  .passthrough();

export type RawResultBody = z.infer<typeof RawResultBodySchema>;

/**
 * Top-level result event schema.
 */
export const RawResultEventSchema = z
  .object({
    event: z.string(),
    result: RawResultBodySchema,
  })
  .passthrough();

export type RawResultEvent = z.infer<typeof RawResultEventSchema>;

/**
 * Permission request event schema (fallback/extensible).
 */
export const RawAskPermissionEventSchema = z
  .object({
    event: z.string(),
  })
  .passthrough();

export type RawAskPermissionEvent = z.infer<typeof RawAskPermissionEventSchema>;
