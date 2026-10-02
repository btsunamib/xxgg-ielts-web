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
    + section(reviewSource, 'async function vn(t)', 'function kr(t)') + '\nglobalThis.select=vn;', h.ctx);
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

test('a stale picker response cannot replace the newly selected channel', async () => {
  const source = fs.readFileSync(path.join(root, 'xxgg-compose-picker.js'), 'utf8');
  const replies = {};
  const state = { channel: 'reading', units: [], loading: false, error: '' };
  const ctx = vm.createContext({ state, T: {}, renderList() {}, renderCount() {},
    api: () => ({ listUnits: channel => new Promise(resolve => { replies[channel] = resolve; }) }),
  });
  vm.runInContext(section(source, '  function load(', '  /* ------------------------------------------------------------------ */\n  /* boot') + '\nglobalThis.load=load;', ctx);
  ctx.load();
  await Promise.resolve();
  state.channel = 'listening';
  ctx.load();
  await Promise.resolve();
  replies.listening([{ unitId: 'listening-unit' }]);
  await Promise.resolve(); await Promise.resolve();
  replies.reading([{ unitId: 'reading-unit' }]);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(state.units[0].unitId, 'listening-unit');
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
