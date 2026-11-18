// Throwaway-mailbox providers that cannot be used to create a NearPill account.
// Edit this list freely: one lower-case domain per entry, no leading "@".
export const blockedEmailDomains = Object.freeze(new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org', 'sharklasers.com',
  'grr.la', 'guerrillamailblock.com', '10minutemail.com', '10minutemail.net', 'tempmail.com',
  'temp-mail.org', 'temp-mail.io', 'tempmail.net', 'tempmailo.com', 'throwawaymail.com',
  'yopmail.com', 'yopmail.net', 'yopmail.fr', 'trashmail.com', 'trashmail.net', 'trashmail.de',
  'getnada.com', 'nada.email', 'maildrop.cc', 'dispostable.com', 'fakeinbox.com', 'mailnesia.com',
  'mintemail.com', 'mytemp.email', 'emailondeck.com', 'burnermail.io', 'spamgourmet.com',
  'mohmal.com', 'moakt.com', 'tmail.ws', 'tmpmail.org', 'tmpmail.net', 'discard.email',
  'mail.tm', 'inboxkitten.com', 'mailcatch.com', 'spambox.us', 'getairmail.com', 'anonbox.net',
]));
