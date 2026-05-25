/**
 * Kleinanzeigen Plus - Background Service Worker
 * Handles operations requiring background permissions, such as batch downloads.
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'download_images') {
        const { images, adId } = message;
        images.forEach((url, index) => {
            // Determine file extension
            let ext = '.jpg';
            try {
                const cleanUrl = url.split('?')[0];
                if (cleanUrl.endsWith('.png') || cleanUrl.endsWith('.PNG')) ext = '.png';
                else if (cleanUrl.endsWith('.webp') || cleanUrl.endsWith('.WEBP')) ext = '.webp';
                else if (cleanUrl.endsWith('.jpeg') || cleanUrl.endsWith('.JPEG')) ext = '.jpeg';
            } catch (e) {
                // Ignore parsing errors, fallback to .jpg
            }

            const filename = `Kleinanzeigen_${adId}/bild_${String(index + 1).padStart(2, '0')}${ext}`;
            
            chrome.downloads.download({
                url: url,
                filename: filename,
                conflictAction: 'uniquify'
            }, (downloadId) => {
                if (chrome.runtime.lastError) {
                    console.error(`Download failed for ${url}:`, chrome.runtime.lastError.message);
                }
            });
        });
        sendResponse({ success: true, count: images.length });
    }
    return true;
});
