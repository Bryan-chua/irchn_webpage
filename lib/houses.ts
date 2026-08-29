export const HOUSES = [
  { name: 'RVRC', code: 'RV', accent: '#ff7a32' },
  { name: 'CAPT', code: 'CP', accent: '#c98cff' },
  { name: 'Acacia', code: 'AC', accent: '#63d6a2' },
  { name: 'Tembusu', code: 'TM', accent: '#ffcf5a' },
  { name: 'RC4', code: 'R4', accent: '#63b3ff' },
  { name: 'NUSC', code: 'NS', accent: '#ff7293' },
] as const;

export type HouseCode = (typeof HOUSES)[number]['code'];
export const HOUSE_CODES = HOUSES.map((house) => house.code);
export const HOUSE_BY_CODE = Object.fromEntries(HOUSES.map((house) => [house.code, house])) as Record<HouseCode, (typeof HOUSES)[number]>;

export function isHouseCode(value: string): value is HouseCode {
  return HOUSE_CODES.includes(value as HouseCode);
}
