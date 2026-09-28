import type { Prefs, UpdatePrefsBody } from '@agy-studio/contracts';
import { DEFAULT_PREFS, type PrefsRepository } from '../repositories/prefs.js';

export interface PrefsServiceOptions {
  prefsRepo: PrefsRepository;
}

export class PrefsService {
  private readonly prefsRepo: PrefsRepository;

  constructor(options: PrefsServiceOptions | PrefsRepository) {
    if ('get' in options && 'update' in options) {
      this.prefsRepo = options as PrefsRepository;
    } else {
      this.prefsRepo = (options as PrefsServiceOptions).prefsRepo;
    }
  }

  async getPrefs(): Promise<Prefs> {
    const stored = this.prefsRepo.get();
    return {
      ...DEFAULT_PREFS,
      ...stored,
    };
  }

  async updatePrefs(input: UpdatePrefsBody): Promise<Prefs> {
    return this.prefsRepo.update(input);
  }
}
