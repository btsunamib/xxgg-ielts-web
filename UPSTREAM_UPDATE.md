# Desktop renderer update: 0.9.17-rc.2

Updated from 0.9.16-rc.3 using the official desktop installer, without running the Windows application.

- Official channel: https://static.9fnnn.com/electron/stable/latest.yml
- Release date: 2026-10-03T01:16:44.516Z
- Installer: jiufenxuezhang-ielts-setup-0.9.17-rc.2.exe
- Installer SHA-512 (base64): `IGstelkTlFYPKZfSTMtBNEqkqrIE+k0XGjQ4LKEMvPREmYVjI/bYT+6EgmxufH6bPuOwqEvz8yCwi8P3OeKIxg==`

The repository contains the renderer from `resources/app.asar/dist`, the existing browser bridge, and the existing web request adapters. No Electron executable, native database, account credentials, or user data is included.

The new renderer includes the native manual composition panel and vocabulary features. Native manual selection routes through the existing web composition adapter. The web Part picker remains available from “逐 Part 自选篇目” / “调整各 Part 篇目”. Opening an editor hides launch actions; cancelling or failing an edit retains the original composition.

Retained browser fixes include hidden-answer question audio, four-Part automatic playback, review fallback without forced logout, account/session guards, and submission when draft storage is full. All new renderer imports and browser scripts are pinned to this release.

## Verification

Run `node --test tests/listening-compose.test.cjs`. The tests execute shipped request clients, controllers, renderer callbacks, and browser adapters with deterministic responses. They cover account changes, failed/partial submissions, quota limits, saved reviews, manual composition, and playback.

`tests/bundle-contracts.json` maps changing build variable names to the test harness names, validates each shipped file with SHA-256, and changes identifier spelling only. Scope resolution was verified against the shipped modules. Refresh its ranges and hashes whenever a renderer bundle changes; do not bypass the digest check.

Server-backed vocabulary, account, and catalogue features continue to use the upstream API and its availability and permissions.
