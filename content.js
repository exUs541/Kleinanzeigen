/**
 * Kleinanzeigen Plus - Content Script
 * Implements ad filtering, hover previews, notes, map links, price checks, templates, and exporter.
 */

const STORAGE_KEYS = {
    SETTINGS: 'ka_settings',
    BLOCKED_USERS: 'ka_blocked_users',
    HIDDEN_ADS: 'ka_hidden_ads',
    SEEN_ADS: 'ka_seen_ads',
    TEMPLATES: 'ka_templates',
    NOTES: 'ka_notes'
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

let settings = { ...DEFAULT_SETTINGS };
let blockedUsers = [];
let hiddenAds = [];
let seenAds = [];
let templates = [];
let notes = {};

// In-memory cache for fetched details (to prevent spamming fetch calls)
const detailCache = new Map();
const hoverTimers = new Map();
let infiniteScrollInitialized = false;
let isInitialized = false;

// Initialize all data from storage
async function init() {
    console.log("KA Plus: Content script loaded, initializing...");
    try {
        const data = await chrome.storage.local.get([
            STORAGE_KEYS.SETTINGS,
            STORAGE_KEYS.BLOCKED_USERS,
            STORAGE_KEYS.HIDDEN_ADS,
            STORAGE_KEYS.SEEN_ADS,
            STORAGE_KEYS.TEMPLATES,
            STORAGE_KEYS.NOTES
        ]);
        
        settings = { ...DEFAULT_SETTINGS, ...data[STORAGE_KEYS.SETTINGS] };
        blockedUsers = data[STORAGE_KEYS.BLOCKED_USERS] || [];
        hiddenAds = data[STORAGE_KEYS.HIDDEN_ADS] || [];
        seenAds = data[STORAGE_KEYS.SEEN_ADS] || [];
        templates = data[STORAGE_KEYS.TEMPLATES] || [];
        notes = data[STORAGE_KEYS.NOTES] || {};
        
        console.log("KA Plus: Settings loaded successfully:", settings);
        
        isInitialized = true;
        processPage();
    } catch (e) {
        console.error("KA Plus: Error during initialization:", e);
    }
}

// Route to proper handlers based on URL
function processPage() {
    const path = window.location.pathname;
    console.log("KA Plus: Processing page path:", path);
    
    // 1. Create/Edit Ad Page
    if (path.includes('/s-anzeige-aufgeben.html')) {
        handleCreateListingPage();
    }
    // 2. Chat / Messenger
    else if (path.includes('/m-nachrichten.html')) {
        handleChatPage();
    }
    // 3. Ad Detail Page
    else if (path.includes('/s-anzeige/')) {
        handleAdDetailPage();
    }
    // 4. My Ads Page
    else if (path.includes('/m-meine-anzeigen.html')) {
        handleMyAdsPage();
    }
    
    // Always process search results / ad lists (present on many pages)
    handleAdLists();
}

/**
 * ==========================================
 * SEARCH LISTS & INDEX PAGE HELPERS
 * ==========================================
 */
function handleAdLists() {
    if (!isInitialized) return;
    
    // Set up Infinite Scroll dynamically when container is ready in DOM
    if (settings.enableInfiniteScroll && !infiniteScrollInitialized) {
        const container = getAdContainer();
        if (container) {
            infiniteScrollInitialized = true;
            setupInfiniteScroll();
        }
    }

    const parentContainer = getAdContainer();

    // Hide ad placeholders / banner elements in search table
    if (parentContainer) {
        const listItems = Array.from(parentContainer.children);
        listItems.forEach(li => {
            const hasArticle = li.querySelector('article[data-adid], article.aditem') || 
                               li.tagName === 'ARTICLE' || 
                               li.classList.contains('aditem');
                               
            const hasClassBanner = li.className.includes('banner') || 
                                   li.className.includes('placeholder') || 
                                   li.className.includes('advertisement') || 
                                   li.id.includes('banner') || 
                                   li.id.includes('ad-');
                                   
            const hasInnerAd = li.querySelector('iframe, div[class*="banner"], div[class*="ad-"], div[id*="banner"], div[id*="ad-"], div[class*="placeholder"]');
            const text = li.textContent.trim();
            const hasLogoText = text.toLowerCase() === 'kleinanzeigen' || (text.toLowerCase().includes('anzeige') && text.length < 50 && !li.querySelector('a'));
            
            // If it doesn't contain a valid listing article, or is flagged as an ad, hide it!
            if (!hasArticle || hasClassBanner || (hasInnerAd && !li.querySelector('article')) || (hasLogoText && !hasArticle)) {
                li.style.display = 'none';
                li.classList.add('ka-hidden');
            }
        });
    }

    // Hide general page ad boxes (outside listings)
    if (settings.hideSponsored) {
        const adSelectors = [
            '.outbrain', '.google-ad', 'div[class*="banner"]', 'div[id*="banner"]',
            'div[class*="advertisement"]', 'iframe[id*="google_ads"]', '.ad-placeholder',
            'div[id*="ad-slot"]', 'ins.adsbygoogle', '.banner-desktop', '.banner-mobile',
            'div.ad-item', '.badvertisement', '.srchrslt-adtable-featured'
        ];
        adSelectors.forEach(sel => {
            document.querySelectorAll(sel).forEach(el => {
                el.style.display = 'none';
                el.classList.add('ka-hidden');
            });
        });
    }

    // 1. Inject search exporter button if list exists and button not present
    if (parentContainer && !document.getElementById('ka-export-results-btn')) {
        injectExporterButton();
    }

    const ads = document.querySelectorAll('article[data-adid], article.aditem');

    ads.forEach(ad => {
        if (ad.dataset.kaProcessed) return;
        
        const adId = getAdId(ad);
        if (!adId) return;

        const titleEl = ad.querySelector('.aditem-main--middle--title-container a, h2 a, h3 a, a.ellipsis');
        const titleText = titleEl ? titleEl.textContent.trim() : '';
        const lowerTitle = titleText.toLowerCase();

        // 2. Blacklist Keywords Filter
        const matchesBlacklist = settings.blacklistKeywords.some(keyword => 
            lowerTitle.includes(keyword.toLowerCase())
        );

        // 3. Sponsored Ads Filter
        // Sponsored ads have special classes, text like "Anzeige" or are in banner slots
        const isSponsored = ad.classList.contains('aditem-featured') || 
                            ad.querySelector('.aditem-main--top--right')?.textContent.includes('Anzeige') ||
                            ad.closest('.ad-listitem--banner') ||
                            ad.classList.contains('ad-placeholder') ||
                            ad.innerHTML.includes('sponsored');

        // 4. Top Ads Filter
        const isTopAd = ad.querySelector('.aditem-main--top--right')?.textContent.includes('Top-Anzeige') || 
                         ad.classList.contains('is-topad');

        // Get user details
        const userIdLink = ad.querySelector('a[href*="userId="]');
        let userId = ad.dataset.userid;
        if (userIdLink) {
            try {
                const urlObj = new URL(userIdLink.href, window.location.origin);
                userId = urlObj.searchParams.get('userId') || userId;
            } catch (e) {}
        }
        const userName = ad.querySelector('.aditem-main--user--name')?.innerText.trim() || 'Verkäufer';

        // Check if user is blocked or listing is hidden
        const isUserBlocked = userId && blockedUsers.some(u => u.id === userId);
        const isAdHidden = hiddenAds.includes(adId);

        // Hide logic
        if (isAdHidden || isUserBlocked || (isSponsored && settings.hideSponsored) || (isTopAd && settings.hideTopAds) || matchesBlacklist) {
            hideListingElement(ad);
            return;
        }

        // Shift Top Ads to Bottom
        if (isTopAd && settings.shiftTopAdsBottom && parentContainer && !ad.dataset.kaShifted) {
            ad.dataset.kaShifted = "true";
            // Find parent li
            const li = ad.closest('li');
            if (li) {
                parentContainer.appendChild(li); // Appends to the bottom of the list
            } else {
                parentContainer.appendChild(ad);
            }
            return;
        }

        // 5. Mark Seen Ads
        if (seenAds.includes(adId)) {
            ad.classList.add('ka-seen');
            const titleContainer = ad.querySelector('.aditem-main--middle--title-container') || ad.querySelector('h2') || ad.querySelector('h3');
            if (titleContainer && !titleContainer.querySelector('.ka-seen-indicator')) {
                const indicator = document.createElement('span');
                indicator.className = 'ka-seen-indicator';
                indicator.innerText = 'Gesehen';
                titleContainer.prepend(indicator);
            }
        }

        // 6. Map Link
        let mapLink = null;
        if (settings.enableMaps) {
            const locEl = ad.querySelector('.aditem-main--top--left, .aditem-details');
            const locText = locEl ? locEl.textContent.trim().replace(/\s+/g, ' ') : '';
            if (locText) {
                const cityMatch = locText.match(/(\d{5})\s+(.+)/) || [null, locText];
                const query = encodeURIComponent(cityMatch[1] ? `${cityMatch[1]} ${cityMatch[2]}` : cityMatch[0]);
                mapLink = `https://www.google.com/maps/search/?api=1&query=${query}`;
            }
        }

        // 7. Inject Listing Cards Controls
        injectListingControls(ad, adId, userId, userName, mapLink);

        // 8. Load Previews & Badges on Hover
        if (settings.enableImagePreviews) {
            setupHoverPreview(ad, adId, titleEl?.href);
        }

        // 9. Display Saved Note if present
        if (settings.enableNotes && notes[adId]) {
            injectNoteToListing(ad, notes[adId]);
        }

        ad.dataset.kaProcessed = "true";
    });

    // Auto-check if we need to pre-fetch pages due to hidden/filtered ads
    if (settings.enableInfiniteScroll && nextPageUrl) {
        checkScrollTrigger(true);
    }
}

function getAdId(element) {
    if (element.dataset.adid) return element.dataset.adid;
    const link = element.querySelector('a[href*="/s-anzeige/"]');
    if (link) {
        const match = link.getAttribute('href').match(/\/s-anzeige\/.*?\/(\d+)/);
        return match ? match[1] : null;
    }
    return null;
}

function hideListingElement(ad) {
    const listItem = ad.closest('li.ad-listitem') || ad.closest('.ad-listitem') || ad.closest('li') || ad;
    listItem.classList.add('ka-hidden');
    listItem.style.display = 'none';
}

function injectListingControls(ad, adId, userId, userName, mapLink) {
    const mainContent = ad.querySelector('.aditem-main') || ad.children[1] || ad;
    if (!mainContent) return;

    const controls = document.createElement('div');
    controls.className = 'ka-controls-container';

    // Hide Button
    const hideBtn = document.createElement('div');
    hideBtn.className = 'ka-btn ka-btn-hide';
    hideBtn.innerHTML = '👁️ Ausblenden';
    hideBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        hideAd(adId, ad);
    };
    ad.appendChild(hideBtn);

    // Block Button
    if (userId) {
        const blockBtn = document.createElement('div');
        blockBtn.className = 'ka-btn ka-btn-block';
        blockBtn.innerHTML = '🚫 User blockieren';
        blockBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            blockUser(userId, userName);
        };
        controls.appendChild(blockBtn);
    }

    // Map Button
    if (mapLink) {
        const mapBtn = document.createElement('a');
        mapBtn.className = 'ka-btn ka-btn-map';
        mapBtn.innerHTML = '🗺️ Karte';
        mapBtn.href = mapLink;
        mapBtn.target = '_blank';
        mapBtn.onclick = (e) => e.stopPropagation();
        controls.appendChild(mapBtn);
    }

    mainContent.appendChild(controls);
}

function injectNoteToListing(ad, noteText) {
    const mainContent = ad.querySelector('.aditem-main') || ad;
    if (!mainContent.querySelector('.ka-list-note')) {
        const noteDiv = document.createElement('div');
        noteDiv.className = 'ka-list-note';
        noteDiv.innerHTML = `<strong>Meine Notiz:</strong> ${noteText}`;
        mainContent.appendChild(noteDiv);
    }
}

// Hover image previews logic
function setupHoverPreview(ad, adId, detailUrl) {
    const imgContainer = ad.querySelector('.aditem-image, .aditem-image-container, .imagebox');
    if (!imgContainer || !detailUrl) return;

    const imgEl = imgContainer.querySelector('img');
    if (!imgEl) return;

    // Relative absolute container setup
    imgContainer.style.position = 'relative';

    ad.addEventListener('mouseenter', () => {
        // Start a delay timer to prevent trigger on sweeping hover
        const timer = setTimeout(async () => {
            let data = detailCache.get(adId);
            if (!data) {
                try {
                    data = await fetchDetailData(detailUrl);
                    detailCache.set(adId, data);
                } catch (e) {
                    console.error("KA Plus: Hover fetch failed", e);
                    return;
                }
            }

            // Inject image dots preview
            if (data && data.images && data.images.length > 1) {
                renderImagePreviewDots(imgContainer, imgEl, data.images);
            }

            // Inject Seller Age / Rating badge
            if (data && (data.sellerAge || data.sellerRating)) {
                renderSellerBadge(ad, data.sellerAge, data.sellerRating);
            }
        }, 180);
        
        hoverTimers.set(adId, timer);
    });

    ad.addEventListener('mouseleave', () => {
        // Clear timer
        if (hoverTimers.has(adId)) {
            clearTimeout(hoverTimers.get(adId));
            hoverTimers.delete(adId);
        }
        
        // Remove dots
        const dots = imgContainer.querySelector('.ka-image-preview-dots');
        if (dots) dots.remove();
        
        // Restore original image
        if (imgEl.dataset.originalSrc) {
            imgEl.src = imgEl.dataset.originalSrc;
        }
    });
}

async function fetchDetailData(url) {
    const res = await fetch(url);
    const html = await res.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // 1. Extract Images
    const imgEls = doc.querySelectorAll('.imagegallery-image img, .imagegallery-slide img, #viewad-image, .imagegallery img');
    const images = Array.from(imgEls)
        .map(img => img.src || img.dataset.src || img.getAttribute('data-img-src'))
        .filter(Boolean)
        .map(src => src.replace(/_1\.JPG/i, '_9.JPG')); // Try to get higher resolution if possible

    // 2. Extract Seller registration date & satisfaction rating
    let sellerAge = '';
    let sellerRating = '';

    const textNodes = Array.from(doc.querySelectorAll('#viewad-contact, .userprofile-details, aside'));
    textNodes.forEach(el => {
        const text = el.textContent;
        // Match registration: "Aktiv seit 12.03.2018"
        const ageMatch = text.match(/Aktiv seit\s+([0-9.]+)/i);
        if (ageMatch) sellerAge = ageMatch[1];
        
        // Match satisfaction: "Zufriedenheit: Hoch"
        const ratingMatch = text.match(/Zufriedenheit:\s+(\w+)/i) || text.match(/(Sehr)?\s*(Zufrieden)/i);
        if (ratingMatch) sellerRating = ratingMatch[0].trim();
    });

    return { images, sellerAge, sellerRating };
}

function renderImagePreviewDots(container, mainImg, images) {
    if (container.querySelector('.ka-image-preview-dots')) return;

    // Backup original src
    if (!mainImg.dataset.originalSrc) {
        mainImg.dataset.originalSrc = mainImg.src;
    }

    const dotsDiv = document.createElement('div');
    dotsDiv.className = 'ka-image-preview-dots';

    images.forEach((imgUrl, index) => {
        const dot = document.createElement('div');
        dot.className = 'ka-image-dot';
        if (index === 0) dot.classList.add('active');

        // Hover over dot changes main image source
        dot.addEventListener('mouseenter', (e) => {
            e.stopPropagation();
            dotsDiv.querySelectorAll('.ka-image-dot').forEach(d => d.classList.remove('active'));
            dot.classList.add('active');
            mainImg.src = imgUrl;
        });

        dotsDiv.appendChild(dot);
    });

    // Make sure click is ignored
    dotsDiv.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
    };

    container.appendChild(dotsDiv);
}

function renderSellerBadge(ad, age, rating) {
    const detailsContainer = ad.querySelector('.aditem-main--middle') || ad;
    if (detailsContainer.querySelector('.ka-seller-info-badge')) return;

    let badgeText = '';
    if (age) badgeText += `Seit ${age}`;
    if (rating) badgeText += (badgeText ? ' | ' : '') + rating;

    if (badgeText) {
        const badge = document.createElement('span');
        badge.className = 'ka-seller-info-badge';
        badge.innerText = badgeText;
        
        const priceContainer = ad.querySelector('.aditem-main--middle--price-shipping--price, .aditem-main--middle--price-shipping, .aditem-main--middle--price-container, .aditem-main--middle--price');
        if (priceContainer) {
            priceContainer.before(badge);
        } else {
            detailsContainer.appendChild(badge);
        }
    }
}

/**
 * ==========================================
 * AD DETAIL PAGE CONTROLS
 * ==========================================
 */
function handleAdDetailPage() {
    const adId = getAdIdFromUrl(window.location.pathname);
    if (!adId) return;

    // Mark as seen immediately
    markAsSeen(adId);

    // 1. Map Link
    let mapLink = '';
    const locEl = document.querySelector('#viewad-locality');
    if (locEl) {
        const text = locEl.textContent.trim().replace(/\s+/g, ' ');
        mapLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}`;
    }

    // 2. Block/Template actions box
    injectDetailActions(adId, mapLink);

    // 3. Notes Area
    if (settings.enableNotes) {
        injectNotesArea(adId);
    }

    // 4. Sparpilot price comparison widget
    if (settings.enablePriceCompare) {
        injectSparpilotWidget();
    }
}

function injectDetailActions(adId, mapLink) {
    const userSection = document.querySelector('#viewad-contact') || 
                        document.querySelector('.userprofile-details') ||
                        document.querySelector('aside');
                        
    if (userSection && !document.querySelector('.ka-detail-actions')) {
        // Attempt name extraction
        let userName = 'Unbekannt';
        const h2 = userSection.querySelector('h2') || document.querySelector('.userprofile-details h2');
        if (h2) userName = h2.textContent.replace(/\s+/g, ' ').trim();

        // Extract userId
        const userIdLink = document.querySelector('a[href*="userId="]') || document.querySelector('a[href*="/s-bestandsliste.html"]');
        let userId = null;
        if (userIdLink) {
            try {
                const urlObj = new URL(userIdLink.href, window.location.origin);
                userId = urlObj.searchParams.get('userId');
            } catch (e) {}
        }

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'ka-detail-actions';

        // Row 1: Block & Download
        const row1 = document.createElement('div');
        row1.className = 'ka-detail-row';

        if (userId) {
            const blockBtn = document.createElement('div');
            blockBtn.className = 'ka-detail-btn ka-detail-btn-block';
            blockBtn.innerText = `🚫 Blockieren`;
            blockBtn.onclick = () => blockUser(userId, userName);
            row1.appendChild(blockBtn);
        }

        const downloadBtn = document.createElement('div');
        downloadBtn.className = 'ka-detail-btn ka-detail-btn-download';
        downloadBtn.innerText = `📥 Bilder laden`;
        downloadBtn.onclick = () => triggerImageDownloads(adId);
        row1.appendChild(downloadBtn);

        actionsDiv.appendChild(row1);

        // Row 2: Map & Template
        const row2 = document.createElement('div');
        row2.className = 'ka-detail-row';
        row2.style.marginTop = '6px';

        if (mapLink) {
            const mapBtn = document.createElement('a');
            mapBtn.className = 'ka-detail-btn ka-detail-btn-map';
            mapBtn.innerText = `🗺️ Auf Karte`;
            mapBtn.href = mapLink;
            mapBtn.target = '_blank';
            row2.appendChild(mapBtn);
        }

        const templateBtn = document.createElement('div');
        templateBtn.className = 'ka-detail-btn ka-detail-btn-template';
        templateBtn.innerText = `💾 Als Vorlage`;
        templateBtn.onclick = () => saveAdAsTemplate();
        row2.appendChild(templateBtn);

        actionsDiv.appendChild(row2);

        userSection.prepend(actionsDiv);
    }
}

function injectNotesArea(adId) {
    const parent = document.querySelector('#viewad-contact') || 
                   document.querySelector('.viewad-actions') || 
                   document.querySelector('aside');
    if (!parent || document.querySelector('.ka-note-section')) return;

    const noteSec = document.createElement('div');
    noteSec.className = 'ka-note-section';
    noteSec.innerHTML = `
        <h3>📝 Eigene Notizen</h3>
        <textarea class="ka-note-textarea" placeholder="Notizen zu diesem Inserat eintragen..."></textarea>
    `;

    const textarea = noteSec.querySelector('.ka-note-textarea');
    textarea.value = notes[adId] || '';

    // Auto-save on typing
    textarea.addEventListener('input', async () => {
        const text = textarea.value.trim();
        if (text) {
            notes[adId] = text;
        } else {
            delete notes[adId];
        }
        await chrome.storage.local.set({ [STORAGE_KEYS.NOTES]: notes });
    });

    parent.appendChild(noteSec);
}

function injectSparpilotWidget() {
    const titleEl = document.querySelector('#viewad-title');
    const targetParent = document.querySelector('#viewad-main-info') || document.querySelector('.viewad-description') || document.querySelector('#viewad-title')?.parentNode;
    if (!titleEl || !targetParent || document.querySelector('.ka-sparpilot-widget')) return;

    const title = titleEl.textContent.trim();
    // Exclude noise, special chars
    const query = encodeURIComponent(title.replace(/[^\w\säöüÄÖÜß-]/g, ' ').replace(/\s+/g, ' ').trim());

    const widget = document.createElement('div');
    widget.className = 'ka-sparpilot-widget';

    // Categories checker
    const breadcrumbs = document.querySelector('.breadcrumbs, #viewad-details, .breadcrump');
    const isCarCategory = breadcrumbs && (breadcrumbs.textContent.toLowerCase().includes('auto') || breadcrumbs.textContent.toLowerCase().includes('fahrzeug'));

    let linksHtml = `
        <a href="https://www.google.com/search?tbm=shop&q=${query}" target="_blank" class="ka-compare-link">🛍️ Google Shopping</a>
        <a href="https://geizhals.de/?fs=${query}" target="_blank" class="ka-compare-link">🏷️ Geizhals</a>
        <a href="https://www.ebay.de/sch/i.html?_nkw=${query}" target="_blank" class="ka-compare-link">🤝 eBay</a>
        <a href="https://www.amazon.de/s?k=${query}" target="_blank" class="ka-compare-link">📦 Amazon</a>
    `;

    if (isCarCategory) {
        linksHtml += `<a href="https://www.mobile.de/suchen.html?vc=Car&kw=${query}" target="_blank" class="ka-compare-link" style="border-color:#b91c1c; color:#b91c1c;">🚗 mobile.de</a>`;
    }

    widget.innerHTML = `
        <div class="ka-sparpilot-header">
            <span class="ka-sparpilot-title"><span class="ka-sparpilot-logo">S</span> Sparpilot Preisvergleich</span>
        </div>
        <div class="ka-sparpilot-grid">
            ${linksHtml}
        </div>
    `;

    // Inject after the title parent or in primary column
    titleEl.parentNode.insertBefore(widget, titleEl.nextSibling);
}

// Trigger sequential downloads via background script
function triggerImageDownloads(adId) {
    const imgEls = document.querySelectorAll('.imagegallery-image img, .imagegallery-slide img, #viewad-image, .imagegallery img');
    const images = Array.from(imgEls)
        .map(img => img.src || img.dataset.src || img.getAttribute('data-img-src'))
        .filter(Boolean)
        .map(src => src.replace(/_1\.JPG/i, '_9.JPG')); // Ensure high-res version is fetched

    if (images.length === 0) {
        alert("Keine Bilder zum Downloaden gefunden!");
        return;
    }

    chrome.runtime.sendMessage({
        action: 'download_images',
        images: Array.from(new Set(images)), // remove duplicates
        adId: adId
    }, (res) => {
        alert(`${images.length} Bilder werden in den Ordner 'Kleinanzeigen_${adId}' geladen.`);
    });
}

// Save current details as posting template
async function saveAdAsTemplate() {
    const title = document.querySelector('#viewad-title')?.textContent.trim() || '';
    const desc = document.querySelector('#viewad-description')?.textContent.trim() || '';
    const priceEl = document.querySelector('#viewad-price');
    const price = priceEl ? priceEl.textContent.trim().replace(/[^\d]/g, '') : '';
    
    // Breadcrumbs for Category
    const bread = document.querySelector('.breadcrumbs, #viewad-details, .breadcrump');
    const category = bread ? bread.textContent.trim().replace(/\s+/g, ' > ') : '';

    const newTpl = {
        title,
        description: desc,
        price: price,
        category: category,
        details: extractKeyDetails()
    };

    templates.push(newTpl);
    await chrome.storage.local.set({ [STORAGE_KEYS.TEMPLATES]: templates });
    alert("Diese Anzeige wurde erfolgreich als Vorlage gespeichert!");
}

function extractKeyDetails() {
    const list = document.querySelector('#viewad-details, .addetails-list');
    const details = {};
    if (list) {
        const items = list.querySelectorAll('li, dt, dd');
        // Simple scraper for description key-value details
        for (let i = 0; i < items.length; i++) {
            const text = items[i].textContent.trim();
            if (text.includes(':')) {
                const parts = text.split(':');
                details[parts[0].trim()] = parts[1].trim();
            }
        }
    }
    return details;
}

/**
 * ==========================================
 * LISTING CREATION PAGE AUTO-FILL
 * ==========================================
 */
function handleCreateListingPage() {
    // Inject Template Loader at the top of the form
    const form = document.querySelector('form#postad-form, #postad-form, #pka-container');
    if (!form || document.querySelector('.ka-template-selector-container')) return;

    // Check templates list
    if (templates.length === 0) return;

    const selectDiv = document.createElement('div');
    selectDiv.className = 'ka-template-selector-container';

    let selectHtml = `<select id="ka-load-template-select" class="ka-template-select">
        <option value="">-- Vorlage zum Ausfüllen auswählen --</option>
    `;

    templates.forEach((tpl, index) => {
        selectHtml += `<option value="${index}">${tpl.title} (${tpl.price ? tpl.price + '€' : 'VB'})</option>`;
    });
    selectHtml += `</select>`;

    selectDiv.innerHTML = `
        <span class="ka-template-label">⚡ Vorlagen-Manager:</span>
        ${selectHtml}
    `;

    // Insert at the beginning of the form
    form.prepend(selectDiv);

    // Event change
    document.getElementById('ka-load-template-select').onchange = (e) => {
        const val = e.target.value;
        if (val !== '') {
            fillListingForm(templates[parseInt(val, 10)]);
        }
    };

    // Auto-load temp template if page matches pusher redirect
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('load_temp') === 'true') {
        chrome.storage.local.get('ka_temp_pusher', (data) => {
            if (data.ka_temp_pusher) {
                fillListingForm(data.ka_temp_pusher);
                chrome.storage.local.remove('ka_temp_pusher'); // delete temp
            }
        });
    }
}

function fillListingForm(tpl) {
    const titleInput = document.querySelector('#postad-title, #pka-title, input[name*="title"]');
    const descInput = document.querySelector('#postad-description, #pka-description, textarea[name*="description"]');
    const priceInput = document.querySelector('#postad-price, #pka-price, input[name*="price"]');

    if (titleInput) {
        titleInput.value = tpl.title;
        titleInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (descInput) {
        descInput.value = tpl.description;
        descInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (priceInput) {
        priceInput.value = tpl.price;
        priceInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

/**
 * ==========================================
 * ACTIVE ADS PAGE (REPUBLISH / PUSHER)
 * ==========================================
 */
function handleMyAdsPage() {
    const items = document.querySelectorAll('li.managead-listitem, .myads-listitem, article');
    items.forEach(item => {
        if (item.querySelector('.ka-republish-btn')) return;

        const actionGroup = item.querySelector('.managead-listitem--actions, .myads-actions, div:last-child');
        if (!actionGroup) return;

        const republishBtn = document.createElement('button');
        republishBtn.className = 'btn-secondary ka-republish-btn';
        republishBtn.innerText = '🔄 Neu einstellen';
        republishBtn.style.padding = '4px 8px';
        republishBtn.style.fontSize = '12px';
        republishBtn.style.margin = '4px';

        republishBtn.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();

            const adLink = item.querySelector('a[href*="/s-anzeige/"]');
            if (!adLink) {
                alert("Anzeigen-Link konnte nicht ermittelt werden!");
                return;
            }

            if (confirm("Möchtest du diese Anzeige neu einstellen? (Details kopieren, alte löschen, neue öffnen)")) {
                try {
                    const data = await fetchDetailData(adLink.href);
                    
                    // Construct template from item details
                    const priceEl = item.querySelector('.managead-listitem--price, .myads-price');
                    const price = priceEl ? priceEl.textContent.trim().replace(/[^\d]/g, '') : '';
                    const title = item.querySelector('.managead-listitem--title, h3, a.ellipsis')?.textContent.trim() || '';

                    const tempTpl = {
                        title: title,
                        description: data.description || '', // details fetched description
                        price: price,
                        category: data.category || ''
                    };

                    // Save details to temp storage
                    await chrome.storage.local.set({ ka_temp_pusher: tempTpl });

                    // Find and click delete button of listing
                    const deleteBtn = item.querySelector('a[data-action="delete"], .delete-ad-btn, a[href*="delete"]');
                    if (deleteBtn) {
                        deleteBtn.click();
                        // Redirect to post listing after a small delay
                        setTimeout(() => {
                            window.open('/s-anzeige-aufgeben.html?load_temp=true', '_blank');
                        }, 1200);
                    } else {
                        // Redirect directly
                        window.open('/s-anzeige-aufgeben.html?load_temp=true', '_blank');
                    }
                } catch (err) {
                    console.error("KA Plus: Republish failed", err);
                    alert("Beim Kopieren der Anzeige ist ein Fehler aufgetreten.");
                }
            }
        };

        actionGroup.appendChild(republishBtn);
    });
}

/**
 * ==========================================
 * CHAT MESSENGER SNIPPETS
 * ==========================================
 */
function handleChatPage() {
    const chatInput = document.querySelector('#viewad-contact-message, #chat-message-input, .chat-input textarea, textarea[name="message"]');
    if (!chatInput || document.querySelector('.ka-snippets-container')) return;

    if (!settings.chatSnippets || settings.chatSnippets.length === 0) return;

    const container = document.createElement('div');
    container.className = 'ka-snippets-container';

    settings.chatSnippets.forEach(snippet => {
        const pill = document.createElement('div');
        pill.className = 'ka-snippet-pill';
        pill.innerText = snippet;
        pill.onclick = () => {
            // Append snippet to textarea
            const spacer = chatInput.value ? ' ' : '';
            chatInput.value = chatInput.value + spacer + snippet;
            chatInput.dispatchEvent(new Event('input', { bubbles: true }));
            chatInput.focus();
        };
        container.appendChild(pill);
    });

    // Insert above textarea
    chatInput.parentNode.insertBefore(container, chatInput);
}

/**
 * ==========================================
 * SEARCH EXPORTER (SCRAPER)
 * ==========================================
 */
function injectExporterButton() {
    const container = getAdContainer();
    if (!container) return;

    const listHeader = document.querySelector('.pagination-nav') || container.previousSibling || container;
    if (!listHeader) return;

    const btnContainer = document.createElement('div');
    btnContainer.className = 'ka-export-btn-container';

    const btn = document.createElement('button');
    btn.className = 'ka-export-btn';
    btn.id = 'ka-export-results-btn';
    btn.innerHTML = '📊 Ergebnisse exportieren (CSV)';
    btn.onclick = () => exportSearchResults();

    btnContainer.appendChild(btn);
    listHeader.parentNode.insertBefore(btnContainer, listHeader);
}

function exportSearchResults() {
    const ads = document.querySelectorAll('article[data-adid], article.aditem');
    if (ads.length === 0) {
        alert("Keine Suchergebnisse zum Exportieren gefunden!");
        return;
    }

    const data = [];
    // Header
    data.push(['Anzeigen-ID', 'Titel', 'Preis', 'Ort', 'Datum', 'Link']);

    ads.forEach(ad => {
        const adId = getAdId(ad) || '';
        const titleEl = ad.querySelector('.aditem-main--middle--title-container a, h2 a, h3 a, a.ellipsis');
        const title = titleEl ? titleEl.textContent.trim().replace(/"/g, '""') : '';
        const href = titleEl ? window.location.origin + titleEl.getAttribute('href') : '';
        
        const priceEl = ad.querySelector('.aditem-main--middle--price-shipping--price, .aditem-main--middle--price-shipping, .aditem-main--middle--price-container, .aditem-main--middle--price');
        const price = priceEl ? priceEl.textContent.trim().replace(/"/g, '""') : '';
        
        const locEl = ad.querySelector('.aditem-main--top--left');
        const location = locEl ? locEl.textContent.trim().replace(/\s+/g, ' ').replace(/"/g, '""') : '';
        
        const dateEl = ad.querySelector('.aditem-main--top--right');
        const date = dateEl ? dateEl.textContent.trim().replace(/\s+/g, ' ').replace(/"/g, '""') : '';

        data.push([adId, title, price, location, date, href]);
    });

    // Create CSV String
    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" 
        + data.map(e => e.map(val => `"${val}"`).join(";")).join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    
    const queryTerm = new URLSearchParams(window.location.search).get('q') || 'Kleinanzeigen';
    link.setAttribute("download", `${queryTerm}_export_${new Date().toISOString().split('T')[0]}.csv`);
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

/**
 * ==========================================
 * UTILITY HELPERS
 * ==========================================
 */
async function markAsSeen(adId) {
    if (!seenAds.includes(adId)) {
        seenAds.push(adId);
        if (seenAds.length > 500) seenAds.shift(); // Max cache 500 items
        await chrome.storage.local.set({ [STORAGE_KEYS.SEEN_ADS]: seenAds });
    }
}

async function hideAd(adId, element) {
    if (!hiddenAds.includes(adId)) {
        hiddenAds.push(adId);
        await chrome.storage.local.set({ [STORAGE_KEYS.HIDDEN_ADS]: hiddenAds });
        hideListingElement(element);
    }
}

async function blockUser(userId, userName) {
    if (confirm(`Möchtest du '${userName}' wirklich blockieren? Alle Anzeigen dieses Users werden in Zukunft ausgeblendet.`)) {
        if (!blockedUsers.some(u => u.id === userId)) {
            blockedUsers.push({ id: userId, name: userName });
            await chrome.storage.local.set({ [STORAGE_KEYS.BLOCKED_USERS]: blockedUsers });
            location.reload(); // Reload page to filter blocked user's ads
        }
    }
}

function getAdIdFromUrl(path) {
    const match = path.match(/\/(\d+)-/);
    return match ? match[1] : null;
}

/**
 * ==========================================
 * INFINITE SCROLL LOADER
 * ==========================================
 */
let infiniteScrollLoading = false;
let nextPageUrl = null;
let scrollListenerAttached = false;

function getAdContainer(rootDoc = document) {
    let container = rootDoc.querySelector('#srchrslt-adtable, ul.ad-list, .ad-list');
    if (!container) {
        const firstAd = rootDoc.querySelector('article.aditem, article[data-adid]');
        if (firstAd) {
            container = firstAd.closest('ul, ol, div');
        }
    }
    return container;
}

function getPaginationElement(rootDoc = document) {
    return rootDoc.querySelector('.pagination') || 
           rootDoc.querySelector('.pagination-pages') || 
           rootDoc.querySelector('.pagination-pagination') || 
           rootDoc.querySelector('[class*="pagination"]');
}

function getHrefFromElement(el) {
    if (!el) return null;
    if (el.tagName === 'A') {
        return el.getAttribute('href');
    }
    const a = el.querySelector('a');
    if (a) {
        return a.getAttribute('href');
    }
    return el.getAttribute('data-url') || el.getAttribute('data-href');
}

function getNextPageButton(rootDoc = document) {
    // Look inside the pagination element first
    const pagination = getPaginationElement(rootDoc);
    if (pagination) {
        const nextBtn = pagination.querySelector('.pagination-next') || 
                        pagination.querySelector('a[data-testid="pagination-next"]') ||
                        pagination.querySelector('.pagination-pages--next') ||
                        pagination.querySelector('a[rel="next"]') ||
                        Array.from(pagination.querySelectorAll('a')).find(a => {
                            const text = a.textContent.toLowerCase();
                            const label = (a.getAttribute('aria-label') || '').toLowerCase();
                            const testId = (a.getAttribute('data-testid') || '').toLowerCase();
                            return text.includes('weiter') || 
                                   text.includes('nächste') || 
                                   text.includes('›') || 
                                   text.includes('»') || 
                                   label.includes('weiter') || 
                                   label.includes('nächste') ||
                                   testId.includes('next');
                        });
        if (nextBtn) return nextBtn;
    }
    
    // Fallback: only look document-wide using specific selectors (not text search)
    return rootDoc.querySelector('.pagination-next') ||
           rootDoc.querySelector('a[data-testid="pagination-next"]') ||
           rootDoc.querySelector('.pagination-pages--next') ||
           rootDoc.querySelector('a[rel="next"]');
}

function initScrollListener() {
    if (scrollListenerAttached) return;
    scrollListenerAttached = true;
    
    console.log("KA Plus: Scroll listener registered successfully.");

    window.addEventListener('scroll', throttle(() => {
        consecutiveAutoLoads = 0; // Reset auto-loads count when user scrolls
        checkScrollTrigger(false);
    }, 200));
}

let consecutiveAutoLoads = 0;
const MAX_CONSECUTIVE_AUTO_LOADS = 5;

function checkScrollTrigger(isAutoTrigger = false) {
    if (infiniteScrollLoading || !settings.enableInfiniteScroll || !nextPageUrl) {
        return;
    }

    if (isAutoTrigger && consecutiveAutoLoads >= MAX_CONSECUTIVE_AUTO_LOADS) {
        console.log("KA Plus: Max consecutive auto-loads reached, pausing auto-fetch.");
        let spinner = document.getElementById('ka-infinite-spinner');
        if (spinner) {
            spinner.innerHTML = '⚠️ Viele Inserate ausgeblendet. <a href="#" id="ka-trigger-force-load" style="color: var(--ka-primary); text-decoration: underline; font-weight: bold;">Mehr laden</a>';
            const forceBtn = document.getElementById('ka-trigger-force-load');
            if (forceBtn) {
                forceBtn.onclick = (e) => {
                    e.preventDefault();
                    consecutiveAutoLoads = 0; // reset
                    loadNextPage();
                };
            }
        }
        return;
    }

    const adTable = getAdContainer();
    if (!adTable) return;

    const rect = adTable.getBoundingClientRect();
    const distanceToBottom = rect.bottom - window.innerHeight;
    
    console.log("KA Plus: Scroll trigger check (container-based)", { 
        rectBottom: rect.bottom, 
        windowHeight: window.innerHeight, 
        distanceToBottom, 
        nextPageUrl, 
        isAutoTrigger, 
        consecutiveAutoLoads 
    });

    // Threshold: trigger loading when the bottom of the ad list is within 1000px of the viewport bottom
    if (distanceToBottom < 1000) {
        if (isAutoTrigger) {
            consecutiveAutoLoads++;
        }
        loadNextPage();
    }
}

function constructNextPageUrlFallback(currentUrlString) {
    try {
        const urlObj = new URL(currentUrlString);
        let path = urlObj.pathname;
        
        if (path.endsWith('/')) {
            path = path.slice(0, -1);
        }
        
        const segments = path.split('/');
        const pageMatch = path.match(/\/seite:(\d+)(\/|$)/);
        
        if (pageMatch) {
            const curPage = parseInt(pageMatch[1], 10);
            const nextPage = curPage + 1;
            urlObj.pathname = path.replace(/\/seite:\d+(\/|$)/, `/seite:${nextPage}$1`);
        } else {
            // Insert seite:2 before the last segment
            segments.splice(segments.length - 1, 0, 'seite:2');
            urlObj.pathname = segments.join('/');
        }
        return urlObj.href;
    } catch (e) {
        console.error("KA Plus: Failed to construct fallback next URL", e);
        return null;
    }
}

function setupInfiniteScroll() {
    const adTable = getAdContainer();
    if (!adTable) return;

    // Track the initial next page URL
    const nextBtn = getNextPageButton();
    if (nextBtn) {
        const hrefAttr = getHrefFromElement(nextBtn);
        nextPageUrl = hrefAttr ? new URL(hrefAttr, window.location.origin).href : null;
    }
    
    if (!nextPageUrl) {
        // Fallback: construct page URL programmatically from current URL
        nextPageUrl = constructNextPageUrlFallback(window.location.href);
        console.log("KA Plus: Next button not found in DOM. Using constructed fallback next page URL:", nextPageUrl);
    } else {
        console.log("KA Plus: Resolved initial next page URL:", nextPageUrl);
    }

    if (!nextPageUrl) {
        infiniteScrollInitialized = false;
        return;
    }

    initScrollListener();

    // Trigger initial check in case the page is already too short
    setTimeout(() => {
        checkScrollTrigger(true);
    }, 500);
}

async function loadNextPage() {
    if (!nextPageUrl) return;

    const currentUrlToFetch = nextPageUrl;
    // Set to null immediately to prevent duplicate async trigger
    nextPageUrl = null;
    infiniteScrollLoading = true;

    console.log("KA Plus: Loading next page", currentUrlToFetch);

    const parentContainer = getAdContainer();
    if (!parentContainer) {
        infiniteScrollLoading = false;
        return;
    }

    let spinner = document.getElementById('ka-infinite-spinner');
    if (!spinner) {
        spinner = document.createElement('div');
        spinner.id = 'ka-infinite-spinner';
        spinner.style.textAlign = 'center';
        spinner.style.padding = '20px';
        spinner.style.fontSize = '14px';
        spinner.style.color = '#64748b';
        spinner.innerHTML = '🔄 Lade nächste Seite...';
        parentContainer.parentNode.insertBefore(spinner, parentContainer.nextSibling);
    }
    spinner.innerHTML = '🔄 Lade nächste Seite...';
    spinner.style.display = 'block';

    try {
        const res = await fetch(currentUrlToFetch);
        if (!res.ok) throw new Error("HTTP error " + res.status);
        
        const html = await res.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const nextTable = getAdContainer(doc);
        let appendedAds = 0;
        if (nextTable) {
            const nextItems = Array.from(nextTable.children);
            // Filter to only real ad items — ignore placeholder/banner children
            const realItems = nextItems.filter(item =>
                item.querySelector('article[data-adid], article.aditem') ||
                item.tagName === 'ARTICLE'
            );

            if (realItems.length === 0) {
                // No real ads found — we've hit the end
                console.log("KA Plus: Fetched page contains no ads. End of results.");
                nextPageUrl = null;
                spinner.innerHTML = '✨ Keine weiteren Anzeigen gefunden.';
                return;
            }

            console.log(`KA Plus: Appending ${nextItems.length} new items (${realItems.length} real ads).`);
            appendedAds = realItems.length;
            nextItems.forEach(item => {
                parentContainer.appendChild(item);
            });
            
            try {
                window.history.replaceState({}, '', currentUrlToFetch);
            } catch (e) {}

            // Process the newly added listings
            handleAdLists();
        }

        // Find the next URL from the background-fetched document only.
        // We intentionally do NOT sync the live pagination DOM — overwriting it
        // with innerHTML breaks the browser's ability to find the next-page link afterwards.
        let resolvedNextUrl = null;

        const newNextBtn = getNextPageButton(doc);
        if (newNextBtn) {
            const hrefAttr = getHrefFromElement(newNextBtn);
            if (hrefAttr) {
                const candidate = new URL(hrefAttr, window.location.origin).href;
                if (candidate !== currentUrlToFetch) {
                    resolvedNextUrl = candidate;
                }
            }
        }

        // Fallback: construct next URL programmatically from the URL we just fetched
        if (!resolvedNextUrl) {
            resolvedNextUrl = constructNextPageUrlFallback(currentUrlToFetch);
            console.log("KA Plus: next button not found in fetched doc, using fallback URL:", resolvedNextUrl);
        } else {
            console.log("KA Plus: Next page URL from fetched doc:", resolvedNextUrl);
        }

        if (resolvedNextUrl) {
            nextPageUrl = resolvedNextUrl;
            spinner.style.display = 'none';
        } else {
            nextPageUrl = null;
            spinner.innerHTML = '✨ Keine weiteren Anzeigen gefunden.';
            console.log("KA Plus: No more pages to load.");
        }
    } catch (err) {
        console.error("KA Plus: Failed to load next page", err);
        spinner.innerHTML = '❌ Fehler beim Laden der nächsten Seite. Bitte nach unten scrollen zum Erneut-Versuchen.';
        nextPageUrl = currentUrlToFetch; // Restore link to retry
    } finally {
        infiniteScrollLoading = false;
    }
}

function throttle(func, limit) {
    let inThrottle;
    return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// Observe modifications (dynamic content support)
const observer = new MutationObserver((mutations) => {
    if (isInitialized) {
        handleAdLists();
    }
});

observer.observe(document.body, { childList: true, subtree: true });

// Initial execute
init();
