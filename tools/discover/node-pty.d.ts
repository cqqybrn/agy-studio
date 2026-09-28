declare module 'node-pty' {
  export interface IPty {
    onData(listener: (data: string) => void): void;
    write(data: string): void;
    kill(signal?: string): void;
    onExit(listener: (res: { exitCode: number }) => void): void;
  }

  export interface IPtyForkOptions {
    name?: string;
    cols?: number;
    rows?: number;
    cwd?: string;
    env?: Record<string, string>;
    encoding?: string;
  }

  export function spawn(file: string, args: string[] | string, options: IPtyForkOptions): IPty;
}
