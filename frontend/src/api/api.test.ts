import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildUrl, request, TOKEN_STORAGE_KEY } from './http';
import {
  createSession,
  deleteWorkspace,
  getHealth,
  getSessionEvents,
  uploadAttachments,
} from './endpoints';

// In Node/Vitest default environment (node), provide localStorage mock
const createLocalStorageMock = () => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
};

const mockLocalStorage = createLocalStorageMock();
vi.stubGlobal('localStorage', mockLocalStorage);

if (typeof window === 'undefined') {
  vi.stubGlobal('window', {
    localStorage: mockLocalStorage,
  });
}

describe('http.ts - URL Building and Parameter Handling', () => {
  it('replaces single path parameter correctly', () => {
    const url = buildUrl('/api/sessions/:sessionId', { sessionId: 'sess-123' });
    expect(url).toBe('/api/sessions/sess-123');
  });

  it('replaces multiple path parameters and encodes them', () => {
    const url = buildUrl('/api/sessions/:sessionId/subagents/:conversationId/transcript', {
      sessionId: 'sess 123',
      conversationId: 'conv/456',
    });
    expect(url).toBe('/api/sessions/sess%20123/subagents/conv%2F456/transcript');
  });

  it('throws error if required path parameter is missing', () => {
    expect(() => {
      buildUrl('/api/sessions/:sessionId', {});
    }).toThrow('Missing path parameter: sessionId');
  });

  it('encodes query parameters correctly including arrays and skips null/undefined', () => {
    const url = buildUrl(
      '/api/sessions',
      undefined,
      {
        workspaceId: 'ws-1',
        cursor: undefined,
        limit: 20,
        tags: ['alpha', 'beta'],
      },
    );
    expect(url).toBe('/api/sessions?workspaceId=ws-1&limit=20&tags=alpha&tags=beta');
  });

  it('combines path parameters and query parameters', () => {
    const url = buildUrl(
      '/api/sessions/:sessionId/events',
      { sessionId: 's1' },
      { afterSeq: 10, limit: 50 },
    );
    expect(url).toBe('/api/sessions/s1/events?afterSeq=10&limit=50');
  });
});

describe('http.ts - request() function', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('attaches Bearer token from localStorage when available', async () => {
    mockLocalStorage.setItem(TOKEN_STORAGE_KEY, 'test-jwt-token');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ ok: true, version: '1.0' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await request('GET /api/health');
    expect(res).toEqual({ ok: true, version: '1.0' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe('/api/health');
    expect(calledInit.headers['Authorization']).toBe('Bearer test-jwt-token');
  });

  it('does not overwrite explicitly passed Authorization header', async () => {
    mockLocalStorage.setItem(TOKEN_STORAGE_KEY, 'storage-token');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await request('GET /api/health', {
      headers: { Authorization: 'Bearer custom-token' },
    });

    const [, calledInit] = fetchMock.mock.calls[0];
    expect(calledInit.headers['Authorization']).toBe('Bearer custom-token');
  });

  it('sets Content-Type: application/json and stringifies JSON body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ id: 'ws-new', name: 'my-ws', path: '/path' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await request('POST /api/workspaces', {
      body: { name: 'my-ws', path: '/path' },
    });

    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe('/api/workspaces');
    expect(calledInit.method).toBe('POST');
    expect(calledInit.headers['Content-Type']).toBe('application/json');
    expect(calledInit.body).toBe(JSON.stringify({ name: 'my-ws', path: '/path' }));
  });

  it('does not set Content-Type header when body is FormData', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ attachments: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const formData = new FormData();
    formData.append('workspaceId', 'ws-123');

    await request('POST /api/attachments', {
      body: formData,
    });

    const [, calledInit] = fetchMock.mock.calls[0];
    expect(calledInit.body).toBe(formData);
    expect(calledInit.headers['Content-Type']).toBeUndefined();
  });

  it('throws structured ApiError on non-2xx with error response body', async () => {
    const errorBody = {
      error: {
        code: 'SESSION_BUSY',
        message: 'The session is currently running',
        retryable: true,
        details: { activeRunId: 'run-99' },
      },
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => errorBody,
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      request('DELETE /api/sessions/:sessionId', {
        params: { sessionId: 'sess-1' },
      }),
    ).rejects.toMatchObject({
      name: 'ApiError',
      code: 'SESSION_BUSY',
      message: 'The session is currently running',
      retryable: true,
      status: 409,
      details: { activeRunId: 'run-99' },
    });
  });

  it('handles non-2xx without JSON body with fallback ApiError', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      headers: new Headers({ 'content-type': 'text/plain' }),
      json: async () => {
        throw new Error('Not JSON');
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    // ★ B-1: 502/503/504 等非 JSON 响应默认标记为 retryable: true
    await expect(request('GET /api/health')).rejects.toMatchObject({
      name: 'ApiError',
      code: 'INTERNAL',
      message: 'HTTP Error 502: Bad Gateway',
      retryable: true,
      status: 502,
    });
  });

  it('throws ApiError with INTERNAL and retryable=true on network failure', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(request('GET /api/health')).rejects.toMatchObject({
      name: 'ApiError',
      code: 'INTERNAL',
      message: 'Network error',
      retryable: true,
      status: 0,
    });
  });

  it('returns Blob when requesting raw endpoints', async () => {
    const dummyBlob = new Blob(['raw-data'], { type: 'application/octet-stream' });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/octet-stream' }),
      blob: async () => dummyBlob,
    });
    vi.stubGlobal('fetch', fetchMock);

    const blob = await request('GET /api/attachments/:attachmentId/raw', {
      params: { attachmentId: 'att-1' },
    });
    expect(blob).toBe(dummyBlob);
  });
});

describe('endpoints.ts - Typed Endpoint Functions', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    vi.restoreAllMocks();
  });

  it('getHealth calls GET /api/health', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await getHealth();
    expect(res).toEqual({ ok: true });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/health');
  });

  it('deleteWorkspace correctly passes params', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await deleteWorkspace('ws-xyz');
    expect(res).toEqual({ ok: true });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/workspaces/ws-xyz');
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
  });

  it('createSession sends POST with JSON body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ id: 'sess-1', title: 'New chat' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await createSession({
      workspaceId: 'ws-1',
      title: 'New chat',
    });
    expect(res).toEqual({ id: 'sess-1', title: 'New chat' });
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    expect(fetchMock.mock.calls[0][1].body).toBe(
      JSON.stringify({ workspaceId: 'ws-1', title: 'New chat' }),
    );
  });

  it('getSessionEvents encodes query parameters', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ items: [], latestSeq: 0, hasMore: false }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await getSessionEvents('sess-2', { afterSeq: 5, limit: 10 });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/sessions/sess-2/events?afterSeq=5&limit=10');
  });
});

describe('endpoints.ts - uploadAttachments via XMLHttpRequest', () => {
  let mockXHR: any;
  const originalXHR = (global as any).XMLHttpRequest;

  beforeEach(() => {
    mockLocalStorage.clear();
    mockXHR = {
      open: vi.fn(),
      send: vi.fn(),
      setRequestHeader: vi.fn(),
      upload: {},
      status: 200,
      responseText: JSON.stringify({ attachments: [{ id: 'att-1' }] }),
      onload: null,
      onerror: null,
      ontimeout: null,
      onabort: null,
    };

    function MockXMLHttpRequest() {
      return mockXHR;
    }
    (global as any).XMLHttpRequest = MockXMLHttpRequest;
  });

  afterEach(() => {
    (global as any).XMLHttpRequest = originalXHR;
  });

  it('uploads files, handles token and reports progress', async () => {
    mockLocalStorage.setItem(TOKEN_STORAGE_KEY, 'uploader-token');
    const file = new File(['content'], 'test.txt', { type: 'text/plain' });
    const progressSpy = vi.fn();

    const promise = uploadAttachments([file], 'ws-1', 'sess-1', progressSpy);

    expect(mockXHR.open).toHaveBeenCalledWith('POST', '/api/attachments');
    expect(mockXHR.setRequestHeader).toHaveBeenCalledWith(
      'Authorization',
      'Bearer uploader-token',
    );

    mockXHR.upload.onprogress({
      lengthComputable: true,
      loaded: 50,
      total: 100,
    });
    expect(progressSpy).toHaveBeenCalledWith(50);

    mockXHR.status = 200;
    mockXHR.onload();

    const result = await promise;
    expect(result).toEqual({ attachments: [{ id: 'att-1' }] });
    expect(progressSpy).toHaveBeenCalledWith(100);
  });

  it('rejects with ApiError when XMLHttpRequest fails with non-2xx', async () => {
    const file = new File(['bad'], 'bad.exe', { type: 'application/octet-stream' });
    const promise = uploadAttachments([file], 'ws-1');

    mockXHR.status = 415;
    mockXHR.responseText = JSON.stringify({
      error: {
        code: 'ATTACHMENT_TYPE_REJECTED',
        message: 'File type not allowed',
        retryable: false,
      },
    });

    mockXHR.onload();

    await expect(promise).rejects.toMatchObject({
      name: 'ApiError',
      code: 'ATTACHMENT_TYPE_REJECTED',
      message: 'File type not allowed',
      status: 415,
      retryable: false,
    });
  });

  it('rejects with network error on xhr.onerror', async () => {
    const file = new File(['content'], 'test.txt');
    const promise = uploadAttachments([file], 'ws-1');

    mockXHR.onerror();

    await expect(promise).rejects.toMatchObject({
      name: 'ApiError',
      code: 'INTERNAL',
      message: 'Network error',
      status: 0,
      retryable: true,
    });
  });
});
