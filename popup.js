/**
 * Kleinanzeigen Plus - Popup Script
 * Manages configuration settings, tabs, blocked users, templates, and quick snippets.
 */

const STORAGE_KEYS = {
    SETTINGS: 'ka_settings',
    BLOCKED_USERS: 'ka_blocked_users',
    HIDDEN_ADS: 'ka_hidden_ads',
    SEEN_ADS: 'ka_seen_ads',
    TEMPLATES: 'ka_templates'
};

const DEFAULT_SETTINGS = {
    hideSponsored: true,
    hideTopAds: false,
    shiftTopAdsBottom: true,
    blacklistKeywords: ['defekt', 'bastler', 'tausch', 'ersatzteil'],
    enableImagePreviews: true,
    enableMaps: true,
    enablePriceCompare: true,
    enableNotes: true,
    enableInfiniteScroll: true,
    chatSnippets: [
        "Hallo, ist das noch zu haben?",
        "Ich habe Interesse daran. Wann könnte ich es abholen?",
        "Ist ein Versand möglich und was würde er kosten?",
        "Was wäre Ihr letzter Preis inkl. Versand?"
    ]
};

let currentSettings = { ...DEFAULT_SETTINGS };

document.addEventListener('DOMContentLoaded', async () => {
    initTabs();
    await loadSettings();
    await updateUI();
    bindSettingsControls();
});

// 1. Tab Switching Logic
function initTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            tab.classList.add('active');
            const targetId = tab.dataset.tab;
            document.getElementById(targetId).classList.add('active');
        });
    });
}

// 2. Load settings from storage
async function loadSettings() {
    const data = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
    if (data[STORAGE_KEYS.SETTINGS]) {
        currentSettings = { ...DEFAULT_SETTINGS, ...data[STORAGE_KEYS.SETTINGS] };
    } else {
        currentSettings = { ...DEFAULT_SETTINGS };
        await saveSettings();
    }
}

// 3. Save settings to storage
async function saveSettings() {
    await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: currentSettings });
}

// 4. Update UI Fields and Lists
async function updateUI() {
    // A. Bind Checkboxes and Textarea with values
    document.getElementById('opt-hide-sponsored').checked = currentSettings.hideSponsored;
    document.getElementById('opt-hide-top').checked = currentSettings.hideTopAds;
    document.getElementById('opt-shift-top').checked = currentSettings.shiftTopAdsBottom;
    document.getElementById('blacklist-input').value = currentSettings.blacklistKeywords.join('\n');
    
    document.getElementById('opt-image-previews').checked = currentSettings.enableImagePreviews;
    document.getElementById('opt-enable-maps').checked = currentSettings.enableMaps;
    document.getElementById('opt-price-compare').checked = currentSettings.enablePriceCompare;
    document.getElementById('opt-enable-notes').checked = currentSettings.enableNotes;
    document.getElementById('opt-infinite-scroll').checked = currentSettings.enableInfiniteScroll;

    // B. Fetch other stored data counts
    const data = await chrome.storage.local.get([
        STORAGE_KEYS.BLOCKED_USERS,
        STORAGE_KEYS.HIDDEN_ADS,
        STORAGE_KEYS.SEEN_ADS,
        STORAGE_KEYS.TEMPLATES
    ]);

    const blocked = data[STORAGE_KEYS.BLOCKED_USERS] || [];
    const hidden = data[STORAGE_KEYS.HIDDEN_ADS] || [];
    const seen = data[STORAGE_KEYS.SEEN_ADS] || [];
    const templates = data[STORAGE_KEYS.TEMPLATES] || [];

    // C. Update Counts in UI
    document.getElementById('count-seen').innerText = seen.length;
    document.getElementById('count-hidden').innerText = hidden.length;

    // D. Render Blocked List
    renderBlockedList(blocked);

    // E. Render Templates List
    renderTemplatesList(templates);

    // F. Render Chat Snippets
    renderSnippetsList();
}

// 5. Bind input event listeners to save settings on-the-fly
function bindSettingsControls() {
    const bindToggle = (id, key) => {
        const el = document.getElementById(id);
        el.onchange = async () => {
            currentSettings[key] = el.checked;
            await saveSettings();
        };
    };

    bindToggle('opt-hide-sponsored', 'hideSponsored');
    bindToggle('opt-hide-top', 'hideTopAds');
    bindToggle('opt-shift-top', 'shiftTopAdsBottom');
    
    bindToggle('opt-image-previews', 'enableImagePreviews');
    bindToggle('opt-enable-maps', 'enableMaps');
    bindToggle('opt-price-compare', 'enablePriceCompare');
    bindToggle('opt-enable-notes', 'enableNotes');
    bindToggle('opt-infinite-scroll', 'enableInfiniteScroll');

    const blacklistInput = document.getElementById('blacklist-input');
    blacklistInput.oninput = async () => {
        currentSettings.blacklistKeywords = blacklistInput.value
            .split('\n')
            .map(s => s.trim())
            .filter(s => s.length > 0);
        await saveSettings();
    };

    // Add snippet button
    document.getElementById('add-snippet-btn').onclick = async () => {
        currentSettings.chatSnippets.push("Neues Snippet...");
        await saveSettings();
        renderSnippetsList();
    };

    // Clear lists & settings buttons
    document.getElementById('clear-seen').onclick = async () => {
        if (confirm('Gesehen-Liste wirklich leeren?')) {
            await chrome.storage.local.set({ [STORAGE_KEYS.SEEN_ADS]: [] });
            await updateUI();
        }
    };

    document.getElementById('clear-hidden').onclick = async () => {
        if (confirm('Ausblend-Liste wirklich leeren?')) {
            await chrome.storage.local.set({ [STORAGE_KEYS.HIDDEN_ADS]: [] });
            await updateUI();
        }
    };

    document.getElementById('reset-settings').onclick = async () => {
        if (confirm('Möchtest du alle Einstellungen und Vorlagen auf Standard zurücksetzen?')) {
            currentSettings = { ...DEFAULT_SETTINGS };
            await saveSettings();
            await chrome.storage.local.set({ [STORAGE_KEYS.TEMPLATES]: [] });
            await updateUI();
        }
    };
}

// 6. Blocked Users rendering
function renderBlockedList(blocked) {
    const list = document.getElementById('blocked-list');
    if (blocked.length === 0) {
        list.innerHTML = '<div class="empty-state">Keine User blockiert</div>';
        return;
    }

    list.innerHTML = '';
    blocked.forEach(user => {
        const item = document.createElement('div');
        item.className = 'list-item';
        item.innerHTML = `
            <span class="list-item-title">${user.name}</span>
            <button class="btn-icon unblock-btn" data-id="${user.id}">Entsperren</button>
        `;
        list.appendChild(item);
    });

    list.querySelectorAll('.unblock-btn').forEach(btn => {
        btn.onclick = async () => {
            const id = btn.dataset.id;
            const data = await chrome.storage.local.get(STORAGE_KEYS.BLOCKED_USERS);
            const listData = data[STORAGE_KEYS.BLOCKED_USERS] || [];
            const filtered = listData.filter(u => u.id !== id);
            await chrome.storage.local.set({ [STORAGE_KEYS.BLOCKED_USERS]: filtered });
            updateUI();
        };
    });
}

// 7. Templates List rendering
function renderTemplatesList(templates) {
    const list = document.getElementById('templates-list');
    if (templates.length === 0) {
        list.innerHTML = '<div class="empty-state">Keine Vorlagen gespeichert</div>';
        return;
    }

    list.innerHTML = '';
    templates.forEach((tpl, index) => {
        const item = document.createElement('div');
        item.className = 'template-item';
        
        // Truncate description for display
        const descText = tpl.description ? tpl.description.substring(0, 45) + '...' : 'Keine Beschreibung';
        const priceText = tpl.price ? `${tpl.price} €` : 'VB';

        item.innerHTML = `
            <div class="template-row">
                <span class="list-item-title" style="font-weight:600;">${tpl.title || 'Ohne Titel'}</span>
                <div>
                    <button class="btn-icon delete-tpl-btn" data-index="${index}">🗑️</button>
                </div>
            </div>
            <div class="template-details">
                <span>Kategorie: ${tpl.category || 'Unbekannt'}</span> | <span>Preis: ${priceText}</span>
            </div>
        `;
        list.appendChild(item);
    });

    list.querySelectorAll('.delete-tpl-btn').forEach(btn => {
        btn.onclick = async () => {
            if (confirm('Diese Vorlage wirklich löschen?')) {
                const idx = parseInt(btn.dataset.index, 10);
                const data = await chrome.storage.local.get(STORAGE_KEYS.TEMPLATES);
                const currentTemplates = data[STORAGE_KEYS.TEMPLATES] || [];
                currentTemplates.splice(idx, 1);
                await chrome.storage.local.set({ [STORAGE_KEYS.TEMPLATES]: currentTemplates });
                updateUI();
            }
        };
    });
}

// 8. Chat Snippets rendering
function renderSnippetsList() {
    const list = document.getElementById('snippets-list');
    if (!currentSettings.chatSnippets || currentSettings.chatSnippets.length === 0) {
        list.innerHTML = '<div class="empty-state">Keine Snippets vorhanden</div>';
        return;
    }

    list.innerHTML = '';
    currentSettings.chatSnippets.forEach((snippet, index) => {
        const item = document.createElement('div');
        item.className = 'snippet-item';
        item.innerHTML = `
            <input type="text" class="snippet-input" value="${snippet.replace(/"/g, '&quot;')}" data-index="${index}">
            <button class="btn-icon delete-snippet-btn" data-index="${index}">🗑️</button>
        `;
        list.appendChild(item);
    });

    // Snippet input changes
    list.querySelectorAll('.snippet-input').forEach(input => {
        input.addEventListener('change', async () => {
            const idx = parseInt(input.dataset.index, 10);
            currentSettings.chatSnippets[idx] = input.value.trim();
            await saveSettings();
        });
    });

    // Snippet deletes
    list.querySelectorAll('.delete-snippet-btn').forEach(btn => {
        btn.onclick = async () => {
            const idx = parseInt(btn.dataset.index, 10);
            currentSettings.chatSnippets.splice(idx, 1);
            await saveSettings();
            renderSnippetsList();
        };
    });
}
