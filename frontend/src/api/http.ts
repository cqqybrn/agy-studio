import type { ApiEndpoints, EndpointKey, EndpointResponse, ErrorCode } from '@agy-studio/contracts';

export const TOKEN_STORAGE_KEY = 'agy-studio-token';

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    options?: {
      retryable?: boolean;
      status?: number;
      details?: Record<string, unknown>;
    },
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = options?.status ?? 0;
    this.retryable = options?.retryable ?? false;
    this.details = options?.details;
  }
}

type ExtractParams<Path extends string> = Path extends `${string}:${infer Param}/${infer Rest}`
  ? Param | ExtractParams<`/${Rest}`>
  : Path extends `${string}:${infer Param}`
    ? Param
    : never;

type PathParams<K extends EndpointKey> = K extends `${string} ${infer Path}`
  ? [ExtractParams<Path>] extends [never]
    ? { params?: never }
    : { params: Record<ExtractParams<Path>, string | number> }
  : { params?: never };

type QueryParams<K extends EndpointKey> = ApiEndpoints[K] extends { query: infer Q }
  ? [keyof Q] extends [never]
    ? { query?: never }
    : { query?: Q }
  : { query?: never };

type BodyParams<K extends EndpointKey> = ApiEndpoints[K] extends { body: infer B }
  ? { body: B }
  : { body?: never };

export type RequestOptions<K extends EndpointKey> = PathParams<K> &
  QueryParams<K> &
  BodyParams<K> & {
    headers?: Record<string, string>;
    signal?: AbortSignal;
  };

export function buildUrl(
  pathTemplate: string,
  params?: Record<string, string | number>,
  query?: Record<string, unknown>,
): string {
  let url = pathTemplate.replace(/:([a-zA-Z0-9_]+)/g, (_match, key) => {
    if (params && key in params && params[key] !== undefined && params[key] !== null) {
      return encodeURIComponent(String(params[key]));
    }
    throw new Error(`Missing path parameter: ${key}`);
  });

  if (query) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        if (Array.isArray(value)) {
          for (const item of value) {
            if (item !== undefined && item !== null) {
              searchParams.append(key, String(item));
            }
          }
        } else {
          searchParams.append(key, String(value));
        }
      }
    }
    const queryString = searchParams.toString();
    if (queryString) {
      url += (url.includes('?') ? '&' : '?') + queryString;
    }
  }

  return url;
}

export function getAuthToken(): string | null {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      return window.localStorage.getItem(TOKEN_STORAGE_KEY);
    } catch {
      return null;
    }
  }
  return null;
}

export async function request<K extends EndpointKey>(
  key: K,
  ...args: [RequestOptions<K>] | (RequestOptions<K> extends { params?: never; query?: never; body?: never } ? [RequestOptions<K>?] : [RequestOptions<K>])
): Promise<EndpointResponse<K>> {
  const options = (args[0] ?? {}) as RequestOptions<K>;
  const [method, pathTemplate] = key.split(' ') as [string, string];

  const params = (options as { params?: Record<string, string | number> }).params;
  const query = (options as { query?: Record<string, unknown> }).query;
  const body = (options as { body?: unknown }).body;

  const url = buildUrl(pathTemplate, params, query);

  const headers: Record<string, string> = {
    ...(options.headers ?? {}),
  };

  const token = getAuthToken();
  if (token && !headers['Authorization'] && !headers['authorization']) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let requestBody: BodyInit | undefined;
  if (body !== undefined && body !== null) {
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      requestBody = body;
    } else {
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
      }
      requestBody = JSON.stringify(body);
    }
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: requestBody,
      signal: options.signal,
    });
  } catch (err: unknown) {
    if (err instanceof ApiError) {
      throw err;
    }
    throw new ApiError('INTERNAL', 'Network error', {
      retryable: true,
      status: 0,
    });
  }

  if (!response.ok) {
    let errorCode: ErrorCode = 'INTERNAL';
    let errorMessage = `HTTP Error ${response.status}: ${response.statusText}`;
    let retryable = false;
    let details: Record<string, unknown> | undefined;

    try {
      const errorJson = await response.json();
      if (errorJson && typeof errorJson === 'object' && 'error' in errorJson) {
        const errorBody = errorJson.error;
        if (errorBody && typeof errorBody === 'object') {
          if (errorBody.code) errorCode = errorBody.code;
          if (errorBody.message) errorMessage = errorBody.message;
          if (typeof errorBody.retryable === 'boolean') retryable = errorBody.retryable;
          if (errorBody.details) details = errorBody.details;
        }
      }
    } catch {
      // response body was not JSON or failed parsing
    }

    throw new ApiError(errorCode, errorMessage, {
      status: response.status,
      retryable,
      details,
    });
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return (await response.json()) as EndpointResponse<K>;
  }

  // If response is a Blob (e.g. GET /api/.../raw)
  if (
    contentType.startsWith('image/') ||
    contentType.startsWith('video/') ||
    contentType.startsWith('audio/') ||
    contentType.startsWith('application/octet-stream') ||
    contentType.startsWith('application/pdf') ||
    key.endsWith('/raw')
  ) {
    return (await response.blob()) as unknown as EndpointResponse<K>;
  }

  try {
    const text = await response.text();
    if (!text) {
      return {} as EndpointResponse<K>;
    }
    try {
      return JSON.parse(text) as EndpointResponse<K>;
    } catch {
      return text as unknown as EndpointResponse<K>;
    }
  } catch {
    return {} as EndpointResponse<K>;
  }
}
