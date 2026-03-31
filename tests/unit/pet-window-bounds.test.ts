import { describe, expect, it } from 'vitest';
import { constrainRectToWorkArea, getDefaultPetBounds } from '@electron/main/pet-window-bounds';

describe('pet window bounds helpers', () => {
  it('keeps an already visible window unchanged', () => {
    expect(
      constrainRectToWorkArea(
        { x: 40, y: 60, width: 192, height: 192 },
        { x: 0, y: 0, width: 1440, height: 900 },
      ),
    ).toEqual({ x: 40, y: 60, width: 192, height: 192 });
  });

  it('clamps a window that would leave the left or top edge', () => {
    expect(
      constrainRectToWorkArea(
        { x: -80, y: -20, width: 192, height: 192 },
        { x: 0, y: 0, width: 1440, height: 900 },
      ),
    ).toEqual({ x: 0, y: 0, width: 192, height: 192 });
  });

  it('clamps a window that would leave the right or bottom edge', () => {
    expect(
      constrainRectToWorkArea(
        { x: 1400, y: 840, width: 192, height: 192 },
        { x: 0, y: 0, width: 1440, height: 900 },
      ),
    ).toEqual({ x: 1248, y: 708, width: 192, height: 192 });
  });

  it('shrinks oversized bounds to the available work area', () => {
    expect(
      constrainRectToWorkArea(
        { x: 100, y: 100, width: 500, height: 400 },
        { x: 10, y: 20, width: 320, height: 240 },
      ),
    ).toEqual({ x: 10, y: 20, width: 320, height: 240 });
  });

  it('places the default pet near the lower-right corner with margin', () => {
    expect(
      getDefaultPetBounds({ x: 0, y: 0, width: 1440, height: 900 }, 192, 24),
    ).toEqual({ x: 1224, y: 684, width: 192, height: 192 });
  });
});
