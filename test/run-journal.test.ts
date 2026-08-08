import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'bun';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ROOT = path.resolve(__dirname, '..');
const RUN = path.join(ROOT, 'bin', 'gstack-run');
const PY = process.env.GSTACK_PY || 'python';

function tmpRoot(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-j-')); }
function run(args: string[], root: string) {
  const out = spawnSync([PY, RUN, ...args], { env: { ...process.env, GSTACK_STATE_ROOT: root } });
  return { code: out.exitCode, stdout: out.stdout.toString().trim(), stderr: out.stderr.toString().trim() };
}

describe('gstack-run journal', () => {
  test('verdict defaults to recorded value and history returns it', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 't'], root).stdout;

    const e = run(['journal', '--run', runId, '--item', item, '--claim', 'guard blocks edits',
                   '--verdict', 'PROVEN', '--evidence', 'ran the command and observed the documented exit code and output'], root);
    expect(e.code).toBe(0);

    const h = JSON.parse(run(['history', '--run', runId, '--item', item], root).stdout);
    expect(h.length).toBe(1);
    expect(h[0].verdict).toBe('PROVEN');
    expect(h[0].evidence).toBe('ran the command and observed the documented exit code and output');
  });

  test('a superseding entry links back so the stale claim never stands alone', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 't'], root).stdout;

    const first = run(['journal', '--run', runId, '--item', item, '--claim', 'the change under test behaves as specified',
                       '--verdict', 'PROVEN', '--evidence', 'ran the command and observed the documented exit code and output'], root).stdout;
    const second = run(['journal', '--run', runId, '--item', item, '--claim', 'the change under test behaves as specified',
                        '--verdict', 'CONTRADICTED', '--evidence', 'console shows 5 blocked scripts',
                        '--supersedes', first], root).stdout;

    const h = JSON.parse(run(['history', '--run', runId, '--item', item], root).stdout);
    const older = h.find((x: any) => x.entry_id === first);
    const newer = h.find((x: any) => x.entry_id === second);
    expect(older.superseded_by).toBe(second);
    expect(newer.verdict).toBe('CONTRADICTED');
  });

  test('an invalid verdict is rejected', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 't'], root).stdout;
    const bad = run(['journal', '--run', runId, '--item', item, '--claim', 'the change under test behaves as specified',
                     '--verdict', 'PROBABLY', '--evidence', 'ran the command and observed the documented exit code and output'], root);
    expect(bad.code).not.toBe(0);
  });

  test('a --supersedes target that does not exist is rejected', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 't'], root).stdout;
    const bad = run(['journal', '--run', runId, '--item', item, '--claim', 'the change under test behaves as specified',
                     '--verdict', 'CONTRADICTED', '--evidence', 'ran the command and observed the documented exit code and output',
                     '--supersedes', 'deadbeef00'], root);
    expect(bad.code).toBe(7);
    const h = JSON.parse(run(['history', '--run', runId, '--item', item], root).stdout);
    expect(h.length).toBe(0);
  });

  test('a --supersedes target belonging to a DIFFERENT item is rejected', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const itemA = run(['add', '--run', runId, '--title', 'a'], root).stdout;
    const itemB = run(['add', '--run', runId, '--title', 'b'], root).stdout;

    const entryA = run(['journal', '--run', runId, '--item', itemA, '--claim', 'the change under test behaves as specified',
                        '--verdict', 'PROVEN', '--evidence', 'ran the command and observed the documented exit code and output'], root).stdout;

    // Filing the correction under the wrong item must not silently orphan it.
    const wrong = run(['journal', '--run', runId, '--item', itemB, '--claim', 'the change under test behaves as specified',
                       '--verdict', 'CONTRADICTED', '--evidence', 'ran the command and observed the documented exit code and output',
                       '--supersedes', entryA], root);
    expect(wrong.code).toBe(7);

    // The original claim must not be left standing alone as PROVEN by accident.
    const h = JSON.parse(run(['history', '--run', runId, '--item', itemA], root).stdout);
    expect(h.length).toBe(1);
    expect(h[0].superseded_by).toBeUndefined();
  });

  test('two entries superseding the same claim: last wins, both links recoverable', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 't'], root).stdout;
    const first = run(['journal', '--run', runId, '--item', item, '--claim', 'the change under test behaves as specified',
                       '--verdict', 'PROVEN', '--evidence', 'ran the command and observed the documented exit code and output'], root).stdout;
    const second = run(['journal', '--run', runId, '--item', item, '--claim', 'the change under test behaves as specified',
                        '--verdict', 'UNPROVEN', '--evidence', 'ran the command and observed the documented exit code and output',
                        '--supersedes', first], root).stdout;
    const third = run(['journal', '--run', runId, '--item', item, '--claim', 'the change under test behaves as specified',
                       '--verdict', 'CONTRADICTED', '--evidence', 'ran the command and observed the documented exit code and output',
                       '--supersedes', first], root).stdout;

    const h = JSON.parse(run(['history', '--run', runId, '--item', item], root).stdout);
    const original = h.find((x: any) => x.entry_id === first);
    expect(original.superseded_by).toBe(third);
    // Both superseders still record what they overturned.
    expect(h.filter((x: any) => x.supersedes === first).map((x: any) => x.entry_id).sort())
      .toEqual([second, third].sort());
  });

  test('a corrupt journal line fails closed rather than showing a contradicted claim as current', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 't'], root).stdout;
    run(['journal', '--run', runId, '--item', item, '--claim', 'the change under test behaves as specified',
         '--verdict', 'PROVEN', '--evidence', 'ran the command and observed the documented exit code and output'], root);
    // Simulate a crash while appending the entry that would have overturned it.
    fs.appendFileSync(path.join(root, 'runs', runId, 'journal.jsonl'), '{"entry_id":"tru');

    const h = run(['history', '--run', runId, '--item', item], root);
    expect(h.code).toBe(12);
    expect(h.stderr).toContain('unreliable');
  });
});

describe('gstack-run journal --verifier', () => {
  test('a verifier who also claimed the item is refused', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 't'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'worker-a'], root);

    const self = run(['journal', '--run', runId, '--item', item, '--claim', 'the change under test behaves as specified',
                      '--verdict', 'PROVEN', '--evidence', 'ran the command and observed the documented exit code and output',
                      '--verifier', 'worker-a'], root);
    expect(self.code).toBe(15);

    const h = JSON.parse(run(['history', '--run', runId, '--item', item], root).stdout);
    expect(h.length).toBe(0);
  });

  test('a different verifier is accepted and recorded', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 't'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'worker-a'], root);

    const ok = run(['journal', '--run', runId, '--item', item, '--claim', 'the change under test behaves as specified',
                    '--verdict', 'PROVEN', '--evidence', 'ran the command and observed the documented exit code and output',
                    '--verifier', 'worker-b'], root);
    expect(ok.code).toBe(0);

    const h = JSON.parse(run(['history', '--run', runId, '--item', item], root).stdout);
    expect(h[0].verifier).toBe('worker-b');
  });
});

describe('gstack-run journal --tier elevated', () => {
  test('elevated work without a verifier is refused', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 't'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'worker-a'], root);

    const bare = run(['journal', '--run', runId, '--item', item, '--claim', 'the change under test behaves as specified',
                      '--verdict', 'PROVEN', '--evidence', 'ran the command and observed the documented exit code and output',
                      '--tier', 'elevated'], root);
    expect(bare.code).toBe(16);

    const h = JSON.parse(run(['history', '--run', runId, '--item', item], root).stdout);
    expect(h.length).toBe(0);
  });

  test('elevated work WITH a different verifier is accepted and records the tier', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 't'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'worker-a'], root);

    const ok = run(['journal', '--run', runId, '--item', item, '--claim', 'the change under test behaves as specified',
                    '--verdict', 'PROVEN', '--evidence', 'ran the command and observed the documented exit code and output',
                    '--tier', 'elevated', '--verifier', 'worker-b'], root);
    expect(ok.code).toBe(0);

    const h = JSON.parse(run(['history', '--run', runId, '--item', item], root).stdout);
    expect(h[0].tier).toBe('elevated');
    expect(h[0].verifier).toBe('worker-b');
  });

  test('routine work still needs no verifier', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 't'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'worker-a'], root);

    const ok = run(['journal', '--run', runId, '--item', item, '--claim', 'the change under test behaves as specified',
                    '--verdict', 'PROVEN', '--evidence', 'ran the command and observed the documented exit code and output',
                    '--tier', 'routine'], root);
    expect(ok.code).toBe(0);
  });
});

describe('a journal entry must actually say something', () => {
  function ready(root: string) {
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 't'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'w1'], root);
    return { runId, item };
  }

  test('placeholder claim and evidence are refused', () => {
    const root = tmpRoot();
    const { runId, item } = ready(root);
    const junk = run(['journal', '--run', runId, '--item', item,
                      '--claim', 'x', '--verdict', 'PROVEN', '--evidence', 'x'], root);
    expect(junk.code).toBe(22);
    expect(JSON.parse(run(['history', '--run', runId, '--item', item], root).stdout).length).toBe(0);
  });

  test('a placeholder verifier is refused even though it differs from the worker', () => {
    const root = tmpRoot();
    const { runId, item } = ready(root);
    const junk = run(['journal', '--run', runId, '--item', item,
                      '--claim', 'the guard now blocks edits to generated files',
                      '--verdict', 'PROVEN',
                      '--evidence', 'ran a live Edit and the hook denied it, file bytes unchanged',
                      '--verifier', 'pending'], root);
    expect(junk.code).toBe(22);
  });

  test('substantive claim, evidence and verifier are accepted', () => {
    const root = tmpRoot();
    const { runId, item } = ready(root);
    const ok = run(['journal', '--run', runId, '--item', item,
                    '--claim', 'the guard now blocks edits to generated files',
                    '--verdict', 'PROVEN',
                    '--evidence', 'ran a live Edit and the hook denied it, file bytes unchanged',
                    '--verifier', 'verifier-a4cc293e'], root);
    expect(ok.code).toBe(0);
  });

  // The denylist is a wordlist; the length floors are what catch everything
  // NOT on it. Mutation testing showed every floor could be lowered to 1 with
  // the suite still green, because every existing case used a denylisted word.
  // These use strings no denylist would ever contain, one character either
  // side of each boundary.
  const LONG_CLAIM = 'the change under test behaves exactly as specified';
  const LONG_EVIDENCE = 'reran the command and compared its output against the spec';

  test('a claim one character under the floor is refused, and one at it is accepted', () => {
    const root = tmpRoot();
    const { runId, item } = ready(root);
    const short = run(['journal', '--run', runId, '--item', item, '--claim', 'situation ok',
                       '--verdict', 'PROVEN', '--evidence', LONG_EVIDENCE], root);
    expect(short.code).toBe(22);
    expect(run(['journal', '--run', runId, '--item', item, '--claim', 'situation okay',
                '--verdict', 'PROVEN', '--evidence', LONG_EVIDENCE], root).code).toBe(22);
    expect(run(['journal', '--run', runId, '--item', item, '--claim', 'situation okayy',
                '--verdict', 'PROVEN', '--evidence', LONG_EVIDENCE], root).code).toBe(0);
  });

  test('evidence one character under the floor is refused, and one at it is accepted', () => {
    const root = tmpRoot();
    const { runId, item } = ready(root);
    expect(run(['journal', '--run', runId, '--item', item, '--claim', LONG_CLAIM,
                '--verdict', 'PROVEN', '--evidence', 'ran it and compared bytes'.slice(0, 24)], root).code).toBe(22);
    expect(run(['journal', '--run', runId, '--item', item, '--claim', LONG_CLAIM,
                '--verdict', 'PROVEN', '--evidence', 'ran it and compared bytes'.slice(0, 25)], root).code).toBe(0);
  });

  test('a verifier under the floor is refused even though it is not a known placeholder', () => {
    const root = tmpRoot();
    const { runId, item } = ready(root);
    expect(run(['journal', '--run', runId, '--item', item, '--claim', LONG_CLAIM,
                '--verdict', 'PROVEN', '--evidence', LONG_EVIDENCE,
                '--verifier', 'ab'], root).code).toBe(22);
    expect(run(['journal', '--run', runId, '--item', item, '--claim', LONG_CLAIM,
                '--verdict', 'PROVEN', '--evidence', LONG_EVIDENCE,
                '--verifier', 'abc'], root).code).toBe(0);
  });

  test('a bad verdict reports as a bad verdict, not as a thin field', () => {
    const root = tmpRoot();
    const { runId, item } = ready(root);
    const bad = run(['journal', '--run', runId, '--item', item, '--claim', 'x',
                     '--verdict', 'PROBABLY', '--evidence', 'x'], root);
    expect(bad.code).toBe(5);
  });
});

// Both of these were documented as accepted limits before being closed. A
// documented limit that quietly returns is worse than one never claimed fixed,
// which is why each has a test rather than a paragraph.
describe('a placeholder cannot be smuggled past the denylist', () => {
  function ready(root: string) {
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 't'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'w1'], root);
    return { runId, item };
  }
  const CLAIM = 'the change under test behaves as specified';
  const EVIDENCE = 'reran the command and compared its output against the spec';

  // 'pеnding' carries a Cyrillic е — it reads as "pending" and is not equal to it.
  for (const verifier of ['n/a.', 'pending.', 'N.A.', 'pеnding',
                          'P E N D I N G', 'x . . . . . . . . . .']) {
    test(`--verifier ${JSON.stringify(verifier)} is refused`, () => {
      const root = tmpRoot();
      const { runId, item } = ready(root);
      expect(run(['journal', '--run', runId, '--item', item, '--claim', CLAIM,
                  '--verdict', 'PROVEN', '--evidence', EVIDENCE,
                  '--verifier', verifier], root).code).toBe(22);
    });
  }

  test('a real name that merely contains a placeholder substring is still accepted', () => {
    const root = tmpRoot();
    const { runId, item } = ready(root);
    // 'nomad' contains 'no'; 'donovan' contains 'done'. Canonicalisation must
    // compare whole values, not search for a placeholder inside them.
    for (const verifier of ['nomad-7', 'donovan', 'testarossa']) {
      expect(run(['journal', '--run', runId, '--item', item, '--claim', CLAIM,
                  '--verdict', 'PROVEN', '--evidence', EVIDENCE,
                  '--verifier', verifier], root).code).toBe(0);
    }
  });
});

describe('evidence must report an observation, not assert a conclusion', () => {
  function ready(root: string) {
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 't'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'w1'], root);
    return { runId, item };
  }
  const CLAIM = 'the change under test behaves as specified';

  // Refused: the phrase IS the whole message, so nothing survives removing it.
  for (const evidence of ['I am confident that it works as intended',
                          'everything works fine and nothing broke',
                          'checked it out and it all looks good now',
                          'it just works, all good, no issues at all']) {
    test(`PROVEN evidence ${JSON.stringify(evidence)} is refused`, () => {
      const root = tmpRoot();
      const { runId, item } = ready(root);
      expect(run(['journal', '--run', runId, '--item', item, '--claim', CLAIM,
                  '--verdict', 'PROVEN', '--evidence', evidence], root).code).toBe(22);
    });
  }

  test('a vacuous claim is refused even when the evidence is sound', () => {
    const root = tmpRoot();
    const { runId, item } = ready(root);
    expect(run(['journal', '--run', runId, '--item', item,
                '--claim', 'it works as intended, all good',
                '--verdict', 'PROVEN',
                '--evidence', 'ran the suite and saw 100 pass 0 fail'], root).code).toBe(22);
  });

  // The rule must not make the honest verdict the hardest one to file.
  test('UNPROVEN may say that no evidence exists — that is its purpose', () => {
    const root = tmpRoot();
    const { runId, item } = ready(root);
    expect(run(['journal', '--run', runId, '--item', item, '--claim', CLAIM,
                '--verdict', 'UNPROVEN',
                '--evidence', 'no evidence gathered yet; verification is still pending'], root).code).toBe(0);
  });

  // The first version of this gate refused 65% of real evidence. Each string
  // below is one an independent review wrote as evidence it would genuinely
  // file, and each was rejected. A gate that refuses honest work teaches
  // workers to pad prose until the tool goes quiet, which is the vacuity it
  // was built to stop.
  test('a real observation is not refused for a trailing conclusion', () => {
    const root = tmpRoot();
    const { runId, item } = ready(root);
    for (const evidence of [
      'reran the failing test and nothing broke elsewhere',
      'ran the full suite and everything passes',
      'ran npm audit; no issues remain at high or critical',
      'inspected the diff and the generated file looks correct against the schema',
      'deployed to staging and confirmed it serves the new template',
    ]) {
      expect(run(['journal', '--run', runId, '--item', item, '--claim', CLAIM,
                  '--verdict', 'PROVEN', '--evidence', evidence], root).code).toBe(0);
    }
  });

  test('evidence is not required to be English, or to contain a number or a path', () => {
    const root = tmpRoot();
    const { runId, item } = ready(root);
    for (const evidence of [
      // "I ran the command and observed the output matches the spec exactly"
      'شغّلت الأمر ولاحظت أن المخرج مطابق للمواصفات تماما',
      'I have run the command and the result was same as the expected one',
      'applied the migration to a scratch database and the new column exists',
      'clicked through signup, upload and checkout',
      'took a screenshot before and after; the spacing between the cards changed',
      'ran a live Edit and the hook denied it, file bytes unchanged',
    ]) {
      expect(run(['journal', '--run', runId, '--item', item, '--claim', CLAIM,
                  '--verdict', 'PROVEN', '--evidence', evidence], root).code).toBe(0);
    }
  });
});
