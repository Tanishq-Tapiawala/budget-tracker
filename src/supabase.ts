import {createClient} from "@supabase/supabase-js";
const url=import.meta.env.VITE_SUPABASE_URL || "https://not-configured.invalid";
const key=import.meta.env.VITE_SUPABASE_ANON_KEY || "not-configured";
export const configured=Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
export const supabase=createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
