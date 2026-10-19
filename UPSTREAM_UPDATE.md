# Desktop renderer update: 0.9.17-rc.2

Updated from 0.9.16-rc.3 using the official desktop installer, without running the Windows application.

- Official channel: https://static.9fnnn.com/electron/stable/latest.yml
- Release date: 2026-10-03T01:16:44.516Z
- Installer: jiufenxuezhang-ielts-setup-0.9.17-rc.2.exe
- Installer SHA-512 (base64): `IGstelkTlFYPKZfSTMtBNEqkqrIE+k0XGjQ4LKEMvPREmYVjI/bYT+6EgmxufH6bPuOwqEvz8yCwi8P3OeKIxg==`

The repository contains the renderer from `resources/app.asar/dist`, the existing browser bridge, and the existing web request adapters. No Electron executable, native database, account credentials, or user data is included.

The new renderer includes the native manual composition panel and vocabulary features. Native manual selection routes through the existing web composition adapter. The extra web Part picker was retired on 2026-10-19; the native random and manual composition surfaces remain available through the web request adapter.

Retained browser fixes include hidden-answer question audio, four-Part automatic playback, review fallback without forced logout, account/session guards, and submission when draft storage is full. All new renderer imports and browser scripts are pinned to this release.

## Verification

Run `node --test tests/listening-compose.test.cjs`. The tests execute shipped request clients, controllers, renderer callbacks, and browser adapters with deterministic responses. They cover account changes, failed/partial submissions, quota limits, saved reviews, manual composition, and playback.

`tests/bundle-contracts.json` maps changing build variable names to the test harness names, validates each shipped file with SHA-256, and changes identifier spelling only. Scope resolution was verified against the shipped modules. Refresh its ranges and hashes whenever a renderer bundle changes; do not bypass the digest check.

Server-backed vocabulary, account, and catalogue features continue to use the upstream API and its availability and permissions.

## Public catalogue heat list (2026-10-11)

The web port adds independent “公开题库热度 Top 50” albums for reading and listening. Each Part shows up to 50 unique public catalogue entries, sorted by the public `sevenDayReportTotal` field descending, with unit ID ascending as the deterministic tie break. Source album IDs and entry modes are preserved. These are independently computed catalogue lists, not copies of the official permission-gated extended ranking; historical positions/deltas are unavailable. Public catalogue coverage can differ from the official ranking universe.

Ordinary public albums/units are requested without account headers or cookies. Public metadata stays in memory for five minutes; account progress is fetched separately as described below and is never added to this cache. If a catalogue source fails, the official list remains intact and the next load retries. All 50 rows are delivered together, so no ranking entitlement is required for this independent list.

The former forced `high_frequency_more_rows` flag is removed. Real accounts retain the upstream ranking entitlement through the local composition adapter; official rankings and their pagination remain upstream-controlled. Anonymous/local accounts keep the original public official ranking view.

Run `node --test tests/*.test.cjs` for 90 regression checks, including Top 50 sorting, deduplication, Part/channel separation, public-request credential isolation, failure fallback, and preservation of paid/unpaid ranking feature flags with mocked accounts. Real privileged-account validation requires secure sign-in and is separate from these checks.

## Web composition rules repair (2026-10-11)

`xxgg-compose-rules.js` is shared by account-backed local composition and anonymous/device composition. Candidates must be available single-Part exam entries and selectable for mixed practice; recall links, unavailable/locked entries and invalid Part numbers are excluded. Both modes preserve public heat, average accuracy and source identifiers, deduplicate the full catalogue, and require exactly one passage per expected Part (reading 3, listening 4).

High-frequency preference uses public seven-day report counts as random-selection weights, independent of ranking entitlements. It overrides difficulty to random, matching the renderer's control behavior. When no positive counts are available, selection is uniform. Difficulty is a web estimate: within each Part, public average accuracy is sorted into upper/middle/lower thirds for easy/medium/hard, with boundary ties kept together. Unknown accuracy is excluded from difficulty-specific pools. These tiers are not asserted to reproduce the official backend's private algorithm.

Only-undone checks the entire candidate pool in batches of 50 (three concurrent batches), removing the former 300-status/400-candidate limits. Status failures cannot silently become successful papers. If only completed candidates remain in a Part, the renderer's existing shortage-confirmation flow asks before falling back, and only the deficient Parts relax the undone rule. A completely missing Part or difficulty pool fails atomically rather than taking another Part. Reshuffle avoids previous units/source Part IDs when alternatives exist; unavoidable repeats return the existing repeat warning. Explicit manual IDs remain authoritative and Part-validated.

Real-account caches reset on account change and successful ordinary/mixed submissions. Catalogue heat/difficulty metadata expires after five minutes. Locally accepted done markers are scoped to the account identity; unscoped legacy markers are ignored for selection. Catalogue failures leave no partial paper. Existing stored papers, review and ordinary server grading remain supported.

Validation: `node --test tests/*.test.cjs` passes 111 checks covering weighted heat, realistic reading difficulty tiers, invalid candidates, missing Parts, shortage consent, full status coverage, account changes, submit invalidation, manual selection, and the earlier playback/grading/storage/ranking contracts.

## Ranking progress and default accuracy repair (2026-10-12)

The added public Top 50 lists previously contained public catalogue metadata only, so the renderer treated completed units as unpractised and lacked personal accuracy/result links. Each ranking refresh now hydrates its source unit IDs through the existing `/practice/v1/unit-status` API, in batches of 50 with at most three concurrent requests. The existing browser adapters continue to serve device-local progress for local sessions. Completion status, personal accuracy (including 0%), result ID and last attempt date are merged by unit ID; missing account averages retain the public average.

Only the public catalogue is cached. Personal status is read afresh for every ranking refresh, is never persisted by this adapter, and is discarded if the session token changes while a request is running. A failed status request leaves the public rows and official lists available and retries on the next refresh. Public catalogue requests remain credential-free; the account token is sent only to the configured practice API's status endpoint.

All high-frequency ranking surfaces now default to accuracy when that display option is available. Users can still select report count, completion date or notes through the existing filter. The shipped bundle's alias offsets and SHA-256 contract have been updated along with the script cache versions.

Validation: `node --test tests/*.test.cjs` passes 116 checks, including fresh progress after completion, 350-row batch coverage, 0% accuracy, account changes during requests, status failures, and shipped renderer defaults/status mapping. These use deterministic account responses rather than a live student account.

## First-navigation module identity repair (2026-10-12)

The HTML entry loaded the main ES module with a query-string version, while lazy exam/review pages imported its bare filename. Since ES module identity includes the query string, the first navigation loaded a second Vue/router/application bootstrap, replacing the active application and resetting catalogue/ranking state. This affected reading, listening and the other lazy page routes, rather than only the new ranking.

The HTML entry and every chunk now reference exactly the same canonical main-module URL without a query. The entire 21-file JavaScript dependency graph has fresh filenames, including shared chunks, so cached pages cannot import the old bootstrap. CSS filenames are retained. Import references, preload targets, bundle contract paths/digests and the published version are updated together. The ranking's fallback configuration now also defaults to accuracy.

`tests/module-navigation.test.cjs` compiles and links the deployed ES modules for all eight lazy routes and asserts that their dependency graph contains only the original HTML entry instance. The preceding deployment fails this regression on its first lazy-page navigation by linking two application modules. Validation: `node --test tests/*.test.cjs` passes 118 checks. This exercises the real shipped module graph and renderer contracts; a live-account browser click test remains separate.

## Vocabulary Part filters and TXT export (2026-10-14)

The native vocabulary surface now offers All Parts, Part 1, Part 4, and Part 1 or Part 4. Membership uses each entry's complete source Part array; a word appearing in both Parts belongs to both separate filters and appears once in the combined view. This filter intersects the existing assessment-state/hidden filters and category selection. Category counts, letter bands and visible rows all use the same filtered data.

Copy and Download TXT export all matching words in the active category across every letter band, not only the current A–G/H–N/etc. view. They are disabled during incomplete pagination, loading, return masking, or errors, so a partially loaded list cannot be represented as a complete export. Both actions produce the same header-free, one-entry-per-line text. Downloads are UTF-8 with a BOM for Chinese text compatibility; clipboard copying has a selection fallback when the Clipboard API is unavailable or denied.

The format is `English | phonetic | POS | Chinese gloss`, with absent fields omitted, retaining `apple | 苹果`. Alternative accepted English expressions use ` / `; multiple POS use ` / `; meanings use `；`. Existing noun/verb/adjective/adverb names are normalized to `n.`/`v.`/`adj.`/`adv.`. Optional POS/phonetic API fields survive vocabulary normalization. Explicit POS already present in upstream glosses (such as `adj. 抽象的；n. 摘要`) are separated into the POS field. Missing dictionary information is not invented.

The entire ES module graph is versioned together to retain one canonical bootstrap. Validation: `node --test tests/*.test.cjs` passes 124 checks, including the shipped vocabulary component's state/Part/category intersection, all-letter-band export, source overlap, optional metadata, partial-page guards, clipboard fallback and UTF-8 TXT downloads.

## Composition audit repairs (2026-10-19)

Account and device composition responses now include `channel`, so reading papers launch the reading page rather than falling back to listening.

Device-local submissions reject missing, duplicate or unrelated Parts before recording a successful result; unanswered questions remain valid. Empty answer placeholders no longer mask a valid `correctAnswer`.

Completed device-local mixed papers update source-unit progress and accuracy, and only-undone composition excludes those units. Each source result link and history item opens only its own saved passage, without duplicating the complete attempt in history. Progress and part-code mappings survive a reload through session storage when primary storage is full.

Validation: `node --test tests/*.test.cjs` passes 135 checks against the shipped renderer and mocked APIs. New checks cover both channels and storage fallback. Live account/browser exercise remains separate.

## Composition timeout repair (2026-10-19)

Both composition adapters now honour the caller's AbortSignal. A slow catalogue/status request previously outlived the request client's timeout, leaving the renderer waiting with its compose button disabled. Timeouts now reach the renderer, release the loading state and allow retry. Late read responses cannot create a cancelled composition; shared catalogue reads and accepted-answer submission recovery keep their existing lifecycles.

Validation: all 137 checks pass. Delayed-catalogue regressions exercise the shipped controller in both account and device modes, checking timeout recovery, no late paper creation and successful retry. The deployed reading random and manual flows were also exercised in a browser with a device-local session; both opened the reading page with passage text. This does not establish the exact cause of an individual user's report or validate their account session.


## Native composition UI only (2026-10-19)

Removed the extra “逐 Part 自选篇目” editor, its script, controller state, mount callbacks and hidden-footer conditions. Opening it from native manual mode could successfully create a paper while leaving the native panel showing an unrelated empty selection, making the action look unresponsive. Random and manual composition now use only the native panel.

The official native controller disables manual launch for an account without mixed-practice entitlement. The web bridge remains necessary: it composes the selected public units locally and grades real-account answers through ordinary practice requests. Mocked unentitled-account tests cover native reading and listening selection with the official compose endpoint refusing access; the bridged flow never calls that endpoint. No live unentitled student account was used.

All 21 JavaScript chunks received fresh URLs together, with consistent imports, preload paths, bundle alias ranges and SHA-256 contracts. The released version marker was refreshed. All 131 current checks pass, including native manual/random launch actions and single-instance lazy navigation. Retired editor-only checks were removed with the deleted feature.


## Review fallback and open-tab compatibility (2026-10-19)

The accepted-answer controller previously fell back to the domain-root `/exam-review` URL when router navigation failed. It now prefers the router-resolved review URL, and its last-resort browser URL retains the deployment directory and hash route. Ordinary and mixed submissions preserve their accepted result/composition identifiers and never resubmit while recovering navigation.

The two preceding deployed JavaScript graphs are retained unchanged. Removing old lazy chunks during deployment could break the review navigation of a tab opened before the update. New HTML uses only the current graph; older tabs can still load their original review page and shared application module.

All 135 checks pass, including forced navigation failures for ordinary/mixed results, router-provided URLs, and traversal of both retained module graphs.
