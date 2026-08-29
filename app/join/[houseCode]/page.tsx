import { notFound } from 'next/navigation';
import JoinClient from '@/components/JoinClient';
import { isHouseCode } from '@/lib/houses';

export default async function JoinPage({ params }: { params: Promise<{ houseCode: string }> }) {
  const { houseCode: raw } = await params;
  const houseCode = raw.toUpperCase();
  if (!isHouseCode(houseCode)) notFound();
  return <JoinClient houseCode={houseCode} />;
}
