# Up sync

`up-sync.mjs` runs hourly as a GitHub Actions job in a **private** repository (job logs in a public repository can be read by anyone). It only calls Up when a sync is due: every 6 hours by default, or the frequency chosen in the app (Settings → Up sync), or when someone taps Sync now.

Each due run:
- signs in to Firebase as a limited sync account (not an admin key)
- fetches the joint Up accounts and their recent transactions
- writes them to an inbox, which either phone turns into budget transactions
- records which transactions are still held, and lists any Up webhooks so the app can warn about unknown ones

Once a week the job also saves an encrypted backup of the budget into the private repository. It keeps the last 12.

The code is plain Node with no packages and no third-party actions. It never prints the Up token or the sync password.

## Setting it up

1. **Sync account.** In Firebase, go to Authentication → Sign-in method → Add new provider → **Email/Password** and turn it on. Then go to Users → **Add user**. Use an address like `up-sync@home-budget-8f244.firebaseapp.com`, and a long random password from your password manager. Copy the new user's **User UID**.
2. **Rules.** Publish `firestore.rules` with the two household emails and that UID filled in.
3. **Private repository.** Create `home-budget-sync` as a private repository. Put `up-sync.mjs` and `decrypt-backup.mjs` in a `sync/` folder, and `sync.yml` in `.github/workflows/`. Turn on secret scanning and push protection under Settings → Code security.
4. **Backup key.** In PowerShell, run:
   ```powershell
   $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
   ```
   Save the result in your password manager. Restoring a backup needs it.
5. **Secrets.** Under Settings → Secrets and variables → Actions, add these four:
   - `UP_TOKEN`: a new personal access token from the Up app. Copy it straight into GitHub, then clear the clipboard. Up allows one token at a time, so making a new one replaces any old one.
   - `SYNC_EMAIL` and `SYNC_PASSWORD`: the sync account from step 1.
   - `BACKUP_KEY`: the key from step 4.
6. **First run.** Go to Actions → Up sync → Run workflow. Then in the app, go to Settings → Up sync and choose, for each joint account, whether to link it, add it, or ignore it.

## If the token is ever exposed

Revoke it in the Up app and make a new one. Put the new one in the `UP_TOKEN` secret. Then check Settings → Up sync in the app for unknown webhooks, and delete any you didn't create.

## Restoring a backup

Download the `.hbbak` file from `backups/`. Then, on your own computer, run:

```
BACKUP_KEY=<the key> node decrypt-backup.mjs 2026-11-27.hbbak
```

Restore the `.json` file it writes in the app, under Settings → Restore a backup. Keep that file private.
