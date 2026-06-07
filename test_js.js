// Mock browser environment to test content.js logic
const fs = require('fs');

global.chrome = {
    storage: {
        local: {
            get: (keys, cb) => {
                const res = {
                    ka_settings: {
                        enableInfiniteScroll: true,
                        hideSponsored: true,
                        hideTopAds: false,
                        shiftTopAdsBottom: true,
                        blacklistKeywords: ['defekt']
                    },
                    ka_blocked_users: [],
                    ka_hidden_ads: [],
                    ka_seen_ads: [],
                    ka_templates: [],
                    ka_notes: {}
                };
                if (cb) cb(res);
                return Promise.resolve(res);
            },
            set: (data, cb) => {
                if (cb) cb();
                return Promise.resolve();
            }
        }
    }
};

global.window = {
    location: {
        pathname: '/s-zu-verschenken-tauschen/90513/seite:5/c272l5659r10',
        origin: 'https://www.kleinanzeigen.de'
    },
    addEventListener: (event, cb) => {
        console.log(`Event listener added for: ${event}`);
    },
    innerHeight: 800,
    pageYOffset: 0,
    history: {
        replaceState: () => {}
    }
};

global.document = {
    location: global.window.location,
    body: {
        scrollHeight: 1200,
        offsetHeight: 1200,
        clientHeight: 1200,
        scrollTop: 0
    },
    documentElement: {
        scrollHeight: 1200,
        offsetHeight: 1200,
        clientHeight: 1200,
        scrollTop: 0
    },
    createElement: (tag) => {
        return {
            id: '',
            style: {},
            innerHTML: '',
            parentNode: {
                insertBefore: () => {}
            },
            appendChild: () => {}
        };
    },
    getElementById: (id) => null,
    querySelectorAll: (selector) => [],
    querySelector: (selector) => null,
    addEventListener: () => {}
};

global.MutationObserver = function(cb) {
    this.observe = () => {
        console.log("MutationObserver observe called");
    };
};

// Load content.js
try {
    const code = fs.readFileSync('content.js', 'utf8');
    // Run content.js in this context
    eval(code);
    console.log("SUCCESS: content.js loaded and evaluated without syntax/compilation errors.");
} catch (e) {
    console.error("FAIL: Error evaluating content.js:", e);
}
