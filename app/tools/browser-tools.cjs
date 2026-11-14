// UI checks use an existing Chrome installation; no browser download is needed.
const path = require('path');
const chromium = require('playwright-core').chromium;
const executablePath = process.env.CHROME_PATH || (process.platform === 'win32'
  ? path.join(process.env.ProgramFiles || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe')
  : process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome');
module.exports = { chromium, executablePath };
