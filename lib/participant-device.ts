// Keep one token even when browser storage is unavailable for this page load.
let deviceToken: string | null = null;
export function getParticipantDeviceToken() {
  if (deviceToken) return deviceToken;
  try {
    const saved = localStorage.getItem('night-of-frights-device-id');
    if (saved && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved)) deviceToken = saved;
    else {
      deviceToken = crypto.randomUUID();
      localStorage.setItem('night-of-frights-device-id', deviceToken);
    }
  } catch { deviceToken ||= crypto.randomUUID(); }
  return deviceToken;
}
