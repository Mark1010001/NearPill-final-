// Passwords that are always refused for new accounts, compared in lower case.
export const commonPasswords = Object.freeze(new Set([
  'password', 'password1', 'password12', 'password123', 'password1234', 'password12345', 'passw0rd123',
  'qwerty123', 'qwertyuiop', 'qwerty12345', '1234567890', '12345678910', '123456789a', 'abc1234567',
  'abcd123456', 'iloveyou123', 'welcome123', 'welcome1234', 'admin12345', 'letmein1234', 'monkey12345',
  'dragon12345', 'football123', 'baseball123', 'superman123', 'princess123', 'sunshine123', 'nearpill123',
  'nearpill1234', 'philippines1', 'cebu123456', 'changeme123', 'default1234', 'test123456', 'testing1234',
]));
