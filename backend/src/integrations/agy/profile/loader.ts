import fs from 'node:fs';
import { AppError } from '../../../utils/errors.js';
import { AgyProfileSchema, type AgyProfile } from './schema.js';

export function loadProfile(profilePath: string): AgyProfile {
  let fileContent: string;
  try {
    fileContent = fs.readFileSync(profilePath, 'utf-8');
  } catch (err) {
    throw new AppError('NOT_FOUND', `Failed to read agy profile from "${profilePath}"`, {
      cause: err,
      details: { path: profilePath },
    });
  }

  let rawJson: unknown;
  try {
    rawJson = JSON.parse(fileContent);
  } catch (err) {
    throw new AppError('BAD_REQUEST', `Invalid JSON in agy profile at "${profilePath}"`, {
      cause: err,
      details: { path: profilePath },
    });
  }

  const result = AgyProfileSchema.safeParse(rawJson);
  if (!result.success) {
    const issues = result.error.issues ?? [];
    const errorDetails = issues.map((issue) => {
      const fieldPath = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return {
        path: fieldPath,
        message: issue.message,
        code: issue.code,
      };
    });

    const formattedPaths = errorDetails.map((e) => `${e.path}: ${e.message}`).join('; ');

    throw new AppError(
      'BAD_REQUEST',
      `Profile validation failed for "${profilePath}". Errors: [${formattedPaths}]`,
      {
        details: {
          path: profilePath,
          errors: errorDetails,
        },
      },
    );
  }

  return result.data;
}
