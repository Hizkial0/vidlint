// js/auth.js

async function signInWithGoogle(next = '/dashboard.html') {
    try {
        sessionStorage.setItem('post_login_redirect', next);

        const { error } = await window.sb.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: `${window.location.origin}/auth/callback.html`
            }
        });

        if (error) {
            console.error('Google sign-in failed:', error);
            alert('Google sign-in could not start.');
        }
    } catch (err) {
        console.error('Unexpected sign-in error:', err);
        alert('Unexpected sign-in error.');
    }
}

async function signOutUser() {
    try {
        const { error } = await window.sb.auth.signOut();
        if (error) {
            console.error('Sign out failed:', error);
            return;
        }
        window.location.href = '/index.html';
    } catch (err) {
        console.error('Unexpected sign-out error:', err);
    }
}

function handleLogoutClick(e) {
    if (e) e.preventDefault();
    const modal = document.getElementById('logout-modal');
    if (modal) {
        modal.classList.add('show');
    } else {
        // Fallback if modal isn't in DOM
        if (confirm('Are you sure you want to log out?')) {
            signOutUser();
        }
    }
}

function closeLogoutModal() {
    const modal = document.getElementById('logout-modal');
    if (modal) {
        modal.classList.remove('show');
    }
}

function togglePlanDropdown(e) {
    if (e) e.stopPropagation();
    const dropdown = document.getElementById('plan-dropdown');
    if (dropdown) {
        dropdown.classList.toggle('open');
    }
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('plan-dropdown');
    if (dropdown && !dropdown.contains(e.target)) {
        dropdown.classList.remove('open');
    }
});

async function getSession() {
    const { data, error } = await window.sb.auth.getSession();
    if (error) {
        console.error('Get session failed:', error);
        return null;
    }
    return data.session || null;
}

async function getUser() {
    const { data, error } = await window.sb.auth.getUser();
    if (error) {
        console.error('Get user failed:', error);
        return null;
    }
    return data.user || null;
}

async function getMyProfile() {
    const user = await getUser();
    if (!user) return null;

    const { data, error } = await window.sb
        .from('profiles')
        .select('id, email, full_name, avatar_url, plan, subscription_status')
        .eq('id', user.id)
        .single();

    if (error) {
        console.error('Profile fetch failed:', error);
        return null;
    }

    return data;
}

async function requireAuth({ redirectTo = '/index.html' } = {}) {
    const session = await getSession();
    if (!session) {
        window.location.href = redirectTo;
        return null;
    }
    return session;
}

function bindAuthTriggers() {
    const triggers = document.querySelectorAll('[data-auth-trigger="google"]');

    triggers.forEach((el) => {
        el.addEventListener('click', async (e) => {
            e.preventDefault();

            const next = el.getAttribute('data-next') || '/dashboard.html';
            await signInWithGoogle(next);
        });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    bindAuthTriggers();
});
