export const HOUSES = [
  { name: 'RVRC', code: 'RV', title: 'Haunted Theatre', location: 'The Hub @ Block C, E', accent: '#ff7a32' },
  { name: 'CAPT', code: 'CP', title: 'Abandoned Museum', location: 'MPSH @ L1', accent: '#c98cff' },
  { name: 'Acacia', code: 'AC', title: 'Abandoned Laboratory', location: 'Learn Lobe', accent: '#63d6a2' },
  { name: 'Tembusu', code: 'TM', title: 'Haunted Hospital', location: 'Seminar Rooms 4-6 @ B1', accent: '#ffcf5a' },
  { name: 'RC4', code: 'R4', title: 'Haunted Hotel', location: 'Seminar Rooms 1-3 @ B1', accent: '#63b3ff' },
  { name: 'NUSC', code: 'NS', title: 'Obsessionusc', location: 'MPH @ L1, near cafe/library', accent: '#ff7293' },
] as const;

export type HouseCode = (typeof HOUSES)[number]['code'];
export const MAX_GROUP_SIZE: Record<HouseCode, number> = {
  RV: 8,
  CP: 8,
  AC: 8,
  TM: 8,
  R4: 5,
  NS: 8,
};
export const HOUSE_CODES = HOUSES.map((house) => house.code);
export const HOUSE_BY_CODE = Object.fromEntries(HOUSES.map((house) => [house.code, house])) as Record<HouseCode, (typeof HOUSES)[number]>;

export function isHouseCode(value: string): value is HouseCode {
  return HOUSE_CODES.includes(value as HouseCode);
}
