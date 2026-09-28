import fs from 'node:fs';
import type { Attachment } from '@agy-studio/contracts';
import type { AgyProfile } from '../../integrations/agy/profile/schema.js';

export interface InjectedPromptResult {
  prompt: string;
  nativeImages?: unknown[];
}

export class PromptInjector {
  /**
   * Injects attachments into the user prompt or generates native image structures based on profile.
   *
   * 1. Default mode (`imageInput.supported` is false or profile omitted):
   *    Appends formatted tags at the end of the prompt:
   *    <images_input>
   *    - [filename] (path)
   *    </images_input>
   *    <files_input>
   *    - [filename] (path)
   *      Extracted content:
   *      ...
   *    </files_input>
   *
   * 2. When `imageInput.supported` is true:
   *    Returns native image objects constructed according to profile.stream.imageInput.template,
   *    and does not append those images to `<images_input>` in the text prompt.
   */
  injectAttachments(
    prompt: string,
    attachments: Attachment[],
    profile?: AgyProfile,
  ): InjectedPromptResult {
    if (!attachments || attachments.length === 0) {
      return { prompt };
    }

    const nativeSupported = profile?.stream?.imageInput?.supported === true;
    const template = profile?.stream?.imageInput?.template;

    const nativeImages: unknown[] = [];
    const textImages: Attachment[] = [];
    const fileAttachments: Attachment[] = [];

    for (const att of attachments) {
      if (att.kind === 'image') {
        if (nativeSupported) {
          nativeImages.push(this.formatNativeImage(att, template));
        } else {
          textImages.push(att);
        }
      } else {
        fileAttachments.push(att);
      }
    }

    let modifiedPrompt = prompt;
    const blocks: string[] = [];

    if (textImages.length > 0) {
      const lines: string[] = ['<images_input>'];
      for (const img of textImages) {
        lines.push(`- [${img.originalName}] (${img.storedPath})`);
      }
      lines.push('</images_input>');
      blocks.push(lines.join('\n'));
    }

    if (fileAttachments.length > 0) {
      const lines: string[] = ['<files_input>'];
      for (const file of fileAttachments) {
        lines.push(`- [${file.originalName}] (${file.storedPath})`);
        if (file.derivedTextPath && fs.existsSync(file.derivedTextPath)) {
          try {
            const extracted = fs.readFileSync(file.derivedTextPath, 'utf-8');
            lines.push(`  Extracted text:\n${extracted.trim()}`);
          } catch {
            lines.push(`  (Extracted text available at: ${file.derivedTextPath})`);
          }
        }
      }
      lines.push('</files_input>');
      blocks.push(lines.join('\n'));
    }

    if (blocks.length > 0) {
      modifiedPrompt = `${modifiedPrompt.trimEnd()}\n\n${blocks.join('\n\n')}`;
    }

    return {
      prompt: modifiedPrompt,
      ...(nativeImages.length > 0 ? { nativeImages } : {}),
    };
  }

  private formatNativeImage(attachment: Attachment, template: unknown): unknown {
    let base64Data: string | null = null;
    try {
      base64Data = fs.readFileSync(attachment.storedPath).toString('base64');
    } catch {
      // ignore
    }

    if (typeof template === 'string') {
      return template
        .replaceAll('{{path}}', attachment.storedPath)
        .replaceAll('{{mimeType}}', attachment.mimeType)
        .replaceAll('{{base64}}', base64Data ?? '');
    }

    if (template && typeof template === 'object') {
      const replacer = (val: unknown): unknown => {
        if (typeof val === 'string') {
          return val
            .replaceAll('{{path}}', attachment.storedPath)
            .replaceAll('{{mimeType}}', attachment.mimeType)
            .replaceAll('{{base64}}', base64Data ?? '');
        }
        if (Array.isArray(val)) {
          return val.map(replacer);
        }
        if (val && typeof val === 'object') {
          const res: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(val)) {
            res[k] = replacer(v);
          }
          return res;
        }
        return val;
      };
      return replacer(template);
    }

    // Default native representation if template is null/undefined
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: attachment.mimeType,
        data: base64Data,
        path: attachment.storedPath,
      },
    };
  }
}
