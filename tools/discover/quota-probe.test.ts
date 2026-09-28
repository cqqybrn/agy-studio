import { describe, it, expect } from 'vitest';
import {
  Redactor,
  redactByPattern,
  placeholderForKey,
  parseCredentialBlob,
  extractOauthClientFromText,
  describeShape,
} from './quota-probe.js';

const FAKE_CLIENT_ID = '111111-abcdefghijklmnop.apps.googleusercontent.com';
const OTHER_CLIENT_ID = '222222-qrstuvwxyz.apps.googleusercontent.com';
const FAKE_SECRET = 'GOCSPX-' + 'a'.repeat(28);
const OTHER_SECRET = 'GOCSPX-' + 'b'.repeat(28);

describe('quota-probe 脱敏与解析', () => {
  it('redactByPattern 替换 token、client 标识、JWT、邮箱与长数字 id', () => {
    const input = [
      'ya29.a0AfB_byC-xyz',
      '1//0gABCDEFGHIJKLMNOP',
      FAKE_SECRET,
      FAKE_CLIENT_ID,
      'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJlLXNpZw',
      'someone.name@gmail.com',
      '123456789012345678901',
    ].join(' ');
    const out = redactByPattern(input);
    expect(out).not.toMatch(/ya29\.|1\/\/0g|GOCSPX|apps\.googleusercontent\.com|eyJhbGci|someone\.name|123456789012345678901/);
    expect(out).toContain('<redacted:email>@gmail.com');
  });

  it('redactByPattern 保留额度数值与时间戳', () => {
    const input = '{"remainingFraction":0.88930523456789012,"resetTime":"2026-09-27T12:37:07Z","bucketId":"gemini-5h"}';
    expect(redactByPattern(input)).toBe(input);
  });

  it('placeholderForKey 按字段名脱敏且不误伤布尔字段', () => {
    expect(placeholderForKey('access_token', 'x')).toBe('<redacted:access_token>');
    expect(placeholderForKey('client_secret', 'x')).toBe('<redacted:client_secret>');
    expect(placeholderForKey('cloudaicompanionProject', 'my-proj-123')).toBe('<redacted:project>');
    expect(placeholderForKey('userDefinedCloudaicompanionProject', true)).toBeUndefined();
    expect(placeholderForKey('email', 'a.b@example.org')).toBe('<redacted:email>@example.org');
    expect(placeholderForKey('email_verified', true)).toBeUndefined();
    expect(placeholderForKey('bucketId', 'gemini-weekly')).toBeUndefined();
  });

  it('Redactor 替换已知值并能检测残留', () => {
    const r = new Redactor();
    r.addEmail('torres.test@corp.example');
    r.add('proj-secret-42', '<redacted:project>');
    const out = r.redactValue({ note: 'user torres.test / proj-secret-42', nested: [{ project: 'proj-secret-42' }] });
    const s = JSON.stringify(out);
    expect(s).not.toContain('torres.test');
    expect(s).not.toContain('proj-secret-42');
    expect(r.findLeaks(s)).toEqual([]);
    expect(r.findLeaks('leaked torres.test here')).not.toEqual([]);
  });

  it('parseCredentialBlob 解析 agy 凭据 JSON 结构', () => {
    const blob = Buffer.from(
      JSON.stringify({
        token: { access_token: 'a', token_type: 'Bearer', refresh_token: 'r', expiry: '2026-09-29T03:00:00.0000000+08:00' },
        auth_method: 'consumer',
        id_token: 'x.y.z',
      }),
      'utf-8',
    );
    const c = parseCredentialBlob(blob);
    expect(c?.refreshToken).toBe('r');
    expect(c?.schemaKeys).toEqual(['auth_method', 'id_token', 'token']);
    expect(parseCredentialBlob(Buffer.from('not json'))).toBeNull();
  });

  it('extractOauthClientFromText 按 id_token.aud 选 client_id，secret 按首次出现顺序列出', () => {
    const text = `${OTHER_CLIENT_ID} ${OTHER_SECRET} ${FAKE_CLIENT_ID} ${FAKE_SECRET} ${OTHER_SECRET}`;
    const c = extractOauthClientFromText(text, FAKE_CLIENT_ID);
    expect(c?.clientId).toBe(FAKE_CLIENT_ID);
    expect(c?.clientSecrets).toEqual([OTHER_SECRET, FAKE_SECRET]);
    expect(c?.diagnostics).toEqual({
      clientIdCandidates: 2,
      clientSecretCandidates: 2,
      clientIdSelection: 'id_token-aud',
    });
  });

  it('extractOauthClientFromText 多个候选且无法对上 aud 时返回 null', () => {
    const text = `${OTHER_CLIENT_ID} ${FAKE_CLIENT_ID} ${FAKE_SECRET}`;
    expect(extractOauthClientFromText(text, null)).toBeNull();
    expect(extractOauthClientFromText(text, 'unknown.apps.googleusercontent.com')).toBeNull();
    expect(extractOauthClientFromText(`${FAKE_CLIENT_ID} ${FAKE_SECRET}`)?.diagnostics.clientIdSelection).toBe('single-candidate');
    expect(extractOauthClientFromText('nothing')).toBeNull();
  });

  it('describeShape 只保留字段名与类型', () => {
    expect(describeShape({ a: 1, b: [{ c: 'x' }], d: null })).toEqual({ a: 'number', b: [{ c: 'string' }], d: 'null' });
  });
});
