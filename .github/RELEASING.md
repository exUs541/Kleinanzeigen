# Releasing

Pushing to the default branch publishes the extension to the stores. This file is the
short version of how that works and what to do when it does not.

## How a release happens

1. Change the code.
2. Raise `"version"` in `manifest.json` (stores reject a version that is not higher than the live one).
3. Commit and push to `main`.

The **Store Release** workflow then builds the package, checks it, and uploads it to

- the **Chrome Web Store** (always), and
- **Microsoft Edge Add-ons** (only if the three `EDGE_*` secrets exist, i.e. only for
  extensions that are already published there).

A push that does not change the version builds and verifies the package but publishes
nothing. Pushes that only touch docs, Markdown, store artwork or `.github/` do not start
the workflow at all.

Run it by hand under **Actions > Store Release > Run workflow**. Tick *Dry run* to build and
verify the package without publishing (useful after changing the pipeline).

## What goes into the package

`.github/scripts/package-extension.mjs` ships everything except documentation, store
artwork, presentations and scripts. Add repo-specific exclusions to `.storeignore` in the
repository root (one glob per line). The script fails the run if the manifest or a shipped
page references a file that is not in the package, or if shipped code mentions a file that
was excluded. Run it locally with `node .github/scripts/package-extension.mjs`.

## Secrets (Settings > Secrets and variables > Actions)

| Secret | Store | Notes |
|---|---|---|
| `CHROME_EXTENSION_ID` | Chrome | ID of the published item |
| `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN` | Chrome | OAuth credentials, see [chrome-webstore-upload-keys](https://github.com/fregante/chrome-webstore-upload-keys) |
| `CHROME_PUBLISHER_ID` | Chrome | Developer Dashboard > Account. Required for the current Chrome Web Store API. Without it the workflow falls back to the legacy API (v1.1), which Google planned to retire on 2026-10-15. |
| `EDGE_PRODUCT_ID`, `EDGE_CLIENT_ID`, `EDGE_API_KEY` | Edge | Partner Center > Microsoft Edge > Publish API. **The API key expires after about 72 days.** |
| `PORTFOLIO_PAT` | GitHub | Optional. Triggers the website/LinkedIn update after a successful release. |

## When something fails

| Symptom | Cause | Fix |
|---|---|---|
| Run is green, "Not publishing: manifest version is still ..." | Version was not raised | Raise it, push again |
| Chrome: previous submission is still in review | The store accepts one pending submission | Re-run the workflow after the review |
| Edge: "did not return an operation id", 401 | API key expired | Create a new key at Partner Center, update `EDGE_API_KEY`, re-run |
| Chrome: auth / 401 / 403 | Refresh token revoked or publisher ID wrong | Recreate the token, check `CHROME_PUBLISHER_ID`, re-run |
| Package check fails | A referenced file is missing or was excluded | Fix the reference or adjust `.storeignore` |

A failed release is not retried by later pushes (the version did not change again). Fix the
cause and use **Run workflow**.

New extensions, listing text and screenshots are still created in the store dashboards by
hand; the API only updates an existing item.
