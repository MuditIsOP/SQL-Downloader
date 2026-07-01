import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    // Create filesystem lock file to share stop state across isolated Next.js worker processes
    try {
      await fs.writeFile(path.join(process.cwd(), 'backup_stop.lock'), 'stop');
    } catch (e) {}

    // 1. Terminate all mydumper instances inside WSL
    exec('wsl pkill -9 mydumper');

    // 2. Terminate all native mydumper instances (Windows or Linux/macOS host)
    if (process.platform === 'win32') {
      // taskkill /F /IM mydumper.exe
      // We run in a try/catch block inside exec, so if it's not running, it fails silently
      exec('taskkill /F /IM mydumper.exe');
      exec('taskkill /F /IM mydumper');
    } else {
      exec('pkill -9 mydumper');
    }

    return NextResponse.json({ success: true, message: 'All backup processes terminated.' });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
