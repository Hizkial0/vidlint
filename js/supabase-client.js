// js/supabase-client.js
const SUPABASE_URL = 'https://gvksgexxdjltbmdweohw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2a3NnZXh4ZGpsdGJtZHdlb2h3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxNzYxMzYsImV4cCI6MjA4Nzc1MjEzNn0.GJvqpVkS-aLtvRwtghDD-1CjfqoAyWh_cWqywhLn9g8';

if (!window.supabase) {
    throw new Error('Supabase SDK not loaded. Make sure the CDN script loads first.');
}

window.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
    }
});
