import { sanitizeHistory } from './history.mjs';

export const VAULT_KEY = 'twofa.history.v2';
export const DEVICE_KEY_ID = 'history-aes-gcm-v1';
const DB_NAME = 'rulio-2fa-vault';
const STORE_NAME = 'keys';
const AAD = new TextEncoder().encode('rulio-2fa-history-v2');
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function bytesToBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value, expectedLength) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('Invalid base64');
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  if (expectedLength && bytes.length !== expectedLength) throw new Error('Invalid byte length');
  return bytes;
}

function parseEnvelope(raw) {
  const envelope = JSON.parse(raw);
  if (!envelope || envelope.v !== 2 || envelope.keyId !== DEVICE_KEY_ID || envelope.cipher?.name !== 'AES-GCM') throw new Error('Invalid vault format');
  return {
    iv: base64ToBytes(envelope.cipher.iv, 12),
    ciphertext: base64ToBytes(envelope.data),
  };
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB unavailable'));
    request.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}

async function withStore(mode, action) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      let result;
      let request;
      try { request = action(transaction.objectStore(STORE_NAME)); }
      catch (error) { reject(error); return; }
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
      transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
    });
  } finally {
    database.close();
  }
}

async function storeDeviceKeyIfMissing(candidate) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const getRequest = store.get(DEVICE_KEY_ID);
      let key;
      getRequest.onsuccess = () => {
        if (getRequest.result instanceof CryptoKey) {
          key = getRequest.result;
          return;
        }
        key = candidate;
        const putRequest = store.put(candidate, DEVICE_KEY_ID);
        putRequest.onerror = () => reject(putRequest.error || new Error('IndexedDB key write failed'));
      };
      getRequest.onerror = () => reject(getRequest.error || new Error('IndexedDB key read failed'));
      transaction.oncomplete = () => resolve(key);
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
      transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
    });
  } finally {
    database.close();
  }
}

export function hasSecureStorage() {
  return Boolean(globalThis.isSecureContext && globalThis.crypto?.subtle && globalThis.crypto?.getRandomValues && globalThis.indexedDB);
}

export async function getOrCreateDeviceKey() {
  if (!hasSecureStorage()) throw new Error('当前环境不支持安全的设备加密存储。');
  const key = await withStore('readonly', store => store.get(DEVICE_KEY_ID));
  if (key instanceof CryptoKey) return key;
  const candidate = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return storeDeviceKeyIfMissing(candidate);
}

export async function encryptVault(entries, key) {
  const safeEntries = sanitizeHistory(entries);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify(safeEntries));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD, tagLength: 128 }, key, plaintext));
  return JSON.stringify({
    v: 2,
    keyId: DEVICE_KEY_ID,
    cipher: { name: 'AES-GCM', iv: bytesToBase64(iv), tagLength: 128 },
    data: bytesToBase64(ciphertext),
  });
}

export async function decryptVault(raw, key) {
  const { iv, ciphertext } = parseEnvelope(raw);
  let plaintext;
  try {
    plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: AAD, tagLength: 128 }, key, ciphertext);
  } catch {
    throw new Error('加密历史无法解锁，可能已损坏或设备密钥已丢失。');
  }
  try { return sanitizeHistory(JSON.parse(decoder.decode(plaintext))); }
  catch { throw new Error('加密历史内容无效。'); }
}

export async function deleteDeviceKey() {
  if (!globalThis.indexedDB) return;
  await withStore('readwrite', store => store.delete(DEVICE_KEY_ID));
}
