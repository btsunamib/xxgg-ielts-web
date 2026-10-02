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
function harness({ initial = {}, fetch = async () => ok({}), local = false, compose = false } = {}) {
  const localStorage = storage(initial);
  const events = [];
  const window = {
    document: {}, localStorage, fetch, Response, Request, Headers, AbortController,
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
  return { ctx, window, localStorage, events, api: ctx.api, profile: ctx.profile, auth: ctx.auth, submit: ctx.submit };
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
    submitFn: async () => ({ success: true, data: await h.api.submitMixedPracticeAttempt(compositionId, { channel: 'listening', parts: [{ id: 'part-1', groups: [] }] }) }),
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
