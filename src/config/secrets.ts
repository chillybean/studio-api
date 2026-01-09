/**
 * Secrets Manager Service
 * 
 * Secure API key and secrets management using Google Cloud Secret Manager
 * with Firestore metadata for admin UI tracking
 */

import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { getFirestore } from './firebase';

const secretManager = new SecretManagerServiceClient();
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'tat-life';

// Cache for secrets to avoid repeated API calls
const secretsCache: Map<string, { value: string; expiresAt: number }> = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Secret metadata stored in Firestore (NOT the actual secret value)
 */
export interface SecretMetadata {
  id: string;
  name: string;
  description: string;
  category: 'ai' | 'api' | 'database' | 'auth' | 'payment' | 'other';
  service: string; // Which API uses this
  provider: string; // e.g., "Google", "OpenAI", "Stripe"
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lastRotatedAt?: string;
  expiresAt?: string;
  usageCount?: number;
  lastUsedAt?: string;
}

/**
 * Get a secret value from Google Cloud Secret Manager
 * Falls back to environment variables for local development
 */
export async function getSecret(secretName: string): Promise<string | null> {
  // Check cache first
  const cached = secretsCache.get(secretName);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  // In development, fall back to environment variables
  if (process.env.NODE_ENV === 'development') {
    const envValue = process.env[secretName];
    if (envValue) {
      return envValue;
    }
  }

  try {
    const [version] = await secretManager.accessSecretVersion({
      name: `projects/${PROJECT_ID}/secrets/${secretName}/versions/latest`,
    });

    const payload = version.payload?.data?.toString();
    
    if (payload) {
      // Cache the secret
      secretsCache.set(secretName, {
        value: payload,
        expiresAt: Date.now() + CACHE_TTL,
      });

      // Update usage tracking in Firestore (non-blocking)
      trackSecretUsage(secretName).catch(console.error);

      return payload;
    }

    return null;
  } catch (error: any) {
    console.error(`Failed to get secret ${secretName}:`, error.message);
    
    // Fall back to environment variable
    return process.env[secretName] || null;
  }
}

/**
 * Create or update a secret in Google Cloud Secret Manager
 */
export async function setSecret(
  secretName: string, 
  value: string,
  metadata?: Partial<SecretMetadata>
): Promise<boolean> {
  try {
    // Check if secret exists
    let secretExists = false;
    try {
      await secretManager.getSecret({
        name: `projects/${PROJECT_ID}/secrets/${secretName}`,
      });
      secretExists = true;
    } catch {
      // Secret doesn't exist
    }

    if (!secretExists) {
      // Create the secret
      await secretManager.createSecret({
        parent: `projects/${PROJECT_ID}`,
        secretId: secretName,
        secret: {
          replication: {
            automatic: {},
          },
        },
      });
    }

    // Add new version with the value
    await secretManager.addSecretVersion({
      parent: `projects/${PROJECT_ID}/secrets/${secretName}`,
      payload: {
        data: Buffer.from(value, 'utf8'),
      },
    });

    // Clear cache
    secretsCache.delete(secretName);

    // Update metadata in Firestore
    const db = getFirestore();
    const now = new Date().toISOString();
    
    await db.collection('secrets_metadata').doc(secretName).set({
      id: secretName,
      name: secretName,
      updatedAt: now,
      lastRotatedAt: now,
      isActive: true,
      ...metadata,
    }, { merge: true });

    return true;
  } catch (error: any) {
    console.error(`Failed to set secret ${secretName}:`, error.message);
    return false;
  }
}

/**
 * Delete a secret
 */
export async function deleteSecret(secretName: string): Promise<boolean> {
  try {
    await secretManager.deleteSecret({
      name: `projects/${PROJECT_ID}/secrets/${secretName}`,
    });

    // Clear cache
    secretsCache.delete(secretName);

    // Update metadata in Firestore
    const db = getFirestore();
    await db.collection('secrets_metadata').doc(secretName).update({
      isActive: false,
      deletedAt: new Date().toISOString(),
    });

    return true;
  } catch (error: any) {
    console.error(`Failed to delete secret ${secretName}:`, error.message);
    return false;
  }
}

/**
 * List all secrets metadata (NOT the actual values)
 */
export async function listSecrets(): Promise<SecretMetadata[]> {
  const db = getFirestore();
  const snapshot = await db.collection('secrets_metadata')
    .where('isActive', '==', true)
    .orderBy('category')
    .get();

  return snapshot.docs.map((doc: any) => ({
    id: doc.id,
    ...doc.data(),
  })) as SecretMetadata[];
}

/**
 * Get secret metadata (NOT the actual value)
 */
export async function getSecretMetadata(secretName: string): Promise<SecretMetadata | null> {
  const db = getFirestore();
  const doc = await db.collection('secrets_metadata').doc(secretName).get();
  
  if (!doc.exists) {
    return null;
  }

  return { id: doc.id, ...doc.data() } as SecretMetadata;
}

/**
 * Track secret usage for analytics
 */
async function trackSecretUsage(secretName: string): Promise<void> {
  const db = getFirestore();
  const docRef = db.collection('secrets_metadata').doc(secretName);
  
  await db.runTransaction(async (transaction: any) => {
    const doc = await transaction.get(docRef);
    if (doc.exists) {
      const data = doc.data();
      transaction.update(docRef, {
        usageCount: (data?.usageCount || 0) + 1,
        lastUsedAt: new Date().toISOString(),
      });
    }
  });
}

/**
 * Rotate a secret (create new version)
 */
export async function rotateSecret(
  secretName: string, 
  newValue: string
): Promise<boolean> {
  return setSecret(secretName, newValue, {
    lastRotatedAt: new Date().toISOString(),
  });
}

/**
 * Validate that required secrets exist
 */
export async function validateSecrets(requiredSecrets: string[]): Promise<{
  valid: boolean;
  missing: string[];
}> {
  const missing: string[] = [];

  for (const secretName of requiredSecrets) {
    const value = await getSecret(secretName);
    if (!value) {
      missing.push(secretName);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}

/**
 * Get all secrets for a specific service
 */
export async function getSecretsForService(serviceName: string): Promise<Record<string, string>> {
  const db = getFirestore();
  const snapshot = await db.collection('secrets_metadata')
    .where('service', '==', serviceName)
    .where('isActive', '==', true)
    .get();

  const secrets: Record<string, string> = {};

  for (const doc of snapshot.docs) {
    const secretName = doc.id;
    const value = await getSecret(secretName);
    if (value) {
      secrets[secretName] = value;
    }
  }

  return secrets;
}

/**
 * Predefined secret templates for common providers
 */
export const SecretTemplates = {
  gemini: {
    name: 'GEMINI_API_KEY',
    category: 'ai' as const,
    provider: 'Google',
    description: 'Google Gemini AI API key for text and image generation',
  },
  openai: {
    name: 'OPENAI_API_KEY',
    category: 'ai' as const,
    provider: 'OpenAI',
    description: 'OpenAI API key for GPT models',
  },
  stableDiffusion: {
    name: 'SD_API_KEY',
    category: 'ai' as const,
    provider: 'Stable Diffusion',
    description: 'Stable Diffusion API key for image generation',
  },
  stripe: {
    name: 'STRIPE_SECRET_KEY',
    category: 'payment' as const,
    provider: 'Stripe',
    description: 'Stripe secret key for payment processing',
  },
  sendgrid: {
    name: 'SENDGRID_API_KEY',
    category: 'api' as const,
    provider: 'SendGrid',
    description: 'SendGrid API key for email delivery',
  },
  twilio: {
    name: 'TWILIO_AUTH_TOKEN',
    category: 'api' as const,
    provider: 'Twilio',
    description: 'Twilio auth token for SMS',
  },
};
