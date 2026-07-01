import { NextRequest } from 'next/server';
import { spawn, exec } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';

const checkMydumper = () => new Promise<boolean>((resolve) => {
  exec('mydumper --version', (err) => {
    resolve(!err);
  });
});

const checkWslMydumper = () => new Promise<boolean>((resolve) => {
  exec('wsl mydumper --version', (err) => {
    resolve(!err);
  });
});

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();
  let activeChild: any = null;
  let useWsl = false;

  // Reset global stop flag in memory for this new session
  (global as any).isBackupStopRequested = false;

  // Kill running subprocesses immediately if request is aborted by client
  req.signal.addEventListener('abort', () => {
    if (activeChild) {
      try {
        activeChild.kill('SIGKILL');
      } catch (e) {}
      if (useWsl) {
        try {
          exec('wsl pkill -9 mydumper');
        } catch (e) {}
      }
    }
  });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: any) => {
        controller.enqueue(encoder.encode(JSON.stringify(data) + '\n'));
      };

      try {
        let body;
        try {
          body = await req.json();
        } catch {
          send({ type: 'error', message: 'Invalid JSON request body.' });
          controller.close();
          return;
        }

        const { host, port, username, password, threads } = body;

        // 1. Input Validation
        if (!host || typeof host !== 'string') {
          send({ type: 'error', message: 'Host is required.' });
          controller.close();
          return;
        }

        const portNum = parseInt(port, 10);
        if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
          send({ type: 'error', message: 'Port must be a valid integer between 1 and 65535.' });
          controller.close();
          return;
        }

        if (!username || typeof username !== 'string') {
          send({ type: 'error', message: 'Username is required.' });
          controller.close();
          return;
        }

        if (typeof password !== 'string') {
          send({ type: 'error', message: 'Password must be a string.' });
          controller.close();
          return;
        }

        const threadsNum = parseInt(threads, 10);
        if (isNaN(threadsNum) || threadsNum < 1 || threadsNum > 128) {
          send({ type: 'error', message: 'Threads must be a valid integer between 1 and 128.' });
          controller.close();
          return;
        }

        send({ type: 'info', message: `Connecting to MySQL server at ${host}:${portNum}...` });

        // 2. Discover databases
        let databases: string[] = [];
        try {
          const connection = await mysql.createConnection({
            host,
            port: portNum,
            user: username,
            password,
            connectTimeout: 5000,
          });

          const [rows] = await connection.query('SHOW DATABASES');
          
          databases = (rows as any[])
            .map((r) => r.Database || r.database || Object.values(r)[0])
            .filter((dbName: string) => {
              const systemDbs = ['information_schema', 'performance_schema', 'sys', 'mysql'];
              return !systemDbs.includes(dbName.toLowerCase());
            });

          await connection.end();
        } catch (dbErr: any) {
          send({ type: 'error', message: `Database connection failed: ${dbErr.message || dbErr}` });
          controller.close();
          return;
        }

        if (databases.length === 0) {
          send({ type: 'info', message: 'No user databases found on this server.' });
          send({ type: 'success', message: 'Process completed. 0 databases backed up.' });
          controller.close();
          return;
        }

        if ((global as any).isBackupStopRequested || req.signal.aborted) {
          controller.close();
          return;
        }

        send({ type: 'info', message: `Discovered ${databases.length} database(s) to back up: ${databases.join(', ')}` });
        send({ type: 'databases', databases });

        // Check mydumper presence and fallback to WSL
        useWsl = false;
        const mydumperExists = await checkMydumper();
        if (!mydumperExists) {
          if (process.platform === 'win32') {
            send({ type: 'info', message: 'mydumper not found on Windows PATH. Checking WSL...' });
            const wslMydumperExists = await checkWslMydumper();
            if (wslMydumperExists) {
              useWsl = true;
              send({ type: 'info', message: 'Found mydumper inside WSL! Using WSL backup engine.' });
            } else {
              send({ type: 'error', message: "Failed to execute mydumper. The 'mydumper' binary was not found on Windows PATH or inside WSL. Please install it on Windows or run 'sudo apt update && sudo apt install mydumper -y' inside your WSL Ubuntu terminal." });
              controller.close();
              return;
            }
          } else {
            send({ type: 'error', message: "Failed to execute mydumper. The 'mydumper' binary was not found on your system PATH." });
            controller.close();
            return;
          }
        }

        // Derive safe server/user identity for target folder
        const identity = `${username}_at_${host}`.replace(/[^a-zA-Z0-9_.-]/g, '_');
        let successCount = 0;
        let failCount = 0;

        for (const dbName of databases) {
          if ((global as any).isBackupStopRequested || req.signal.aborted) {
            send({ type: 'info', message: 'Backup job aborted. Terminating process...' });
            break;
          }
          send({ type: 'db_start', db: dbName, message: `Starting backup of database: ${dbName}` });

          const targetDir = path.join(process.cwd(), 'output', identity, dbName);

          // Clear existing folder to satisfy mydumper and ensure latest snapshot
          try {
            await fs.rm(targetDir, { recursive: true, force: true });
          } catch (e) {
            // Ignore error if folder doesn't exist
          }
          
          try {
            await fs.mkdir(targetDir, { recursive: true });
          } catch (mkdirErr: any) {
            send({ type: 'db_fail', db: dbName, message: `Failed to create output directory: ${mkdirErr.message}` });
            failCount++;
            continue;
          }

          // Create temporary options file to inject SET SESSION max_execution_time=0 on connection init
          const tempCnfPath = path.join(process.cwd(), `temp_${dbName}_${Date.now()}.cnf`);
          const wslTempCnfPath = `/tmp/temp_${dbName}_${Date.now()}.cnf`;

          if (useWsl) {
            // Write directly to WSL /tmp/ to ensure permissions are not world-writable (which causes MySQL to ignore it)
            try {
              await new Promise<void>((resolve, reject) => {
                const cnfData = '[client]\\ninit-command=\\"SET SESSION max_execution_time=0, SESSION net_read_timeout=86400, SESSION net_write_timeout=86400, SESSION wait_timeout=86400\\"';
                exec(`wsl sh -c "echo '${cnfData}' > ${wslTempCnfPath} && chmod 600 ${wslTempCnfPath}"`, (err) => {
                  if (err) reject(err);
                  else resolve();
                });
              });
            } catch (cnfWriteErr: any) {
              send({ type: 'db_fail', db: dbName, message: `Failed to create temporary WSL configuration file: ${cnfWriteErr.message}` });
              failCount++;
              continue;
            }
          } else {
            // Native Windows/Linux
            try {
              await fs.writeFile(tempCnfPath, '[client]\ninit-command="SET SESSION max_execution_time=0, SESSION net_read_timeout=86400, SESSION net_write_timeout=86400, SESSION wait_timeout=86400"\n');
              await fs.chmod(tempCnfPath, 0o600);
            } catch (cnfWriteErr: any) {
              send({ type: 'db_fail', db: dbName, message: `Failed to create temporary configuration file: ${cnfWriteErr.message}` });
              failCount++;
              continue;
            }
          }

          // Spawn mydumper
          const success = await new Promise<boolean>((resolve) => {
            send({ type: 'info', message: `Running mydumper command for '${dbName}'...` });
            
            const nativeCnfPath = tempCnfPath;
            let cmd = 'mydumper';
            let args = [
              `--defaults-file=${nativeCnfPath}`,
              '-h', host,
              '-P', String(portNum),
              '-u', username,
              '-t', String(threadsNum),
              '-B', dbName,
              '-o', targetDir,
              '--trx-consistency-only',
              '--no-locks',
              '-r', '50000',
              '--verbose', '3'
            ];

            if (useWsl) {
              cmd = 'wsl';
              const wslTargetDir = targetDir
                .replace(/^([a-zA-Z]):/, (_, letter) => `/mnt/${letter.toLowerCase()}`)
                .replace(/\\/g, '/');
              args = [
                'mydumper',
                `--defaults-file=${wslTempCnfPath}`,
                '-h', host,
                '-P', String(portNum),
                '-u', username,
                '-t', String(threadsNum),
                '-B', dbName,
                '-o', wslTargetDir,
                '--trx-consistency-only',
                '--no-locks',
                '-r', '50000',
                '--verbose', '3'
              ];
            }

            // Password is NOT passed in args, only via MYSQL_PWD to prevent ps aux leak
            const child = spawn(cmd, args, {
              env: {
                ...process.env,
                MYSQL_PWD: password,
                ...(useWsl ? { WSLENV: 'MYSQL_PWD/u' } : {})
              }
            });

            activeChild = child;

            let buffer = '';
            const processData = (chunk: Buffer) => {
              buffer += chunk.toString();
              const lines = buffer.split(/\r?\n/);
              buffer = lines.pop() || '';
              for (const line of lines) {
                if (line.trim()) {
                  send({ type: 'log', db: dbName, message: line });
                }
              }
            };

            child.stdout.on('data', processData);
            child.stderr.on('data', processData);

            const cleanup = async () => {
              if (useWsl) {
                await new Promise<void>((resolve) => {
                  exec(`wsl rm -f ${wslTempCnfPath}`, () => resolve());
                });
              } else {
                try {
                  await fs.unlink(tempCnfPath);
                } catch (e) {
                  // Ignore cleanup errors
                }
              }
            };

            child.on('error', async (err: any) => {
              activeChild = null;
              await cleanup();
              if (err.code === 'ENOENT') {
                send({ type: 'error', message: `Failed to execute ${cmd}. Command binary was not found.` });
              } else {
                send({ type: 'error', message: `${cmd} process error: ${err.message}` });
              }
              resolve(false);
            });

            child.on('close', async (code) => {
              activeChild = null;
              await cleanup();
              if (buffer.trim()) {
                send({ type: 'log', db: dbName, message: buffer });
              }
              if (code === 0) {
                send({ type: 'db_success', db: dbName, message: `Database '${dbName}' backup completed successfully.` });
                resolve(true);
              } else {
                send({ type: 'db_fail', db: dbName, message: `Database '${dbName}' backup failed with exit code ${code}.` });
                resolve(false);
              }
            });
          });

          if (success) {
            successCount++;
          } else {
            failCount++;
          }
        }

        send({
          type: 'success',
          message: `Backup complete. Successfully backed up ${successCount}/${databases.length} database(s). ${failCount} database(s) failed.`
        });
        controller.close();
      } catch (err: any) {
        send({ type: 'error', message: `Unexpected error during backup execution: ${err.message || err}` });
        controller.close();
      }
    },
    cancel() {
      if (activeChild) {
        try {
          activeChild.kill('SIGKILL');
        } catch (e) {}
        if (useWsl) {
          try {
            exec('wsl pkill -9 mydumper');
          } catch (e) {}
        }
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    }
  });
}
