import { COMPOSER_LIMITS } from './types';

/**
 * Checks if a file is an image that should be compressed.
 * Note: GIF files should not be canvas-compressed to preserve animation frames.
 */
export function shouldCompressImage(file: File): boolean {
  if (!file.type.startsWith('image/')) {
    return false;
  }
  if (file.type === 'image/gif') {
    return false;
  }
  return true;
}

/**
 * Formats file size in readable units (B, KB, MB, GB).
 */
export function formatFileSize(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const unit = units[i] ?? 'MB';
  const value = (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1);
  return `${value} ${unit}`;
}

/**
 * Compresses an image file by scaling its longest edge down to maxDimension (default 2048px).
 * Preserves MIME type if supported (image/jpeg, image/png, image/webp), default to image/jpeg if unknown.
 * Returns the original file if already smaller than maxDimension or if compression fails/unsupported.
 */
export async function compressImageIfNeeded(
  file: File,
  maxDimension = COMPOSER_LIMITS.maxImageDimension,
): Promise<File> {
  if (!shouldCompressImage(file)) {
    return file;
  }

  // If in an environment without DOM/Image/Canvas (e.g. SSR / Node test), return original file
  if (
    typeof window === 'undefined' ||
    typeof document === 'undefined' ||
    typeof Image === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    return file;
  }

  return new Promise<File>((resolve) => {
    let objectUrl: string | null = null;
    try {
      objectUrl = URL.createObjectURL(file);
    } catch {
      return resolve(file);
    }

    const img = new Image();
    img.onload = () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }

      const { naturalWidth: width, naturalHeight: height } = img;
      if (!width || !height) {
        return resolve(file);
      }

      // If dimensions are already within limit, don't re-encode
      if (width <= maxDimension && height <= maxDimension) {
        return resolve(file);
      }

      let targetWidth = width;
      let targetHeight = height;

      if (width > height) {
        if (width > maxDimension) {
          targetHeight = Math.round((height * maxDimension) / width);
          targetWidth = maxDimension;
        }
      } else {
        if (height > maxDimension) {
          targetWidth = Math.round((width * maxDimension) / height);
          targetHeight = maxDimension;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return resolve(file);
      }

      try {
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
        const mimeType = file.type || 'image/jpeg';
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              return resolve(file);
            }
            const compressedFile = new File([blob], file.name, {
              type: mimeType,
              lastModified: file.lastModified,
            });
            resolve(compressedFile);
          },
          mimeType,
          0.9,
        );
      } catch {
        resolve(file);
      }
    };

    img.onerror = () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
      resolve(file);
    };

    img.src = objectUrl;
  });
}
