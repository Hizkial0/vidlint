const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const fetch = require('node-fetch');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function createHeaders() {
    return {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
    };
}

async function listProfiles() {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
        console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable.');
        return;
    }

    const url = `${SUPABASE_URL}/rest/v1/profiles?select=email,plan,subscription_status,created_at&order=created_at.desc`;
    try {
        const res = await fetch(url, { headers: createHeaders() });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Supabase query failed (${res.status}): ${text}`);
        }

        const profiles = await res.json();

        console.log('\n--- USER PROFILES (Supabase) ---\n');
        if (profiles.length === 0) {
            console.log('No profiles found.');
        } else {
            console.table(profiles.map(p => ({
                Email: p.email,
                Plan: p.plan,
                Status: p.subscription_status,
                Joined: new Date(p.created_at).toLocaleDateString()
            })));
        }
        console.log('\n-------------------------------\n');
    } catch (err) {
        console.error('Failed to list profiles:', err.message);
    }
}

listProfiles();
