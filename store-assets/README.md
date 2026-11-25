# Store assets – Kleinanzeigen Plus

Everything for the store listings of Kleinanzeigen Plus in one place: images, logo sources and the store text, for the Chrome Web Store and Microsoft Edge Add-ons at once. One image set serves both stores (the sizes are accepted by both). The store text is German, like the extension and kleinanzeigen.de.

This folder is not part of the extension package. The packager (`.github/scripts/package-extension.mjs`) skips `store-assets/`, and changes here do not start a release.

## Contents

```
store-assets/
├─ listing.md                          store texts and field values (both stores; store-only parts are marked)
├─ screenshots/                        5 × 1280×800
├─ promo-small-440x280.png             small promo tile
├─ promo-marquee-1400x560.png          large promo tile (Chrome "marquee", Edge "large")
├─ brand/
│  ├─ logo.svg                         logo master
│  ├─ logo-512.png
│  └─ logo-300x300.png                 Edge logo
└─ Kleinanzeigen-<version>.zip         built package (git-ignored)
```

## Which file goes where

| Store field | File | Chrome | Edge |
|---|---|---|---|
| Extension icon 128 × 128 | `../icons/icon128.png` (inside the package) | store icon | automatic |
| Logo 300 × 300 | `brand/logo-300x300.png` | – | logo |
| Screenshots | `screenshots/screenshot-1-…` to `screenshot-5-…` (24-bit PNG) | up to 5 | up to 6 |
| Small tile 440 × 280 | `promo-small-440x280.png` | optional | optional |
| Large tile 1400 × 560 | `promo-marquee-1400x560.png` | optional (marquee) | optional (large) |
| Package | `Kleinanzeigen-<version>.zip` | built by the release pipeline | upload by hand the first time, pipeline afterwards |

## File naming

Files that apply to one store only carry the store in their name (`…-chrome.…` or `…-edge.…`). Everything without such a suffix is shared by both stores.

## Notes

- The screenshots are real captures of kleinanzeigen.de with the real extension code and the real popup, framed with a headline. The seller name on the detail page was anonymised for the capture; the cookie dialog and the login notice were only hidden (nothing was accepted).
- The popup switches "Top-Anzeigen", "Bildervorschau" and "Google-Maps-Link" are hidden in the screenshots because they have no effect in the current Kleinanzeigen layout.
- The texts describe only features verified live against kleinanzeigen.de on 2026-11-23. No longer working in the new layout: image preview on hover, map and block buttons in the result list, hiding or moving top ads, price/location/date in the CSV export. Whoever repairs one of these updates the text and the screenshots.
- The old `images/` folder (dark theme, popup texts that were not a real interface) was removed from the repository. It remains in the Git history.
