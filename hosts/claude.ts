import type { HostConfig } from '../scripts/host-config';

const claude: HostConfig = {
  name: 'claude',
  displayName: 'Claude Code',
  cliCommand: 'claude',
  cliAliases: [],

  globalRoot: '.claude/skills/gstack',
  localSkillRoot: '.claude/skills/gstack',
  hostSubdir: '.claude',
  usesEnvVars: false,

  frontmatter: {
    mode: 'denylist',
    // interactive + benefits-from are gen-time inputs (buildContext reads them
    // from the .tmpl); no runtime or test reader consumes them from the
    // GENERATED file (verified: e2e-harness-audit reads .tmpl; benefits-from
    // tests assert rendered prose; the host reads name/description/
    // allowed-tools/hooks; bin/gstack-brain-context-load reads gbrain: — which
    // is why gbrain and hooks are NOT stripped). Stripping them trims the
    // always-on frontmatter catalog every session loads.
    stripFields: ['sensitive', 'voice-triggers', 'interactive', 'benefits-from'],
    descriptionLimit: null,
  },

  generation: {
    generateMetadata: false,
    skipSkills: ['claude'],  // Claude outside-voice skill is for non-Claude hosts
  },

  pathRewrites: [],  // Claude is the primary host — no rewrites needed
  toolRewrites: {},
  suppressedResolvers: ['GBRAIN_CONTEXT_LOAD', 'GBRAIN_SAVE_RESULTS'],

  runtimeRoot: {
    globalSymlinks: ['bin', 'browse/dist', 'browse/bin', 'gstack-upgrade', 'ETHOS.md'],
    globalFiles: {
      'review': ['checklist.md', 'TODOS-format.md'],
    },
  },

  install: {
    prefixable: true,
    linkingStrategy: 'real-dir-symlink',
  },

  coAuthorTrailer: 'Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>',
  learningsMode: 'full',
};

export default claude;
