const API_BASE = '/ironsync/api/collections';

export const COLLECTIONS_REL_PATH = 'artifacts/colecciones';

async function parseJsonResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || `HTTP ${response.status}`);
  }
  return payload;
}

export async function listCollections() {
  const response = await fetch(API_BASE);
  return parseJsonResponse(response);
}

export async function createCollection() {
  const response = await fetch(API_BASE, { method: 'POST' });
  return parseJsonResponse(response);
}

export async function loadCollection(stamp) {
  const safe = encodeURIComponent(String(stamp ?? '').trim());
  const response = await fetch(`${API_BASE}/${safe}/load`);
  return parseJsonResponse(response);
}

export async function saveDatasetToCollection(bundle) {
  const response = await fetch(`${API_BASE}/save-dataset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bundle),
  });
  return parseJsonResponse(response);
}
