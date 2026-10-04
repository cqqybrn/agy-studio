import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export interface ModelEntry {
  id: string;
  name: string;
}

export interface CatalogProbeResult {
  timestamp: string;
  binaryPath: string;
  version: string | null;
  versionRaw: string;
  modelsCommand: string[];
  models: ModelEntry[];
  modelsRaw: string;
  modes: string[];
  modesRaw: string;
}

/**
 * 探测寻找可用的 agy 二进制路径
 */
export function findAgyBinary(overridePath?: string): string | null {
  if (overridePath && fs.existsSync(overridePath)) {
    return path.resolve(overridePath);
  }
  if (process.env.AGY_BIN && fs.existsSync(process.env.AGY_BIN)) {
    return path.resolve(process.env.AGY_BIN);
  }

  // Windows 默认安装位置
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    const candidate = path.join(localAppData, 'agy', 'bin', 'agy.exe');
    if (fs.existsSync(candidate)) return candidate;
  }

  // 尝试直接调用 PATH 中的 agy 或 agy.exe
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['agy'], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
    shell: true,
  });

  if (probe.status === 0 && probe.stdout) {
    const firstLine = probe.stdout.split(/\r?\n/)[0].trim();
    if (firstLine && fs.existsSync(firstLine)) {
      return path.resolve(firstLine);
    }
  }

  return 'agy'; // 降级为 PATH 中的别名
}

/**
 * 从 --version 输出中提取纯净的版本字符串
 */
export function parseVersionOutput(rawOutput: string): string | null {
  const match = rawOutput.match(/\b(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)\b/);
  return match ? match[1] : null;
}

/**
 * 从 agy models 命令输出中解析模型列表
 * 输出格式通常为:
 * gemini-3.8-flash-high\tGemini 3.8 Flash (High)
 * 或带 Fetching available models... 前缀
 */
export function parseModelsOutput(rawOutput: string): ModelEntry[] {
  const lines = rawOutput.split(/\r?\n/);
  const models: ModelEntry[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('Fetching') || trimmed.startsWith('Listing')) {
      continue;
    }

    // 按制表符或两个以上空格切分
    const parts = trimmed.split(/\t|\s{2,}/);
    if (parts.length >= 2) {
      const id = parts[0].trim();
      const name = parts.slice(1).join(' ').trim();
      if (id && name) {
        models.push({ id, name });
      }
    } else if (parts.length === 1 && parts[0].length > 0) {
      models.push({ id: parts[0], name: parts[0] });
    }
  }

  return models;
}

/**
 * 从 agy --help 输出中解析支持的 --mode 列表
 * 例如: --mode Set the agent execution mode for this session (accept-edits, plan)
 */
export function parseModesFromHelp(helpOutput: string): { modes: string[]; rawText: string } {
  const match = helpOutput.match(/--mode\s+(.+?)(?=\n\s*--|\n\n|$)/s);
  if (!match) {
    return { modes: [], rawText: '' };
  }

  const rawText = match[1].replace(/\r?\n\s*/g, ' ').trim();
  // 匹配括号中的选项，例如 (accept-edits, plan) 或 (code|plan)
  const parenMatch = rawText.match(/\(([^)]+)\)/);
  if (parenMatch) {
    const items = parenMatch[1]
      .split(/[,|/]/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
    return { modes: items, rawText };
  }

  return { modes: [], rawText };
}

function printUsage(): void {
  console.log(`
[catalog-probe] agy 版本、模型目录与执行模式探测工具
用于阶段 0 探测清单 V11：记录 agy --version、模型列表命令的原始输出与 mode 可选值。

用法说明:
  npx tsx tools/discover/catalog-probe.ts [选项]

选项:
  --bin <path>  指定 agy 可执行程序路径 (默认自动查找系统已安装的 agy)
  --out <file>  指定将探测结果保存为 JSON 文件的路径 (例如 fixtures/agy/catalog/catalog-probe.json)
  -h, --help    显示帮助信息

示例:
  npx tsx tools/discover/catalog-probe.ts
  npx tsx tools/discover/catalog-probe.ts --out fixtures/agy/catalog/catalog-probe.json
`);
}

function parseCliArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        result[key] = next;
        i++;
      } else {
        result[key] = 'true';
      }
    }
  }
  return result;
}

export function runCli(argv: string[] = process.argv.slice(2)): void {
  if (argv.includes('--help') || argv.includes('-h')) {
    printUsage();
    return;
  }

  const flags = parseCliArgs(argv);
  const bin = findAgyBinary(flags.bin);

  if (!bin) {
    console.error('错误: 未在本机找到 agy CLI 二进制文件，请通过 --bin <path> 指定路径或设置 AGY_BIN。');
    process.exit(1);
  }

  console.log(`\n======================================================`);
  console.log(`[catalog-probe] 启动 agy 目录与元信息探测...`);
  console.log(`目标程序路径: ${bin}`);
  console.log(`======================================================\n`);

  // 1. 探测版本
  console.log('[1/3] 探测 agy 版本信息 (--version)...');
  const verRun = spawnSync(bin, ['--version'], { encoding: 'utf-8', shell: true });
  const versionRaw = verRun.stdout || verRun.stderr || '';
  const version = parseVersionOutput(versionRaw);
  console.log(`  解析版本: ${version || '未知'} (原始输出: ${versionRaw.trim()})`);

  // 2. 探测模型列表
  console.log('[2/3] 探测可用模型列表 (models)...');
  const modelsRun = spawnSync(bin, ['models'], { encoding: 'utf-8', shell: true });
  const modelsRaw = modelsRun.stdout || modelsRun.stderr || '';
  const models = parseModelsOutput(modelsRaw);
  console.log(`  解析到模型数量: ${models.length} 个`);
  models.forEach(m => console.log(`    - [${m.id}] ${m.name}`));

  // 3. 探测可选模式 (--help)
  console.log('[3/3] 探测支持的执行模式 (--help --mode)...');
  const helpRun = spawnSync(bin, ['--help'], { encoding: 'utf-8', shell: true });
  const helpRaw = helpRun.stdout || helpRun.stderr || '';
  const { modes, rawText: modesRaw } = parseModesFromHelp(helpRaw);
  console.log(`  解析到执行模式: ${modes.length > 0 ? modes.join(', ') : '默认'} (说明: ${modesRaw})`);

  const report: CatalogProbeResult = {
    timestamp: new Date().toISOString(),
    binaryPath: bin,
    version,
    versionRaw: versionRaw.trim(),
    modelsCommand: ['models'],
    models,
    modelsRaw: modelsRaw.trim(),
    modes,
    modesRaw,
  };

  if (flags.out) {
    const outPath = path.resolve(flags.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`\n[成功] 探测结果已保存至: ${outPath}`);
  } else {
    console.log(`\n[提示] 可通过 --out <path> 保存结构化 JSON 产物。`);
  }
}

const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('catalog-probe.ts') ||
  process.argv[1].endsWith('catalog-probe.js')
);

if (isDirectRun) {
  runCli();
}
