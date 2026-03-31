import { useEffect, useRef, useState } from 'react';
import { getFrameCount, getSprite, type PetAction } from '@/petclaw/sprites';

const WINDOW_SIZE = 192;
const PIXEL_SCALE = 8;
const SPRITE_PIXEL_SIZE = 16;
const RENDERED_SPRITE_SIZE = SPRITE_PIXEL_SIZE * PIXEL_SCALE;
const SPRITE_X = Math.floor((WINDOW_SIZE - RENDERED_SPRITE_SIZE) / 2);
const SPRITE_Y = 18;
const FRAME_INTERVAL_MS = 1000 / 8;

const ACTION_SEQUENCE: Array<{
  action: PetAction;
  flipChance: number;
  maxMs: number;
  minMs: number;
}> = [
  { action: 'idle', minMs: 1400, maxMs: 2400, flipChance: 0.25 },
  { action: 'walk', minMs: 1800, maxMs: 3000, flipChance: 0.5 },
  { action: 'happy', minMs: 900, maxMs: 1500, flipChance: 0.65 },
  { action: 'idle', minMs: 1100, maxMs: 2100, flipChance: 0.2 },
  { action: 'sleep', minMs: 2600, maxMs: 4200, flipChance: 0 },
];

function randomBetween(min: number, max: number): number {
  return Math.round(min + Math.random() * (max - min));
}

function getVerticalOffset(action: PetAction, frame: number): number {
  switch (action) {
    case 'walk':
      return frame % 2 === 0 ? 0 : -2;
    case 'happy':
      return frame % 2 === 0 ? -3 : -1;
    case 'sleep':
      return 6;
    default:
      return frame % 2 === 0 ? 0 : -1;
  }
}

function drawPetFrame(
  ctx: CanvasRenderingContext2D,
  action: PetAction,
  frame: number,
  direction: 1 | -1,
): void {
  const { palette, pixels, size } = getSprite(action, frame);
  const verticalOffset = getVerticalOffset(action, frame);

  ctx.save();
  ctx.globalAlpha = action === 'sleep' ? 0.16 : 0.22;
  ctx.fillStyle = '#2a130e';
  ctx.beginPath();
  ctx.ellipse(WINDOW_SIZE / 2, WINDOW_SIZE - 26, 42, action === 'sleep' ? 10 : 12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const colorIndex = pixels[row]?.[col] ?? 0;
      if (colorIndex === 0) {
        continue;
      }

      const color = palette[colorIndex];
      if (!color || color === 'transparent') {
        continue;
      }

      const drawCol = direction === -1 ? size - 1 - col : col;
      ctx.fillStyle = color;
      ctx.fillRect(
        SPRITE_X + drawCol * PIXEL_SCALE,
        SPRITE_Y + verticalOffset + row * PIXEL_SCALE,
        PIXEL_SCALE,
        PIXEL_SCALE,
      );
    }
  }
}

export function DesktopPetApp() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [action, setAction] = useState<PetAction>('idle');
  const [direction, setDirection] = useState<1 | -1>(1);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | null = null;
    let actionIndex = 0;

    const advanceAction = () => {
      const next = ACTION_SEQUENCE[actionIndex % ACTION_SEQUENCE.length];
      actionIndex += 1;
      setAction(next.action);

      if (Math.random() < next.flipChance) {
        setDirection((previous) => (previous === 1 ? -1 : 1));
      }

      timeoutId = window.setTimeout(() => {
        if (!cancelled) {
          advanceAction();
        }
      }, randomBetween(next.minMs, next.maxMs));
    };

    advanceAction();

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  useEffect(() => {
    setFrame(0);
    const frameCount = getFrameCount(action);
    const intervalId = window.setInterval(() => {
      setFrame((current) => (current + 1) % frameCount);
    }, FRAME_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [action]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const expectedWidth = WINDOW_SIZE * dpr;
    const expectedHeight = WINDOW_SIZE * dpr;

    if (canvas.width !== expectedWidth || canvas.height !== expectedHeight) {
      canvas.width = expectedWidth;
      canvas.height = expectedHeight;
      canvas.style.width = `${WINDOW_SIZE}px`;
      canvas.style.height = `${WINDOW_SIZE}px`;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, WINDOW_SIZE, WINDOW_SIZE);
    drawPetFrame(ctx, action, frame, direction);
  }, [action, direction, frame]);

  return (
    <div className="pet-window-root">
      <canvas
        ref={canvasRef}
        aria-label="TnymaAI desktop pet"
        className="pet-window-canvas"
      />
    </div>
  );
}
