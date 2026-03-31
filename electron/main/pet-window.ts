import { BrowserWindow, screen } from 'electron';
import { join } from 'path';
import { constrainRectToWorkArea, getDefaultPetBounds } from './pet-window-bounds';

const PET_WINDOW_MARGIN = 24;
const PET_WINDOW_SIZE = 192;

let petWindow: BrowserWindow | null = null;
let isConstrainingMove = false;

function getPetWindowEntryPath(): string {
  return join(__dirname, '../../dist/pet.html');
}

async function loadPetWindow(win: BrowserWindow): Promise<void> {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    const url = new URL(devServerUrl);
    url.pathname = '/pet.html';
    url.hash = '';
    await win.loadURL(url.toString());
    return;
  }

  await win.loadFile(getPetWindowEntryPath());
}

function clampPetWindowToVisibleArea(win: BrowserWindow): void {
  if (win.isDestroyed()) {
    return;
  }

  const currentBounds = win.getBounds();
  const display = screen.getDisplayMatching(currentBounds);
  const nextBounds = constrainRectToWorkArea(currentBounds, display.workArea);

  if (
    currentBounds.x === nextBounds.x &&
    currentBounds.y === nextBounds.y &&
    currentBounds.width === nextBounds.width &&
    currentBounds.height === nextBounds.height
  ) {
    return;
  }

  isConstrainingMove = true;
  win.setBounds(nextBounds);
  isConstrainingMove = false;
}

export async function createPetWindow(): Promise<BrowserWindow> {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.showInactive();
    clampPetWindowToVisibleArea(petWindow);
    return petWindow;
  }

  const initialDisplay = screen.getPrimaryDisplay();
  const initialBounds = getDefaultPetBounds(
    initialDisplay.workArea,
    PET_WINDOW_SIZE,
    PET_WINDOW_MARGIN,
  );

  const win = new BrowserWindow({
    ...initialBounds,
    title: 'TnymaAI Pet',
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  if (process.platform === 'darwin') {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  petWindow = win;

  const handleDisplayChange = () => {
    clampPetWindowToVisibleArea(win);
  };

  screen.on('display-added', handleDisplayChange);
  screen.on('display-removed', handleDisplayChange);
  screen.on('display-metrics-changed', handleDisplayChange);

  win.on('ready-to-show', () => {
    if (petWindow !== win) {
      return;
    }

    clampPetWindowToVisibleArea(win);
    win.showInactive();
  });

  win.on('move', () => {
    if (isConstrainingMove) {
      return;
    }

    clampPetWindowToVisibleArea(win);
  });

  win.on('closed', () => {
    if (petWindow === win) {
      petWindow = null;
    }
    screen.off('display-added', handleDisplayChange);
    screen.off('display-removed', handleDisplayChange);
    screen.off('display-metrics-changed', handleDisplayChange);
  });

  await loadPetWindow(win);
  return win;
}
