import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import net, { AddressInfo } from 'net';

const SERVER_PATH = path.join(__dirname, '../../src/main.ts');
const TSX_PATH = path.resolve(path.dirname(require.resolve('tsx/package.json')), 'dist/cli.mjs');

describe('Server Lifecycle Integration', () => {
  let serverProcess: ChildProcess | null = null;
  const TEST_PORT = 12345;

  afterEach(async () => {
    if (serverProcess) {
      serverProcess.kill('SIGTERM');

      let timeoutId: NodeJS.Timeout;
      const timeoutPromise = new Promise<void>((resolve) => {
        timeoutId = setTimeout(resolve, 2000);
      });

      const exitPromise = new Promise<void>((resolve) => {
        if (!serverProcess) return resolve();
        serverProcess.once('exit', () => resolve());
      });

      await Promise.race([exitPromise, timeoutPromise]);
      clearTimeout(timeoutId!);

      // Force kill if it hasn't exited
      if (serverProcess && serverProcess.exitCode === null) {
        serverProcess.kill('SIGKILL');
      }

      serverProcess = null;
    }
  });

  function startServer(
    env: Record<string, string> = {}
  ): Promise<{ process: ChildProcess; output: string }> {
    return new Promise((resolve, reject) => {
      // Precedence: explicit env override > logic default (TEST_PORT) > process.env
      const port = env.PORT || TEST_PORT.toString();

      const proc = spawn(TSX_PATH, [SERVER_PATH], {
        env: {
          ...process.env,
          PORT: port,
          ...env,
        },
        stdio: 'pipe',
      });

      let output = '';
      let errorOutput = '';
      let settled = false;
      // eslint-disable-next-line prefer-const
      let startupTimeout: NodeJS.Timeout | undefined;

      const cleanup = () => {
        if (startupTimeout) clearTimeout(startupTimeout);
        proc.stdout?.off('data', onStdout);
        proc.stderr?.off('data', onStderr);
        proc.off('error', onError);
        proc.off('exit', onExit);
      };

      const settle = (err?: Error, result?: { process: ChildProcess; output: string }) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (err) reject(err);
        else resolve(result!);
      };

      const onStdout = (data: Buffer) => {
        const str = data.toString();
        output += str;
        if (str.includes('NextDocs Realtime Server started')) {
          settle(undefined, { process: proc, output });
        }
      };

      const onStderr = (data: Buffer) => {
        errorOutput += data.toString();
      };

      const onError = (err: Error) => {
        settle(err);
      };

      const onExit = (code: number) => {
        if (!settled) {
          settle(new Error(`Server exited with code ${code}. Stderr: ${errorOutput}`));
        }
      };

      proc.stdout?.on('data', onStdout);
      proc.stderr?.on('data', onStderr);
      proc.on('error', onError);
      proc.on('exit', onExit);

      startupTimeout = setTimeout(() => {
        if (!settled) {
          settle(new Error(`Server startup timed out. Output: ${output} Error: ${errorOutput}`));
        }
      }, 5000);
    });
  }

  function waitForExit(proc: ChildProcess): Promise<number | null> {
    return new Promise((resolve) => {
      proc.on('exit', (code) => {
        resolve(code);
      });
    });
  }

  function getFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.on('error', reject);
      server.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr !== 'string' && (addr as AddressInfo).port) {
          const port = (addr as AddressInfo).port;
          server.close(() => {
            resolve(port);
          });
        } else {
          server.close(() => {
            reject(new Error('Failed to retrieve address from server'));
          });
        }
      });
    });
  }

  it('should start successfully', async () => {
    const port = await getFreePort();
    const { process: proc, output } = await startServer({
      PORT: port.toString(),
    });
    serverProcess = proc;
    expect(output).toContain('NextDocs Realtime Server started');
    // Log content is JSON stringified, so quotes might be escaped
    // or formatted differently
    expect(output).toContain(`"port":${port}`);
  });

  it('should shut down gracefully on SIGTERM', async () => {
    const port = await getFreePort();
    const { process: proc } = await startServer({ PORT: port.toString() });
    serverProcess = proc;

    proc.kill('SIGTERM');

    const code = await waitForExit(proc);

    expect(code).toBe(0);
    serverProcess = null;
  }, 10000);

  it('should fail if port is already in use', async () => {
    const port = await getFreePort();
    const { process: proc1 } = await startServer({ PORT: port.toString() });
    serverProcess = proc1;

    await expect(startServer({ PORT: port.toString() })).rejects.toThrow();
  }, 10000);
});
