/**
 * API HTTP del laboratorio (Vite dev) — no depende del relay WebSocket.
 */

export async function verifyModelsHttp(items) {
  const res = await fetch('/ironsync/api/verify-models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) throw new Error(`verify-models HTTP ${res.status}`);
  const data = await res.json();
  return data.results ?? [];
}

export async function verifyTcnModelHttp(tcnPath) {
  const query = new URLSearchParams({ path: tcnPath });
  const res = await fetch(`/ironsync/api/verify-tcn?${query}`);
  if (!res.ok) throw new Error(`verify-tcn HTTP ${res.status}`);
  return res.json();
}

export async function startPpoTrainingHttp(payload) {
  const res = await fetch('/ironsync/api/start-ppo-training', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `start-ppo HTTP ${res.status}`);
  }
  return res.json();
}

export async function stopPpoTrainingHttp() {
  await fetch('/ironsync/api/stop-ppo-training', { method: 'POST' });
}

export async function fetchPpoLiveFrameHttp() {
  const res = await fetch('/ironsync/api/ppo-live-frame');
  if (!res.ok) return null;
  const text = await res.text();
  if (!text || text === 'null') return null;
  return JSON.parse(text);
}
