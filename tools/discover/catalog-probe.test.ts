import { describe, it, expect } from 'vitest';
import { parseVersionOutput, parseModelsOutput, parseModesFromHelp } from './catalog-probe.js';

describe('catalog-probe 版本、模型与执行模式解析测试', () => {
  it('parseVersionOutput 能正确提取版本号', () => {
    expect(parseVersionOutput('1.2.12\n')).toBe('1.2.12');
    expect(parseVersionOutput('agy version 2.0.1-beta.1 (built 2026-09-01)')).toBe('2.0.1-beta.1');
    expect(parseVersionOutput('unknown output')).toBeNull();
  });

  it('parseModelsOutput 准确解析真实输出格式并忽略 Fetching 提示', () => {
    const raw = `
Fetching available models...
gemini-3.8-flash-high\tGemini 3.8 Flash (High)
gemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)
claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)
gpt-oss-120b-medium\tGPT-OSS 120B (Medium)
`;
    const models = parseModelsOutput(raw);
    expect(models).toHaveLength(4);
    expect(models[0]).toEqual({
      id: 'gemini-3.8-flash-high',
      name: 'Gemini 3.8 Flash (High)',
    });
    expect(models[2]).toEqual({
      id: 'claude-sonnet-4-6',
      name: 'Claude Sonnet 4.6 (Thinking)',
    });
  });

  it('parseModesFromHelp 准确提取命令行可选模式', () => {
    const helpText = `
Usage of agy.exe:
  --log-file                      Override CLI log file path
  --mode                          Set the agent execution mode for this session (accept-edits, plan)
  --model                         Model for the current CLI session
`;
    const result = parseModesFromHelp(helpText);
    expect(result.modes).toEqual(['accept-edits', 'plan']);
    expect(result.rawText).toContain('Set the agent execution mode');
  });
});
