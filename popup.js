/**
 * Kleinanzeigen Plus - Popup Logic
 */

const STORAGE_KEYS = {
    BLOCKED_USERS: 'ka_blocked_users',
    HIDDEN_ADS: 'ka_hidden_ads',
    SEEN_ADS: 'ka_seen_ads'
};

async function updateUI() {
    const data = await chrome.storage.local.get([
        STORAGE_KEYS.BLOCKED_USERS,
        STORAGE_KEYS.HIDDEN_ADS,
        STORAGE_KEYS.SEEN_ADS
    ]);

    const blocked = data[STORAGE_KEYS.BLOCKED_USERS] || [];
    const hidden = data[STORAGE_KEYS.HIDDEN_ADS] || [];
    const seen = data[STORAGE_KEYS.SEEN_ADS] || [];

    // Update Counts
    document.getElementById('count-blocked').innerText = blocked.length;
    document.getElementById('count-hidden').innerText = hidden.length;
    document.getElementById('count-seen').innerText = seen.length;

    // Render Blocked List
    const list = document.getElementById('blocked-list');
    if (blocked.length === 0) {
        list.innerHTML = '<div class="empty-state">Keine User blockiert</div>';
    } else {
        list.innerHTML = '';
        blocked.forEach(user => {
            const item = document.createElement('div');
            item.className = 'list-item';
            item.innerHTML = `
                <span>${user.name}</span>
                <span class="unblock-btn" data-id="${user.id}">Entsperren</span>
            `;
            list.appendChild(item);
        });

        // Add Click Listeners
        document.querySelectorAll('.unblock-btn').forEach(btn => {
            btn.onclick = () => unblockUser(btn.dataset.id);
        });
    }
}

async function unblockUser(id) {
    const data = await chrome.storage.local.get(STORAGE_KEYS.BLOCKED_USERS);
    const blocked = data[STORAGE_KEYS.BLOCKED_USERS] || [];
    const filtered = blocked.filter(u => u.id !== id);
    await chrome.storage.local.set({ [STORAGE_KEYS.BLOCKED_USERS]: filtered });
    updateUI();
}

document.getElementById('clear-seen').onclick = async () => {
    if (confirm('Gesehen-Liste wirklich leeren?')) {
        await chrome.storage.local.set({ [STORAGE_KEYS.SEEN_ADS]: [] });
        updateUI();
    }
};

document.getElementById('clear-hidden').onclick = async () => {
    if (confirm('Ausblend-Liste wirklich leeren?')) {
        await chrome.storage.local.set({ [STORAGE_KEYS.HIDDEN_ADS]: [] });
        updateUI();
    }
};

// Initial Load
updateUI();
