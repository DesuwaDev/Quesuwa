// Language-neutral identifiers shared by the browser and the server.
// Every user-visible label is resolved through the translation catalogs.

export const LIMITS = Object.freeze({
  fields: 100,
  options: 50,
  rankingOptions: 15,
  matrixRows: 20,
  matrixColumns: 10,
  fileFields: 2,
  filesPerField: 3,
  fileMB: 10,
  title: 120,
  description: 3000,
  thanks: 1000,
  label: 500,
  fieldDescription: 2000,
  option: 200,
  shortText: 1000,
  longText: 10000,
  other: 200,
  note: 10000,
  logicRules: 10,
  scaleLabel: 40
});

export const fieldTypes = {
  short: 'type.short',
  long: 'type.long',
  email: 'type.email',
  phone: 'type.phone',
  url: 'type.url',
  number: 'type.number',
  date: 'type.date',
  time: 'type.time',
  single: 'type.single',
  multi: 'type.multi',
  select: 'type.select',
  ranking: 'type.ranking',
  rating: 'type.rating',
  scale: 'type.scale',
  nps: 'type.nps',
  matrix: 'type.matrix',
  file: 'type.file',
  section: 'type.section',
  statement: 'type.statement'
};

export const fieldTypeHints = {
  short: 'typeHint.short',
  long: 'typeHint.long',
  email: 'typeHint.email',
  phone: 'typeHint.phone',
  url: 'typeHint.url',
  number: 'typeHint.number',
  date: 'typeHint.date',
  time: 'typeHint.time',
  single: 'typeHint.single',
  multi: 'typeHint.multi',
  select: 'typeHint.select',
  ranking: 'typeHint.ranking',
  rating: 'typeHint.rating',
  scale: 'typeHint.scale',
  nps: 'typeHint.nps',
  matrix: 'typeHint.matrix',
  file: 'typeHint.file',
  section: 'typeHint.section',
  statement: 'typeHint.statement'
};

export const fieldGroups = [
  { key: 'editor.groupText', types: ['short', 'long', 'email', 'phone', 'url'] },
  { key: 'editor.groupChoice', types: ['single', 'multi', 'select', 'ranking'] },
  { key: 'editor.groupScale', types: ['rating', 'scale', 'nps', 'matrix', 'number'] },
  { key: 'editor.groupOther', types: ['date', 'time', 'file'] },
  { key: 'editor.groupLayout', types: ['section', 'statement'] }
];

export const layoutTypes = ['section', 'statement'];
export const choiceTypes = ['single', 'multi', 'select'];
export const optionTypes = ['single', 'multi', 'select', 'ranking'];
export const numericTypes = ['number', 'rating', 'scale', 'nps'];
export const textTypes = ['short', 'long', 'email', 'phone', 'url', 'date', 'time'];
export const otherTypes = ['single', 'multi'];

export const statuses = ['pending', 'inProgress', 'resolved', 'needsInfo'];
export const statusKeys = { pending: 'status.pending', inProgress: 'status.inProgress', resolved: 'status.resolved', needsInfo: 'status.needsInfo' };
export const formStates = ['draft', 'published', 'closed'];
export const stateKeys = { draft: 'state.draft', published: 'state.published', closed: 'state.closed' };

export const roles = ['owner', 'editor', 'viewer'];
export const roleKeys = { owner: 'role.owner', editor: 'role.editor', viewer: 'role.viewer' };
export const roleHintKeys = { owner: 'role.ownerHint', editor: 'role.editorHint', viewer: 'role.viewerHint' };
const grants = {
  owner: ['forms.write', 'forms.purge', 'responses.write', 'responses.purge', 'users.manage', 'system.read'],
  editor: ['forms.write', 'responses.write'],
  viewer: []
};
export const can = (role, permission) => Boolean(grants[role]?.includes(permission));

export const accents = ['coral', 'blue', 'green', 'amber', 'violet', 'slate'];
export const accentKeys = { coral: 'accent.coral', blue: 'accent.blue', green: 'accent.green', amber: 'accent.amber', violet: 'accent.violet', slate: 'accent.slate' };

export const fileKinds = ['image', 'pdf', 'text'];
export const fileKindKeys = { image: 'settings.images', pdf: 'settings.pdf', text: 'settings.textFiles' };
export const fileKindExtensions = { image: '.png,.jpg,.jpeg,.webp,.gif', pdf: '.pdf', text: '.txt,.log' };

export const logicOperators = {
  equals: 'logic.equals',
  notEquals: 'logic.notEquals',
  includes: 'logic.includes',
  excludes: 'logic.excludes',
  eq: 'logic.eq',
  neq: 'logic.neq',
  gt: 'logic.gt',
  gte: 'logic.gte',
  lt: 'logic.lt',
  lte: 'logic.lte',
  answered: 'logic.answered',
  notAnswered: 'logic.notAnswered'
};
