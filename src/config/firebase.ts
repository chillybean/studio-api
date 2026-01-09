/**
 * Firebase Configuration
 */

import * as admin from 'firebase-admin';
import path from 'path';
import fs from 'fs';

let initialized = false;

export function initializeFirebase(): admin.app.App {
  if (initialized) {
    return admin.app();
  }

  // Try to load service account from secrets folder
  const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || 
    path.join(__dirname, '../../secrets/service-account.json');

  if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: `${serviceAccount.project_id}.firebasestorage.app`
    });
    
    console.log(`✅ Firebase initialized with project: ${serviceAccount.project_id}`);
  } else {
    // Use application default credentials (for Cloud Run, etc.)
    admin.initializeApp();
    console.log('✅ Firebase initialized with default credentials');
  }

  initialized = true;
  return admin.app();
}

export function getFirestore(): admin.firestore.Firestore {
  return admin.firestore();
}

export function getStorage(): admin.storage.Storage {
  return admin.storage();
}

export function getAuth(): admin.auth.Auth {
  return admin.auth();
}
