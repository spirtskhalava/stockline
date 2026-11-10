import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function init() {
  if (getApps().length) return getApps()[0];
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  // with FIRESTORE_EMULATOR_HOST set, no credentials are needed
  return sa ? initializeApp({ credential: cert(JSON.parse(sa)) }) : initializeApp({ projectId: process.env.GCLOUD_PROJECT });
}

export const db = getFirestore(init());
