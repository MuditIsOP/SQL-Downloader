import { NextResponse } from 'next/server';
import { exec } from 'child_process';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    // Set global stop flag in memory
    (global as any).isBackupStopRequested = true;

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
