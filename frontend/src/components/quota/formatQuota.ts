import type { QuotaBucket, QuotaSnapshot, QuotaSource } from '@agy-studio/contracts';

/**
 * 计算快照中所有未 disabled 桶的最小 remainingFraction (0.0 - 1.0)
 * 若无有效桶或 source === 'unavailable'，返回 null
 */
export function getMinRemainingFraction(snapshot: QuotaSnapshot | null | undefined): number | null {
  if (!snapshot || snapshot.source === 'unavailable' || !snapshot.groups || snapshot.groups.length === 0) {
    return null;
  }

  const activeBuckets: QuotaBucket[] = [];
  for (const group of snapshot.groups) {
    if (group.buckets) {
      for (const bucket of group.buckets) {
        if (!bucket.disabled) {
          activeBuckets.push(bucket);
        }
      }
    }
  }

  if (activeBuckets.length === 0) {
    return null;
  }

  let min = Infinity;
  for (const bucket of activeBuckets) {
    const raw = bucket.remainingFraction;
    const norm = raw > 1 ? raw / 100 : Math.max(0, raw);
    if (norm < min) {
      min = norm;
    }
  }

  return min === Infinity ? null : min;
}

export type QuotaColorLevel = 'success' | 'warning' | 'error' | 'unavailable';

/**
 * 依据最小 fraction 计算颜色等级：
 * > 0.5: success (绿色)
 * 0.2 - 0.5: warning (黄色)
 * < 0.2: error (红色)
 * null: unavailable (灰色)
 */
export function getQuotaColorLevel(fraction: number | null): QuotaColorLevel {
  if (fraction === null) {
    return 'unavailable';
  }
  if (fraction > 0.5) {
    return 'success';
  }
  if (fraction >= 0.2) {
    return 'warning';
  }
  return 'error';
}

/**
 * 格式化重置倒计时：
 * 优先使用 resetInSeconds，否则依据 resetTime 计算秒数
 * 精确换算：
 * - "还剩 2 小时 15 分"
 * - "还剩 45 分钟"
 * - "还剩 2 天 3 小时"
 * - "还剩 30 秒"
 * - "已重置"
 */
export function formatResetCountdown(
  resetInSeconds: number | null | undefined,
  resetTime: string | null | undefined,
  nowMs: number = Date.now(),
): string {
  let seconds: number | null = null;

  if (typeof resetInSeconds === 'number') {
    seconds = resetInSeconds;
  } else if (resetTime) {
    const targetMs = new Date(resetTime).getTime();
    if (!isNaN(targetMs)) {
      seconds = Math.max(0, Math.floor((targetMs - nowMs) / 1000));
    }
  }

  if (seconds === null) {
    return '--';
  }

  if (seconds <= 0) {
    return '已重置';
  }

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSec = seconds % 60;

  if (days > 0) {
    return hours > 0 ? `还剩 ${days} 天 ${hours} 小时` : `还剩 ${days} 天`;
  }
  if (hours > 0) {
    return minutes > 0 ? `还剩 ${hours} 小时 ${minutes} 分` : `还剩 ${hours} 小时`;
  }
  if (minutes > 0) {
    return `还剩 ${minutes} 分钟`;
  }
  return `还剩 ${remainingSec} 秒`;
}

/**
 * 格式化额度数据来源
 */
export function formatQuotaSource(source: QuotaSource | string | null | undefined): string {
  switch (source) {
    case 'quota_api':
      return '额度接口';
    case 'statusline':
      return 'Statusline';
    case 'cli_probe':
      return 'CLI 探针';
    case 'unavailable':
      return '不可用';
    default:
      return source ? String(source) : '未知来源';
  }
}

/**
 * 格式化 ISO 时间字符串
 */
export function formatFetchedTime(isoString: string | null | undefined): string {
  if (!isoString) return '--';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  } catch {
    return isoString;
  }
}
