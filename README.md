# MySQL Database Backup Tool — Next.js UI

A sleek, self-hosted web interface that wraps the powerful, multi-threaded `mydumper` utility to perform blazing-fast, non-blocking backups of all databases on a MySQL server.

---

## 🚀 Key Features

*   **Blazing Fast Parallel Backups**: Leverages `mydumper`'s multi-threaded architecture (dumping different tables and table-chunks in parallel) instead of slow, single-threaded utilities.
*   **Zero-Downtime Consistent Snapshots**: Enforces `--no-locks` and `--trx-consistency-only` by default. Uses InnoDB's MVCC transaction model to capture a point-in-time snapshot without blocking database write operations.
*   **Automatic WSL Fallback (Windows Ready)**: If you run the web server natively on Windows, the application automatically detects if `mydumper` is missing and bridges the commands to your WSL (Ubuntu) shell, translating folder paths dynamically.
*   **Secure Credential Handling**: Database passwords are never exposed in system logs or the process list (`ps aux` / Task Manager). They are passed securely in-memory and forwarded to WSL using the whitelisted `WSLENV` translation layer.
*   **Interactive Terminal Console**: Features a real-time terminal UI console (verbose logging mode) showing precise thread activity, table chunks, and individual database progress checklists.
*   **Stop Backup Mid-Way**: Click the "Stop Backup" button to abort the network request; the server immediately kills any running `mydumper` subprocesses safely.
*   **Leak Protection**: Pre-configured `.gitignore` prevents your local database dumps (located in the `output/` directory) from ever being accidentally pushed to GitHub.

---

## 🛠️ Prerequisites

1.  **Node.js**: Version 18.0.0 or higher.
2.  **MyDumper**: 
    *   **Linux/macOS**: Installed on your system `PATH`.
    *   **Windows**: Installed inside your **WSL Ubuntu** shell (run `sudo apt update && sudo apt install mydumper -y`).

---

## ⚙️ Installation & Running

1.  Clone the repository:
    ```bash
    git clone https://github.com/yourusername/mysql-db-backup-tool.git
    cd mysql-db-backup-tool
    ```

2.  Install the dependencies:
    ```bash
    npm install
    ```

3.  Start the development server:
    ```bash
    npm run dev
    ```

4.  Open your browser to [http://localhost:3000](http://localhost:3000).

---

## 📖 Minimal User Permissions

To ensure security, you do **not** need to provide administrative or `root` credentials to the tool. A backup user with read-only capabilities is fully sufficient:

```sql
CREATE USER 'backup_user'@'%' IDENTIFIED BY 'your_password';
GRANT SELECT, SHOW VIEW, TRIGGER, LOCK TABLES, EVENT ON *.* TO 'backup_user'@'%';
FLUSH PRIVILEGES;
```
*Note: The `LOCK TABLES` privilege is only required to satisfy MySQL's internal metadata checks. Because `--no-locks` is used, no physical table locks are ever placed on your tables.*

---

## ⚠️ Important Configurations

*   **Thread Count**: Setting a very high thread count (e.g., `40`+) will open 40 concurrent connection threads to the database. For managed databases (like AWS RDS or Google Cloud SQL) running on smaller instances (e.g. `db.t3.micro`), this will quickly hit the `max_connections` limit and throw a `Too many connections` error. **A thread count of `4` or `8` is recommended.**
*   **Output Folder**: Backups are structured under `./output/<username>_at_<host>/<database_name>/` as plain, readable `.sql` schemas and table data.

---

## 📄 License

This project is licensed under the MIT License.
