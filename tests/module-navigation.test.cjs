const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

test('first navigation to every lazy page reuses the HTML entry module and Vue/router instance', () => {
  // Compile and link the actual shipped ES modules. Module identity includes
  // query strings, just as it does in a browser; a query on only the HTML entry
  // would link a second main module and fail this test on the first navigation.
  const result = spawnSync(process.execPath, ['--experimental-vm-modules', '-e', String.raw`
    const vm = require('node:vm');
    const fs = require('node:fs');
    const path = require('node:path');
    const assert = require('node:assert/strict');
    const root = process.cwd();
    const site = 'https://example.test/xxgg-ielts-web/';
    const html = fs.readFileSync('index.html', 'utf8');
    const entry = new URL(html.match(/type="module"[^>]*src="([^"]+)"/)[1], site).href;
    const filename = path.basename(new URL(entry).pathname);
    const source = fs.readFileSync('assets/' + filename, 'utf8');
    const routes = source.slice(source.indexOf('fU=[{path:'));
    const pageRoutes = [...routes.matchAll(/import\("(\.\/[^"?]+\.js)"\)/g)].map(m => m[1]);
    assert.equal(pageRoutes.length, 8, 'all eight deployed lazy routes are covered');
    const pages = [...new Set(pageRoutes)];
    const context = vm.createContext({});
    const cache = new Map();
    function load(url) {
      if (cache.has(url)) return cache.get(url);
      const file = path.resolve(root, new URL(url).pathname.replace('/xxgg-ielts-web/', ''));
      assert.ok(file.startsWith(root + path.sep));
      const module = new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), { context, identifier: url });
      cache.set(url, module);
      return module;
    }
    function resolve(specifier, parent) { return load(new URL(specifier, parent.identifier).href); }
    (async () => {
      const main = load(entry);
      await main.link(resolve);
      for (const page of pages) {
        const module = load(new URL(page, entry).href);
        if (module.status === 'unlinked') await module.link(resolve);
        const bootstrapModules = [...cache].filter(([url]) => path.basename(new URL(url).pathname) === filename);
        assert.equal(bootstrapModules.length, 1, page + ' must not instantiate a second application');
        assert.equal(bootstrapModules[0][1], main);
        assert.equal(main.status, 'linked');
      }
      console.log('Linked all lazy pages with one shared entry module:', cache.size);
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `], { cwd: root, encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('JS chunks have fresh URLs across the full dependency graph, with valid preload targets', () => {
  const contracts = JSON.parse(fs.readFileSync(path.join(__dirname, 'bundle-contracts.json'), 'utf8'));
  const main = Object.values(contracts).find(c => /assets\/index-/.test(c.path));
  const source = fs.readFileSync(path.join(root, main.path), 'utf8');
  const deps = source.match(/m\.f=\[(.*?)\]/)[1];
  const targets = [...deps.matchAll(/"\.\/([^"]+)"/g)].map(m => m[1]);
  assert.ok(targets.length > 30);
  for (const target of targets) assert.ok(fs.existsSync(path.join(root, 'assets', target)), target);
  for (const c of Object.values(contracts)) {
    assert.match(path.basename(c.path), /-[0-9a-f]{8}\.js$/, 'every JS importer needs a fresh URL, including shared chunks');
  }
});

test('previous deployed module graphs remain available to tabs opened before an update', () => {
  for (const entry of ['index-e7f3166d.js', 'index-16ba4ae5.js']) {
    const visited = new Set();
    function walk(name) {
      if (visited.has(name)) return;
      visited.add(name);
      const file = path.join(root, 'assets', name);
      assert.ok(fs.existsSync(file), `${entry}: old tabs still need ${name}`);
      if (name.startsWith('index-')) assert.equal(name, entry, 'an old page must keep its original shared application module');
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(/["']\.\/([^"']+\.js)["']/g)) walk(match[1]);
    }
    walk(entry);
    assert.ok(visited.size >= 20, `${entry}: retain lazy pages and their shared imports`);
    const main = fs.readFileSync(path.join(root, 'assets', entry), 'utf8');
    const review = main.match(/import\("\.\/(ExamReviewPage-[^"]+\.js)"\)/)[1];
    assert.ok(visited.has(review), 'the old review route must still load after submitting answers');
  }
});
