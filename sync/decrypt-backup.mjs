// Turns an encrypted weekly backup (.hbbak) back into a file the app's "Restore a backup" accepts.
// Run on your own computer: BACKUP_KEY=<the key> node decrypt-backup.mjs backups/2026-11-27.hbbak
// Writes home-budget-backup-<date>.json next to where you run it. Keep that file private.
import { createDecipheriv } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
export function decrypt(text, keyB64) {
  const b = JSON.parse(text); if (b.kind !== 'home-budget-encrypted-backup') throw new Error('Not a Home Budget backup');
  const d = createDecipheriv('aes-256-gcm', Buffer.from(keyB64, 'base64'), Buffer.from(b.iv, 'base64')); d.setAuthTag(Buffer.from(b.tag, 'base64'));
  return JSON.parse(gunzipSync(Buffer.concat([d.update(Buffer.from(b.data, 'base64')), d.final()])).toString());
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2], key = process.env.BACKUP_KEY;
  if (!file || !key) { console.log('Usage: BACKUP_KEY=<key> node decrypt-backup.mjs <file.hbbak>'); process.exit(2); }
  const out = `home-budget-backup-${basename(file, '.hbbak')}.json`;
  writeFileSync(out, JSON.stringify(decrypt(readFileSync(file, 'utf8'), key))); console.log(`Written ${out}. Restore it in the app: Settings → Restore a backup.`);
}
