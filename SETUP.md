# Setting up Home Budget

The app works straight away on one phone: open it with `?local` on the end of the address. Nothing leaves that phone, and nothing is shared or backed up. Sharing between two phones needs its own Firebase project, which takes about 15 minutes.

## 1. Create the Firebase project

Keep it separate from Home Duties.

1. Go to console.firebase.google.com and choose **Create a project**. Name it `home-budget` and turn Google Analytics off.
2. Stay on the free Spark plan. The budget doesn't need anything paid.

## 2. Turn on Google sign-in

1. Go to **Authentication → Get started → Sign-in method → Google**, turn it on and save.
2. Go to **Authentication → Settings → Authorised domains** and add `frontiersmanfinished.github.io`.

## 3. Create the database

1. Go to **Databases & Storage → Firestore → Create database**. Choose **Standard** edition and keep the ID `(default)`.
2. Pick **australia-southeast1 (Sydney)** and start in **production mode**.
3. Open the **Rules** tab. Paste in `firestore.rules`, put both Google emails where the placeholders are, and choose **Publish**. Don't commit the real emails to this repository.

## 4. Connect the app

1. Go to **Project settings → General → Your apps → Web** (the `</>` icon). Register an app called `Home Budget`; Firebase Hosting isn't needed.
2. Copy the `firebaseConfig` values into `js/firebase-config.js` as `FIREBASE = { apiKey: …, authDomain: …, projectId: …, storageBucket: …, messagingSenderId: …, appId: … }`. These values are public by design: the rules keep the data private.
3. In `sw.js`, bump `VERSION` so phones pick up the change.

## 5. Check the rules, then bring the budget across

1. Open the app and sign in from a third Google account that isn't on the list. It should say "Not on the list". Don't import anything until it does.
2. Sign in as yourself, open **Settings → Import from YNAB** and choose the full API export. The app compares every month with YNAB's own figures before saving anything.
3. The second person signs in on their phone through Chrome (**⋮ → Add to home screen**), not Samsung Internet.
4. Add both people in **Settings → People**, with the email each signs in with.

## A test budget

Create a second project the same way, and put its settings in `TEST_FIREBASE`. Opening the app with `?test` uses it, so changes to the app can be tried without touching the real budget.

## Checking the maths against YNAB

`node tests/verify-ynab.mjs path/to/ynab-full-export.json` compares every category in every month, Ready to Assign and every account balance with YNAB's figures. Keep the export file outside this folder.
