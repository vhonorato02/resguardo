/** Minimal GoTrue REST client. Publishable key only: never service-role credentials in browser. */
import { SUPABASE_URL as URL, SUPABASE_PUBLISHABLE_KEY as PUBLISHABLE_KEY } from './config.mjs';
export { URL, PUBLISHABLE_KEY };
const KEY = 'resguardo-auth-v1';
let session = null;
let refreshPromise = null;
const headers = (token, json = true) => ({ apikey: PUBLISHABLE_KEY, ...(json ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) });
export async function request(path, options = {}, authenticated = true) {
  const token = authenticated ? await getAccessToken() : null;
  if (authenticated && !token) throw new Error('Entre na sua conta para sincronizar.');
  const response = await fetch(URL + path, { ...options, headers: { ...headers(token), ...(options.headers || {}) } });
  if (!response.ok) {
    let cause = '';
    try { const x = await response.json(); cause = x.msg || x.message || x.error_description || x.error || ''; } catch {}
    const error = new Error(`Supabase (${response.status}): ${cause || response.statusText}`);
    error.status = response.status; throw error;
  }
  if (response.status === 204 || response.headers.get('content-length') === '0') return null;
  return response.json();
}
export function restoreSession() {
  try { session = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { session = null; }
  if (session && (!session.access_token || !session.refresh_token)) session = null;
  return session;
}
export function currentUser() { return session?.user || null; }
export function sessionExists() { return !!session?.refresh_token; }
export function setSession(next) {
  if (!next?.access_token || !next?.refresh_token) throw new Error('Sessão inválida.');
  session = { ...next, expires_at: next.expires_at || Math.floor(Date.now() / 1000) + (next.expires_in || 3600) };
  localStorage.setItem(KEY, JSON.stringify(session));
  return session;
}
export async function getAccessToken() {
  const active = session;
  if (!active) return null;
  if (active.expires_at > Math.floor(Date.now() / 1000) + 90) return active.access_token;
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const next = await request('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', body: JSON.stringify({ refresh_token: active.refresh_token }),
      }, false);
      if (session !== active) return session?.access_token || null;
      setSession(next);
      return session.access_token;
    } catch (error) {
      // A failed stale refresh must never invalidate a newer signed-in session.
      if (session === active && (error.status === 400 || error.status === 401)) {
        session = null;
        localStorage.removeItem(KEY);
      }
      throw error;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}
export async function authPassword(email, password, mode = 'login') {
  const address = String(email).trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(address)) throw new Error('E-mail inválido.');
  if (password.length < 8) throw new Error('A senha deve ter pelo menos 8 caracteres.');
  const redirect = encodeURIComponent(window.location.origin + '/');
  const url = mode === 'signup' ? `/auth/v1/signup?redirect_to=${redirect}` : '/auth/v1/token?grant_type=password';
  const result = await request(url, { method: 'POST', body: JSON.stringify({ email: address, password }) }, false);
  if (result.access_token) setSession(result);
  return result;
}
export async function requestReset(email) {
  return request(`/auth/v1/recover?redirect_to=${encodeURIComponent(window.location.origin + '/')}`, { method: 'POST', body: JSON.stringify({ email: String(email).trim().toLowerCase() }) }, false);
}
export async function updatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) throw new Error('A nova senha deve ter pelo menos 8 caracteres.');
  return request('/auth/v1/user', { method: 'PUT', body: JSON.stringify({ password }) });
}
export async function signOut() {
  try { if (session?.access_token) await request('/auth/v1/logout', { method: 'POST' }); } catch {}
  session = null; localStorage.removeItem(KEY);
}
export async function checkSession() {
  if (!session) return null;
  if (typeof navigator !== 'undefined' && navigator.onLine === false && session.user?.id) return session.user;
  try { const user = await request('/auth/v1/user'); if (user?.id) { session.user = user; localStorage.setItem(KEY, JSON.stringify(session)); } return session.user; }
  catch (error) { if (error.status === 401 || error.status === 403) { session = null; localStorage.removeItem(KEY); return null; }
    return session?.user?.id ? session.user : null; }
}
export async function rest(path, method = 'GET', body = null, extraHeaders = {}) {
  return request('/rest/v1/' + path, { method, headers: extraHeaders, ...(body === null ? {} : { body: JSON.stringify(body) }) });
}
export async function storageUpload(path, blob, contentType) {
  const token = await getAccessToken();
  if (!token) throw new Error('Sessão necessária.');
  const response = await fetch(`${URL}/storage/v1/object/resguardo-evidencias/${path}`, {
    method: 'POST', headers: { apikey: PUBLISHABLE_KEY, authorization: `Bearer ${token}`, 'Content-Type': contentType, 'x-upsert': 'false' }, body: blob,
  });
  if (!response.ok && response.status !== 409) throw new Error(`Falha no anexo (${response.status}).`);
  return path;
}
export async function storageDownload(path) {
  const token = await getAccessToken();
  if (!token) throw new Error('Entre na sua conta.');
  const result = await fetch(`${URL}/storage/v1/object/authenticated/resguardo-evidencias/${path}`, { headers: { apikey: PUBLISHABLE_KEY, authorization: `Bearer ${token}` } });
  if (!result.ok) throw new Error(`Não foi possível recuperar o arquivo (${result.status}).`);
  return result.blob();
}
