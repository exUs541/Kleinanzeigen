/**
 * Kleinanzeigen Plus - Content Script
 * Handles ad filtering, UI injection, and seen tracking.
 */

const STORAGE_KEYS = {
    BLOCKED_USERS: 'ka_blocked_users', // Array of { id, name }
    HIDDEN_ADS: 'ka_hidden_ads',       // Array of ad IDs
    SEEN_ADS: 'ka_seen_ads'            // Array of ad IDs
};

let blockedUsers = [];
let hiddenAds = [];
let seenAds = [];

// Initialize data from storage
async function initData() {
    const data = await chrome.storage.local.get([
        STORAGE_KEYS.BLOCKED_USERS,
        STORAGE_KEYS.HIDDEN_ADS,
        STORAGE_KEYS.SEEN_ADS
    ]);
    
    blockedUsers = data[STORAGE_KEYS.BLOCKED_USERS] || [];
    hiddenAds = data[STORAGE_KEYS.HIDDEN_ADS] || [];
    seenAds = data[STORAGE_KEYS.SEEN_ADS] || [];
    
    processPage();
}

// Main processing function
function processPage() {
    const isAdDetail = window.location.pathname.includes('/s-anzeige/');
    
    if (isAdDetail) {
        processAdDetail();
    }
    
    processAdList();
}

/**
 * Handle Single Ad Detail Page
 */
function processAdDetail() {
    const adId = getAdIdFromUrl(window.location.pathname);
    if (!adId) return;

    // Mark as seen
    markAsSeen(adId);

    // Inject Block Button in User Profile Section
    const userSection = document.querySelector('#viewad-contact');
    if (userSection && !document.querySelector('.ka-detail-actions')) {
        
        // Try to extract user ID from various links
        const userIdLink = document.querySelector('a[href*="userId="]') || 
                          document.querySelector('a[href*="/s-bestandsliste.html"]');
        
        let userId = null;
        if (userIdLink) {
            try {
                const urlObj = new URL(userIdLink.href, window.location.origin);
                const urlParams = new URLSearchParams(urlObj.search);
                userId = urlParams.get('userId');
                
                // Fallback for direct string split if URLSearchParams fails or param is weird
                if (!userId && userIdLink.href.includes('userId=')) {
                    userId = userIdLink.href.split('userId=')[1].split('&')[0].split('#')[0];
                }
            } catch (e) {
                console.error("KA Plus: Error parsing userId", e);
            }
        }

        // Try to find user name via multiple common selectors
        const userName = document.querySelector('#viewad-contact-user-name')?.innerText.trim() || 
                         document.querySelector('.userprofile-name')?.innerText.trim() ||
                         document.querySelector('#viewad-contact h2')?.innerText.trim() ||
                         document.querySelector('.text-contact h2')?.innerText.trim() ||
                         'Unbekannt';

        if (userId) {
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'ka-detail-actions';
            
            const blockBtn = document.createElement('div');
            blockBtn.className = 'ka-detail-btn ka-detail-btn-block';
            blockBtn.innerText = `User '${userName}' blockieren`;
            blockBtn.onclick = () => blockUser(userId, userName);
            
            actionsDiv.appendChild(blockBtn);
            userSection.prepend(actionsDiv);
        }
    }
}

/**
 * Handle Search Result List
 */
function processAdList() {
    const ads = document.querySelectorAll('article.aditem');
    
    ads.forEach(ad => {
        if (ad.dataset.kaProcessed) return;
        
        const adId = ad.dataset.adid;
        
        // Try to find userId in links within the ad (e.g. user name link or 'more ads' link)
        const userIdLink = ad.querySelector('a[href*="userId="]');
        let userId = ad.dataset.userid;
        
        if (userIdLink) {
            try {
                const urlObj = new URL(userIdLink.href, window.location.origin);
                const urlParams = new URLSearchParams(urlObj.search);
                userId = urlParams.get('userId') || userId;
            } catch (e) {
                // Silently fail, might use fallback
            }
        }

        const userName = ad.querySelector('.aditem-main--user--name')?.innerText.trim() || 
                         ad.querySelector('.aditem-main--top--left')?.innerText.split('\n')[0].trim();

        // 1. Check if blocked or hidden
        if (hiddenAds.includes(adId) || (userId && blockedUsers.some(u => u.id === userId))) {
            const listItem = ad.closest('li.ad-listitem') || ad.closest('.ad-listitem');
            if (listItem) {
                listItem.classList.add('ka-hidden');
                listItem.style.display = 'none'; // Force hide
            }
            return;
        }

        // 2. Mark if seen
        if (seenAds.includes(adId)) {
            ad.classList.add('ka-seen');
            const title = ad.querySelector('.aditem-main--middle--title-container');
            if (title && !title.querySelector('.ka-seen-indicator')) {
                const indicator = document.createElement('span');
                indicator.className = 'ka-seen-indicator';
                indicator.innerText = 'Gesehen';
                title.prepend(indicator);
            }
        }

        // 3. Inject controls
        injectAdControls(ad, adId, userId, userName);
        
        ad.dataset.kaProcessed = "true";
    });
}

function injectAdControls(ad, adId, userId, userName) {
    const mainContent = ad.querySelector('.aditem-main');
    if (!mainContent) return;

    const controls = document.createElement('div');
    controls.className = 'ka-controls-container';

    // Hide Button
    const hideBtn = document.createElement('div');
    hideBtn.className = 'ka-btn ka-btn-hide';
    hideBtn.innerHTML = '<span>👁️</span> Ausblenden';
    hideBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        hideAd(adId, ad);
    };

    // Block Button
    const blockBtn = document.createElement('div');
    blockBtn.className = 'ka-btn ka-btn-block';
    blockBtn.innerHTML = '<span>🚫</span> User blocken';
    blockBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (userId) {
            blockUser(userId, userName);
        } else {
            alert('User ID nicht gefunden. Öffne die Anzeige, um den User zu blockieren.');
        }
    };

    controls.appendChild(hideBtn);
    if (userId) controls.appendChild(blockBtn);
    
    mainContent.appendChild(controls);
}

/**
 * Storage Helpers
 */
async function markAsSeen(adId) {
    if (!seenAds.includes(adId)) {
        seenAds.push(adId);
        // Keep only last 500 seen ads to avoid storage limits
        if (seenAds.length > 500) seenAds.shift();
        await chrome.storage.local.set({ [STORAGE_KEYS.SEEN_ADS]: seenAds });
    }
}

async function hideAd(adId, element) {
    if (!hiddenAds.includes(adId)) {
        hiddenAds.push(adId);
        await chrome.storage.local.set({ [STORAGE_KEYS.HIDDEN_ADS]: hiddenAds });
        element.closest('li.ad-listitem')?.classList.add('ka-hidden');
    }
}

async function blockUser(userId, userName) {
    if (confirm(`Möchtest du '${userName}' wirklich blockieren? Alle Anzeigen dieses Users werden ausgeblendet.`)) {
        if (!blockedUsers.some(u => u.id === userId)) {
            blockedUsers.push({ id: userId, name: userName });
            await chrome.storage.local.set({ [STORAGE_KEYS.BLOCKED_USERS]: blockedUsers });
            location.reload(); // Reload to apply filters
        }
    }
}

function getAdIdFromUrl(path) {
    const match = path.match(/\/(\d+)-/);
    return match ? match[1] : null;
}

// Observe changes for dynamic loading
const observer = new MutationObserver((mutations) => {
    processAdList();
});

observer.observe(document.body, { childList: true, subtree: true });

// Initial run
initData();
