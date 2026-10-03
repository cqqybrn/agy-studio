import { describe, expect, it, beforeEach } from 'vitest';
import {
  extractOAuthCandidatesFromText,
  findAgyBinaryPath,
  OAuthClientManager,
} from '../../src/integrations/agy/oauth-client.js';

describe('OAuth Client Scanner & Manager', () => {
  const sampleClientId1 = '1234567890-abcdefghij.apps.googleusercontent.com';
  const sampleClientId2 = '9876543210-zyxwvutsrq.apps.googleusercontent.com';
  const sampleSecret1 = 'GOCSPX-1111111111111111111111111111'; // 35 chars
  const sampleSecret2 = 'GOCSPX-2222222222222222222222222222'; // 35 chars

  const dummyBinaryText = `
    \x00\x01Some binary noise\xFF\xFE
    client_id: ${sampleClientId1}
    noise in between
    secret1: ${sampleSecret1}
    more binary \x00 noise
    another_client: ${sampleClientId2}
    secret2: ${sampleSecret2}
    duplicate secret: ${sampleSecret1}
    end of binary
  `;

  describe('extractOAuthCandidatesFromText', () => {
    it('extracts all client_ids and client_secrets preserving order of first appearance', () => {
      const candidates = extractOAuthCandidatesFromText(dummyBinaryText, sampleClientId1);
      expect(candidates).not.toBeNull();
      expect(candidates?.clientId).toBe(sampleClientId1);
      expect(candidates?.clientSecrets).toEqual([sampleSecret1, sampleSecret2]);
    });

    it('selects client_id matching provided aud', () => {
      const candidates = extractOAuthCandidatesFromText(dummyBinaryText, sampleClientId2);
      expect(candidates).not.toBeNull();
      expect(candidates?.clientId).toBe(sampleClientId2);
    });

    it('returns null when aud does not match any discovered client_id', () => {
      const candidates = extractOAuthCandidatesFromText(
        dummyBinaryText,
        'nonexistent-aud.apps.googleusercontent.com',
      );
      expect(candidates).toBeNull();
    });

    it('automatically selects single client_id when only one is present and aud is omitted', () => {
      const textSingle = `client: ${sampleClientId1} and secret: ${sampleSecret1}`;
      const candidates = extractOAuthCandidatesFromText(textSingle);
      expect(candidates).not.toBeNull();
      expect(candidates?.clientId).toBe(sampleClientId1);
    });

    it('returns null if multiple client_ids are present and aud is omitted', () => {
      const candidates = extractOAuthCandidatesFromText(dummyBinaryText);
      expect(candidates).toBeNull();
    });

    it('returns null if no client_ids or secrets are found', () => {
      expect(extractOAuthCandidatesFromText('no secrets here')).toBeNull();
      expect(extractOAuthCandidatesFromText(`only id: ${sampleClientId1}`)).toBeNull();
      expect(extractOAuthCandidatesFromText(`only secret: ${sampleSecret1}`)).toBeNull();
    });
  });

  describe('OAuthClientManager', () => {
    let manager: OAuthClientManager;

    beforeEach(() => {
      manager = new OAuthClientManager({
        binaryPath: '/fake/bin/agy',
        readBinary: () => dummyBinaryText,
      });
    });

    it('returns first secret candidate on initial request', () => {
      const creds = manager.getClientCredentials(sampleClientId1);
      expect(creds).toEqual({
        clientId: sampleClientId1,
        clientSecret: sampleSecret1,
      });
    });

    it('advances to next secret candidate when previous secret is marked invalid (401)', () => {
      const creds1 = manager.getClientCredentials(sampleClientId1);
      expect(creds1?.clientSecret).toBe(sampleSecret1);

      // 401 invalid_client occurs
      manager.markSecretInvalid(sampleClientId1, sampleSecret1);

      // Next candidate is tried
      const creds2 = manager.getClientCredentials(sampleClientId1);
      expect(creds2?.clientSecret).toBe(sampleSecret2);
    });

    it('returns null when all candidate secrets are exhausted', () => {
      manager.markSecretInvalid(sampleClientId1, sampleSecret1);
      manager.markSecretInvalid(sampleClientId1, sampleSecret2);

      const creds = manager.getClientCredentials(sampleClientId1);
      expect(creds).toBeNull();
    });

    it('remembers successful secret in memory and reuses it directly', () => {
      manager.rememberSuccess(sampleClientId1, sampleSecret2);

      const creds = manager.getClientCredentials(sampleClientId1);
      expect(creds).toEqual({
        clientId: sampleClientId1,
        clientSecret: sampleSecret2,
      });
    });

    it('returns null safely if binary reader throws or file does not exist', () => {
      const failingManager = new OAuthClientManager({
        binaryPath: '/non/existent/path/agy.exe',
        readBinary: () => {
          throw new Error('ENOENT: no such file or directory');
        },
      });

      const creds = failingManager.getClientCredentials(sampleClientId1);
      expect(creds).toBeNull();
    });

    it('clears in-memory caches upon clear()', () => {
      manager.rememberSuccess(sampleClientId1, sampleSecret2);
      manager.clear();

      // After clearing, returns first candidate again
      const creds = manager.getClientCredentials(sampleClientId1);
      expect(creds?.clientSecret).toBe(sampleSecret1);
    });
  });

  describe('findAgyBinaryPath', () => {
    it('returns explicit path if provided and exists', () => {
      // Use existing file like package.json
      const result = findAgyBinaryPath(undefined, 'package.json');
      expect(result).toContain('package.json');
    });

    it('returns null if explicit path does not exist', () => {
      const result = findAgyBinaryPath(undefined, '/non/existent/agy_bin_9999.exe');
      expect(result).toBeNull();
    });
  });
});
