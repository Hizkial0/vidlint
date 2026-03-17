const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const fetch = require('node-fetch');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function usage() {
    console.log('Usage: node upgrade_user.js <email> [plan]');
    console.log('Example: node upgrade_user.js creator@example.com pro');
}

function createHeaders() {
    return {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
    };
}

async function getAuthUserByEmail(email) {
    // List users via Admin API
    const url = `${SUPABASE_URL}/auth/v1/admin/users`;
    const res = await fetch(url, { headers: createHeaders() });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Auth API failed (${res.status}): ${text}`);
    }

    const { users } = await res.json();
    return users.find(u => u.email.toLowerCase() === email.toLowerCase()) || null;
}

async function getProfileByEmail(email) {
    const url = `${SUPABASE_URL}/rest/v1/profiles?select=id,email,plan,subscription_status&email=eq.${encodeURIComponent(email)}&limit=1`;
    const res = await fetch(url, { headers: createHeaders() });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Supabase query failed (${res.status}): ${text}`);
    }

    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return rows[0];
}

async function createProfile(userId, email) {
    const url = `${SUPABASE_URL}/rest/v1/profiles`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            ...createHeaders(),
            'Prefer': 'return=representation'
        },
        body: JSON.stringify({
            id: userId,
            email: email,
            plan: 'free',
            subscription_status: 'inactive'
        })
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Profile creation failed (${res.status}): ${text}`);
    }
    const rows = await res.json();
    return rows[0];
}

async function upgradeProfile(profileId, plan) {
    const url = `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(profileId)}`;
    const payload = {
        plan,
        subscription_status: 'active'
    };

    const res = await fetch(url, {
        method: 'PATCH',
        headers: {
            ...createHeaders(),
            Prefer: 'return=representation'
        },
        body: JSON.stringify(payload)
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Supabase update failed (${res.status}): ${text}`);
    }

    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) {
        throw new Error('Supabase update succeeded but returned no rows.');
    }
    return rows[0];
}

async function main() {
    const emailArg = (process.argv[2] || '').trim().toLowerCase();
    const planArg = (process.argv[3] || 'pro').trim().toLowerCase();

    if (!emailArg) {
        usage();
        process.exit(1);
    }

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
        throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable.');
    }

    console.log(`[UpgradeUser] Looking up profile for ${emailArg}...`);
    let profile = await getProfileByEmail(emailArg);
    
    if (!profile) {
        console.log(`[UpgradeUser] Profile not found. Checking Auth users...`);
        const authUser = await getAuthUserByEmail(emailArg);
        if (!authUser) {
            throw new Error(`No user found in Auth or Profiles for email: ${emailArg}`);
        }
        
        console.log(`[UpgradeUser] Found Auth user (${authUser.id}). Creating profile row...`);
        profile = await createProfile(authUser.id, emailArg);
    }

    console.log(`[UpgradeUser] Current plan: ${profile.plan || 'none'} | subscription_status: ${profile.subscription_status || 'none'}`);
    const updated = await upgradeProfile(profile.id, planArg);
    console.log(`[UpgradeUser] Upgrade complete for ${updated.email}.`);
    console.log(`[UpgradeUser] New plan: ${updated.plan} | subscription_status: ${updated.subscription_status}`);
}

main().catch((err) => {
    console.error('[UpgradeUser] Failed:', err.message);
    process.exit(1);
});
