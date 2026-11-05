export interface EmailFixture {
  name: string;
  subject: string;
  body: string;
  expect: string | null;
}

export const emailFixtures: EmailFixture[] = [
  {
    name: 'google',
    subject: 'Your Google verification code',
    body: 'Your Google verification code is 847291. It expires in 10 minutes.',
    expect: '847291',
  },
  {
    name: 'microsoft',
    subject: 'Microsoft account security code',
    body: 'Use 193847 to verify your sign-in.',
    expect: '193847',
  },
  {
    name: 'amazon otp with dash',
    subject: 'Amazon OTP',
    body: '123-456 is your Amazon OTP. Do not share it.',
    expect: '123456',
  },
  {
    name: 'bank pin',
    subject: 'Security code',
    body: 'Your one-time PIN is 445566.',
    expect: '445566',
  },
  {
    name: 'spaced digits',
    subject: 'Login code',
    body: 'Enter this code: 123 456',
    expect: '123456',
  },
  {
    name: 'alphanumeric',
    subject: 'Verification code',
    body: 'Your code is A1B2C3',
    expect: 'A1B2C3',
  },
  {
    name: 'hyphenated alphanumeric code',
    subject: 'Your verification code',
    body: 'Your verification code is AB3-9K2.',
    expect: 'AB39K2',
  },
  {
    name: 'hyphenated order reference is not a code',
    subject: 'Order confirmation',
    body: 'Your order number is ORD-48213.',
    expect: null,
  },
  {
    name: 'order number is not a code',
    subject: 'Order confirmation',
    body: 'Thanks for your order. Your order number is 48219375.',
    expect: null,
  },
  {
    name: 'year nearby is ignored',
    subject: 'Verification code',
    body: 'Your verification code is 551209.\n\n© 2024 Acme Bank',
    expect: '551209',
  },
  {
    name: 'price is ignored',
    subject: 'Verification code',
    body: 'Your code is 778899. Order total $12.99.',
    expect: '778899',
  },
  {
    name: 'phone number is ignored',
    subject: 'Your code',
    body: 'Your verification code is 909090. Call +1 202 555 0148 if you did not request it.',
    expect: '909090',
  },
  {
    name: 'plain number without a keyword',
    subject: 'Hello',
    body: 'See you at 123456.',
    expect: null,
  },
  {
    name: 'date is ignored',
    subject: 'Sign-in code',
    body: 'Code 246810 requested on 12/05/2024.',
    expect: '246810',
  },
  {
    name: 'club hub invite is not a code',
    subject: 'Club Hub · New Event: Break Through Tech',
    body: 'You are invited to a new event for Girls Who Code: Break Through Tech. Add to calendar: https://outlook.office.com/calendar/0/deeplink/compose?body=Girls+Who+Code+%E2%80%94+First+Meeting%21+%F0%9F%8E%89%0D%0AJoin+us+for+our+kickoff',
    expect: null,
  },
];

export interface LinkFixture {
  name: string;
  subject: string;
  body: string;
  html: string;
  /** Expected verification URL, or null when the message must not yield one. */
  url: string | null;
  /** When set, extractCode must still return this and must not treat the URL as a code. */
  code?: string | null;
}

export const linkFixtures: LinkFixture[] = [
  {
    name: 'verify button beats unsubscribe',
    subject: 'Verify your email',
    body: '',
    html: '<p>Verify your email to finish signing up.</p><a href="https://accounts.example.com/verify?token=abc">Verify email</a><a href="https://example.com/unsubscribe">Unsubscribe</a>',
    url: 'https://accounts.example.com/verify?token=abc',
  },
  {
    name: 'plain magic sign-in url',
    subject: 'Sign in',
    body: 'Click the link below to sign in: https://app.example.com/login?token=xyz',
    html: '',
    url: 'https://app.example.com/login?token=xyz',
  },
  {
    name: 'google wrapper unwraps to the verify url',
    subject: 'Verify your email',
    body: '',
    html: '<a href="https://www.google.com/url?q=https%3A%2F%2Faccounts.example.com%2Fverify%3Ftoken%3Dabc">Verify email</a>',
    url: 'https://accounts.example.com/verify?token=abc',
  },
  {
    name: 'outlook safelink unwraps',
    subject: 'Verify your email',
    body: '',
    html: '<a href="https://nam01.safelinks.protection.outlook.com/?url=https%3A%2F%2Faccounts.example.com%2Fverify%3Ftoken%3Dabc">Verify email</a>',
    url: 'https://accounts.example.com/verify?token=abc',
  },
  {
    name: 'unsubscribe footer is not a verification link',
    subject: 'Weekly notes',
    body: 'Thanks for reading.',
    html: '<a href="https://news.example.com/unsubscribe?id=1">Unsubscribe</a>',
    url: null,
  },
  {
    name: 'password reset subject is rejected',
    subject: 'Reset your password',
    body: '',
    html: '<a href="https://accounts.example.com/reset?token=abc">Continue</a>',
    url: null,
  },
  {
    name: 'reset path is rejected',
    subject: 'Account help',
    body: 'Click continue.',
    html: '<a href="https://accounts.example.com/reset?token=abc">Continue</a>',
    url: null,
  },
  {
    name: 'account deletion is rejected',
    subject: 'Confirm account deletion',
    body: '',
    html: '<a href="https://accounts.example.com/verify-account-deletion?token=abc">Continue</a>',
    url: null,
  },
  {
    name: 'opaque tracker is skipped',
    subject: 'Verify your email',
    body: '',
    html: '<a href="https://click.sendgrid.net/ls/click?upn=abc">Verify email</a>',
    url: null,
  },
  {
    name: 'http link is rejected',
    subject: 'Verify your email',
    body: '',
    html: '<a href="http://accounts.example.com/verify?token=abc">Verify email</a>',
    url: null,
  },
  {
    name: 'code email url is not a code or a verification link',
    subject: 'Verification code',
    body: 'Your code is 847291. Visit https://example.com/help',
    html: '',
    url: null,
    code: '847291',
  },
  {
    name: 'extensionpay login link in plain text',
    subject: 'Log in to KeyTray',
    body: 'Hey! We received a login request to this email address for the browser extension KeyTray. Click this link to log in: https://extensionpay.com/extension/example/reactivate-from-email?uuid=00000000-0000-4000-8000-000000000001 This link will expire in 2 days. If you did not request a login link, please contact the extension developer and do not click the link.',
    html: '',
    url: 'https://extensionpay.com/extension/example/reactivate-from-email?uuid=00000000-0000-4000-8000-000000000001',
  },
  {
    name: 'mailgun click tracker yields the visible login url',
    subject: 'Log in to KeyTray',
    body: 'Click this link to log in: https://extensionpay.com/extension/example/reactivate-from-email?uuid=00000000-0000-4000-8000-000000000001',
    html: '<a href="https://email.mg.extensionpay.com/c/opaque-token">Log in to KeyTray</a><a href="https://email.mg.extensionpay.com/c/opaque-token">https://extensionpay.com/extension/example/reactivate-from-email?uuid=00000000-0000-4000-8000-000000000001</a>',
    url: 'https://extensionpay.com/extension/example/reactivate-from-email?uuid=00000000-0000-4000-8000-000000000001',
  },
  {
    name: 'code and verify link can both be found',
    subject: 'Verify your email',
    body: 'Your verification code is 111222.',
    html: '<a href="https://accounts.example.com/verify?token=abc">Verify email</a>',
    url: 'https://accounts.example.com/verify?token=abc',
    code: '111222',
  },
];
