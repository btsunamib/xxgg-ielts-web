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

## Public catalogue heat list (2026-10-11)

The web port adds independent “公开题库热度 Top 50” albums for reading and listening. Each Part shows up to 50 unique public catalogue entries, sorted by the public `sevenDayReportTotal` field descending, with unit ID ascending as the deterministic tie break. Source album IDs and entry modes are preserved. These are independently computed catalogue lists, not copies of the official permission-gated extended ranking; historical positions/deltas are unavailable. Public catalogue coverage can differ from the official ranking universe.

Only ordinary public albums/units are requested for this list, without account headers or cookies. Public metadata stays in memory for five minutes; no privileged account data is cached or shared. If a catalogue source fails, the official list remains intact and the next load retries. All 50 rows are delivered together, so no ranking entitlement is required for this independent list.

The former forced `high_frequency_more_rows` flag is removed. Real accounts retain the upstream ranking entitlement through the local composition adapter; official rankings and their pagination remain upstream-controlled. Anonymous/local accounts keep the original public official ranking view.

Run `node --test tests/*.test.cjs` for 90 regression checks, including Top 50 sorting, deduplication, Part/channel separation, public-request credential isolation, failure fallback, and preservation of paid/unpaid ranking feature flags with mocked accounts. Real privileged-account validation requires secure sign-in and is separate from these checks.
