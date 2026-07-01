# MySQL Database Backup Tool — Next.js UI

## What this app does

A local Next.js web app that lets a user back up every database on a MySQL server through a simple UI — no command line, no editing config files. The user opens the app, types in their server details, hits "Start Backup," and watches a live terminal-style log while it backs up every database automatically, one folder per database.

Under the hood, the app runs `mydumper` (a fast parallel MySQL backup tool) instead of a manual export, so backups are fast and don't lock the server while it's running.

## The screen the user sees

A single page with:

1. **Connection form**
   - Host (text field)
   - Port (number field, defaults to 3306, user can change it)
   - Username (text field)
   - Password (password field, masked)
   - Threads (number field, e.g. defaults to 4, user can increase/decrease — more threads = faster backup but more load on the server)
   - A "Start Backup" button

2. **Live terminal panel**
   - Appears once backup starts
   - Looks like a real terminal (dark background, monospace font, scrolling text)
   - Shows real-time progress: which database it's currently backing up, which table, how much is done, elapsed time
   - Shows a running list of completed databases with a checkmark
   - Shows a clear success message at the end, or a clear error message if something fails (e.g. wrong password, can't connect)
   - Auto-scrolls as new lines come in, but user can scroll up to review

3. No other pages, no login system, no settings beyond the form above. Keep it minimal.

## How the backup is organized

- The user runs the app from a project folder (e.g. via `npm run dev`).
- Everything the app produces goes into a folder called `output` inside that same project folder.
- Inside `output`, create one folder named after the server/user's identity (e.g. the username they typed in, or a name derived from the host).
- Inside that folder, every database gets its own subfolder.
- Example layout:
  ```
  output/
    myuser/
      database_one/
      database_two/
      database_three/
  ```
- No compression for now — files are saved as-is (plain SQL). This can be added later but should NOT be built into the first version.
- No manual locking of the server — the backup must run while the server stays fully usable by other applications, using the safest built-in method for taking a consistent snapshot without blocking writes.

## Behavior requirements

- On "Start Backup," the app first connects and automatically discovers every database on the server — the user never types database names manually.
- It then backs up each database one after another (or in parallel, whichever mydumper handles by default), streaming progress to the terminal panel live as it happens — not just a spinner, not just a final "done" message.
- If the connection fails (bad host/port/user/password), show a clear, specific error in the terminal panel immediately. Don't let the UI hang silently.
- If backup of one database fails, keep going with the others, and clearly mark which one failed at the end.

## Safety requirements

- The database user only needs read-level permissions to take a backup — the app must never ask for or require more than that. Explain to the user in the UI (a small note near the form) exactly which minimal permissions their MySQL user needs to grant, so they don't have to give the app admin/root access unless they choose to.
- The app must not modify, delete, or write anything to the source MySQL server — it only reads data out.
- The password field must never be logged, printed to the terminal panel, saved to disk, or stored anywhere — it's used only for the live connection and then discarded.
- No data ever leaves the local machine — everything runs and saves locally.

## Tech notes for the builder (agent-facing, not user-facing)

- Next.js app, App Router.
- Use `mydumper` as the underlying backup engine, invoked as a subprocess per run.
- Stream subprocess output to the browser in real time (e.g. via Server-Sent Events or WebSocket) so the terminal panel updates live instead of waiting for the process to finish.
- Threads field maps directly to mydumper's thread count option.
- Use mydumper's transaction-consistent snapshot mode by default (no user-facing toggle for this — just always do it, since it's what keeps the backup safe without locking the server).
- Compression stays off by default and out of the UI for v1.
- Output path is always relative to the process's working directory (`./output/<server-identity>/<database-name>/`), not user-configurable in v1.
