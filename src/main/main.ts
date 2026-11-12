// Electron main: window 1280x800 (min 1280x720 per DESIGN.md §10.3), IPC bootstrap.
// If renderer bundle or DB is unavailable, still open the window with a clear
// Vietnamese error page instead of crashing (BE-003 run-app requirement).
import { app, BrowserWindow, Menu } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { defaultDbPath, openDatabase } from './db';
import type { AppDb } from './db';
import { registerIpcHandlers } from './ipc-handlers';
import { startDailyBackupJob } from './backup-restore';
import { startNotificationScheduler, stopNotificationScheduler } from './notifications';

let mainWindow: BrowserWindow | null = null;

/** Minimal error page so the app never shows a blank/crashed window. */
function errorHtml(title: string, detail: string): string {
  const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return (
    `data:text/html;charset=utf-8,` +
    encodeURIComponent(
      `<!doctype html><html lang="vi"><head><meta charset="UTF-8" />` +
        `<title>${esc(title)}</title></head>` +
        `<body style="font-family:system-ui,sans-serif;background:#0F172A;color:#E2E8F0;` +
        `display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">` +
        `<main style="max-width:640px;padding:32px;background:#1E293B;border-radius:12px">` +
        `<h1 style="margin:0 0 12px;font-size:22px">${esc(title)}</h1>` +
        `<p style="white-space:pre-wrap;font-size:14px;line-height:1.6">${esc(detail)}</p>` +
        `</main></body></html>`,
    )
  );
}

function rendererIndexPath(): string | null {
  const p = path.join(__dirname, '..', 'renderer', 'index.html');
  return fs.existsSync(p) ? p : null;
}

function createWindow(startupError: string | null): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1280,
    minHeight: 720,
    title: 'Parking Management',
    backgroundColor: '#FFFFFF',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else if (startupError !== null) {
    void mainWindow.loadURL(errorHtml('Không khởi động được', startupError));
  } else {
    const indexFile = rendererIndexPath();
    if (indexFile === null) {
      void mainWindow.loadURL(
        errorHtml(
          'Chưa build giao diện (renderer)',
          'Không tìm thấy dist/renderer/index.html.\n\nHãy chạy:\n  npm run build:renderer\n\n' +
            'rồi mở lại app (npm run dev). Chi tiết xem specs/run-report.md.',
        ),
      );
    } else {
      void mainWindow.loadFile(indexFile);
    }
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.setMenu(null);
}

void app.whenReady().then(() => {
  // BE-004: bỏ hẳn menu mặc định (Electron 33 Windows: setApplicationMenu(null) toàn app + setMenu(null)/autoHideMenuBar cho chắc).
  Menu.setApplicationMenu(null);
  let db: AppDb | null = null;
  let startupError: string | null = null;
  try {
    const dbPath = app.isPackaged ? defaultDbPath(app.getPath('userData')) : defaultDbPath();
    db = openDatabase(dbPath);
    registerIpcHandlers(db);
    // M3 (BE-015): auto-backup 03:00 hằng ngày, giữ 7 bản. Lỗi job không crash app.
    try {
      startDailyBackupJob(db);
    } catch {
      // ignore — backup tay qua backup:now vẫn dùng được
    }
    // BE-021 (DS-014 V1): scheduler thông báo desktop (E1–E4) + check bù lúc mở app.
    try {
      startNotificationScheduler(db, () => mainWindow);
    } catch {
      // ignore — app vẫn chạy không Toast, renderer tự render banner in-app
    }
  } catch (err) {
    // Never crash on startup: show the window with the error (DB missing binding, etc).
    startupError =
      err instanceof Error
        ? `${err.message}\n\nChi tiết xem specs/run-report.md.`
        : String(err);
  }
  createWindow(startupError);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(startupError);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  try {
    stopNotificationScheduler();
  } catch {
    // ignore
  }
});
