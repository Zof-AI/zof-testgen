export function clamp(value: number): number {
  if (value < 0) return 0;
  return Math.min(5, value);
}
