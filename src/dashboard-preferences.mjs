export const preferenceKey = 'tuxun-dashboard-preferences';
export function normalizePreferences(value) {
  return {language:value?.language === 'en' ? 'en' : 'zh', theme:['light','dark','system'].includes(value?.theme) ? value.theme : 'system'};
}
export function readPreferences(storage) {
  try {return normalizePreferences(JSON.parse(storage.getItem(preferenceKey)));}
  catch {return normalizePreferences(null);}
}
export function savePreferences(storage, preferences) {
  try {storage.setItem(preferenceKey, JSON.stringify(normalizePreferences(preferences)));} catch { /* Storage may be disabled; controls still work. */ }
}
export function resolvedTheme(theme, systemDark) {
  return theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
}
export function minutesToSeconds(value) {
  const minutes = Number(value), seconds = minutes * 60;
  return Number.isSafeInteger(minutes) && minutes > 0 && Number.isSafeInteger(seconds) ? seconds : NaN;
}
