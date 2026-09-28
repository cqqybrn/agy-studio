export interface BackoffOptions {
  jitter?: boolean;
}

export function nextDelay(
  attempt: number,
  baseMs: number,
  maxMs: number,
  options?: BackoffOptions,
): number {
  if (attempt < 0) {
    attempt = 0;
  }
  // Exponential backoff: baseMs * 2^attempt
  const exponential = baseMs * Math.pow(2, attempt);
  const capped = Math.min(maxMs, exponential);

  const applyJitter = options?.jitter ?? true;
  if (!applyJitter) {
    return Math.round(capped);
  }

  // Full jitter: random between 0 and capped delay
  const jittered = Math.random() * capped;
  return Math.round(jittered);
}
