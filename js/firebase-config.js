// Web app settings from Firebase (Project settings → General → Your apps → Config).
// These are public by design; the database rules keep the budget private. See SETUP.md.
export const FIREBASE = {
  apiKey: 'AIzaSyBQ1Js3eHdjBiOAnlyBs4R7mgsdFeUJM2Y',
  authDomain: 'home-budget-8f244.firebaseapp.com',
  projectId: 'home-budget-8f244',
  storageBucket: 'home-budget-8f244.firebasestorage.app',
  messagingSenderId: '676615897679',
  appId: '1:676615897679:web:2afe7c454bebc52a70e03a',
};
// A separate project with sample data, so development never touches the live budget. Open the app with ?test to use it.
export const TEST_FIREBASE = null;
