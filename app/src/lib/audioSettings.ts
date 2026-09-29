export function audioOptionValue(value: number, presets: readonly number[]): string {
  const preset = presets.find((candidate) => Math.abs(candidate - value) < 0.000001);
  return String(preset ?? value);
}
