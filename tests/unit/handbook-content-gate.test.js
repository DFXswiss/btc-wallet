/**
 * Rules of the handbook content gate.
 *
 * The gate itself shells out to zbarimg and tesseract; those runs happen in the
 * handbook PR workflow against the real image payload. Here the decision logic
 * is exercised directly, so the rules stay covered on machines and CI jobs that
 * have neither tool installed — a check that quietly disappears when a tool is
 * missing is the exact failure mode this gate exists to prevent.
 */
const assert = require('assert');
const path = require('path');

const gate = require(path.resolve(__dirname, '../../scripts/handbook/content-gate.js'));

const WORDS = new Set(['abandon', 'ability', 'able', 'about', 'above', 'absent', 'zoo']);

function manifestOf(...outputPaths) {
  return { artifacts: outputPaths.map(p => ({ outputPath: p })) };
}

describe('unit - handbook content gate', () => {
  describe('scan set', () => {
    it('declares PNGs regardless of extension case and ignores other artifacts', function () {
      // build.js discovers PNGs with toLowerCase().endsWith('.png'), so an
      // upper-case extension is published. The gate must see it too.
      const declared = gate.collectDeclaredPngs(manifestOf('screenshots/a.png', 'screenshots/B.PNG', 'index.html', 'handbook.js'));
      assert.deepStrictEqual([...declared].sort(), ['screenshots/B.PNG', 'screenshots/a.png']);
    });

    it('refuses an empty scan set instead of reporting success', function () {
      const problems = gate.scanSetProblems(new Set(), new Set());
      assert.strictEqual(problems.length, 1);
      assert.match(problems[0], /nothing to scan/i);
    });

    it('reports an image that ships without being declared', function () {
      const problems = gate.scanSetProblems(new Set(['screenshots/a.png']), new Set(['screenshots/a.png', 'screenshots/sneaked.png']));
      assert.strictEqual(problems.length, 1);
      assert.match(problems[0], /shipped but not declared/);
      assert.match(problems[0], /screenshots\/sneaked\.png/);
    });

    it('reports a declared image that is absent on disk', function () {
      const problems = gate.scanSetProblems(new Set(['screenshots/a.png', 'screenshots/gone.png']), new Set(['screenshots/a.png']));
      assert.strictEqual(problems.length, 1);
      assert.match(problems[0], /absent on disk/);
      assert.match(problems[0], /screenshots\/gone\.png/);
    });

    it('passes when both sides describe the same set', function () {
      const both = ['screenshots/a.png', 'assets/b.png'];
      assert.deepStrictEqual(gate.scanSetProblems(new Set(both), new Set(both)), []);
    });
  });

  describe('QR allowlist', () => {
    const allowlist = {
      'screenshots/receive.png': { payload: /^(bitcoin:)?bc1[a-z0-9]{20,}$/, reason: 'receive screen' },
    };
    const declared = new Set(['screenshots/receive.png', 'screenshots/other.png']);

    it('accepts a QR only in the allowlisted image', function () {
      const qr = new Map([['screenshots/receive.png', 'bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4']]);
      assert.deepStrictEqual(gate.qrProblems(qr, declared, allowlist), []);
    });

    it('rejects a QR in the allowlisted image when the payload is not what was permitted', function () {
      // A path-only allowlist would wave through whatever replaces that file —
      // including the worst case this gate exists for.
      const qr = new Map([['screenshots/receive.png', 'abandon ability able about above absent']]);
      const problems = gate.qrProblems(qr, declared, allowlist);
      assert.strictEqual(problems.length, 1);
      assert.match(problems[0], /does not match what the allowlist permits/);
    });

    it('rejects a QR anywhere else and shows the payload', function () {
      const qr = new Map([
        ['screenshots/receive.png', 'bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'],
        ['screenshots/other.png', 'bitcoin:bc1qleakedaddress0000000000000000000000000'],
      ]);
      const problems = gate.qrProblems(qr, declared, allowlist);
      assert.strictEqual(problems.length, 1);
      assert.match(problems[0], /non-allowlisted image: screenshots\/other\.png/);
      // The payload is described, never quoted: this log is public.
      assert.ok(!problems[0].includes('bc1qleaked'), 'the payload must not be echoed');
      assert.match(problems[0], /content not shown/);
    });

    it('rejects an allowlist entry whose image is no longer published', function () {
      // Otherwise the entry keeps covering whatever moves into that path.
      const problems = gate.qrProblems(new Map(), new Set(['screenshots/other.png']), allowlist);
      assert.strictEqual(problems.length, 1);
      assert.match(problems[0], /stale QR allowlist entry/);
      assert.match(problems[0], /screenshots\/receive\.png/);
    });

    it('rejects an allowlist entry whose image lost its QR', function () {
      const problems = gate.qrProblems(new Map(), declared, allowlist);
      assert.strictEqual(problems.length, 1);
      assert.match(problems[0], /pointless QR allowlist entry/);
    });
  });

  describe('seed phrase detection', () => {
    it('reads a numbered phrase as one run: digits do not break it', function () {
      // This is what tesseract returns for a backup screen rendered as a grid.
      const ocr = '1. abandon 2. ability 3. able 4. about 5. above 6. absent';
      const run = gate.longestBip39Run(ocr, WORDS);
      assert.strictEqual(run.length, 6);
      assert.deepStrictEqual(run, ['abandon', 'ability', 'able', 'about', 'above', 'absent']);
    });

    it('lets any non-wordlist word end the run, and keeps the longest', function () {
      // Two separate runs of 2 and 3 — the German UI word between them must
      // not be bridged, or ordinary prose would accumulate into one long run.
      const ocr = 'abandon ability Einstellungen able about above';
      assert.deepStrictEqual(gate.longestBip39Run(ocr, WORDS), ['able', 'about', 'above']);
    });

    it('matches case-insensitively', function () {
      assert.deepStrictEqual(gate.longestBip39Run('ABANDON Ability', WORDS), ['abandon', 'ability']);
    });

    it('finds nothing in text without wordlist words', function () {
      assert.deepStrictEqual(gate.longestBip39Run('Guthaben senden und empfangen', WORDS), []);
    });

    it('stays silent below the limit and fails at it', function () {
      const short = [{ rel: 'a.png', run: ['abandon', 'ability', 'able'] }];
      assert.deepStrictEqual(gate.seedProblems(short, gate.SEED_RUN_LIMIT), []);

      const long = [{ rel: 'a.png', run: new Array(gate.SEED_RUN_LIMIT).fill('abandon') }];
      const problems = gate.seedProblems(long, gate.SEED_RUN_LIMIT);
      assert.strictEqual(problems.length, 1);
      assert.match(problems[0], /consecutive BIP39 words read out of a\.png/);
    });

    it('keeps the limit low enough to survive OCR misreads', function () {
      // A misread word splits a run. For n words and limit L a leak needs the
      // smallest k with n - k <= (k + 1)(L - 1) misreads. The comment justifies
      // 5 by demanding more than one misread for a 12-word phrase; a range
      // check alone would let a value through that breaks that reasoning.
      const misreadsNeeded = (n, L) => {
        for (let k = 0; k <= n; k++) if (n - k <= (k + 1) * (L - 1)) return k;
        return n;
      };
      assert.ok(
        misreadsNeeded(12, gate.SEED_RUN_LIMIT) >= 2,
        `SEED_RUN_LIMIT=${gate.SEED_RUN_LIMIT} lets a 12-word phrase through on a single misread`,
      );
    });

    it('keeps the limit far below the shortest real phrase', function () {
      // 12 words is the shortest BIP39 mnemonic. A limit at or above it would
      // only catch a leak after it is already complete.
      assert.ok(gate.SEED_RUN_LIMIT < 12, `SEED_RUN_LIMIT=${gate.SEED_RUN_LIMIT} would not catch a 12-word phrase`);
      assert.ok(gate.SEED_RUN_LIMIT > 3, 'the handbook already contains runs of 3');
    });
  });

  describe('the whole path, with the tools stubbed', () => {
    // Neither zbarimg nor tesseract is needed here, which is the point: the
    // wiring from the tools through the checks to the problem list was covered
    // by nothing, and deleting one line in it disarms a check silently.
    const FILES = ['screenshots/recv.png', 'screenshots/a.png'];
    const DECLARED = new Set(FILES);
    const STUB_WORDS = new Set(['abandon', 'ability', 'able', 'about', 'above']);
    const ALLOWLIST = {
      'screenshots/recv.png': { payload: /^bitcoin:bc1[02-9ac-hj-np-z]{39}$/, reason: 'receive screen fixture' },
    };
    const ADDRESS = 'bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
    const PROSE = 'Guthaben senden und empfangen '.repeat(400);

    function run(over = {}) {
      return gate.runGate({
        files: FILES,
        declared: DECLARED,
        words: STUB_WORDS,
        allowlist: ALLOWLIST,
        silentAllowed: gate.SCREENSHOTS_MUST_YIELD_OCR,
        decodeQr: rel => (rel === 'screenshots/recv.png' ? ADDRESS : ''),
        ocr: () => PROSE,
        ...over,
      });
    }

    it('reports nothing on a clean set', function () {
      const { problems, summary } = run();
      assert.deepStrictEqual(problems, []);
      assert.match(summary, /scanned 2 published PNGs/);
    });

    it('catches a recovery phrase read out of one image', function () {
      const { problems } = run({
        ocr: rel => (rel === 'screenshots/a.png' ? '1 abandon 2 ability 3 able 4 about 5 above' : PROSE),
      });
      assert.strictEqual(problems.length, 1);
      assert.match(problems[0], /consecutive BIP39 words read out of screenshots\/a\.png/);
    });

    it('catches an extended key read out of one image', function () {
      const { problems } = run({
        ocr: rel => (rel === 'screenshots/a.png' ? `Export Zpub6rFR7y4Q2AijBEqT ${PROSE}` : PROSE),
      });
      assert.strictEqual(problems.length, 1);
      assert.match(problems[0], /extended key read out of screenshots\/a\.png/);
    });

    it('catches a QR that is not the allowlisted address', function () {
      const { problems } = run({ decodeQr: () => ADDRESS });
      assert.strictEqual(problems.length, 1);
      assert.match(problems[0], /non-allowlisted image: screenshots\/a\.png/);
    });

    it('catches a tool that returns almost nothing across the set', function () {
      // Without this the token floor could be unwired from the aggregate and
      // nothing would turn red: every other case here feeds text-rich prose.
      const { problems } = run({ ocr: () => 'ok' });
      assert.strictEqual(problems.length, 1);
      assert.match(problems[0], /alphabetic tokens across the whole image set/);
    });

    it('catches an image OCR could not read', function () {
      const { problems } = run({ ocr: rel => (rel === 'screenshots/a.png' ? '' : PROSE) });
      assert.strictEqual(problems.length, 1);
      assert.match(problems[0], /OCR returned nothing for 1 screenshot/);
    });

    it('reports 0 on a clean set and 1 on anything it objects to', function () {
      // The scan-set enforcement and the only exit code live in the
      // orchestration, not in runGate. Until this was driven by a test, both
      // could be deleted with the whole suite staying green.
      const manifest = { artifacts: FILES.map(p => ({ outputPath: p })) };
      const base = {
        readManifest: () => manifest,
        listPngs: () => FILES,
        allowlist: ALLOWLIST,
        silentAllowed: gate.SCREENSHOTS_MUST_YIELD_OCR,
        words: STUB_WORDS,
        decodeQr: rel => (rel === 'screenshots/recv.png' ? ADDRESS : ''),
        ocr: () => PROSE,
        log: () => {},
        error: () => {},
      };
      assert.strictEqual(gate.runMain(base), 0);
      // An image that ships without being declared is never looked at, so the
      // scan-set comparison is the only thing between it and the public web.
      assert.strictEqual(gate.runMain({ ...base, listPngs: () => [...FILES, 'screenshots/97-undeclared.PNG'] }), 1);
      // And a problem from any check has to reach the exit code.
      assert.strictEqual(gate.runMain({ ...base, decodeQr: () => ADDRESS }), 1);
    });

    it('never prints the words or the payload it found', function () {
      const { detail, problems } = run({
        ocr: rel => (rel === 'screenshots/a.png' ? '1 abandon 2 ability 3 able 4 about 5 above' : PROSE),
      });
      // This log is public. A gate that echoes the phrase publishes it in the
      // cheaper, searchable format.
      const printed = [...detail, ...problems].join('\n');
      for (const word of ['abandon', 'ability', 'able', 'about', 'above']) {
        assert.ok(!printed.includes(word), `${word} appears in the output`);
      }
      // Not even a prefix: two characters per word leave a 12-word phrase far
      // too easy to guess, in a log that never expires.
      for (const prefix of ['ab', 'ac']) {
        assert.ok(!printed.includes(`${prefix}…`), `a ${prefix}… prefix appears in the output`);
      }
      assert.match(printed, /word\(s\), not shown/);
    });
  });

  it('treats only zbarimg exit 4 as "no QR"', function () {
    // Exit 1 is a read error. The predecessor's `|| true` passed those as
    // clean, which is the difference between "no QR here" and "not looked at".
    assert.strictEqual(gate.qrExitIsClean(4), true);
    for (const status of [0, 1, 2, 127, undefined, null]) {
      assert.strictEqual(gate.qrExitIsClean(status), false, `exit ${status} must not count as clean`);
    }
  });

  it('never puts QR content in the output', function () {
    const described = gate.maskPayload('bitcoin:bc1qsecretaddress0000000000');
    assert.ok(!described.includes('bc1qsecret'), 'the payload must not be echoed');
    assert.match(described, /characters/);
  });

  it('refuses a wordlist that is not 2048 words', function () {
    // The only thing between a dependency drift and a vacuously clean seed
    // check. It throws rather than exiting so this can be asserted at all.
    const bip39 = require('bip39');
    assert.throws(
      () => gate.bip39WordSet({ wordlists: { ...bip39.wordlists, french: ['abandon'] } }),
      /french is not the expected 2048-word list/,
    );
    assert.throws(() => gate.bip39WordSet({}), /not the expected 2048-word list/);
  });

  describe('the executable, driven as a child process', () => {
    // main() is the only place that turns a finding into a red CI step, and no
    // in-process test can reach it. The tools are stubbed on PATH so this runs
    // without zbarimg or tesseract installed.
    const fs = require('fs');
    const os = require('os');
    const { spawnSync } = require('child_process');
    const SCRIPT = path.resolve(__dirname, '../../scripts/handbook/content-gate.js');
    const ALLOWED = Object.keys(gate.QR_ALLOWLIST)[0];
    const ADDRESS = 'bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

    let tmp;

    function stub(dir, name, body) {
      const p = path.join(dir, name);
      fs.writeFileSync(p, `#!/bin/sh\n${body}\n`);
      fs.chmodSync(p, 0o755);
    }

    function fixture({ extraOnDisk = [], text = 'Guthaben senden und empfangen ', qrBody, ocrBody } = {}) {
      const root = fs.mkdtempSync(path.join(tmp, 'gate-'));
      const bin = fs.mkdtempSync(path.join(tmp, 'bin-'));
      const declared = [ALLOWED, 'screenshots/plain.png'];
      for (const rel of [...declared, ...extraOnDisk]) {
        fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), '');
      }
      fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ artifacts: declared.map(p => ({ outputPath: p })) }));
      // Only the allowlisted screen carries a QR; everything else exits 4.
      stub(
        bin,
        'zbarimg',
        qrBody || `case "$*" in *--version*) echo "zbarimg 0.23";; *01-erhalten.png*) echo '${ADDRESS}';; *) exit 4;; esac`,
      );
      stub(
        bin,
        'tesseract',
        ocrBody || `case "$*" in *--version*) echo "tesseract 5";; *) for i in $(seq 1 200); do printf '%s' '${text}'; done; echo;; esac`,
      );
      return { root, bin };
    }

    function runScript({ root, bin }) {
      return spawnSync(process.execPath, [SCRIPT, root], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, NODE_PATH: markedNodePath() },
        timeout: 60000,
      });
    }

    function markedNodePath() {
      return path.resolve(__dirname, '../../_handbook-deps/node_modules');
    }

    beforeAll(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-exec-'));
    });

    afterAll(() => {
      if (tmp && fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('exits 0 on a clean payload', function () {
      const r = runScript(fixture());
      assert.strictEqual(r.status, 0, `${r.stdout}\n${r.stderr}`);
      assert.match(r.stdout, /scanned 2 published PNGs/);
    });

    it('exits non-zero when an image ships without being declared', function () {
      const r = runScript(fixture({ extraOnDisk: ['screenshots/97-undeclared.PNG'] }));
      assert.notStrictEqual(r.status, 0, r.stdout);
      assert.match(r.stderr, /shipped but not declared/);
    });

    it('exits non-zero when zbarimg fails on an image', function () {
      // Exit 1 is a read error, not "no QR". The predecessor's `|| true`
      // passed those as clean, and nothing but this catch holds the difference.
      const r = runScript(
        fixture({
          qrBody: `case "$*" in *--version*) echo "zbarimg 0.23";; *plain.png*) exit 1;; *01-erhalten.png*) echo '${ADDRESS}';; *) exit 4;; esac`,
        }),
      );
      assert.notStrictEqual(r.status, 0, r.stdout);
      assert.match(r.stderr, /Cannot certify the image as QR-free/);
    });

    it('exits non-zero when tesseract fails on an image', function () {
      const r = runScript(
        fixture({
          ocrBody: 'case "$*" in *--version*) echo "tesseract 5";; *plain.png*) exit 1;; *) echo "Guthaben senden";; esac',
        }),
      );
      assert.notStrictEqual(r.status, 0, r.stdout);
      assert.match(r.stderr, /Cannot certify the image as seed-free/);
    });

    it('exits non-zero on a recovery phrase', function () {
      const r = runScript(fixture({ text: '1 abandon 2 ability 3 able 4 about 5 above 6 absent ' }));
      assert.notStrictEqual(r.status, 0, r.stdout);
      assert.match(r.stderr, /consecutive BIP39 words/);
    });
  });

  it('validates the wordlists it depends on', function () {
    // The gate refuses to run unless each list has 2048 entries. That guard is
    // the only thing between a dependency drift and a vacuously clean seed
    // check, so the expectation belongs in the suite too.
    const bip39 = require('bip39');
    assert.ok(gate.BIP39_LATIN_WORDLISTS.length >= 6, 'English alone is not enough — the wallet accepts ten');
    for (const name of gate.BIP39_LATIN_WORDLISTS) {
      assert.strictEqual(bip39.wordlists[name].length, 2048, `${name} is not a 2048-word list`);
    }
  });

  it('finds a French phrase, with or without the accents OCR drops', function () {
    // blue_modules/bip39.js validates against ten wordlists. English alone
    // would have read a French backup screen as ordinary text, and folding the
    // accents is what makes OCR's `academie` the same word as `académie`.
    const bip39 = require('bip39');
    // The set comes from the loader, not rebuilt here: rebuilding it would let
    // the loader drop the accent folding or fall back to English alone without
    // a single test noticing.
    const words = gate.bip39WordSet(bip39);
    const french = bip39.wordlists.french.filter(w => w !== gate.foldAccents(w)).slice(0, 6);
    assert.strictEqual(french.length, 6, 'expected accented words in the French list');
    assert.strictEqual(gate.longestBip39Run(french.join(' '), words).length, french.length);
    assert.strictEqual(gate.longestBip39Run(french.map(gate.foldAccents).join(' '), words).length, french.length);
  });

  it('keeps every allowlist entry pointed at a real screenshot path', function () {
    // An empty allowlist would make qrProblems vacuously clean and take the
    // blind-zbarimg canary with it.
    assert.ok(Object.keys(gate.QR_ALLOWLIST).length >= 1, 'the allowlist is the QR canary — it must not be empty');
    // A typo here disables the QR rule for the intended file while silently
    // covering nothing, and the gate would fail on the real receive screen.
    for (const rel of Object.keys(gate.QR_ALLOWLIST)) {
      const entry = gate.QR_ALLOWLIST[rel];
      assert.match(rel, /^screenshots\/.+\.png$/i, `allowlist key is not a built screenshot path: ${rel}`);
      assert.ok(entry.payload instanceof RegExp, `allowlist entry ${rel} has no payload matcher`);
      assert.ok(entry.reason && entry.reason.length > 10, `allowlist entry ${rel} has no reason`);
      // The matcher must not be a blanket pass — that would be a path-only
      // allowlist wearing a costume.
      assert.ok(!entry.payload.test('abandon ability able'), `allowlist entry ${rel} accepts arbitrary text`);
      // The anchors are the whole mechanism: without them a payload that
      // merely CONTAINS the address passes, and a seed phrase or an xpub can
      // ride along in the same QR.
      const address = 'bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
      assert.ok(
        !entry.payload.test(`abandon ability able ${address}`),
        `allowlist entry ${rel} accepts an address with text in front of it`,
      );
      assert.ok(
        !entry.payload.test(`${address} xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4eg`),
        `allowlist entry ${rel} accepts an address with text after it`,
      );
      // The three cases above all contain a space, so any whitespace-free
      // matcher satisfies them — including a blanket one. These two do not:
      // the first is a bare extended key, which no OCR check would ever see
      // because it sits inside a QR; the second is the BIP21 form with a free
      // text label.
      assert.ok(!entry.payload.test('xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4eg'), `allowlist entry ${rel} accepts a bare extended key`);
      assert.ok(
        !entry.payload.test(`${address}?amount=0.1&label=anything`),
        `allowlist entry ${rel} accepts BIP21 parameters, which carry free text`,
      );
    }
  });

  describe('counter-checks', () => {
    it('fails when OCR returns almost nothing across the whole set', function () {
      // A blind tesseract leaves every run empty, and an empty run set would
      // otherwise report "longest BIP39 run 0" and exit 0.
      const problems = gate.ocrYieldProblems(0, gate.MIN_OCR_TOKENS);
      assert.strictEqual(problems.length, 1);
      assert.match(problems[0], /broken tool/);
    });

    it('stays silent when OCR returns a plausible amount of text', function () {
      assert.deepStrictEqual(gate.ocrYieldProblems(gate.MIN_OCR_TOKENS, gate.MIN_OCR_TOKENS), []);
    });

    it('keeps the OCR floor between a blind tool and the real yield', function () {
      // Measured: the 70 published PNGs return 1264 alphabetic tokens under
      // tesseract 5.5.3 and 1263 under the 5.3.4 the CI runner ships.
      assert.ok(gate.MIN_OCR_TOKENS > 0, 'a floor of 0 cannot detect a blind tool');
      assert.ok(gate.MIN_OCR_TOKENS < 1263, `floor ${gate.MIN_OCR_TOKENS} is above the measured yield`);
      // A floor far below reality only catches total blindness: the four most
      // text-rich images alone return 352.
      assert.ok(gate.MIN_OCR_TOKENS > 352, `floor ${gate.MIN_OCR_TOKENS} is cleared by four images alone`);
    });

    it('refuses to report clean when nothing is in scope', function () {
      // Same vacuous pass one level down: with no screenshots in the set, "no
      // silent screenshot" is true and worthless.
      const problems = gate.ocrCoverageProblems([{ rel: 'assets/logo.png', tokens: 0 }], gate.SCREENSHOTS_MUST_YIELD_OCR);
      assert.strictEqual(problems.length, 1);
      assert.match(problems[0], /nothing to look at/);
    });

    it('reads an extended public key out of OCR text', function () {
      // Deliberately checksum-broken: the check is a shape match, so the
      // fixture has no business being a usable key in a public repository.
      const xpub = 'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDVzm';
      assert.ok(gate.EXTENDED_KEY_RE.test(xpub));
      const problems = gate.extendedKeyProblems([{ rel: 'a.png', key: xpub }]);
      assert.strictEqual(problems.length, 1);
      assert.match(problems[0], /extended key read out of a\.png/);
      assert.ok(!problems[0].includes(xpub), 'the key must not be echoed in full');
      assert.ok(!problems[0].includes(xpub.slice(0, 16)), 'more than a stub of the key is echoed');
    });

    it('sees every prefix this wallet produces, public and private', function () {
      // class/wallets/multisig-hd-wallet.js emits Ypub and Zpub itself, and the
      // handbook already has a multi-device chapter. A lower-case-only pattern
      // would have missed exactly those.
      for (const prefix of ['Ypub', 'Zpub', 'Upub', 'Vpub', 'ypub', 'zpub', 'tpub', 'zprv', 'Zprv', 'xprv', 'Yprv']) {
        const key = `${prefix}6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2`;
        assert.ok(gate.EXTENDED_KEY_RE.test(key), `${prefix} not detected`);
      }
    });

    it('names every screenshot OCR could not read', function () {
      // The token sum alone only catches total blindness: the four most
      // text-rich images clear the floor on their own while 66 stay unread.
      const perFile = [
        { rel: 'screenshots/a.png', tokens: 12 },
        { rel: 'screenshots/b.png', tokens: 0 },
        { rel: 'assets/logo.png', tokens: 0 },
      ];
      const problems = gate.ocrCoverageProblems(perFile, gate.SCREENSHOTS_MUST_YIELD_OCR);
      assert.strictEqual(problems.length, 1);
      assert.match(problems[0], /screenshots\/b\.png/);
      // Assets are borderline across tesseract versions and stay out of scope.
      assert.ok(!problems[0].includes('assets/logo.png'), 'assets must not be required to yield text');
    });

    it('stays silent when every screenshot yields text', function () {
      const perFile = [
        { rel: 'screenshots/a.png', tokens: 5 },
        { rel: 'assets/logo.png', tokens: 0 },
      ];
      assert.deepStrictEqual(gate.ocrCoverageProblems(perFile, gate.SCREENSHOTS_MUST_YIELD_OCR), []);
    });

    it('still matches when OCR breaks the key after a few characters', function () {
      // The whole point of the pattern: tesseract never returns a 111-character
      // key in one piece. A fixture of full length would leave the minimum
      // length — the parameter that decides whether this finds anything at all
      // — unpinned.
      assert.ok(gate.EXTENDED_KEY_RE.test('Zpub6rFR7y4Q2A'), 'prefix plus ten characters must match');
      assert.ok(!gate.EXTENDED_KEY_RE.test('Zpub6rFR7y4Q2'), 'prefix plus nine must not');
      // The body is alphanumeric, not base58, and that is the difference
      // between 1 and 17 of 18 rendered variants: OCR turns O into 0 and l
      // into 1, exactly the characters base58 leaves out. A tidy-up commit
      // that "corrects" this to base58 has to turn a test red.
      assert.ok(gate.EXTENDED_KEY_RE.test('Zpub6rFR7y0Q2Ai'), 'an O misread as 0 must still match');
      assert.ok(gate.EXTENDED_KEY_RE.test('zpub6rFR7ylQ2Ai'), 'an l misread must still match');
    });

    it('does not see an extended key in ordinary text', function () {
      assert.ok(!gate.EXTENDED_KEY_RE.test('Guthaben senden und empfangen, siehe Kapitel xpub'));
      assert.deepStrictEqual(gate.extendedKeyProblems([]), []);
    });
  });
});
