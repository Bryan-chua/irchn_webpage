import { notFound } from 'next/navigation';
import ModeratorDashboard from '@/components/ModeratorDashboard';
import { isHouseCode } from '@/lib/houses';

export default async function DashboardPage({ params }: { params: Promise<{ houseCode: string }> }) {
  const { houseCode: raw } = await params; const houseCode = raw.toUpperCase(); if (!isHouseCode(houseCode)) notFound(); return <ModeratorDashboard expectedHouse={houseCode} />;
}
