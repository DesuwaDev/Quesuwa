import packageInfo from '../package.json' with { type: 'json' };

// Release images set APP_VERSION from the git tag.
export const appVersion = (process.env.APP_VERSION || packageInfo.version).replace(/^v/, '');
