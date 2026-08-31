let injectedNow: Date | null = null;

/** Test-only injectable clock (AUTONOMOUS_TEST_CLOCK_ISO). */
export function autonomousNow(): Date {
  if (injectedNow) return new Date(injectedNow.getTime());
  const env = process.env.AUTONOMOUS_TEST_CLOCK_ISO;
  if (env && /^\d{4}-\d{2}-\d{2}T/.test(env)) return new Date(env);
  return new Date();
}

export function setAutonomousTestClock(iso: string | null) {
  injectedNow = iso ? new Date(iso) : null;
}

export function resetAutonomousTestClock() {
  injectedNow = null;
}
