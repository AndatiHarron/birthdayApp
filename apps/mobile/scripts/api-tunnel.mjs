/**
 * A public https URL for the local API, for phones that cannot reach the
 * laptop's LAN address — for example when the laptop is connected to that same
 * phone's hotspot, where iOS will not route back to its own clients.
 *
 *   node scripts/api-tunnel.mjs        (leave running; Ctrl+C to stop)
 *
 * Put the printed URL in apps/mobile/.env as EXPO_PUBLIC_API_URL, then start
 * Expo with `npx expo start --tunnel`.
 */
import ngrok from '@expo/ngrok';

const port = Number(process.env.API_PORT ?? 4000);
const url = await ngrok.connect({ addr: port, proto: 'http' });

console.log(`API tunnel ready: ${url} -> http://localhost:${port}`);
console.log('Set EXPO_PUBLIC_API_URL to that URL and restart Expo with --tunnel.');

const stop = async () => {
  await ngrok.disconnect();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
