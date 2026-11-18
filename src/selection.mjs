export function markerAtClick(marker, point, tolerance = 48) {
  if (!marker || !point || !Number.isFinite(marker.x) || !Number.isFinite(marker.y)) return false;
  return Math.hypot(marker.x - point.x, marker.y - point.y) <= tolerance;
}

// The same feedback is used with either one map image or a street/compass/map set.
export function correctionHint(audit, mapImageAvailable = true) {
  if(!mapImageAvailable||!audit?.has_correction)return '';
  return `在地图尚未变化时，核对模型建议目标在当前地图局部图坐标 x=${audit.correction_x}, y=${audit.correction_y}；仅作建议，请自行判断。`;
}

// Relative coordinates from an earlier map image cannot survive a map change.
export function invalidatesCorrection(type, kind) {
  return ['hover','map_control','map_scroll','map_select','select_and_review'].includes(type) || (['scroll','click'].includes(type) && kind==='map');
}

export function selectionVerdict(verdict) {
  if (!verdict || !['match','mismatch','uncertain'].includes(verdict.verdict) || typeof verdict.reason !== 'string' || !verdict.reason.trim() || typeof verdict.marker !== 'string' || !verdict.marker.trim()) throw Error('选点核对输出无效');
  if (typeof verdict.approximate_ok !== 'boolean') throw Error('选点核对缺少范围级可用性判断');
  if (typeof verdict.evidence_label !== 'string') throw Error('选点核对缺少可见地名证据');
  if (typeof verdict.target_country_code !== 'string' || !/^(?:[A-Z]{2})?$/.test(verdict.target_country_code)) throw Error('选点核对国家代码无效');
  if (typeof verdict.has_correction !== 'boolean' || !Number.isFinite(verdict.correction_x) || !Number.isFinite(verdict.correction_y) || verdict.correction_x < 0 || verdict.correction_x > 1 || verdict.correction_y < 0 || verdict.correction_y > 1 || (verdict.verdict !== 'mismatch' && verdict.has_correction)) throw Error('选点核对坐标无效');
  if (verdict.verdict === 'match' && (!verdict.evidence_label.trim() || /^(北美洲|南美洲|欧洲|亚洲|非洲|大洋洲|南极洲|north america|south america|europe|asia|africa|oceania|antarctica)$/i.test(verdict.evidence_label.trim()))) return {...verdict,verdict:'uncertain',reason:'缺少足够具体的可见地名；请放大地图后重新核对。',has_correction:false,approximate_ok:false};
  return verdict;
}
export function markerHasContext(evidence, margin = .08) {
  const {pin,x,y,width,height} = evidence ?? {};
  if (!pin || ![pin.x,pin.y,x,y,width,height].every(Number.isFinite) || width<=0 || height<=0) return false;
  const px=(pin.x-x)/width, py=(pin.y-y)/height;
  return px>=margin && px<=1-margin && py>=margin && py<=1-margin;
}
