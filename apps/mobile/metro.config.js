// Metro configuration. The app is outside the npm workspaces (React Native's
// React version differs from the admin dashboard's), so the shared package is
// linked with `file:` and Metro is told to watch it.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const sharedRoot = path.resolve(projectRoot, '../../packages/shared');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [sharedRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];
config.resolver.disableHierarchicalLookup = false;

module.exports = config;
