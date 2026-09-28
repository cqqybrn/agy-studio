import fs from 'node:fs';

export interface TailReadResult {
  lines: string[];
  newOffset: number;
}

export class JsonlTail {
  constructor(
    public readonly path: string,
    public offset: number = 0,
  ) {}

  async read(): Promise<TailReadResult> {
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(this.path);
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === 'ENOENT'
      ) {
        return { lines: [], newOffset: this.offset };
      }
      throw err;
    }

    const fileSize = stat.size;

    // Detect file truncation (file size smaller than current offset)
    if (fileSize < this.offset) {
      this.offset = 0;
    }

    if (fileSize === this.offset) {
      return { lines: [], newOffset: this.offset };
    }

    const bytesToRead = fileSize - this.offset;
    const buffer = Buffer.alloc(bytesToRead);

    const fd = await fs.promises.open(this.path, 'r');
    try {
      await fd.read(buffer, 0, bytesToRead, this.offset);
    } finally {
      await fd.close();
    }

    const lastNewlineIndex = buffer.lastIndexOf(0x0a); // 0x0A is '\n'
    if (lastNewlineIndex === -1) {
      // Only partial line was read; wait for newline in future reads
      return { lines: [], newOffset: this.offset };
    }

    const completeBuffer = buffer.subarray(0, lastNewlineIndex + 1);
    const newOffset = this.offset + completeBuffer.length;

    const text = completeBuffer.toString('utf-8');
    const rawLines = text.split(/\r?\n/);
    if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') {
      rawLines.pop();
    }

    this.offset = newOffset;
    return {
      lines: rawLines,
      newOffset,
    };
  }
}
