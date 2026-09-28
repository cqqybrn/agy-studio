export interface FakeAgyOptions {
  scenario?: string;
  speed?: number;
  homeDir?: string;
  loginBehavior?: 'success' | 'fail' | 'hang';
  fixturesDir?: string;
}

export interface CliParsedArgs {
  isStream: boolean;
  isVersion: boolean;
  isModels: boolean;
  isLogin: boolean;
  isHelp: boolean;
  prompt?: string;
  model?: string;
  effort?: string;
  mode?: string;
  dangerouslySkipPermissions?: boolean;
  extraArgs: string[];
}
