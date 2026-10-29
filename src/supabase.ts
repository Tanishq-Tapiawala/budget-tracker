import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL || "https://not-configured.invalid";
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || "not-configured";
export const configured = Boolean(
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY,
);

const rememberSessionKey = "my-money-remember-session";
const inactivityKey = "my-money-last-activity";
export const inactivityMs = 30 * 60 * 1000;

const authStorage = {
  getItem(key: string) {
    if (typeof window === "undefined") return null;
    const storage =
      window.localStorage.getItem(rememberSessionKey) === "true"
        ? window.localStorage
        : window.sessionStorage;
    return storage.getItem(key);
  },
  setItem(key: string, value: string) {
    if (typeof window === "undefined") return;
    const remember = window.localStorage.getItem(rememberSessionKey) === "true";
    const storage = remember ? window.localStorage : window.sessionStorage;
    const otherStorage = remember ? window.sessionStorage : window.localStorage;
    storage.setItem(key, value);
    otherStorage.removeItem(key);
  },
  removeItem(key: string) {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(key);
    window.sessionStorage.removeItem(key);
  },
};

export function setRememberSession(remember: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(rememberSessionKey, String(remember));
}

export function markActivity() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(inactivityKey, Date.now().toString());
}

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: authStorage,
  },
});

export async function signOut() {
  const result = await supabase.auth.signOut();
  setRememberSession(false);
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(inactivityKey);
  }
  return result;
}
