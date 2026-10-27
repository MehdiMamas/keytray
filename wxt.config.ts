import { defineConfig } from 'wxt';

/**
 * Chrome Web Store public key. Unpacked installs use the store id:
 * kfkmcgkbicdmgdodjjindmnpofbcmoji
 * OAuth redirect: https://kfkmcgkbicdmgdodjjindmnpofbcmoji.chromiumapp.org/
 */
const EXTENSION_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxWE2CyM/NSKkGAyPulGU2+P5mE8E88+Wj3bcQXCB0ltWTRMm7x5WzKyfqdzYcaErkzgU66gzz5+fCTUnY56a1GLKn/y2X5o6ZLetJ/G0FNhm0VeB1KoOOjoCSIWu1Xvek0Y6waVJcuDBZLI2TTHJ7xlXfyKp+1H0+9PVV/rdFLhDxWNiTasFav8cmqRZ1KgitwvAyV9DvqrHF1BpRvnThSb5Fx+QDbbmm6gtbpmcbTNIxmuu7Jd8Cp9X64AwmU0K3qL6ByYY2GqJDYLy+l8WGmSgw3fiqzzRZVLyWsdDwDOH/yPwxhq+JsprUXc/T0+GwXrQbiGzflvIoN/ooJ5Q9wIDAQAB';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // `npm run zip` uses --mode store. The Chrome Web Store rejects `key`.
  // Unpacked builds keep it so the OAuth redirect id stays stable.
  manifest: ({ mode }) => ({
    name: 'Keytray',
    description:
      'Reads verification codes and sign-in links from your Gmail accounts. Codes can be filled or copied. Links open when you choose.',
    ...(mode === 'store' ? {} : { key: EXTENSION_KEY }),
    permissions: ['identity', 'storage', 'alarms', 'offscreen', 'notifications', 'scripting', 'nativeMessaging'],
    host_permissions: [
      'https://gmail.googleapis.com/*',
      'https://www.googleapis.com/*',
      'https://extensionpay.com/*',
      '<all_urls>',
    ],
    icons: {
      16: 'icons/icon16.png',
      32: 'icons/icon32.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png',
    },
    action: {
      default_title: 'Keytray',
      default_icon: {
        16: 'icons/icon16.png',
        32: 'icons/icon32.png',
        48: 'icons/icon48.png',
        128: 'icons/icon128.png',
      },
    },
  }),
});
