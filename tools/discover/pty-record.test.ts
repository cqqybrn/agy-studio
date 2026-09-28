import { describe, it, expect } from 'vitest';
import { stripAnsi, sanitizeTerminalOutput } from './pty-record.js';

describe('pty-record 控制台录制处理与脱敏安全测试', () => {
  it('stripAnsi 能彻底剥离色彩和光标控制字符', () => {
    // 带 ANSI 样式的文本
    const colored = '\u001b[32m✔ Success\u001b[0m: \u001b[1;34mTask completed\u001b[0m\r\n\u001b[2K\u001b[1GThinking...';
    const clean = stripAnsi(colored);
    expect(clean).toBe('✔ Success: Task completed\r\nThinking...');
  });

  it('sanitizeTerminalOutput 能精准脱敏敏感信息', () => {
    const raw = `
User email: developer.john@example.com
OAuth URL: https://accounts.google.com/o/oauth2/auth?client_id=123&code=4/0AbCdEf123456789&state=xyz
API Token: token=ya29.a0AfH6SM...
Headers: Authorization: Bearer ya29.auth_token_here
`;
    const sanitized = sanitizeTerminalOutput(raw);

    // 验证敏感数据已被占位符替换
    expect(sanitized).not.toContain('developer.john@example.com');
    expect(sanitized).toContain('<REDACTED_EMAIL>');

    expect(sanitized).not.toContain('4/0AbCdEf123456789');
    expect(sanitized).toContain('code=<REDACTED_CODE>');

    expect(sanitized).not.toContain('ya29.a0AfH6SM...');
    expect(sanitized).toContain('token=<REDACTED_TOKEN>');

    expect(sanitized).not.toContain('ya29.auth_token_here');
    expect(sanitized).toContain('Bearer <REDACTED_BEARER>');
  });
});
