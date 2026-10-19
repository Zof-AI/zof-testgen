export function classify(value: number): string {
  if (value < 0) return "negative";
  if (value === 0) return "zero";
  return "positive";
}
