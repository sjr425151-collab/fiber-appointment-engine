import { hashPassword } from '../lib/auth';

const pw = process.argv[2];
if (!pw || pw.length < 10) {
  console.error('Usage: npm run admin:hash -- "a-password-of-at-least-10-chars"');
  process.exit(1);
}
console.log('ADMIN_PASSWORD_HASH=' + hashPassword(pw));
