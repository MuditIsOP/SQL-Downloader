'use client';

import React, { useState, useEffect, useRef } from 'react';

interface LogLine {
  id: string;
  type: 'info' | 'log' | 'db_start' | 'db_success' | 'db_fail' | 'error' | 'success';
  message: string;
  db?: string;
}

interface DatabaseItem {
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

export default function Home() {
  // Form State
  const [host, setHost] = useState('127.0.0.1');
  const [port, setPort] = useState('3306');
  const [username, setUsername] = useState('root');
  const [password, setPassword] = useState('');
  const [threads, setThreads] = useState('4');

  // Execution State
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [databases, setDatabases] = useState<DatabaseItem[]>([]);
  const [currentDb, setCurrentDb] = useState<string | null>(null);

  // Refs
  const terminalRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isRunningRef = useRef(false);

  // Auto-scroll logic: only scroll if the user was already near the bottom
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    const threshold = 100; // px from bottom
    const isNearBottom =
      terminal.scrollHeight - terminal.scrollTop - terminal.clientHeight < threshold;

    if (isNearBottom) {
      terminal.scrollTop = terminal.scrollHeight;
    }
  }, [logs]);

  const addLog = (type: LogLine['type'], message: string, db?: string) => {
    const uniqueId = `${type}-${Math.random().toString(36).substring(2, 9)}-${Date.now()}`;
    setLogs((prev) => [
      ...prev,
      { id: uniqueId, type, message, db },
    ]);
  };

  const handleStopBackup = async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    
    addLog('error', 'Stopping backup process and terminating connections...');
    isRunningRef.current = false;
    setIsBackingUp(false);
    setCurrentDb(null);

    try {
      await fetch('/api/backup/stop', { method: 'POST' });
      addLog('error', 'Backup job stopped and all database connections terminated.');
    } catch (err) {
      addLog('error', 'Aborted local request, but failed to notify server of process stop.');
    }
  };

  const handleStartBackup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBackingUp || isRunningRef.current) return;
    isRunningRef.current = true;

    // Reset State
    setIsBackingUp(true);
    setLogs([]);
    setDatabases([]);
    setCurrentDb(null);

    addLog('info', 'Initializing database backup job...');

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch('/api/backup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          host,
          port,
          username,
          password,
          threads,
        }),
      });

      if (!response.body) {
        addLog('error', 'Readable stream not supported in this browser. Please upgrade.');
        setIsBackingUp(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let done = false;
      let buffer = '';

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        buffer += decoder.decode(value, { stream: !done });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const event = JSON.parse(line);
            
            switch (event.type) {
              case 'info':
                addLog('info', event.message);
                break;
              case 'databases':
                setDatabases(
                  event.databases.map((dbName: string) => ({
                    name: dbName,
                    status: 'pending',
                  }))
                );
                break;
              case 'db_start':
                setCurrentDb(event.db);
                addLog('db_start', event.message, event.db);
                setDatabases((prev) =>
                  prev.map((d) =>
                    d.name === event.db ? { ...d, status: 'running' } : d
                  )
                );
                break;
              case 'log':
                addLog('log', event.message, event.db);
                break;
              case 'db_success':
                addLog('db_success', event.message, event.db);
                setDatabases((prev) =>
                  prev.map((d) =>
                    d.name === event.db ? { ...d, status: 'completed' } : d
                  )
                );
                break;
              case 'db_fail':
                addLog('db_fail', event.message, event.db);
                setDatabases((prev) =>
                  prev.map((d) =>
                    d.name === event.db ? { ...d, status: 'failed' } : d
                  )
                );
                break;
              case 'success':
                addLog('success', event.message);
                break;
              case 'error':
                addLog('error', event.message);
                break;
              default:
                addLog('log', JSON.stringify(event));
            }
          } catch (jsonErr) {
            addLog('log', line); // Fallback: show raw line if parsing fails
          }
        }
      }
    } catch (fetchErr: any) {
      if (fetchErr.name === 'AbortError') {
        // Log is already added by handleStopBackup
      } else {
        addLog('error', `Network error while connecting to backup endpoint: ${fetchErr.message || fetchErr}`);
      }
    } finally {
      isRunningRef.current = false;
      setIsBackingUp(false);
      setCurrentDb(null);
      abortControllerRef.current = null;
    }
  };

  return (
    <>
      <header className="header">
        <h1>MySQL Database Backup Tool</h1>
        <p>
          Configure your server credentials below to automatically discover and back up every user database to your local machine using <code style={{ color: 'var(--primary)', fontFamily: 'var(--font-mono)' }}>mydumper</code>.
        </p>
      </header>

      <main className="container">
        {/* Left Side: Configuration Card */}
        <section className="panel">
          <h2 className="panel-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/>
              <path d="M12 16v-4"/>
              <path d="M12 8h.01"/>
            </svg>
            Server Configuration
          </h2>

          <form onSubmit={handleStartBackup} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div className="form-group">
              <label htmlFor="host">Host / IP</label>
              <div className="input-container">
                <input
                  id="host"
                  type="text"
                  className="input-field"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="e.g. 127.0.0.1"
                  required
                  disabled={isBackingUp}
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="port">Port</label>
                <input
                  id="port"
                  type="number"
                  className="input-field"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder="3306"
                  required
                  min="1"
                  max="65535"
                  disabled={isBackingUp}
                />
              </div>

              <div className="form-group">
                <label htmlFor="threads">Threads</label>
                <input
                  id="threads"
                  type="number"
                  className="input-field"
                  value={threads}
                  onChange={(e) => setThreads(e.target.value)}
                  placeholder="4"
                  required
                  min="1"
                  max="128"
                  disabled={isBackingUp}
                />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="username">Username</label>
              <input
                id="username"
                type="text"
                className="input-field"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="root"
                required
                disabled={isBackingUp}
              />
            </div>

            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                className="input-field"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                disabled={isBackingUp}
              />
            </div>

            {isBackingUp ? (
              <button type="button" className="btn btn-danger" onClick={handleStopBackup}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                </svg>
                Stop Backup
              </button>
            ) : (
              <button type="submit" className="btn">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                Start Backup
              </button>
            )}
          </form>

          {/* Minimal Permissions Info Box */}
          <div className="info-box">
            <strong style={{ display: 'block', marginBottom: '0.25rem', color: 'var(--text-primary)' }}>Minimal Permissions Note:</strong>
            The database user needs read access to export schema and data. A secure backup user can be created via:
            <pre style={{ background: 'var(--bg-deep)', padding: '0.5rem', borderRadius: '4px', marginTop: '0.5rem', overflowX: 'auto', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
{`GRANT SELECT, SHOW VIEW, TRIGGER, 
LOCK TABLES, EVENT ON *.* TO 
'backup_user'@'%';`}
            </pre>
          </div>
        </section>

        {/* Right Side: Live Terminal Console */}
        <section className="panel terminal-panel">
          <div className="terminal-header">
            <div className="terminal-controls">
              <span className="dot red" />
              <span className="dot yellow" />
              <span className="dot green" />
            </div>
            <span className="terminal-title-text">
              {currentDb ? `backing up: ${currentDb}` : 'terminal idle'}
            </span>
          </div>

          <div ref={terminalRef} className="terminal-body">
            {logs.length === 0 ? (
              <div className="terminal-empty">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="4 17 10 11 4 5" />
                  <line x1="12" y1="19" x2="20" y2="19" />
                </svg>
                <span>Console ready. Click "Start Backup" to begin execution.</span>
              </div>
            ) : (
              logs.map((log) => (
                <div key={log.id} className={`log-line ${log.type}`}>
                  {log.type === 'info' && <span style={{ color: 'var(--primary)' }}>[INFO]</span>}
                  {log.type === 'error' && <span style={{ color: 'var(--error)' }}>[ERR]</span>}
                  {log.type === 'db_start' && <span style={{ color: 'hsl(260, 80%, 65%)' }}>[START]</span>}
                  {log.type === 'db_success' && <span style={{ color: 'var(--success)' }}>[OK]</span>}
                  {log.type === 'db_fail' && <span style={{ color: 'var(--error)' }}>[FAIL]</span>}
                  {log.type === 'success' && <span style={{ color: 'var(--success)' }}>[SUCCESS]</span>}
                  <span>{log.message}</span>
                </div>
              ))
            )}
          </div>

          {/* Database checklists */}
          {databases.length > 0 && (
            <div className="db-checklist">
              <div className="db-checklist-title">Backup Progress Checklist</div>
              <div className="db-checklist-scroll">
                {databases.map((db) => (
                  <div key={db.name} className="db-item">
                    <span className="db-name">{db.name}</span>
                    <span className={`db-status ${db.status}`}>
                      {db.status === 'pending' && '⏳ Pending'}
                      {db.status === 'running' && '🔄 Backing Up...'}
                      {db.status === 'completed' && '✅ Completed'}
                      {db.status === 'failed' && '❌ Failed'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
