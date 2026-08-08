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
      assert.match(problems[0], /bc1qleaked/);
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

    it('keeps the limit far below the shortest real phrase', function () {
      // 12 words is the shortest BIP39 mnemonic. A limit at or above it would
      // only catch a leak after it is already complete.
      assert.ok(gate.SEED_RUN_LIMIT < 12, `SEED_RUN_LIMIT=${gate.SEED_RUN_LIMIT} would not catch a 12-word phrase`);
      assert.ok(gate.SEED_RUN_LIMIT > 3, 'the handbook already contains runs of 3');
    });
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
      assert.match(problems[0], /extended public key read out of a\.png/);
    });

    it('sees the upper-case SLIP-132 prefixes this wallet produces for multisig', function () {
      // class/wallets/multisig-hd-wallet.js emits Ypub and Zpub itself, and the
      // handbook already has a multi-device chapter. A lower-case-only pattern
      // would have missed exactly those.
      for (const prefix of ['Ypub', 'Zpub', 'Upub', 'Vpub', 'ypub', 'zpub', 'tpub']) {
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
      // Icons and logos legitimately carry no text.
      assert.ok(!problems[0].includes('assets/logo.png'), 'assets must not be required to yield text');
    });

    it('stays silent when every screenshot yields text', function () {
      const perFile = [
        { rel: 'screenshots/a.png', tokens: 5 },
        { rel: 'assets/logo.png', tokens: 0 },
      ];
      assert.deepStrictEqual(gate.ocrCoverageProblems(perFile, gate.SCREENSHOTS_MUST_YIELD_OCR), []);
    });

    it('does not see an extended key in ordinary text', function () {
      assert.ok(!gate.EXTENDED_KEY_RE.test('Guthaben senden und empfangen, siehe Kapitel xpub'));
      assert.deepStrictEqual(gate.extendedKeyProblems([]), []);
    });
  });
});
