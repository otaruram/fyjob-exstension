# FYJOB Scanner - Edge Publish Checklist

## Release Artifact
- Upload file: `builds/fyjob-scanner-chrome-1.1.7.zip`
- Do not upload Firefox `.xpi` to Edge Add-ons.

## Pre-submit Validation
1. Open Edge and go to `edge://extensions`.
2. Enable Developer mode.
3. Click `Load unpacked` and select the `extension` folder.
4. Open side panel and verify:
   - Small restart icon appears in top bar.
   - `Open Dashboard Workspace` CTA appears in Match Result card.
   - Scan button and auth flow still work.

## Edge Add-ons Submission
1. Open Partner Center: https://partner.microsoft.com/dashboard/microsoftedge/overview
2. Create new extension submission.
3. Upload package `fyjob-scanner-chrome-1.1.7.zip`.
4. Fill listing details:
   - Name: FYJOB Scanner
   - Category: Productivity
   - Short description: Quick job match analysis with synced FYJOB auth.
5. Add screenshots from side panel (include new restart icon and dashboard CTA).
6. Privacy policy URL and support URL must be valid.
7. Submit for review.

## Recommended Release Note
- Added quick restart icon in side panel header.
- Improved Open Dashboard CTA styling and copy.
- Minor UI polish for scan workflow.

## Versioning Notes
- `manifest.json` version is set to `1.1.7`.
- `build-all.ps1` default version is set to `1.1.7`.
