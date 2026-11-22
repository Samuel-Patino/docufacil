// Bloqueo de carpetas y archivos: cifrado AES-GCM dentro del dispositivo.
// La clave maestra se protege con el PIN (PBKDF2) y, si el dispositivo lo permite,
// con huella/Face ID mediante WebAuthn (extensión PRF).
import { kvGet, kvSet, type Sealed } from './db';
import { useApp } from './store';

interface Wrapped {
  iv: Uint8Array;
  data: ArrayBuffer;
}
interface LockConfig {
  salt: Uint8Array;
  iter: number;
  pin: Wrapped;
  pinLength: number;
  bio?: { credId: string; prfSalt: Uint8Array; wrap: Wrapped };
}

let master: CryptoKey | null = null;

const enc = new TextEncoder();
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n));

export class LockedError extends Error {
  constructor() {
    super('Contenido bloqueado. Desbloquea con tu PIN.');
  }
}

export async function getLockConfig(): Promise<LockConfig | undefined> {
  return kvGet<LockConfig>('lock');
}
export async function hasPin() {
  return !!(await getLockConfig());
}
export const isUnlocked = () => !!master;

async function pinKey(pin: string, salt: Uint8Array, iter: number) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: iter, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function wrap(kek: CryptoKey, key: CryptoKey): Promise<Wrapped> {
  const raw = await crypto.subtle.exportKey('raw', key);
  const iv = rand(12);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, kek, raw);
  return { iv, data };
}
async function unwrap(kek: CryptoKey, w: Wrapped): Promise<CryptoKey> {
  const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: w.iv as BufferSource }, kek, w.data);
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', true, ['encrypt', 'decrypt']);
}

function setUnlocked(v: boolean) {
  useApp.setState({ unlocked: v });
}

/** Crea el PIN (o lo cambia si ya está desbloqueado). */
export async function setPin(pin: string) {
  const cfg = await getLockConfig();
  if (cfg && !master) throw new LockedError();
  if (!master) {
    master = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  }
  const salt = rand(16);
  const iter = 310000;
  const kek = await pinKey(pin, salt, iter);
  const next: LockConfig = { salt, iter, pin: await wrap(kek, master), pinLength: pin.length, bio: cfg?.bio };
  await kvSet('lock', next);
  setUnlocked(true);
}

export async function unlockWithPin(pin: string): Promise<boolean> {
  const cfg = await getLockConfig();
  if (!cfg) return false;
  try {
    const kek = await pinKey(pin, cfg.salt, cfg.iter);
    master = await unwrap(kek, cfg.pin);
    setUnlocked(true);
    return true;
  } catch {
    return false;
  }
}

export function lockNow() {
  master = null;
  setUnlocked(false);
}

// ---------- Huella / Face ID (WebAuthn PRF) ----------

export async function bioSupported(): Promise<boolean> {
  try {
    if (!window.PublicKeyCredential) return false;
    const ok = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    return ok;
  } catch {
    return false;
  }
}

async function prfKey(out: ArrayBuffer) {
  const base = await crypto.subtle.importKey('raw', out, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('docufacil-bio') as BufferSource, info: new Uint8Array() },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function prfEval(credId: Uint8Array, prfSalt: Uint8Array): Promise<ArrayBuffer | null> {
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: rand(32) as BufferSource,
      allowCredentials: [{ id: credId as BufferSource, type: 'public-key' }],
      userVerification: 'required',
      timeout: 60000,
      extensions: { prf: { eval: { first: prfSalt as BufferSource } } } as any,
    },
  })) as PublicKeyCredential | null;
  const res = (cred?.getClientExtensionResults() as any)?.prf?.results?.first;
  return res ? (res as ArrayBuffer) : null;
}

export async function enableBio(): Promise<{ ok: boolean; message: string }> {
  const cfg = await getLockConfig();
  if (!cfg || !master) return { ok: false, message: 'Primero crea tu PIN y desbloquea.' };
  const prfSalt = rand(32);
  try {
    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge: rand(32) as BufferSource,
        rp: { name: 'DocuFácil' },
        user: { id: rand(16) as BufferSource, name: 'docufacil', displayName: 'DocuFácil' },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
        timeout: 60000,
        extensions: { prf: { eval: { first: prfSalt as BufferSource } } } as any,
      },
    })) as PublicKeyCredential | null;
    if (!cred) return { ok: false, message: 'Cancelado.' };
    const ext = cred.getClientExtensionResults() as any;
    if (ext?.prf?.enabled === false) {
      return { ok: false, message: 'Este dispositivo no permite usar la huella para cifrar. Usa tu PIN.' };
    }
    const credId = new Uint8Array(cred.rawId);
    let out: ArrayBuffer | null = ext?.prf?.results?.first ?? null;
    if (!out) out = await prfEval(credId, prfSalt);
    if (!out) return { ok: false, message: 'Este dispositivo no permite usar la huella para cifrar. Usa tu PIN.' };
    const kek = await prfKey(out);
    cfg.bio = { credId: b64(credId), prfSalt, wrap: await wrap(kek, master) };
    await kvSet('lock', cfg);
    return { ok: true, message: 'Desbloqueo con huella / Face ID activado.' };
  } catch (e: any) {
    return { ok: false, message: e?.name === 'NotAllowedError' ? 'Cancelado.' : 'No se pudo activar: ' + (e?.message || e) };
  }
}

export async function disableBio() {
  const cfg = await getLockConfig();
  if (!cfg) return;
  delete cfg.bio;
  await kvSet('lock', cfg);
}

export async function unlockWithBio(): Promise<boolean> {
  const cfg = await getLockConfig();
  if (!cfg?.bio) return false;
  try {
    const out = await prfEval(unb64(cfg.bio.credId), cfg.bio.prfSalt);
    if (!out) return false;
    master = await unwrap(await prfKey(out), cfg.bio.wrap);
    setUnlocked(true);
    return true;
  } catch {
    return false;
  }
}

// ---------- Sellar / abrir datos ----------

export async function seal(blob: Blob): Promise<Sealed> {
  if (!master) throw new LockedError();
  const iv = rand(12);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, master, await blob.arrayBuffer());
  return { sealed: true, iv, data, type: blob.type };
}

export async function unseal(s: Sealed): Promise<Blob> {
  if (!master) throw new LockedError();
  const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: s.iv as BufferSource }, master, s.data);
  return new Blob([data], { type: s.type });
}

// Bloqueo automático al salir de la app por más de 1 minuto.
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (master && hiddenAt && Date.now() - hiddenAt > 60_000) lockNow();
});
