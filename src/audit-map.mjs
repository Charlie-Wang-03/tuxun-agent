import { markerHasContext } from './selection.mjs';

// Inspect the same selected pin at a closer visible-map scale. Never retry a wheel event.
export async function prepareAuditMap({ evidence, zoom, verify, capture }) {
  if (!markerHasContext(evidence)) throw Error('图钉靠近地图边缘，无法可靠放大核对');
  await zoom(evidence.pin);
  await verify();
  const updated=await capture();
  if (!markerHasContext(updated)) throw Error('放大后图钉或地图上下文不足，无法核对');
  return updated;
}
