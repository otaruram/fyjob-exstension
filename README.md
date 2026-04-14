# FYJOB Scanner Extension

Browser extension for FYJOB that helps users analyze job listings directly from the current page and continue improvement workflows in the FYJOB dashboard.

## Features

- Side panel workflow for quick analysis on job listing pages
- Session sync with FYJOB dashboard authentication
- Quick Match Analysis for the active job post
- Match result summary and skill-gap highlight
- Direct call-to-action to continue in dashboard workspace
- Recent scan history in panel

## Tech Stack

- Manifest V3
- JavaScript (vanilla)
- Chrome Extension APIs (`tabs`, `storage`, `scripting`, `sidePanel`)
- Firefox compatibility via `sidebar_action`

## Project Structure

- `manifest.json`: extension manifest and permissions
- `background.js`: auth sync, token refresh, side panel orchestration
- `content.js`: extraction bridge from active page
- `sidepanel.html`: panel markup
- `sidepanel.css`: panel styles
- `sidepanel.js`: panel state and feature flow
- `sidepanel-ui.js`: UI utilities
- `lib/api.js`: backend API helpers
- `icons/`: extension icons
- `builds/`: release artifacts (`.zip`, `.xpi`)

## Local Development

1. Open browser extension page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
2. Enable Developer Mode.
3. Click **Load unpacked** and select the `extension/` folder.
4. Open FYJOB dashboard and log in.
5. Open a job listing page, then click extension action to open the side panel.

## Build Release Artifacts

From the `extension/` folder, run:

```powershell
./build-all.ps1 -Version 1.1.9
```

Output files are written to `extension/builds/`:

- `fyjob-scanner-chrome-<version>.zip`
- `fyjob-scanner-firefox-<version>.xpi`

## Publishing Notes

- Chrome/Edge submission details: `CHROME_WEB_STORE_SUBMISSION.md`, `EDGE_PUBLISH_CHECKLIST.md`
- Ensure package root contains `manifest.json` and extension files directly
- Verify privacy policy URL and backend endpoints before submission

## API and Auth

- The extension syncs auth session from FYJOB dashboard (Supabase session bridge)
- API requests are sent to FYJOB backend endpoints used for analysis workflows
- Job content is processed only when user triggers analysis

## Repository

Main product repository: `https://github.com/otaruram/fyjob-web`
