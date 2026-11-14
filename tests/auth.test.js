const test = require('node:test');
const assert = require('node:assert/strict');
const Auth = require('../app/auth.js');

test('auth error messages map firebase codes to plain text', () => {
  for (const c of ['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-email'])
    assert.equal(Auth.errorMessage(c), 'Wrong email or password.');
  assert.equal(Auth.errorMessage('auth/network-request-failed'), 'No internet connection. Check your network and try again.');
  assert.equal(Auth.errorMessage('auth/admin-restricted-operation'), 'This account is not allowed to use Amylicious.');
  assert.equal(Auth.errorMessage('permission-denied'), 'This account is not allowed to use Amylicious.');
  assert.equal(Auth.errorMessage('auth/too-many-requests'), 'Too many attempts. Try again in a few minutes.');
  assert.equal(Auth.errorMessage('something/else'), 'Could not sign in. Please try again.');
  assert.equal(Auth.errorMessage(undefined), 'Could not sign in. Please try again.');
});

test('google sign-in is offered on http(s) pages only, not in the desktop app (file://)', () => {
  assert.equal(Auth.googleAvailable({ protocol: 'https:' }), true);
  assert.equal(Auth.googleAvailable({ protocol: 'http:' }), true);
  assert.equal(Auth.googleAvailable({ protocol: 'file:' }), false);
  assert.equal(Auth.googleAvailable(undefined), false);
});
