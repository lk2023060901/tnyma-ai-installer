export interface RectangleLike {
  height: number;
  width: number;
  x: number;
  y: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function constrainRectToWorkArea(
  bounds: RectangleLike,
  workArea: RectangleLike,
): RectangleLike {
  const width = Math.min(bounds.width, workArea.width);
  const height = Math.min(bounds.height, workArea.height);
  const maxX = workArea.x + workArea.width - width;
  const maxY = workArea.y + workArea.height - height;

  return {
    x: clamp(bounds.x, workArea.x, maxX),
    y: clamp(bounds.y, workArea.y, maxY),
    width,
    height,
  };
}

export function getDefaultPetBounds(
  workArea: RectangleLike,
  size: number,
  margin = 24,
): RectangleLike {
  return constrainRectToWorkArea(
    {
      x: workArea.x + workArea.width - size - margin,
      y: workArea.y + workArea.height - size - margin,
      width: size,
      height: size,
    },
    workArea,
  );
}
