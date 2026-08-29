import QueueStatusClient from '@/components/QueueStatusClient';

export default async function QueuePage({ params }: { params: Promise<{ queueNumber: string }> }) {
  const { queueNumber } = await params;
  return <QueueStatusClient queueNumber={decodeURIComponent(queueNumber).toUpperCase()} />;
}
