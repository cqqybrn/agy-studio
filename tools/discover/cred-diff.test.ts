import { describe, it, expect } from 'vitest';
import { parseCmdkeyOutput, diffCredentials } from './cred-diff.js';

describe('cred-diff Windows 凭据管理器探测安全解析', () => {
  it('能精准解析中文版 cmdkey /list 输出中的 Target 名称', () => {
    const sampleZh = `
目前保存的凭据:

    目标: MicrosoftAccount:target=SSO_POP_Device
    类型: 普通 
    用户: 02udcgkagxnkufqr
    仅为此登录会话

    目标: LegacyGeneric:target=gemini:antigravity
    类型: 普通 
    用户: antigravity
    本地计算机暂留

    目标: LegacyGeneric:target=git:https://github.com
    类型: 普通 
    用户: cqqybrn
    本地计算机暂留
`;
    const targets = parseCmdkeyOutput(sampleZh);
    expect(targets).toEqual([
      'LegacyGeneric:target=gemini:antigravity',
      'LegacyGeneric:target=git:https://github.com',
      'MicrosoftAccount:target=SSO_POP_Device',
    ]);
  });

  it('能精准解析英文版 cmdkey /list 输出中的 Target 名称', () => {
    const sampleEn = `
Currently stored credentials:

    Target: WindowsLive:target=virtualapp/didlogical
    Type: Generic
    User: 02udcgkagxnkufqr

    Target: LegacyGeneric:target=gemini:antigravity
    Type: Generic
    User: antigravity
`;
    const targets = parseCmdkeyOutput(sampleEn);
    expect(targets).toEqual([
      'LegacyGeneric:target=gemini:antigravity',
      'WindowsLive:target=virtualapp/didlogical',
    ]);
  });

  it('安全红线保证：绝对不包含密码或内容数据', () => {
    const sample = `
    目标: LegacyGeneric:target=gemini:antigravity
    密码: secret-token-123456
    Token: bearer-token-abcdef
`;
    const targets = parseCmdkeyOutput(sample);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toBe('LegacyGeneric:target=gemini:antigravity');
    const serialized = JSON.stringify(targets);
    expect(serialized).not.toContain('secret-token-123456');
    expect(serialized).not.toContain('bearer-token-abcdef');
  });

  it('diffCredentials 能正确对比新增和移除凭据条目', () => {
    const before = [
      'MicrosoftAccount:target=SSO_POP_Device',
      'LegacyGeneric:target=git:https://github.com',
    ];

    const after = [
      'MicrosoftAccount:target=SSO_POP_Device',
      'LegacyGeneric:target=gemini:antigravity', // 新增
    ];

    const diff = diffCredentials(before, after);

    expect(diff.added).toEqual(['LegacyGeneric:target=gemini:antigravity']);
    expect(diff.removed).toEqual(['LegacyGeneric:target=git:https://github.com']);
    expect(diff.persisted).toEqual(['MicrosoftAccount:target=SSO_POP_Device']);
    expect(diff.summary.addedCount).toBe(1);
    expect(diff.summary.removedCount).toBe(1);
  });
});
