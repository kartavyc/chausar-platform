const path = require('node:path');

module.exports = {
  project: {
    android: { sourceDir: path.resolve(__dirname, 'android') },
    ios: { sourceDir: path.resolve(__dirname, 'ios') },
  },
};
