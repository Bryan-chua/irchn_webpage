import type { HouseCode } from './houses';

// Edit these values whenever a haunted house changes its estimated time per group.
export const MINUTES_PER_GROUP: Record<HouseCode, number> = {
  RV: 4,
  CP: 5,
  AC: 7,
  TM: 10,
  R4: 5,
  NS: 5,
};

export function minutesPerGroup(houseCode: HouseCode) {
  return MINUTES_PER_GROUP[houseCode];
}

const SECONDS_PER_MINUTE = 60;

export function estimatedWaitSeconds(
  houseCode: HouseCode,
  groupsAhead: number,
  lastEnteredAt?: number | null,
  now = Date.now(),
) {
  const groupSeconds = minutesPerGroup(houseCode) * SECONDS_PER_MINUTE;
  if (!lastEnteredAt) return Math.max(0, groupsAhead) * groupSeconds;

  const elapsedSeconds = Math.max(0, Math.floor((now - lastEnteredAt) / 1000));
  return Math.max(0, (Math.max(0, groupsAhead) + 1) * groupSeconds - elapsedSeconds);
}

export function estimatedClearSeconds(
  houseCode: HouseCode,
  waitingGroups: number,
  lastEnteredAt?: number | null,
  now = Date.now(),
) {
  if (waitingGroups <= 0) return 0;
  return estimatedWaitSeconds(houseCode, waitingGroups - 1, lastEnteredAt, now);
}
