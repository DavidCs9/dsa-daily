export function elapsedSessionSeconds(accumulatedSeconds: number, runningSince: number | null, now: number) {
  if (runningSince === null) return accumulatedSeconds;
  return accumulatedSeconds + Math.max(0, Math.floor((now - runningSince) / 1_000));
}

export function reachedSessionTarget(elapsedSeconds: number, targetSeconds: number) {
  return elapsedSeconds >= targetSeconds;
}
