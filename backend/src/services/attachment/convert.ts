import fs from 'node:fs';
import path from 'node:path';
import type { Attachment } from '@agy-studio/contracts';
import type { AttachmentsRepository } from '../../repositories/attachments.js';
import { logger } from '../../utils/logger.js';

export interface AttachmentConverterOptions {
  attachmentsRepo: AttachmentsRepository;
}

export class AttachmentConverter {
  private readonly attachmentsRepo: AttachmentsRepository;

  constructor(options: AttachmentConverterOptions) {
    this.attachmentsRepo = options.attachmentsRepo;
  }

  /**
   * Converts a document (pdf, docx, xlsx/xls) to plain text / markdown.
   * - pdf -> pdf-parse
   * - docx -> mammoth (markdown / plain text)
   * - xlsx / xls -> xlsx (each sheet as a CSV section)
   * Derived text is written to `<storedPath>.extracted.txt`
   * Updates `derivedTextPath` in repositories.attachments.
   * If conversion fails, logs error and does NOT throw.
   */
  async convert(attachment: Attachment): Promise<string | null> {
    try {
      const ext = path.extname(attachment.originalName).toLowerCase();
      const mime = attachment.mimeType.toLowerCase();

      let text: string | null = null;

      if (mime === 'application/pdf' || ext === '.pdf') {
        text = await this.extractPdf(attachment.storedPath);
      } else if (
        mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        ext === '.docx'
      ) {
        text = await this.extractDocx(attachment.storedPath);
      } else if (
        mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        mime === 'application/vnd.ms-excel' ||
        ext === '.xlsx' ||
        ext === '.xls'
      ) {
        text = await this.extractXlsx(attachment.storedPath);
      }

      if (text !== null && text.trim().length > 0) {
        const derivedPath = `${attachment.storedPath}.extracted.txt`;
        fs.writeFileSync(derivedPath, text, 'utf-8');
        this.attachmentsRepo.update(attachment.id, { derivedTextPath: derivedPath });
        attachment.derivedTextPath = derivedPath;
        return derivedPath;
      }
    } catch (err) {
      logger.warn(
        { err, attachmentId: attachment.id, filename: attachment.originalName },
        'Attachment conversion failed, continuing without extracted text',
      );
    }
    return null;
  }

  private async extractPdf(filePath: string): Promise<string | null> {
    const buffer = fs.readFileSync(filePath);
    // Dynamic import to handle differences or ESM
    const pdfParseModule = await import('pdf-parse');
    const { PDFParse } = pdfParseModule;
    if (typeof PDFParse === 'function') {
      const parser = new PDFParse({ data: buffer });
      try {
        const textResult = await parser.getText();
        return textResult?.text ?? null;
      } finally {
        await parser.destroy();
      }
    } else if (typeof (pdfParseModule as any).default === 'function') {
      const parsed = await (pdfParseModule as any).default(buffer);
      return parsed?.text ?? null;
    }
    return null;
  }

  private async extractDocx(filePath: string): Promise<string | null> {
    const buffer = fs.readFileSync(filePath);
    const mammoth = (await import('mammoth')) as any;
    if (typeof mammoth.convertToMarkdown === 'function') {
      const result = await mammoth.convertToMarkdown({ buffer });
      return result?.value ?? null;
    }
    if (typeof mammoth.extractRawText === 'function') {
      const result = await mammoth.extractRawText({ buffer });
      return result?.value ?? null;
    }
    return null;
  }

  private async extractXlsx(filePath: string): Promise<string | null> {
    const buffer = fs.readFileSync(filePath);
    const xlsx = await import('xlsx');
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    const parts: string[] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (sheet) {
        const csv = xlsx.utils.sheet_to_csv(sheet);
        if (csv && csv.trim().length > 0) {
          parts.push(`--- Sheet: ${sheetName} ---\n${csv.trim()}`);
        }
      }
    }

    return parts.length > 0 ? parts.join('\n\n') : null;
  }
}
