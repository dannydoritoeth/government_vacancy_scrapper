/**
 * @description puppeteer broswer settings.
 */
export default {
  headless: false,
  defaultViewport: null,
  args: [
    '--start-maximized',
    '--disable-infobars',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--disable-gpu',
    '--window-size=1920,1080'
  ],
  ignoreHTTPSErrors: true,
  timeout: 60000
};
