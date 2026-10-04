// Run: node --test tests/listening-compose.test.cjs
// This repository contains deployed bundles, not the original Vue sources.
// Exercise the shipped request clients and submit controller, plus both fetch
// interceptors, with deterministic upstream responses. No credentials required.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const mainPath = html.match(/src="\.\/(assets\/index-[^"]+\.js)(?:\?[^"]*)?"/)[1];
const main = fs.readFileSync(path.join(root, mainPath), 'utf8');
const reviewPath = main.match(/import\("\.\/(ExamReviewPage-[^"]+\.js)(?:\?[^"]*)?"\)/)[1];
const reviewSource = fs.readFileSync(path.join(root, 'assets', reviewPath), 'utf8');

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Missing deployed code: ${start}`);
  return source.slice(from, to);
}
function storage(initial = {}) {
  const rows = new Map(Object.entries(initial));
  return {
    get length() { return rows.size; },
    key: index => [...rows.keys()][index] ?? null,
    getItem: key => rows.get(key) ?? null,
    setItem: (key, value) => rows.set(key, String(value)),
    removeItem: key => rows.delete(key),
  };
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function ok(data) { return json({ code: '200', data, msg: 'OK' }); }
function harness({ initial = {}, fetch = async () => ok({}), local = false, compose = false,
  sharedStorage, sharedSessionStorage, rejectStorage = false, rejectSessionStorage = false } = {}) {
  const localStorage = sharedStorage || storage(initial);
  const sessionStorage = sharedSessionStorage || storage();
  if (rejectStorage) localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  if (rejectSessionStorage) sessionStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  const events = [];
  const window = {
    document: {}, localStorage, sessionStorage, fetch, Response, Request, Headers, AbortController,
    location: { href: 'https://example.test/xxgg-ielts-web/' },
    __APP_CONFIG__: { practiceApiBaseUrl: 'https://api.test/api' },
    __XXGG_WEB_CONFIG__: {}, dispatchEvent: event => events.push(event.type),
  };
  const ctx = vm.createContext({
    window, localStorage, URL, URLSearchParams, Response, Request, Headers, AbortController, Event,
    setTimeout, clearTimeout, console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    fetch: (...args) => window.fetch(...args),
    sr: 'https://api.test/api', eg: 'https://api.test/api/listen', jr: 'https://api.test/api',
    Y0: (_, options) => !!options.skipAuth, Q0: () => 'test-client', tg: async () => {},
    is: 'memory_link,spelling_recall',
  });
  if (local) vm.runInContext(fs.readFileSync(path.join(root, 'xxgg-local-mode.js'), 'utf8'), ctx);
  if (compose) vm.runInContext(fs.readFileSync(path.join(root, 'xxgg-server-compose.js'), 'utf8'), ctx);
  const snippets = [
    section(main, 'class U0', 'const Gt=new U0'), 'const Gt=new U0;',
    section(main, 'class Z0', 'const cs=new Z0'),
    section(main, 'class Sw', 'const tt=new Sw'),
    section(main, 'async function Cw', 'const du='),
    'const ow="MIXED_PRACTICE_ENTITLEMENT_REQUIRED",aw="HIGH_FREQUENCY_MORE_ROWS_ENTITLEMENT_REQUIRED";',
    section(main, 'function cw', 'const Ua='),
    'const Ua="提交失败，请重试或返回查看答案",fw="网络超时，请检查网络后重试",lw="当前账号暂未开通组卷做题权限，请联系老师或助教开通后再试。";',
    section(main, 'function pw', 'const Pi='),
    'globalThis.api=new Sw;globalThis.profile=new Z0;globalThis.auth=Gt;globalThis.submit=ZF;',
  ];
  vm.runInContext(snippets.join('\n'), ctx);
  return { ctx, window, localStorage, sessionStorage, events, api: ctx.api, profile: ctx.profile, auth: ctx.auth, submit: ctx.submit };
}
const session = { token: 'account-token', user: JSON.stringify({ id: 'student-1' }) };
function ordinaryExam(h, channel = 'listening') {
  const source = fs.readFileSync(path.join(root, 'assets/examDataService-BtCJRleA.js'), 'utf8');
  Object.assign(h.ctx, { tt: 'https://api.test/api', We: h.api, Ae: h.auth, DOMException, oo: data => data, lt: value => String(value) === '1' ? 'listening' : value });
  vm.runInContext(section(source, 'function Kn(t)', 'class to{')
    + '\n' + section(source, 'class to{', 'const go=new to')
    + '\nglobalThis.ordinary=new to;', h.ctx);
  h.ctx.ordinary.setRuntimeData({ channel, parts: [unitPart(1)] }, 'unit-1');
  return h.ctx.ordinary;
}
function submitState() {
  return Object.fromEntries(['isSubmitting', 'submitFailed', 'submitErrorMessage', 'isExitConfirmed'].map(key => [key, { value: false }]));
}

function draftModule(h) {
  const source = fs.readFileSync(path.join(root, 'assets/useExamTimerLifecycle-hzBFzOTc.js'), 'utf8');
  const listeners = new Map(), unmount = [];
  Object.assign(h.window, { addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener() {} });
  Object.assign(h.ctx, { document: { addEventListener() {}, removeEventListener() {} },
    E: value => ({ value }), _e: fn => unmount.push(fn), tt: h.auth });
  vm.runInContext('(()=>{\n' + section(main, 'function BD(', 'function cB(')
    + '\nconst nt=BD,Se=No;\n'
    + section(source, 'function zn(', 'const R=Object.freeze')
    + '\nglobalThis.progress=jn(unit=>Yn("ielts_listening_progress",unit),Gn);'
    + '\nglobalThis.connectDraft=(unit,getAnswers)=>zn(progress,unit,()=>({answers:getAnswers()}),()=>true);})();', h.ctx);
  return { progress: h.ctx.progress, connect: h.ctx.connectDraft, listeners, unmount };
}
const draftKey = unit => `ielts_listening_progress:${unit}:owner:student-1`;

test('quota on the writer marker no longer prevents ordinary requests; a failed request retains a reloadable session draft', async () => {
  let requests = 0, online = false;
  const h = harness({ initial: session, rejectStorage: true, fetch: async () => {
    requests++; if (!online) throw new TypeError('Failed to fetch'); return ok({ resultId: 'quota-result' });
  } });
  const exam = ordinaryExam(h), drafts = draftModule(h), draft = drafts.connect('unit-1', () => ({ 1: 'answer-1' }));
  await draft.restore(() => assert.fail('new draft does not need claiming'));
  const state = submitState(); let review = 0;
  const args = { submitFn: () => draft.submit(() => exam.submitAnswers({ 1: 'answer-1' })),
    isCurrent: draft.isCurrent, routeQuery: { unitId: 'unit-1' }, state,
    clearProgress: draft.clear, router: { push: () => review++ } };
  await h.submit(args);
  assert.equal(requests, 1, 'quota must not reject before fetch');
  assert.equal(state.submitFailed.value, true);
  assert.equal(review, 0);
  assert.deepEqual(JSON.parse(h.sessionStorage.getItem(draftKey('unit-1'))).answers, { 1: 'answer-1' });
  const reload = harness({ sharedStorage: h.localStorage, sharedSessionStorage: h.sessionStorage });
  assert.equal(draftModule(reload).progress.openSession('unit-1').loadProgress().answers[1], 'answer-1');
  online = true;
  await h.submit(args);
  assert.equal(requests, 2);
  assert.equal(review, 1);
  assert.equal(h.sessionStorage.getItem(draftKey('unit-1')), null);
  expectSession(h);
});

test('a server submit can proceed from in-memory answers even if both draft stores reject writes', async () => {
  let requests = 0;
  const h = harness({ initial: session, rejectStorage: true, rejectSessionStorage: true,
    fetch: async () => { requests++; return ok({ resultId: 'memory-result' }); } });
  const exam = ordinaryExam(h), draft = draftModule(h).connect('unit-1', () => ({ 1: 'answer-1' }));
  await draft.restore(() => false);
  const state = submitState(); let routed = false;
  await h.submit({ submitFn: () => draft.submit(() => exam.submitAnswers({ 1: 'answer-1' })),
    isCurrent: draft.isCurrent, routeQuery: { unitId: 'unit-1' }, state,
    clearProgress: draft.clear, router: { push: () => { routed = true; } } });
  assert.equal(requests, 1);
  assert.equal(routed, true);
  assert.equal(state.submitFailed.value, false);
  expectSession(h);
});

test('completed draft cleanup releases quota and removes legacy copies without touching unfinished answers or result records', () => {
  const done = draftKey('completed'), pending = draftKey('unfinished');
  const legacy = 'ielts_listening_progress:completed';
  const saved = { owner: 'student-1', answers: { 1: 'old-answer' }, lastSaved: 2 };
  const h = harness({ initial: { ...session,
    [done]: JSON.stringify({ owner: 'student-1', cleared: true, lastSaved: 3 }),
    [done + ':writer']: 'old-writer', [legacy]: JSON.stringify(saved),
    [legacy + ':legacy-backup']: JSON.stringify(saved),
    [pending]: JSON.stringify({ ...saved, answers: { 1: 'unfinished-answer' } }),
    [pending + ':writer']: 'unfinished-writer',
    'xxgg.local.v1': JSON.stringify({ attempts: { result1: { details: ['review-answer'] } } }),
    'user-settings': 'keep',
  } });
  const original = h.localStorage.setItem;
  h.localStorage.setItem = (key, value) => {
    if (h.localStorage.getItem(done)) throw new Error('QuotaExceededError');
    return original(key, value);
  };
  const drafts = draftModule(h), next = drafts.progress.openSession('next');
  assert.equal(next.saveProgress({ answers: { 1: 'next-answer' } }), true);
  assert.equal(h.localStorage.getItem(done), null);
  assert.equal(h.localStorage.getItem(done + ':writer'), null);
  assert.equal(h.localStorage.getItem(legacy), null);
  assert.equal(h.localStorage.getItem(legacy + ':legacy-backup'), null);
  assert.equal(JSON.parse(h.localStorage.getItem(pending)).answers[1], 'unfinished-answer');
  assert.equal(h.localStorage.getItem(pending + ':writer'), 'unfinished-writer');
  assert.equal(JSON.parse(h.localStorage.getItem('xxgg.local.v1')).attempts.result1.details[0], 'review-answer');
  assert.equal(h.localStorage.getItem('user-settings'), 'keep');
});

test('cleanup resolves completed and pending copies by save time instead of deleting newer unfinished answers', () => {
  const key = draftKey('unit-1');
  for (const pendingTime of [5, 1]) {
    const h = harness({ initial: { ...session, [key]: JSON.stringify({ owner: 'student-1', cleared: true, lastSaved: 3 }) } });
    h.sessionStorage.setItem(key, JSON.stringify({ owner: 'student-1', answers: { 1: 'pending' }, lastSaved: pendingTime }));
    const progress = draftModule(h).progress.openSession('unit-1');
    assert.equal(progress.loadProgress()?.answers[1] || null, pendingTime === 5 ? 'pending' : null);
  }
});

test('successful completion deletes the draft and writer, while reopening cannot resurrect a migrated old answer', async () => {
  const base = 'ielts_listening_progress:unit-1';
  const h = harness({ initial: { ...session, [base]: JSON.stringify({ owner: 'student-1', answers: { 1: 'old' } }) } });
  const drafts = draftModule(h), old = drafts.progress.openSession('unit-1');
  assert.equal(old.loadProgress().answers[1], 'old');
  assert.equal(old.clearProgress(), true);
  assert.equal(h.localStorage.getItem(draftKey('unit-1')), null);
  assert.equal(h.localStorage.getItem(draftKey('unit-1') + ':writer'), null);
  assert.equal(h.localStorage.getItem(base), null);
  assert.equal(drafts.progress.openSession('unit-1').loadProgress(), null);
  assert.equal(old.saveProgress({ answers: { 1: 'resurrect' } }), false);
});

test('draft fallback still blocks competing writers and account changes, but allows renewal for the same account', async () => {
  const h = harness({ initial: session }), drafts = draftModule(h);
  const first = drafts.progress.openSession('unit-1');
  first.saveProgress({ answers: { 1: 'first' } });
  const second = drafts.progress.openSession('unit-1');
  assert.equal(first.isIdentityCurrent(), false);
  assert.equal(first.saveProgress({ answers: { 1: 'overwrite' } }), false);
  h.localStorage.setItem('token', 'renewed-token');
  assert.equal(second.isIdentityCurrent(), true);
  h.localStorage.setItem('user', JSON.stringify({ id: 'student-2' }));
  assert.equal(second.isIdentityCurrent(), false);
  assert.equal(second.clearProgress(), false);
  assert.equal(JSON.parse(h.localStorage.getItem(draftKey('unit-1'))).answers[1], 'first');
  const quota = harness({ initial: session }), writable = quota.localStorage.setItem;
  quota.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  const quotaDrafts = draftModule(quota), draft = quotaDrafts.connect('unit-1', () => ({ 1: 'pending' }));
  await draft.restore(() => false); draft.save();
  assert.equal(draft.isCurrent(), true);
  // A newer tab can acquire the shared writer after storage becomes writable.
  quota.localStorage.setItem = writable;
  const tabB = harness({ sharedStorage: quota.localStorage });
  draftModule(tabB).progress.openSession('unit-1');
  assert.equal(draft.isCurrent(), false);
  assert.equal(draft.save(), false);
  assert.equal(JSON.parse(quota.sessionStorage.getItem(draftKey('unit-1'))).answers[1], 'pending');
});

test('a full primary draft falls back to a newer session copy and survives a reload', () => {
  const key = draftKey('unit-1');
  const h = harness({ initial: { ...session, [key]: JSON.stringify({ owner: 'student-1', answers: { 1: 'older' }, lastSaved: Date.now() + 1000 }) } });
  const setItem = h.localStorage.setItem;
  h.localStorage.setItem = (name, value) => {
    if (name === key) throw new Error('QuotaExceededError');
    return setItem(name, value);
  };
  const draft = draftModule(h).progress.openSession('unit-1');
  assert.equal(draft.saveProgress({ answers: { 1: 'newer' } }), true);
  assert.equal(draft.loadProgress().answers[1], 'newer');
  const reload = harness({ sharedStorage: h.localStorage, sharedSessionStorage: h.sessionStorage });
  assert.equal(draftModule(reload).progress.openSession('unit-1').loadProgress().answers[1], 'newer');
});

test('unowned and other-account legacy drafts survive cleanup and require explicit ownership before restoration', () => {
  const base = 'ielts_listening_progress:unit-1';
  const original = JSON.stringify({ answers: { 1: 'legacy-answer' } });
  const h = harness({ initial: { ...session, [base]: original } }), drafts = draftModule(h);
  const draft = drafts.progress.openSession('unit-1');
  assert.equal(draft.loadProgress(), null);
  assert.equal(h.localStorage.getItem(base), original);
  assert.equal(draft.claimProgress(), true);
  assert.equal(draft.loadProgress().answers[1], 'legacy-answer');
  assert.equal(h.localStorage.getItem(base), original, 'original is the backup until completion');
  assert.equal(draft.clearProgress(), true);
  assert.equal(h.localStorage.getItem(base), null);
  h.localStorage.setItem(base, JSON.stringify({ owner: 'student-2', answers: { 1: 'someone-else' } }));
  const current = drafts.progress.openSession('unit-1');
  assert.equal(current.loadProgress(), null);
  assert.equal(current.claimProgress(), false);
  current.saveProgress({ answers: { 1: 'mine' } });
  current.clearProgress();
  assert.equal(JSON.parse(h.localStorage.getItem(base)).answers[1], 'someone-else');
});

test('completed reading and writing drafts are cleaned in both stores while pending writing survives', () => {
  const reading = 'ielts_reading_progress:unit:1:owner:student-1';
  const writing = 'ielts_writing_progress:unit:2:owner:student-1';
  const pending = 'ielts_writing_progress:unit:3:owner:student-1';
  const h = harness({ initial: { ...session, [reading]: JSON.stringify({ owner: 'student-1', cleared: true, lastSaved: 3 }),
    [pending]: JSON.stringify({ owner: 'student-1', answerText: 'My essay', lastSaved: 3 }) } });
  h.sessionStorage.setItem(writing, JSON.stringify({ owner: 'student-1', cleared: true, lastSaved: 3 }));
  draftModule(h);
  assert.equal(h.localStorage.getItem(reading), null);
  assert.equal(h.sessionStorage.getItem(writing), null);
  assert.equal(JSON.parse(h.localStorage.getItem(pending)).answerText, 'My essay');
});

test('pre-request account or tab conflicts explain the cause and keep the answer draft', async () => {
  let requests = 0;
  const h = harness({ initial: session, fetch: async () => { requests++; return ok({ resultId: 'unexpected' }); } });
  const exam = ordinaryExam(h), drafts = draftModule(h), draft = drafts.connect('unit-1', () => ({ 1: 'keep' }));
  await draft.restore(() => false); draft.save();
  drafts.progress.openSession('unit-1');
  const state = submitState();
  await h.submit({ submitFn: () => draft.submit(() => exam.submitAnswers({})), state,
    routeQuery: { unitId: 'unit-1' }, clearProgress: () => assert.fail('must keep draft'),
    router: { push: () => assert.fail('must stay on exam') } });
  assert.equal(requests, 0);
  assert.match(state.submitErrorMessage.value, /作答会话已变化/);
  assert.equal(JSON.parse(h.localStorage.getItem(draftKey('unit-1'))).answers[1], 'keep');
  expectSession(h);
});

test('shipped ordinary listening and reading submit without unsupported cache headers and enter review', async () => {
  for (const channel of ['listening', 'reading']) {
    for (const resultKey of ['resultId', 'attemptId']) {
      const requests = [];
      const h = harness({ initial: session, fetch: async (url, init) => {
        requests.push({ url, init });
        if (Object.keys(init.headers).some(key => /^(cache-control|pragma)$/i.test(key))) throw new TypeError('CORS preflight rejected');
        return ok({ [resultKey]: 'ordinary-result' });
      } });
      const exam = ordinaryExam(h, channel), state = submitState();
      let route, cleared = 0;
      await h.submit({ submitFn: () => exam.submitAnswers({ 1: 'answer-1' }, { elapsedSeconds: 42 }),
        routeQuery: { unitId: 'unit-1', channel }, state, clearProgress: () => cleared++,
        router: { push: target => { route = target; } } });
      assert.equal(state.submitFailed.value, false);
      assert.equal(route.name, 'ExamReview');
      assert.equal(route.query.resultId, 'ordinary-result');
      assert.equal(route.query.compositionId, undefined);
      assert.equal(cleared, 1);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].init.mode, 'cors');
      assert.equal(requests[0].init.credentials, 'omit');
      const body = JSON.parse(requests[0].init.body);
      assert.equal(body.unitId, 'unit-1');
      assert.equal(body.channel, channel);
      assert.equal(body.timer.elapsedSeconds, 42);
      assert.equal(body.parts[0].groups[0].questions[0].userAnswer, 'answer-1');
      expectSession(h);
    }
  }
});

test('ordinary submission handles permission errors and an old-token expiry without clearing the current session', async () => {
  for (const response of [() => json({ code: '10403', msg: 'FORBIDDEN' }), () => json({ code: '403', msg: 'FORBIDDEN' }, 403)]) {
    const h = harness({ initial: session, fetch: async () => response() }), exam = ordinaryExam(h), state = submitState();
    let cleared = false;
    await h.submit({ submitFn: () => exam.submitAnswers({}), routeQuery: { unitId: 'unit-1' }, state,
      clearProgress: () => { cleared = true; }, router: { push() { assert.fail('permission error must retain the exam'); } } });
    assert.equal(cleared, false);
    assert.match(state.submitErrorMessage.value, /无权/);
    expectSession(h);
  }
  let reply;
  const h = harness({ initial: session, fetch: () => new Promise(resolve => { reply = resolve; }) });
  const pending = ordinaryExam(h).submitAnswers({});
  h.localStorage.setItem('token', 'new-account-token');
  reply(json({ code: '401', msg: 'AUTH_REQUIRED' }, 401));
  await assert.rejects(() => pending);
  assert.equal(h.localStorage.getItem('token'), 'new-account-token');
  assert.deepEqual(h.events, []);
});

test('ordinary network failure and missing result identifiers retain the draft, and retry succeeds', async () => {
  for (const failure of ['network', 'missing-id']) {
    let ready = false;
    const h = harness({ initial: session, fetch: async () => {
      if (ready) return ok({ resultId: 'retry-result' });
      if (failure === 'network') throw new TypeError('Failed to fetch');
      return ok({ status: 'submitted' });
    } }), exam = ordinaryExam(h), state = submitState();
    let cleared = 0, navigated = 0;
    const args = { submitFn: () => exam.submitAnswers({ 1: 'answer-1' }), routeQuery: { unitId: 'unit-1' }, state,
      clearProgress: () => cleared++, router: { push: () => navigated++ } };
    await h.submit(args);
    assert.equal(cleared, 0);
    assert.equal(navigated, 0);
    assert.match(state.submitErrorMessage.value, failure === 'network' ? /网络连接失败/ : /缺少记录编号/);
    ready = true;
    await h.submit(args);
    assert.equal(cleared, 1);
    assert.equal(navigated, 1);
    expectSession(h);
  }
});

test('ordinary validation refusals never expire the session or claim a successful submit', async () => {
  for (const message of ['INVALID_TIMER_MODE', 'Practice question number mismatch: question-1', 'Question rightAnswer is empty: question-1']) {
    const h = harness({ initial: session, fetch: async () => json({ code: '401', msg: message }) });
    await assert.rejects(() => ordinaryExam(h).submitAnswers({}), error => error.businessCode === message && !error.authExpired);
    expectSession(h);
  }
  const h = harness({ initial: session, fetch: async () => json({ code: '401', msg: 'PRACTICE_AUTH_REQUIRED' }) });
  await assert.rejects(() => ordinaryExam(h).submitAnswers({}), error => error.authExpired);
  assert.equal(h.localStorage.getItem('token'), null);
});

test('ordinary local submission persists graded answers in the session backup or reports storage full', async () => {
  for (const rejectSessionStorage of [false, true]) {
    const h = harness({ local: true, rejectStorage: true, rejectSessionStorage,
      fetch: async () => ok({ parts: [unitPart(1, true)] }) });
    const exam = ordinaryExam(h);
    if (rejectSessionStorage) {
      await assert.rejects(() => exam.submitAnswers({ 1: 'answer-1' }), error => error.status === 507);
    } else {
      const result = await exam.submitAnswers({ 1: 'answer-1' });
      const reloaded = harness({ local: true, sharedStorage: h.localStorage, sharedSessionStorage: h.sessionStorage });
      const review = await reloaded.api.getAttemptReview(result.data.resultId);
      assert.equal(review.details[0].userAnswer, 'answer-1');
      assert.equal(review.attempt.score, 1);
    }
  }
});
function expectSession(h) {
  assert.equal(h.localStorage.getItem('token'), session.token);
  assert.equal(h.localStorage.getItem('user'), session.user);
  assert.deepEqual(h.events, []);
}

for (const response of [
  () => json({ code: '401', msg: 'PRACTICE_AUTH_REQUIRED' }, 401),
  () => json({ code: '401', msg: 'PRACTICE_AUTH_REQUIRED' }),
  () => json({ code: '403', msg: 'FORBIDDEN' }, 403),
  () => json({ code: '10403', msg: 'FORBIDDEN' }),
]) {
  test(`optional review reads reject without signing out (${response().status}/${response().status === 200 ? 'business' : 'http'})`, async () => {
    for (const method of [
      h => h.api.getSentenceTranslations('part-1'),
      h => h.api.getQuestionAnalysis('question-1', 'part-1', 'group-1'),
      h => h.api.queryHighlights('unit-1'),
    ]) {
      const h = harness({ initial: session, fetch: async () => response() });
      await assert.rejects(() => method(h));
      expectSession(h);
    }
  });
}

test('profile bootstrap on the actual review page defers a missing profile response', async () => {
  const h = harness({ initial: session, fetch: async () => json({ code: '401', msg: 'AUTH_REQUIRED' }, 401) });
  Object.assign(h.ctx, {
    tr: () => true, nr: () => '', Hu: () => true,
    Da: s => s.getItem('token'), ar: u => u?.id || '',
  });
  vm.runInContext(section(reviewSource, 'function Gu', 'function Vu') + '\nglobalThis.bootstrap=Gu({storage:localStorage,api:profile});', h.ctx);
  assert.equal(await h.ctx.bootstrap.ensure(), '');
  expectSession(h);
});

test('ordinary forbidden attempts report permission errors without logging out', async () => {
  for (const response of [
    () => json({ code: '403', msg: 'FORBIDDEN' }, 403),
    () => json({ code: '10403', msg: 'FORBIDDEN' }),
  ]) {
    const h = harness({ initial: session, fetch: async () => response() });
    await assert.rejects(() => h.api.submitAttempt({ unitId: 'unit-1' }));
    expectSession(h);
  }
});

test('a required API still expires a genuinely invalid session', async () => {
  for (const response of [
    () => json({ code: '401', msg: 'AUTH_REQUIRED' }, 401),
    () => json({ code: '10401', msg: 'AUTH_REQUIRED' }),
  ]) {
    const h = harness({ initial: session, fetch: async () => response() });
    await assert.rejects(() => h.api.submitAttempt({ unitId: 'unit-1' }));
    assert.equal(h.localStorage.getItem('token'), null);
    assert.equal(h.localStorage.getItem('user'), null);
    assert.deepEqual(h.events, ['xxgg-auth-expired']);
  }
});

test('a late 401 for an older token cannot sign out the new session', async () => {
  for (const client of ['api', 'profile']) {
    for (const status of [200, 401]) {
      let reply;
      const h = harness({ initial: session, fetch: () => new Promise(resolve => { reply = resolve; }) });
      const request = h[client].request('/required');
      h.localStorage.setItem('token', 'new-account-token');
      h.localStorage.setItem('user', '{"id":"new-user"}');
      reply(json({ code: '401', msg: 'AUTH_REQUIRED' }, status));
      await assert.rejects(() => request);
      assert.equal(h.localStorage.getItem('token'), 'new-account-token');
      assert.equal(h.localStorage.getItem('user'), '{"id":"new-user"}');
      assert.deepEqual(h.events, []);
    }
  }
});

test('logging in after local mode loads sends real account attempts to the server', async () => {
  const requests = [];
  const h = harness({ local: true, compose: true, fetch: async (url, init) => {
    requests.push({ url, token: init.headers.token });
    return ok({ resultId: 'real-result', status: 'submitted' });
  } });
  h.localStorage.setItem('token', session.token);
  h.localStorage.setItem('user', session.user);
  const result = await h.api.submitAttempt({ unitId: 'unit-1', channel: 'listening', parts: [] });
  assert.equal(result.resultId, 'real-result');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].token, session.token);
  expectSession(h);
});

const compositionId = 'compose-listening-1';
const slots = Array.from({ length: 4 }, (_, i) => ({ slot: `P${i + 1}`, unitId: `unit-${i + 1}`, partId: `part-${i + 1}`, partNo: `Part ${i + 1}` }));
function initialComposition() {
  return {
    ...session,
    'xxgg.servercompose.v1': JSON.stringify({ version: 1, seq: 1, compositions: {
      [compositionId]: { id: compositionId, channel: 'listening', createdAt: '2026-10-01T13:00:00Z', slots },
    }, doneUnits: {} }),
  };
}
function unitPart(i, graded = false) {
  const qNumber = String(i);
  const rightAnswer = `answer-${i}`;
  return { id: `part-${i}`, partNum: `Part ${i}`, groups: [{ id: `group-${i}`, type: 'fill-in-blank', questions: [{
    id: `question-${i}`, questionId: `question-${i}`, qNumber,
    rightAnswer: graded ? rightAnswer : null, state: null, userAnswer: null,
  }] }] };
}

function reviewState(review) {
  const ctx = vm.createContext({ Tn: q => q.questionId ? q : null });
  vm.runInContext(section(reviewSource, 'function At(e)', 'function Tu(e,a')
    + '\nglobalThis.state=Pa();globalThis.merge=Eu;', ctx);
  ctx.merge(ctx.state, { resultParts: review.parts, resultDetails: review.details });
  return ctx.state;
}

function savedReviewInitial(withAnswers = true) {
  const initial = initialComposition();
  const store = JSON.parse(initial['xxgg.servercompose.v1']);
  const comp = store.compositions[compositionId];
  comp.partUnits = Object.fromEntries(slots.map((s, i) => [s.partId, `unit-${i + 1}`]));
  comp.attempt = {
    unitResults: slots.map((s, i) => ({ unitId: `unit-${i + 1}`, resultId: `result-${i + 1}` })),
    elapsedSeconds: 120,
    details: slots.map((s, i) => ({ partId: s.partId, groupId: `group-${i + 1}`, questionId: `question-${i + 1}`,
      qNumber: String(i + 1), userAnswer: `answer-${i + 1}`, rightAnswer: withAnswers ? `answer-${i + 1}` : '',
      state: withAnswers ? true : null, isCorrect: withAnswers ? true : null })),
  };
  initial['xxgg.servercompose.v1'] = JSON.stringify(store);
  return initial;
}

test('saved answers stay visible when source exams are unavailable, and retry restores the full paper', async () => {
  let available = false;
  const h = harness({ initial: savedReviewInitial(), compose: true, fetch: async (url, init) => {
    assert.notEqual(init.method, 'POST');
    const match = new URL(url).pathname.match(/\/units\/unit-(\d+)\/exam$/);
    assert.ok(match);
    return available ? ok({ parts: [unitPart(Number(match[1]))] }) : json({ code: '503' }, 503);
  } });
  const cached = await h.api.getMixedPracticeReview(compositionId);
  assert.equal(cached.paperStatus, 'cached');
  assert.equal(cached.parts.length, 4);
  assert.equal(cached.score, 4);
  assert.equal(cached.elapsedSeconds, 120);
  assert.equal(reviewState(cached).byPart['part-1'].answers['1'], 'answer-1');
  assert.equal(reviewState(cached).byPart['part-1'].answerResults['1'].rightAnswer, 'answer-1');
  const service = fs.readFileSync(path.join(root, 'assets/examDataService-BtCJRleA.js'), 'utf8');
  const runtime = vm.createContext({ tt: 'https://api.test/api', oo: value => value, console: { log() {} } });
  vm.runInContext(section(service, 'class to{', 'const go=new to') + '\nglobalThis.exam=new to;', runtime);
  runtime.exam.setRuntimeData(cached, compositionId);
  assert.equal(runtime.exam.getPartsInfo().length, 4);
  assert.equal(runtime.exam.getQuestionMappingByPart()['part-1']['1'].questionId, 'question-1');
  available = true;
  const full = await h.api.getMixedPracticeReview(compositionId);
  assert.equal(full.paperStatus, 'ready');
  assert.equal(full.parts[0].reviewFallback, undefined);
  expectSession(h);
});

test('existing result answers can recover even when the original source paper is unavailable', async () => {
  const h = harness({ initial: savedReviewInitial(false), compose: true, fetch: async (url, init) => {
    assert.notEqual(init.method, 'POST');
    const pathname = new URL(url).pathname;
    if (pathname.includes('/units/')) return json({ code: '503' }, 503);
    const match = pathname.match(/\/results\/result-(\d+)\/review$/);
    assert.ok(match);
    return ok({ parts: [unitPart(Number(match[1]), true)] });
  } });
  const review = await h.api.getMixedPracticeReview(compositionId);
  assert.equal(review.answerStatus, 'ready');
  assert.equal(review.score, 4);
  assert.equal(reviewState(review).byPart['part-4'].answerResults['4'].rightAnswer, 'answer-4');
  expectSession(h);
});

test('failed source and result reads retain saved answers as ungraded instead of rejecting the whole review', async () => {
  const h = harness({ initial: savedReviewInitial(false), compose: true, fetch: async (url, init) => {
    assert.notEqual(init.method, 'POST');
    return json({ code: '401', msg: 'UNAVAILABLE' }, 401);
  } });
  const review = await h.api.getMixedPracticeReview(compositionId);
  assert.equal(review.answerStatus, 'pending');
  assert.equal(review.missingAnswers, 4);
  assert.equal(review.details[0].userAnswer, 'answer-1');
  assert.equal(review.details[0].state, null);
  expectSession(h);
});

test('a fallback for an old saved review preserves its existing multiple-choice mark', async () => {
  const initial = savedReviewInitial();
  const store = JSON.parse(initial['xxgg.servercompose.v1']);
  Object.assign(store.compositions[compositionId].attempt.details[0], { userAnswer: 'CA', rightAnswer: 'A,C', state: true, isCorrect: true });
  initial['xxgg.servercompose.v1'] = JSON.stringify(store);
  const h = harness({ initial, compose: true, fetch: async () => json({ code: '503' }, 503) });
  const review = await h.api.getMixedPracticeReview(compositionId);
  assert.equal(reviewState(review).byPart['part-1'].answerResults['1'].isCorrect, true);
});

test('flat server review rows use their source result unit and reach the actual answer state', async () => {
  const h = harness({ initial: initialComposition(), compose: true, fetch: async (url, init) => {
    const pathname = new URL(url).pathname;
    let match;
    if ((match = pathname.match(/\/units\/unit-(\d+)\/exam$/))) return ok({ parts: [unitPart(Number(match[1]))] });
    if (pathname.endsWith('/practice/v1/attempts')) return ok({ resultId: `result-${JSON.parse(init.body).unitId.split('-')[1]}` });
    if ((match = pathname.match(/\/results\/result-(\d+)\/review$/))) {
      const i = Number(match[1]);
      return ok({ result: { unitId: `unit-${i}` }, details: [{ qNumber: String(i), rightAnswer: `answer-${i}` }] });
    }
    throw new Error(pathname);
  } });
  await h.api.submitMixedPracticeAttempt(compositionId, { parts: slots.map((s, i) => ({
    id: s.partId, groups: [{ id: `group-${i + 1}`, questions: [{ qNumber: String(i + 1), userAnswer: `answer-${i + 1}` }] }],
  })) });
  const review = await h.api.getMixedPracticeReview(compositionId);
  assert.equal(review.score, 4);
  const state = reviewState(review);
  assert.equal(state.byPart['part-1'].answerResults['1'].rightAnswer, 'answer-1');
  expectSession(h);
});

test('reopening a saved blank review retrieves answers without resubmitting the paper', async () => {
  const initial = initialComposition();
  const store = JSON.parse(initial['xxgg.servercompose.v1']);
  store.compositions[compositionId].attempt = {
    resultId: 'result-1', unitResultIds: ['result-1', 'result-2', 'result-3', 'result-4'],
    elapsedSeconds: 120,
    details: slots.map((s, i) => ({ partId: s.partId, groupId: `group-${i + 1}`, questionId: `question-${i + 1}`,
      qNumber: String(i + 1), userAnswer: `answer-${i + 1}`, rightAnswer: '', state: false })),
  };
  initial['xxgg.servercompose.v1'] = JSON.stringify(store);
  let reviewReads = 0;
  const h = harness({ initial, compose: true, fetch: async (url, init) => {
    assert.notEqual(init.method, 'POST');
    const pathname = new URL(url).pathname;
    let match;
    if ((match = pathname.match(/\/units\/unit-(\d+)\/exam$/))) return ok({ parts: [unitPart(Number(match[1]))] });
    if ((match = pathname.match(/\/results\/result-(\d+)\/review$/))) {
      reviewReads++;
      return ok({ result: { unitId: `unit-${match[1]}` }, parts: [unitPart(Number(match[1]), true)] });
    }
    throw new Error(pathname);
  } });
  const review = await h.api.getMixedPracticeReview(compositionId);
  assert.equal(reviewReads, 4);
  assert.equal(review.score, 4);
  const state = reviewState(review);
  assert.equal(state.byPart['part-1'].answers['1'], 'answer-1');
  assert.equal(state.byPart['part-1'].answerResults['1'].rightAnswer, 'answer-1');
  assert.equal(state.byPart['part-1'].answerResults['1'].isCorrect, true);
  assert.equal(JSON.parse(h.localStorage.getItem('xxgg.servercompose.v1')).compositions[compositionId].attempt.details[0].rightAnswer, 'answer-1');
  expectSession(h);
});

test('exam placeholders cannot erase saved answer rows or their correctness', () => {
  const part = unitPart(1);
  part.groups[0].questions[0].rightAnswer = '';
  part.groups[0].questions[0].state = false;
  part.groups[0].questions[0].userAnswer = '';
  const state = reviewState({ parts: [part], details: [{ partId: 'part-1', qNumber: '1', userAnswer: 'answer-1', rightAnswer: 'answer-1', state: true }] });
  assert.equal(state.byPart['part-1'].answerResults['1'].rightAnswer, 'answer-1');
  assert.equal(state.byPart['part-1'].answerResults['1'].isCorrect, true);
  assert.equal(state.byPart['part-1'].answers['1'], 'answer-1');
});

test('a failed analysis request leaves the saved answer and embedded explanation visible', async () => {
  const h = harness({ initial: session, fetch: async () => json({ code: '401', msg: 'ANALYSIS_UNAVAILABLE' }, 401) });
  const part = unitPart(1);
  part.groups[0].questions[0].analyses = [{ content: 'Existing explanation', labelsOne: '解析' }];
  const ref = value => ({ value });
  Object.assign(h.ctx, {
    d: ref('part-1'), Ou: (p, q) => `${p}::${q}`, $: { begin: () => ({}), isCurrent: () => true },
    L: ref('mixed:saved'), Te: ref({}), I: ref({ 1: { questionId: 'question-1', partId: 'part-1', groupId: 'group-1' } }),
    ze: { parts: [part] }, H: ref({ 1: { rightAnswer: 'answer-1', isCorrect: true } }),
    ie: ref(null), he: ref(false), Ve: h.api, Ne: () => {}, k: ref(null), D: () => {}, ct: v => v,
  });
  vm.runInContext(section(reviewSource, 'function xxggReviewExplanation', 'const Fo=')
    + section(reviewSource, 'async function vn(', 'function kr(t)') + '\nglobalThis.select=vn;', h.ctx);
  await h.ctx.select(1);
  assert.equal(h.ctx.ie.value.analysisList[0].content, 'Existing explanation');
  assert.equal(h.ctx.H.value[1].rightAnswer, 'answer-1');
  assert.equal(h.ctx.he.value, false);
  expectSession(h);
});

test('unavailable server answers remain ungraded and can be retried without another submit', async () => {
  let available = false;
  let posts = 0;
  const h = harness({ initial: initialComposition(), compose: true, fetch: async (url, init) => {
    const pathname = new URL(url).pathname;
    let match;
    if ((match = pathname.match(/\/units\/unit-(\d+)\/exam$/))) return ok({ parts: [unitPart(Number(match[1]))] });
    if (pathname.endsWith('/practice/v1/attempts')) {
      posts++;
      return ok({ resultId: `result-${JSON.parse(init.body).unitId.split('-')[1]}` });
    }
    if ((match = pathname.match(/\/results\/result-(\d+)\/review$/))) {
      if (!available) return json({ code: '401', msg: 'REVIEW_UNAVAILABLE' }, 401);
      return ok({ result: { unitId: `unit-${match[1]}`, parts: [unitPart(Number(match[1]), true)] } });
    }
    throw new Error(pathname);
  } });
  await h.api.submitMixedPracticeAttempt(compositionId, { parts: slots.map((s, i) => ({
    id: s.partId, groups: [{ id: `group-${i + 1}`, questions: [{ qNumber: String(i + 1), userAnswer: `answer-${i + 1}` }] }],
  })) });
  const pending = await h.api.getMixedPracticeReview(compositionId);
  assert.equal(pending.answerStatus, 'pending');
  assert.equal(pending.missingAnswers, 4);
  assert.equal(pending.details[0].state, null);
  assert.equal(pending.details[0].graded, false);
  assert.equal(pending.details[0].userAnswer, 'answer-1');
  available = true;
  const recovered = await h.api.getMixedPracticeReview(compositionId);
  assert.equal(recovered.answerStatus, 'ready');
  assert.equal(recovered.score, 4);
  assert.equal(posts, 4);
  assert.equal(reviewState(recovered).byPart['part-1'].answerResults['1'].isCorrect, true);
  expectSession(h);
});

test('a missing composition reports an error instead of an empty successful answer page', async () => {
  const h = harness({ initial: session, compose: true });
  await assert.rejects(() => h.api.getMixedPracticeReview('missing-composition'), error => {
    assert.equal(error.status, 404);
    return true;
  });
  expectSession(h);
});

test('four-part listening submit reaches the mixed review with server answers and survives reload', async () => {
  const calls = [];
  const upstream = async (url, init = {}) => {
    const pathname = new URL(url).pathname;
    calls.push({ pathname, token: init.headers?.token, body: init.body && JSON.parse(init.body) });
    let match;
    if ((match = pathname.match(/\/units\/unit-(\d+)\/exam$/))) return ok({ channel: 'listening', parts: [unitPart(Number(match[1]))] });
    if (pathname.endsWith('/practice/v1/attempts')) return ok({ resultId: `result-${JSON.parse(init.body).unitId.split('-')[1]}` });
    if ((match = pathname.match(/\/results\/result-(\d+)\/review$/))) return ok({ parts: [unitPart(Number(match[1]), true)] });
    if (pathname.endsWith('/sentence-translations')) return json({ code: '401', msg: 'TRANSLATIONS_UNAVAILABLE' }, 401);
    throw new Error(`Unexpected upstream request: ${pathname}`);
  };
  const h = harness({ initial: initialComposition(), compose: true, fetch: upstream });
  let route;
  let cleared = false;
  const parts = slots.map((slot, i) => ({ id: slot.partId, groups: [{ id: `group-${i + 1}`, questions: [{ id: `question-${i + 1}`, qNumber: String(i + 1), userAnswer: `answer-${i + 1}` }] }] }));
  const state = Object.fromEntries(['isSubmitting', 'submitFailed', 'submitErrorMessage', 'isExitConfirmed'].map(key => [key, { value: false }]));
  await h.submit({
    submitFn: async () => ({ success: true, data: await h.api.submitMixedPracticeAttempt(compositionId, { channel: 'listening', parts, elapsedSeconds: 120 }) }),
    router: { push: async value => { route = value; } },
    routeQuery: { sessionType: 'mixed', compositionId, channel: 'listening' }, state,
    clearProgress: () => { cleared = true; },
  });
  assert.equal(state.submitFailed.value, false);
  assert.equal(cleared, true);
  assert.equal(route.name, 'ExamReview');
  assert.equal(route.query.compositionId, compositionId);
  assert.equal(route.query.sessionType, 'mixed');
  const review = await h.api.getMixedPracticeReview(compositionId);
  assert.equal(review.children.length, 4);
  assert.equal(review.parts.length, 4);
  assert.equal(review.details.length, 4);
  assert.equal(review.score, 4);
  assert.deepEqual(Array.from(review.details, d => d.rightAnswer), ['answer-1', 'answer-2', 'answer-3', 'answer-4']);
  assert.equal(calls.filter(c => c.pathname.endsWith('/practice/v1/attempts')).length, 4);
  assert.ok(calls.every(c => c.token === session.token));
  await assert.rejects(() => h.api.getSentenceTranslations('part-1'));
  expectSession(h);
  const persisted = h.localStorage.getItem('xxgg.servercompose.v1');
  assert.ok(!JSON.parse(persisted).compositions[compositionId].attempt.parts);
  const reloaded = harness({ initial: { ...session, 'xxgg.servercompose.v1': persisted }, compose: true, fetch: upstream });
  const savedReview = await reloaded.api.getMixedPracticeReview(compositionId);
  assert.equal(savedReview.parts.length, 4);
  assert.equal(savedReview.score, 4);
  assert.deepEqual(Array.from(savedReview.details, d => d.userAnswer), ['answer-1', 'answer-2', 'answer-3', 'answer-4']);
  expectSession(reloaded);
});

test('an unhandled mixed GET permission refusal cannot become a global 401', async () => {
  const h = harness({ initial: session, compose: true, fetch: async () => json({ code: '403', msg: 'FORBIDDEN' }, 403) });
  await assert.rejects(() => h.api.request('/practice/v1/mixed-practice/extra-review-data'), error => {
    assert.equal(error.businessCode, 'MIXED_PRACTICE_ENTITLEMENT_REQUIRED');
    return true;
  });
  expectSession(h);
});

test('refused unit submissions keep answers as a draft and do not claim success', async () => {
  const h = harness({ initial: initialComposition(), compose: true, fetch: async url => {
    const match = new URL(url).pathname.match(/\/units\/unit-(\d+)\/exam$/);
    if (match) return ok({ parts: [unitPart(Number(match[1]))] });
    return json({ code: '10403', msg: 'FORBIDDEN' });
  } });
  let navigated = false;
  let cleared = false;
  const state = Object.fromEntries(['isSubmitting', 'submitFailed', 'submitErrorMessage', 'isExitConfirmed'].map(key => [key, { value: false }]));
  await h.submit({
    submitFn: async () => ({ success: true, data: await h.api.submitMixedPracticeAttempt(compositionId, submittedPaper()) }),
    router: { push: () => { navigated = true; } },
    routeQuery: { sessionType: 'mixed', compositionId }, state, clearProgress: () => { cleared = true; },
  });
  assert.equal(navigated, false);
  assert.equal(cleared, false);
  assert.equal(state.submitFailed.value, true);
  assert.match(state.submitErrorMessage.value, /权限/);
  expectSession(h);
});

test('token expiry keeps a submitted review visible, but still redirects other protected pages', () => {
  const h = harness({ initial: session });
  let redirected = 0;
  const route = { name: 'ExamReview' };
  h.ctx.t = { currentRoute: { value: route }, push: () => { redirected++; } };
  h.ctx.gw = name => ['ListeningExam', 'ReadingExam', 'WritingExam', 'SpellingRecall'].includes(name);
  const handler = section(main, 'const i=()=>{const d=t.currentRoute.value.name;', '},r=d=>{') + '};globalThis.expiredHandler=i;';
  vm.runInContext(handler, h.ctx);
  h.ctx.expiredHandler();
  assert.equal(redirected, 0);
  route.name = 'WritingReview';
  h.ctx.expiredHandler();
  assert.equal(redirected, 0);
  route.name = 'IntensiveListening';
  h.ctx.expiredHandler();
  assert.equal(redirected, 1);
});

test('a session renewal cannot clear or overwrite a login made while it was in flight', async () => {
  for (const success of [false, true]) {
    const h = harness({ initial: session });
    let settle;
    h.ctx.cs = { renewUserAuthSession: () => new Promise((resolve, reject) => { settle = success ? resolve : reject; }) };
    h.ctx.gs = () => !!h.localStorage.getItem('token');
    h.ctx.bl = () => h.localStorage.removeItem('token');
    h.ctx.bo = data => h.localStorage.setItem('token', data.token);
    vm.runInContext('let kl=0,ko=0;\n' + section(main, 'async function nw()', 'const iw=') + '\nglobalThis.renew=nw;', h.ctx);
    const pending = h.ctx.renew();
    h.localStorage.setItem('token', 'new-account-token');
    settle(success ? { token: 'old-renewed-token' } : Object.assign(new Error('expired'), { status: 401 }));
    assert.equal((await pending).reason, 'session-changed');
    assert.equal(h.localStorage.getItem('token'), 'new-account-token');
    assert.deepEqual(h.events, []);
  }
});

test('grading requires the complete answer and accepts every declared alternative', () => {
  for (const file of ['xxgg-server-compose.js', 'xxgg-local-mode.js']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const ctx = vm.createContext({ str: v => v == null ? '' : String(v) });
    vm.runInContext(section(source, '  function normalizeAnswer(v)', '  function qNumberOf(q)')
      + '\nglobalThis.match=answersMatch;', ctx);
    for (const [user, right, type, expected] of [
      ['stone', 'notes', 'fill-in-the-blank', false],
      ['apple', 'A', 'fill-in-the-blank', false],
      ['apple', 'A', 'single-choice', false],
      ['A', 'A,B', 'multiple-choice', false],
      ['C,A', 'A,C', 'multiple-choice', true],
      ['AAB', 'AB', 'multiple-choice', false],
      ['cat', 'cat|kitten', 'fill-in-the-blank', true],
      ['kitten', 'cat|kitten', 'fill-in-the-blank', true],
      ['TRUE', 'true', 'single-choice', true],
      ['  New  York ', 'new york', 'fill-in-the-blank', true],
      ['1.0', '1', 'fill-in-the-blank', true],
    ]) assert.equal(ctx.match(user, right, { type }), expected, `${file}: ${user} / ${right}`);
  }
});

function submittedPaper() {
  return { channel: 'listening', parts: slots.map((s, i) => ({ id: s.partId,
    groups: [{ id: `group-${i + 1}`, questions: [{ qNumber: String(i + 1), userAnswer: `answer-${i + 1}` }] }],
  })) };
}

test('partial submissions retain the draft and retry only failed units after reload', async () => {
  let failed = true;
  const posts = [];
  const upstream = async (url, init) => {
    const pathname = new URL(url).pathname;
    let m;
    if ((m = pathname.match(/\/units\/unit-(\d+)\/exam$/))) return ok({ parts: [unitPart(Number(m[1]))] });
    if (pathname.endsWith('/practice/v1/attempts')) {
      const uid = JSON.parse(init.body).unitId;
      posts.push(uid);
      if (uid === 'unit-4' && failed) return json({ code: '503', msg: 'TEMPORARILY_UNAVAILABLE' }, 503);
      return ok({ resultId: `result-${uid.split('-')[1]}` });
    }
    if ((m = pathname.match(/\/results\/result-(\d+)\/review$/))) return ok({ parts: [unitPart(Number(m[1]), true)] });
    throw new Error(pathname);
  };
  const h = harness({ initial: initialComposition(), compose: true, fetch: upstream });
  let navigated = false, cleared = false;
  const state = Object.fromEntries(['isSubmitting', 'submitFailed', 'submitErrorMessage', 'isExitConfirmed'].map(k => [k, { value: false }]));
  await h.submit({ submitFn: async () => ({ success: true, data: await h.api.submitMixedPracticeAttempt(compositionId, submittedPaper()) }),
    router: { push: () => { navigated = true; } }, routeQuery: { sessionType: 'mixed', compositionId }, state,
    clearProgress: () => { cleared = true; } });
  assert.equal(navigated, false);
  assert.equal(cleared, false);
  assert.equal(state.submitFailed.value, true);
  const saved = JSON.parse(h.localStorage.getItem('xxgg.servercompose.v1'));
  assert.equal(saved.doneUnits['unit-4'], undefined);
  failed = false;
  const reloaded = harness({ initial: { ...session, 'xxgg.servercompose.v1': JSON.stringify(saved) }, compose: true, fetch: upstream });
  await reloaded.api.submitMixedPracticeAttempt(compositionId, submittedPaper());
  assert.deepEqual(posts, ['unit-1', 'unit-2', 'unit-3', 'unit-4', 'unit-4']);
  assert.equal((await reloaded.api.getMixedPracticeReview(compositionId)).score, 4);
  expectSession(reloaded);
});

test('concurrent identical submits create just one accepted result per unit', async () => {
  let posts = 0;
  const h = harness({ initial: initialComposition(), compose: true, fetch: async (url, init) => {
    const p = new URL(url).pathname;
    let m;
    if ((m = p.match(/\/units\/unit-(\d+)\/exam$/))) return ok({ parts: [unitPart(Number(m[1]))] });
    if (p.endsWith('/practice/v1/attempts')) { posts++; return ok({ resultId: `result-${JSON.parse(init.body).unitId.split('-')[1]}` }); }
    if ((m = p.match(/\/results\/result-(\d+)\/review$/))) return ok({ parts: [unitPart(Number(m[1]), true)] });
    throw new Error(p);
  } });
  await Promise.all([h.api.submitMixedPracticeAttempt(compositionId, submittedPaper()), h.api.submitMixedPracticeAttempt(compositionId, submittedPaper())]);
  assert.equal(posts, 4);
});

test('a failed passage load never becomes a cached incomplete composition', async () => {
  let available = false;
  let failedReads = 0;
  const h = harness({ initial: initialComposition(), compose: true, fetch: async url => {
    const m = new URL(url).pathname.match(/\/units\/unit-(\d+)\/exam$/);
    assert.ok(m);
    if (m[1] === '4') { failedReads++; if (!available) return json({ code: '503' }, 503); }
    return ok({ parts: [unitPart(Number(m[1]))] });
  } });
  await assert.rejects(() => h.api.getMixedPracticeExam(compositionId), error => error.status === 503);
  await assert.rejects(() => h.api.getMixedPracticeReview(compositionId), error => error.status === 503);
  available = true;
  assert.equal((await h.api.getMixedPracticeExam(compositionId)).parts.length, 4);
  assert.equal(failedReads, 3);
  expectSession(h);
});

test('a missing composition cannot open an empty successful exam', async () => {
  const h = harness({ initial: session, compose: true });
  await assert.rejects(() => h.api.getMixedPracticeExam('missing'), error => error.status === 404);
});

test('local practice uses the actual harvested-answer cache format', async () => {
  const h = harness({ local: true, initial: { 'xxgg.answers.v1': JSON.stringify({
    version: 1, byQuestionId: { 'question-1': 'answer-1' }, byUnitQ: {},
  }) }, fetch: async () => ok({ channel: 'listening', parts: [unitPart(1)] }) });
  const response = await h.window.fetch('https://api.test/api/practice/v1/attempts', {
    method: 'POST', body: JSON.stringify({ unitId: 'unit-1', channel: 'listening', parts: submittedPaper().parts.slice(0, 1) }),
  });
  const result = (await response.json()).data;
  const reviewResponse = await h.window.fetch(`https://api.test/api/practice/v1/results/${result.resultId}/review`);
  const review = (await reviewResponse.json()).data;
  assert.equal(review.details[0].rightAnswer, 'answer-1');
  assert.equal(review.details[0].graded, true);
  assert.equal(review.details[0].isCorrect, true);
});

test('a failed catalogue request can recover without reloading the application', async () => {
  let available = false;
  const h = harness({ initial: session, compose: true, fetch: async url => {
    if (!available) return json({ code: '503' }, 503);
    if (new URL(url).pathname.endsWith('/albums')) return ok([{ id: 'album-1' }]);
    return ok([{ id: 'unit-1', channel: 'listening', partNo: 'Part 1' }]);
  } });
  assert.equal((await h.window.__xxggServerCompose.listUnits('listening')).length, 0);
  available = true;
  assert.equal((await h.window.__xxggServerCompose.listUnits('listening')).length, 1);
});

test('empty timer fields do not erase the recorded elapsed duration', () => {
  const source = fs.readFileSync(path.join(root, 'xxgg-server-compose.js'), 'utf8');
  const ctx = vm.createContext({ str: v => v == null ? '' : String(v), isPlainObject: v => !!v && typeof v === 'object', num: (v,d) => Number.isFinite(Number(v)) ? Number(v) : d });
  vm.runInContext(section(source, '  function elapsedFromTimer(', '  /* ------------------------------------------------------------------ */\n  /* 5. review') + '\nglobalThis.elapsed=elapsedFromTimer;', ctx);
  assert.equal(ctx.elapsed({ elapsedSeconds: null, elapsed: '', durationSeconds: 120 }, { elapsedSeconds: 60 }), 120);
});

test('local mode refuses unavailable papers without saving an empty successful attempt', async () => {
  const h = harness({ local: true, fetch: async () => json({ code: '503' }, 503) });
  await assert.rejects(() => h.api.submitAttempt({ unitId: 'missing-unit', parts: [] }), error => error.status === 503);
  await assert.rejects(() => h.api.getMixedPracticeExam('missing'), error => error.status === 404);
  await assert.rejects(() => h.api.getMixedPracticeReview('missing'), error => error.status === 404);
  assert.equal(Object.keys(h.window.__xxggLocalMode.store.attempts).length, 0);
});

test('local saved review stays readable when rebuilding its source paper fails', async () => {
  const parts = slots.map((s, i) => ({ ...unitPart(i + 1, true), originalUnitId: s.unitId }));
  parts[0].groups[0].questions[0].userAnswer = 'answer-1';
  const initial = { 'xxgg.local.v1': JSON.stringify({
    compositions: { [compositionId]: { slots, channel: 'listening' } },
    attempts: { saved: { compositionId, resultId: 'saved', parts, total: 4, score: 4, elapsedSeconds: 120 } },
  }) };
  const h = harness({ initial, local: true, fetch: async () => json({ code: '503' }, 503) });
  const review = await h.api.getMixedPracticeReview(compositionId);
  assert.equal(review.parts.length, 4);
  assert.equal(review.parts[0].groups[0].questions[0].userAnswer, 'answer-1');
  assert.equal(review.score, 4);
});

test('an incomplete submitted paper never sends or claims a successful attempt', async () => {
  let posts = 0;
  const h = harness({ initial: initialComposition(), compose: true, fetch: async (url, init) => {
    if (init.method === 'POST') posts++;
    const m = new URL(url).pathname.match(/\/units\/unit-(\d+)\/exam$/);
    return ok({ parts: m ? [unitPart(Number(m[1]))] : [] });
  } });
  const paper = submittedPaper(); paper.parts.pop();
  await assert.rejects(() => h.api.submitMixedPracticeAttempt(compositionId, paper), error => error.status === 422);
  assert.equal(posts, 0);
});

test('local mixed practice rebuilds previously cached incomplete papers and retries missing sources', async () => {
  const parts = slots.slice(0, 3).map((s, i) => ({ ...unitPart(i + 1), originalUnitId: s.unitId }));
  const initial = { 'xxgg.local.v1': JSON.stringify({ compositions: { [compositionId]: { slots, parts, channel: 'listening' } } }) };
  let available = false;
  const h = harness({ initial, local: true, fetch: async url => {
    const m = new URL(url).pathname.match(/\/units\/unit-(\d+)\/exam$/);
    assert.ok(m);
    if (m[1] === '4' && !available) return json({ code: '503' }, 503);
    return ok({ parts: [unitPart(Number(m[1]))] });
  } });
  await assert.rejects(() => h.api.getMixedPracticeExam(compositionId), error => error.status === 503);
  await assert.rejects(() => h.api.submitMixedPracticeAttempt(compositionId, submittedPaper()), error => error.status === 503);
  assert.equal(Object.keys(h.window.__xxggLocalMode.store.attempts).length, 0);
  available = true;
  assert.equal((await h.api.getMixedPracticeExam(compositionId)).parts.length, 4);
});

test('local grading resolves unit-number cache entries without a question-id cache hit', async () => {
  const h = harness({ local: true, initial: { 'xxgg.answers.v1': JSON.stringify({ byQuestionId: {}, byUnitQ: { 'unit-1::1': 'answer-1' } }) },
    fetch: async () => ok({ parts: [unitPart(1)] }) });
  const result = await h.api.submitAttempt({ unitId: 'unit-1', channel: 'listening', parts: submittedPaper().parts.slice(0, 1) });
  const response = await h.window.fetch(`https://api.test/api/practice/v1/results/${result.resultId}/review`);
  assert.equal((await response.json()).data.details[0].isCorrect, true);
});

test('a catalogue refresh actually bypasses the successful cached list', async () => {
  let title = 'Original';
  const h = harness({ initial: session, compose: true, fetch: async url => {
    if (new URL(url).pathname.endsWith('/albums')) return ok([{ id: 'album-1' }]);
    return ok([{ id: 'unit-1', channel: 'listening', partNo: 'Part 1', titleEn: title }]);
  } });
  assert.equal((await h.window.__xxggServerCompose.listUnits('listening'))[0].titleEn, 'Original');
  title = 'Updated';
  assert.equal((await h.window.__xxggServerCompose.listUnits('listening', true))[0].titleEn, 'Updated');
});

function successfulCompositionUpstream(posts = []) {
  return async (url, init) => {
    const p = new URL(url).pathname;
    let m;
    if ((m = p.match(/\/units\/unit-(\d+)\/exam$/))) return ok({ parts: [unitPart(Number(m[1]))] });
    if (p.endsWith('/practice/v1/attempts')) {
      const uid = JSON.parse(init.body).unitId;
      posts.push(uid);
      return ok({ resultId: `result-${uid.split('-')[1]}` });
    }
    if ((m = p.match(/\/results\/result-(\d+)\/review$/))) return ok({ parts: [unitPart(Number(m[1]), true)] });
    if (p.endsWith('/albums')) return ok([{ id: 'album-1' }]);
    if (p.endsWith('/units')) return ok(slots.map((s, i) => ({ id: s.unitId, channel: 'listening', partNo: `Part ${i + 1}` })));
    if (p.endsWith('/unit-status')) return ok([]);
    throw new Error(p);
  };
}

function editorUpstream(posts = []) {
  const catalogue = ['reading', 'listening'].flatMap(channel => Array.from({ length: channel === 'reading' ? 3 : 4 }, (_, i) =>
    ['a', 'b'].map(variant => ({ id: `${channel}-${i + 1}-${variant}`, channel, partNo: `Part ${i + 1}`,
      titleEn: `${channel} ${i + 1} ${variant}`, titleZh: `篇目 ${i + 1} ${variant}` })))).flat();
  function partFor(uid, graded) {
    const [, n, variant] = uid.split('-');
    const part = unitPart(Number(n), graded);
    part.id = `part-${uid}`;
    part.groups[0].id = `group-${uid}`;
    part.groups[0].questions[0].id = part.groups[0].questions[0].questionId = `question-${uid}`;
    if (graded) part.groups[0].questions[0].rightAnswer = `answer-${n}-${variant}`;
    return part;
  }
  return async (url, init) => {
    const p = new URL(url).pathname;
    let match;
    if (p.endsWith('/albums')) return ok([{ id: 'editor-album' }]);
    if (p.endsWith('/units')) return ok(catalogue);
    if (p.endsWith('/unit-status')) return ok([]);
    if (p.endsWith('/feature-entitlements')) return ok({ entitlements: { mixed_practice: true } });
    if ((match = p.match(/\/units\/((?:reading|listening)-\d-[ab])\/exam$/))) return ok({ parts: [partFor(match[1], false)] });
    if (p.endsWith('/practice/v1/attempts')) {
      const body = JSON.parse(init.body); posts.push(body.unitId);
      return ok({ resultId: `result-${body.unitId}` });
    }
    if ((match = p.match(/\/results\/result-((?:reading|listening)-\d-[ab])\/review$/))) return ok({ parts: [partFor(match[1], true)] });
    return ok({});
  };
}

function mixedController(h, authenticated = true) {
  Object.assign(h.ctx, {
    M: value => ({ value }), L: getter => ({ get value() { return getter(); } }), Ne() {},
    Rt: {}, vd: () => false, tt: h.api, Wi: async () => null, Mo: () => false,
    Qn: async () => null, dt: {}, St: v => v, Su: () => false, p6: () => false,
    iw: 'mixed_practice', rw: 'high_frequency_more_rows',
    Bg: async ({ forceRefresh }) => forceRefresh(), Xt: v => v, rr: v => v,
    S6: undefined,
  });
  vm.runInContext(section(main, 'function cu(', 'function cw(') + section(main, 'const Wa=Object.freeze', 'function yi()') +
    '\nglobalThis.controller=S6({isAuthenticated:{value:' + authenticated + '},router:{push:async value=>{globalThis.destination=value}}});', h.ctx);
  return h.ctx.controller;
}

// Small DOM stand-in for the plain editor; tests use the shipped event handlers.
function editorRoot() {
  const root = { classList: { add() {} }, nodes: [], html: '' };
  function parse(html) {
    return [...html.matchAll(/<(button|input|div)\b([^>]*)>/g)].map(match => {
      const attrs = Object.fromEntries([...match[2].matchAll(/([\w-]+)="([^"]*)"/g)].map(a => [a[1], a[2]]));
      const node = { attrs, handlers: {}, disabled: /\sdisabled(?:\s|$)/.test(match[2]),
        getAttribute: name => attrs[name] ?? null,
        addEventListener: (name, callback) => { node.handlers[name] = callback; },
        click() { if (!node.disabled) return node.handlers.click?.({ currentTarget: node, target: node }); },
      };
      let content = '', children = [];
      Object.defineProperty(node, 'innerHTML', { get: () => content, set(value) { content = value; children = parse(value); } });
      node.children = () => children;
      return node;
    });
  }
  Object.defineProperty(root, 'innerHTML', { get: () => root.html, set(value) { root.html = value; root.nodes = parse(value); } });
  root.querySelectorAll = selector => {
    const nodes = root.nodes.flatMap(node => [node, ...node.children()]);
    const action = selector.match(/data-ce-action="([^"]+)"/);
    return nodes.filter(node => action ? node.attrs['data-ce-action'] === action[1]
      : selector[0] === '.' && (node.attrs.class || '').split(' ').includes(selector.slice(1)));
  };
  root.querySelector = selector => root.querySelectorAll(selector)[0] || null;
  root.action = (name, value) => root.querySelectorAll(`[data-ce-action="${name}"]`)
    .find(node => value == null || node.attrs['data-unit-id'] === value || node.attrs['data-index'] === String(value));
  return root;
}
function pickerRuntime(listUnits, random = Math.random) {
  const window = { document: { getElementById: () => null, createElement: () => ({}), head: { appendChild() {} } },
    localStorage: storage(), __xxggServerCompose: { listUnits } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'xxgg-compose-picker.js'), 'utf8'), { window, Math: Object.assign(Object.create(Math), { random }) });
  return window.__xxggComposePicker;
}
const settleEditor = () => new Promise(resolve => setImmediate(resolve));

for (const channel of ['reading', 'listening']) {
  test(`${channel} random picker preserves manual slots, replaces one Part, and reshuffles a complete paper`, async () => {
    const need = channel === 'reading' ? 3 : 4;
    const units = Array.from({ length: need }, (_, i) => ['a', 'b'].map(variant => ({
      unitId: `${i + 1}-${variant}`, partRank: i + 1, titleEn: `Part ${i + 1} ${variant}`,
    }))).flat();
    let applied;
    const picker = pickerRuntime(async () => units, () => 0);
    const root = editorRoot();
    picker.mount(root, { channel, onApply: async ids => { applied = Array.from(ids); } });
    await settleEditor();
    root.action('choose', '1-b').click();
    root.action('random-all').click();
    assert.match(root.innerHTML, /随机换一组/);
    root.action('apply').click(); await settleEditor();
    assert.deepEqual(applied, ['1-b', ...Array.from({ length: need - 1 }, (_, i) => `${i + 2}-a`)]);
    root.action('random-part', 1).click();
    root.action('apply').click(); await settleEditor();
    assert.deepEqual(applied, ['1-b', '2-b', ...Array.from({ length: need - 2 }, (_, i) => `${i + 3}-a`)]);
    root.action('random-all').click();
    root.action('apply').click(); await settleEditor();
    assert.deepEqual(applied, ['1-a', '2-a', ...Array.from({ length: need - 2 }, (_, i) => `${i + 3}-b`)]);
    root.action('edit', 0).click();
    root.action('choose', '1-b').click();
    root.action('apply').click(); await settleEditor();
    assert.equal(applied[0], '1-b', 'random choices remain manually editable');
  });
}

test('random fill is atomic when a Part has no candidates and cannot modify a pending submission', async () => {
  let finish;
  const units = [1, 2, 3].map(n => ({ unitId: `p${n}`, partRank: n, titleEn: `Passage ${n}` }));
  const root = editorRoot();
  pickerRuntime(async () => units, () => 0).mount(root, { channel: 'listening' });
  await settleEditor();
  root.action('choose', 'p1').click(); root.action('random-all').click();
  assert.match(root.innerHTML, /已选 1 \/ 4/);
  assert.match(root.innerHTML, /P4 暂无可选篇目/);
  assert.equal(root.action('apply').disabled, true);
  const pending = editorRoot();
  const all = [...units, { unitId: 'p4', partRank: 4, titleEn: 'Passage 4' }];
  pickerRuntime(async () => all, () => 0).mount(pending, { channel: 'listening',
    onApply: () => new Promise(resolve => { finish = resolve; }) });
  await settleEditor(); pending.action('random-all').click(); pending.action('apply').click();
  assert.equal(pending.action('random-all').disabled, true);
  assert.ok(pending.querySelectorAll('[data-ce-action="random-part"]').every(button => button.disabled));
  finish(); await settleEditor();
  assert.equal(pending.action('random-all').disabled, false);
});

function questionReviewRuntime(fetchAnalysis = async () => null) {
  const ref = value => ({ value });
  const emitted = [], ticks = [];
  const ctx = vm.createContext({ console: { error() {} },
    d: ref('p1'), ae: ref(1), W: ref(false), P: ref(false), L: ref('result'), f: ref(false),
    Te: ref({}), I: ref({ 1: { questionId: 'q1', partId: 'p1' }, 2: { questionId: 'q2', partId: 'p1' } }),
    ze: { parts: [] }, H: ref({}), ie: ref(null), he: ref(false), k: ref(null), B: ref({}), yt: ref({}),
    Ou: (p, q) => `${p}::${q}`, Ve: { getQuestionAnalysis: fetchAnalysis },
    Ne: callback => ticks.push(callback), Nt: (kind, indexes) => emitted.push({ kind, indexes: Array.from(indexes) }),
    C: () => false, D() {}, Dn() {}, jn() {},
  });
  vm.runInContext(section(reviewSource, 'function _u()', 'const Cu=') + 'globalThis.$=_u();'
    + section(reviewSource, 'function ct(t)', 'const yt=')
    + section(reviewSource, 'function xxggReviewExplanation', 'const Fo=')
    + section(reviewSource, 'function gn(t)', 'function Vn()')
    + section(reviewSource, 'async function vn(', 'function kr(t)'), ctx);
  return { ctx, emitted, flush() { while (ticks.length) ticks.shift()(); } };
}

test('hidden-answer question and footer clicks request audio without changing answer visibility', async () => {
  const h = questionReviewRuntime();
  h.ctx.Te.value = { 'p1::1': { sentenceIndex: '3-4' }, 'p2::11': { sentenceIndex: 8 } };
  h.ctx.gn(1); h.flush();
  assert.deepEqual(h.emitted, [{ kind: 'play-question', indexes: [3, 4] }]);
  h.ctx.gn(1); h.flush();
  assert.equal(h.emitted.length, 2, 'clicking the same number restarts its audio');
  h.ctx.wr('p2', 11); h.flush();
  assert.deepEqual(h.emitted.at(-1), { kind: 'play-question', indexes: [8] });
  assert.equal(h.ctx.P.value, false);
  h.ctx.W.value = true; h.ctx.gn(11); h.flush();
  assert.equal(h.emitted.length, 3, 'reading question clicks never start audio');
});

test('only the latest question analysis may start audio and embedded timestamps do not wait for it', async () => {
  const replies = {};
  const h = questionReviewRuntime(id => new Promise(resolve => { replies[id] = resolve; }));
  h.ctx.ae.value = 1; const first = h.ctx.vn(1, true);
  h.ctx.ae.value = 2; const second = h.ctx.vn(2, true);
  replies.q2({ question: { sentenceIndex: '9-10' } }); await second; h.flush();
  replies.q1({ question: { sentenceIndex: '3' } }); await first; h.flush();
  assert.deepEqual(h.emitted, [{ kind: 'play-question', indexes: [9, 10] }]);
  const embedded = questionReviewRuntime(() => new Promise(() => {}));
  embedded.ctx.ze.parts = [{ id: 'p1', groups: [{ questions: [{ qNumber: 1, sentenceIndex: '5' }] }] }];
  embedded.ctx.vn(1, true); embedded.flush();
  assert.deepEqual(embedded.emitted, [{ kind: 'play-question', indexes: [5] }]);
});

const textPanelSource = fs.readFileSync(path.join(root, 'assets/TextPanel-CrX6bIZB.js'), 'utf8');
function questionAudioRuntime(play = () => Promise.resolve()) {
  const ref = value => ({ value });
  const audio = { currentTime: 0, paused: true, starts: 0,
    play() { this.paused = false; this.starts++; return play(); }, pause() { this.paused = true; } };
  const groups = [3, 4, 9].map((sentenceIndex, i) => ({ sentenceIndex,
    words: [{ text: 'word', start_time: 10 + i * 2, end_time: 12 + i * 2 }] }));
  const ctx = vm.createContext({
    O: ref(audio), Je: ref([{ sentenceGroups: groups }]),
    Ge: ref(groups.map((group, i) => ({ key: `0-${i}-0`, word: group.words[0] }))),
    C: ref([]), xxggQuestionKeys: ref([]), E: ref, Et: ref('none'),
    ve: ref(false), oe: ref(false), Le: ref(0), xt: ref(1), H: ref(0), T: ref(true), te: ref(false),
    o: { currentPartKey: 'p1', audioUrl: 'p1.mp3', answerRevealEnabled: false },
    Ue: word => !word.text.trim(), Ce() {}, B: callback => callback(),
    _: (get, watch) => { ctx.watch = watch; },
  });
  vm.runInContext(section(textPanelSource, 'const Ae=', 'function me(i,c)')
    + section(textPanelSource, 'function he(e,t,n)', 'const et=')
    + section(textPanelSource, 'function po(e)', 'function yo(e)')
    + 'let Tt=null,Ve=null,xxggPlaybackGeneration=0,ht=null,bt=null;'
    + section(textPanelSource, 'function nt()', 'function ko(e)')
    + 'let Sn=0;'
    + section(textPanelSource, 'function $o(e)', 'function zo(e)'), ctx);
  return { ctx, audio, request(seq, indexes, ready = true, extra = {}) {
    ctx.watch([{ seq, kind: 'play-question', partKey: 'p1', audioUrl: 'p1.mp3', sentenceIndexes: indexes, ...extra }, ready]);
  } };
}

test('hidden-answer playback seeks and stops at question timestamps without selecting or highlighting answers', () => {
  const h = questionAudioRuntime();
  h.request(1, [3, 4]);
  assert.equal(h.audio.currentTime, 10); assert.equal(h.audio.starts, 1);
  assert.equal(h.ctx.C.value.length, 0);
  assert.equal(h.ctx.o.answerRevealEnabled, false);
  h.ctx.wo(14); assert.equal(h.audio.paused, true);
  h.request(2, [3, 4]); assert.equal(h.audio.starts, 2);
  h.request(3, [9]); assert.equal(h.audio.currentTime, 14);
  h.request(4, [99]); assert.equal(h.audio.starts, 3);
  assert.equal(h.audio.paused, true, 'missing timestamps cannot continue the old question or play the whole clip');
});

test('question audio waits for readiness, ignores stale parts, and survives an older rejected play promise', async () => {
  const reject = [];
  const h = questionAudioRuntime(() => new Promise((resolve, fail) => { reject.push(fail); }));
  h.request(1, [3], false); assert.equal(h.audio.starts, 0);
  h.request(1, [3], true); assert.equal(h.audio.starts, 1);
  h.request(1, [3], true); assert.equal(h.audio.starts, 1);
  h.request(2, [9], true, { partKey: 'old' }); assert.equal(h.audio.starts, 1);
  h.request(2, [9], true, { audioUrl: 'old.mp3' }); assert.equal(h.audio.starts, 1);
  h.request(3, [9], true); assert.equal(h.audio.starts, 2);
  reject[0](new Error('interrupted by newer seek')); await settleEditor();
  assert.equal(h.ctx.ve.value, true);
  h.ctx.wo(16); assert.equal(h.audio.paused, true);
});

test('a disposed picker response cannot replace the newly selected channel', async () => {
  const replies = {};
  const picker = pickerRuntime(channel => new Promise(resolve => { replies[channel] = resolve; }));
  const reading = editorRoot(), listening = editorRoot();
  const dispose = picker.mount(reading, { channel: 'reading' });
  await settleEditor(); dispose();
  picker.mount(listening, { channel: 'listening' }); await settleEditor();
  replies.listening([{ unitId: 'l1', titleEn: 'Listening passage', partRank: 1 }]); await settleEditor();
  replies.reading([{ unitId: 'r1', titleEn: 'Stale reading passage', partRank: 1 }]); await settleEditor();
  assert.equal(reading.innerHTML, '');
  assert.match(listening.querySelector('.xxgg-ce-list').innerHTML, /Listening passage/);
  assert.doesNotMatch(listening.innerHTML, /Stale reading/);
});

for (const channel of ['reading', 'listening']) {
  const need = channel === 'reading' ? 3 : 4;
  test(`${channel} explicit selection reaches the actual paper in Part order in both modes`, async () => {
    for (const local of [false, true]) {
      const h = harness({ initial: local ? {} : session, local, compose: !local, fetch: editorUpstream() });
      const ids = Array.from({ length: need }, (_, i) => `${channel}-${i + 1}-b`);
      const composition = await h.api.composeMixedPractice({ channel, selectionMode: 'custom', selectedUnitIds: ids.slice().reverse() });
      assert.deepEqual(Array.from(composition.slots, s => s.unitId), ids);
      const exam = await h.api.getMixedPracticeExam(composition.compositionId);
      assert.deepEqual(Array.from(exam.parts, p => p.originalUnitId), ids);
    }
  });
}

test('invalid drafts never create a paper or silently top up the requested selection', async () => {
  for (const local of [false, true]) {
    const h = harness({ initial: local ? {} : session, local, compose: !local, fetch: editorUpstream() });
    for (const ids of [[], ['listening-1-a'], ['listening-1-a', 'listening-1-b', 'listening-3-a', 'listening-4-a'],
      ['listening-1-a', 'listening-2-a', 'listening-3-a', 'reading-3-a'],
      ['listening-1-a', 'listening-2-a', 'listening-3-a', 'missing']]) {
      await assert.rejects(() => h.api.composeMixedPractice({ channel: 'listening', selectionMode: 'custom', selectedUnitIds: ids }), error => error.status === 400);
    }
    const data = local ? h.window.__xxggLocalMode.store : JSON.parse(h.localStorage.getItem('xxgg.servercompose.v1') || '{}');
    assert.equal(Object.keys(data.compositions || {}).length, 0);
  }
});

test('random compose ignores an old global custom override and can reshuffle', async () => {
  const initial = { ...session, 'xxgg.compose.custom.v1': JSON.stringify({ enabled: true, channel: 'listening',
    unitIds: ['listening-1-a', 'listening-2-a', 'listening-3-a', 'listening-4-a'] }) };
  const h = harness({ initial, compose: true, fetch: editorUpstream() });
  const first = await h.api.composeMixedPractice({ channel: 'listening', selectionMode: 'random' });
  const next = await h.api.composeMixedPractice({ channel: 'listening', selectionMode: 'random', previousCompositionId: first.compositionId });
  assert.notEqual(first.compositionId, next.compositionId);
  assert.ok(next.slots.every(slot => !first.slots.some(previous => previous.unitId === slot.unitId)));
});

test('random paper edits create a new paper and submit only the updated source units', async () => {
  const posts = [];
  const h = harness({ initial: session, compose: true, fetch: editorUpstream(posts) });
  const controller = mixedController(h);
  controller.openMixModal(); controller.setMixKind('listening');
  await settleEditor();
  await controller.startMixAssemble();
  assert.equal(controller.mixPhase.value, 'result', controller.mixWarningMessage.value);
  const before = Array.from(controller.mixItems.value, item => item.unitId);
  const original = Object.keys(JSON.parse(h.localStorage.getItem('xxgg.servercompose.v1')).compositions)[0];
  let draft;
  h.window.__xxggComposePicker = { mount: (_, options) => { draft = options; return () => {}; } };
  controller.editMixSlot(1); controller.mountMixEditor({ el: {} });
  assert.deepEqual(Array.from(draft.slots, s => s.unitId), before);
  // No navigation while a draft remains open.
  await controller.startMixedExam(); assert.equal(h.ctx.destination, undefined);
  const updated = before.slice(); updated[1] = `listening-2-${before[1].endsWith('-a') ? 'b' : 'a'}`;
  assert.equal(await draft.onApply(updated), true);
  assert.deepEqual(Array.from(controller.mixItems.value, item => item.unitId), updated);
  assert.equal(controller.mixEditorSlot.value, -1);
  await controller.startMixedExam();
  const composition = h.ctx.destination.query.compositionId;
  assert.notEqual(composition, original);
  const exam = await h.api.getMixedPracticeExam(composition);
  const parts = exam.parts.map(p => ({ ...p, groups: p.groups.map(g => ({ ...g, questions: g.questions.map(q => ({ ...q,
    userAnswer: `answer-${p.originalUnitId.split('-')[1]}-${p.originalUnitId.split('-')[2]}` })) })) }));
  await h.api.submitMixedPracticeAttempt(composition, { channel: 'listening', parts });
  assert.deepEqual(posts, updated);
  assert.equal((await h.api.getMixedPracticeReview(composition)).score, 4);
  assert.deepEqual(JSON.parse(h.localStorage.getItem('xxgg.servercompose.v1')).compositions[original].slots.map(s => s.unitId), before);
});

test('cancelling or failing an edit retains the original paper', async () => {
  const h = harness({ initial: session, compose: true, fetch: editorUpstream() });
  const controller = mixedController(h);
  controller.openMixModal(); await settleEditor(); await controller.startMixAssemble();
  assert.equal(controller.mixPhase.value, 'result', controller.mixWarningMessage.value);
  const before = Array.from(controller.mixItems.value, item => item.unitId);
  let draft;
  h.window.__xxggComposePicker = { mount: (_, options) => { draft = options; return () => {}; } };
  controller.editMixSlot(0); controller.mountMixEditor({ el: {} }); draft.onCancel();
  assert.equal(controller.mixEditorSlot.value, -1);
  assert.deepEqual(Array.from(controller.mixItems.value, item => item.unitId), before);
  controller.editMixSlot(0); controller.mountMixEditor({ el: {} });
  assert.notEqual(await draft.onApply(['missing']), true);
  assert.deepEqual(Array.from(controller.mixItems.value, item => item.unitId), before);
  assert.equal(controller.mixEditorSlot.value, 0);
});

test('the inline editor selects one passage per Part, preserves search input, and applies exact IDs', async () => {
  const rows = Array.from({ length: 4 }, (_, i) => ({ unitId: `u${i + 1}`, titleEn: `Title ${i + 1}`, partRank: i + 1 }));
  let applied;
  const picker = pickerRuntime(async () => rows);
  const editor = editorRoot(); picker.mount(editor, { channel: 'listening', onApply: ids => { applied = Array.from(ids); return true; } });
  await settleEditor(); assert.equal(editor.action('apply').disabled, true);
  const search = editor.querySelector('.xxgg-ce-search');
  search.handlers.input({ target: { value: 'Title' } });
  assert.equal(editor.querySelector('.xxgg-ce-search'), search);
  for (let i = 1; i <= 4; i++) {
    const choices = editor.querySelectorAll('[data-ce-action="choose"]');
    assert.equal(choices.length, 1); assert.equal(choices[0].attrs['data-unit-id'], `u${i}`);
    editor.action('choose', `u${i}`).click();
  }
  assert.equal(editor.action('apply').disabled, false);
  await editor.action('apply').click(); assert.deepEqual(applied, ['u1','u2','u3','u4']);
});

test('editor cancellation never applies selections and failed application retains the draft', async () => {
  const picker = pickerRuntime(async () => [{ unitId: 'r1', partRank: 1 }, { unitId: 'r2', partRank: 2 }, { unitId: 'r3', partRank: 3 }]);
  let calls = 0, cancelled = false;
  const editor = editorRoot(); picker.mount(editor, { channel: 'reading', slots: [1,2,3].map(i => ({ unitId: `r${i}`, partNo: `Part ${i}` })),
    onApply: async () => { calls++; return false; }, onCancel: () => { cancelled = true; } });
  await settleEditor(); editor.action('cancel').click(); assert.equal(cancelled, true); assert.equal(calls, 0);
  await editor.action('apply').click(); assert.equal(calls, 1); assert.match(editor.innerHTML, /未能应用/);
  assert.equal(editor.action('apply').disabled, false);
});

test('the shipped modal embeds custom choices and hides stale launch actions while editing', () => {
  const vnode = (tag, props, children) => ({ tag, props: props || {}, children });
  const ctx = vm.createContext({ L: getter => ({ get value() { return getter(); } }), o: vnode, g: vnode, h() {},
    pe: 'fragment', re: v => v, Be: (rows, callback) => rows.map(callback), K: () => null,
    I: String, Ze: value => value, He: () => [], ke: value => value, ht: value => value });
  const modal = section(main, 'HN={class:"pack-modal mix-modal"', 'HO=Object.freeze').replace(/,$/, ';');
  vm.runInContext('const ' + modal + '\nglobalThis.modal=_O;', ctx);
  const props = { mixModalOpen: true, mixPhase: 'config', mixKind: 'reading', mixSelectionMode: 'custom',
    mixEditorSlot: -1, mixItems: [], mixDifficultyStops: [{ v: 'random', label: '随机' }], mixDifficultyIndex: 0,
    setMixSelectionMode() {}, editMixSlot() {}, mountMixEditor() {}, unmountMixEditor() {}, mixPermBannerVisible: false };
  const render = ctx.modal.setup(props);
  function nodes(tree) { return Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.children)] : []; }
  let rendered = nodes(render({}, []));
  assert.ok(rendered.some(n => n.props['aria-label'] === '组卷方式'));
  assert.ok(rendered.some(n => n.props.onVnodeMounted === props.mountMixEditor));
  assert.ok(!rendered.some(n => n.props.role === 'switch'));
  assert.ok(!rendered.some(n => n.props.class === 'pack-modal-ft mix-modal-ft'));
  props.mixPhase = 'result'; props.mixSelectionMode = 'random'; props.mixEditorSlot = 1;
  props.mixItems = [1,2,3].map(i => ({ part: `P${i}`, partId: `p${i}`, en: `Title ${i}` }));
  rendered = nodes(render({}, []));
  assert.ok(rendered.some(n => n.props.onVnodeMounted === props.mountMixEditor));
  assert.ok(!rendered.some(n => n.props.class === 'pack-modal-ft mix-modal-ft'));
  props.mixEditorSlot = -1;
  rendered = nodes(render({}, []));
  assert.equal(rendered.filter(n => /^替换 P\d 篇目$/.test(n.props['aria-label'] || '')).length, 3);
  assert.ok(rendered.some(n => n.props.class === 'pack-modal-ft mix-modal-ft'));
});

test('quota errors never evict the paper currently being answered (local-mix-33)', async () => {
  const initial = initialComposition();
  initial['xxgg.servercompose.v1'] = initial['xxgg.servercompose.v1'].replaceAll(compositionId, 'local-mix-33');
  const posts = [];
  const h = harness({ initial, compose: true, rejectStorage: true, fetch: successfulCompositionUpstream(posts) });
  assert.equal((await h.api.getMixedPracticeExam('local-mix-33')).parts.length, 4);
  const response = await h.api.submitMixedPracticeAttempt('local-mix-33', submittedPaper());
  assert.equal(response.status, 'submitted');
  assert.equal(posts.length, 4);
  assert.equal((await h.api.getMixedPracticeReview('local-mix-33')).score, 4);
  expectSession(h);
});

test('submit reads a composition saved by another page after this page started', async () => {
  const h = harness({ initial: session, compose: true, fetch: successfulCompositionUpstream() });
  h.localStorage.setItem('xxgg.servercompose.v1', initialComposition()['xxgg.servercompose.v1']);
  assert.equal((await h.api.submitMixedPracticeAttempt(compositionId, submittedPaper())).status, 'submitted');
});

test('logging in can submit the same paper created in local mode', async () => {
  const h = harness({ local: true, compose: true, fetch: successfulCompositionUpstream() });
  const comp = await h.api.composeMixedPractice({ channel: 'listening', onlyUndone: false });
  await h.api.getMixedPracticeExam(comp.compositionId);
  h.localStorage.setItem('token', session.token);
  h.localStorage.setItem('user', session.user);
  assert.equal((await h.api.submitMixedPracticeAttempt(comp.compositionId, submittedPaper())).status, 'submitted');
  assert.equal((await h.api.getMixedPracticeReview(comp.compositionId)).score, 4);
  expectSession(h);
});

test('the session copy restores a submitted review if primary storage cannot be written', async () => {
  const h = harness({ initial: initialComposition(), compose: true, rejectStorage: true, fetch: successfulCompositionUpstream() });
  await h.api.submitMixedPracticeAttempt(compositionId, submittedPaper());
  const reloaded = harness({ initial: session, compose: true, sharedSessionStorage: h.sessionStorage,
    fetch: async () => json({ code: '503' }, 503) });
  const review = await reloaded.api.getMixedPracticeReview(compositionId);
  assert.equal(review.parts.length, 4);
  assert.equal(review.score, 4);
  assert.equal(review.details[0].userAnswer, 'answer-1');
});

test('compose refuses success if neither browser store can retain the paper', async () => {
  for (const local of [false, true]) {
    const h = harness({ initial: local ? { token: 'local-device' } : session, local, compose: !local,
      rejectStorage: true, rejectSessionStorage: true, fetch: successfulCompositionUpstream() });
    await assert.rejects(() => h.api.composeMixedPractice({ channel: 'listening', onlyUndone: false }), error => error.status === 507);
  }
});

test('two open pages create different IDs and retain both papers on reload', async () => {
  const sharedStorage = storage(session);
  const a = harness({ sharedStorage, compose: true, fetch: successfulCompositionUpstream() });
  const b = harness({ sharedStorage, compose: true, fetch: successfulCompositionUpstream() });
  const ca = await a.api.composeMixedPractice({ channel: 'listening', onlyUndone: false });
  const cb = await b.api.composeMixedPractice({ channel: 'listening', onlyUndone: false });
  assert.notEqual(ca.compositionId, cb.compositionId);
  const reloaded = harness({ sharedStorage, compose: true, fetch: successfulCompositionUpstream() });
  assert.equal((await reloaded.api.getMixedPracticeExam(ca.compositionId)).parts.length, 4);
  assert.equal((await reloaded.api.getMixedPracticeExam(cb.compositionId)).parts.length, 4);
});

test('cache limits protect unfinished papers, including drafts older than forty newer records', async () => {
  const initial = initialComposition();
  const saved = JSON.parse(initial['xxgg.servercompose.v1']);
  for (let i = 0; i < 41; i++) saved.compositions[`new-draft-${i}`] = { ...saved.compositions[compositionId], createdAt: '2026-10-02T07:00:00Z' };
  initial['xxgg.servercompose.v1'] = JSON.stringify(saved);
  const h = harness({ initial, compose: true, fetch: successfulCompositionUpstream() });
  await h.api.getMixedPracticeExam('new-draft-0');
  assert.equal((await h.api.submitMixedPracticeAttempt(compositionId, submittedPaper())).status, 'submitted');
});

test('a newer session result wins over an older primary composition after quota failure', async () => {
  const initial = initialComposition();
  const h = harness({ initial, compose: true, rejectStorage: true, fetch: successfulCompositionUpstream() });
  await h.api.submitMixedPracticeAttempt(compositionId, submittedPaper());
  const reloaded = harness({ initial, compose: true, sharedSessionStorage: h.sessionStorage,
    fetch: async () => json({ code: '503' }, 503) });
  assert.equal((await reloaded.api.getMixedPracticeReview(compositionId)).score, 4);
});

test('local quota failure preserves saved answers through a reload in the same tab', async () => {
  const h = harness({ initial: { token: 'local-device' }, local: true, fetch: successfulCompositionUpstream() });
  const c = await h.api.composeMixedPractice({ channel: 'listening', onlyUndone: false });
  await h.api.getMixedPracticeExam(c.compositionId);
  h.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  await h.api.submitMixedPracticeAttempt(c.compositionId, submittedPaper());
  const reloaded = harness({ initial: { token: 'local-device' }, local: true,
    sharedSessionStorage: h.sessionStorage, fetch: async () => json({ code: '503' }, 503) });
  const review = await reloaded.api.getMixedPracticeReview(c.compositionId);
  assert.equal(review.parts.length, 4);
  assert.equal(review.details[0].userAnswer, 'answer-1');
});
