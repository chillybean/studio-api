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
 * API Provider Template with documentation and instructions
 */
export interface ApiProviderTemplate {
  name: string;
  category: 'ai' | 'api' | 'database' | 'auth' | 'payment' | 'other';
  provider: string;
  description: string;
  service: string;
  documentationUrl: string;
  instructions: string[];
  freeTrialAvailable: boolean;
  estimatedSetupTime: string;
}

/**
 * Predefined secret templates for all Tat-Life API providers
 */
export const SecretTemplates: Record<string, ApiProviderTemplate> = {
  // ========== CORE / REQUIRED ==========
  GEMINI_API_KEY: {
    name: 'GEMINI_API_KEY',
    category: 'ai',
    provider: 'Google',
    description: 'Google Gemini AI API key for text and image generation',
    service: 'studio-api',
    documentationUrl: 'https://aistudio.google.com/apikey',
    instructions: [
      '1. Go to https://aistudio.google.com/apikey',
      '2. Sign in with your Google account',
      '3. Click "Create API Key"',
      '4. Select your Google Cloud project (or create one)',
      '5. Copy the generated API key',
    ],
    freeTrialAvailable: true,
    estimatedSetupTime: '2 minutes',
  },
  
  GOOGLE_MAPS_API_KEY: {
    name: 'GOOGLE_MAPS_API_KEY',
    category: 'api',
    provider: 'Google',
    description: 'Google Maps SDK for studio/shop locations',
    service: 'tatlife-app',
    documentationUrl: 'https://console.cloud.google.com/apis/credentials',
    instructions: [
      '1. Go to https://console.cloud.google.com/apis/credentials',
      '2. Select your project (tat-life)',
      '3. Click "Create Credentials" → "API Key"',
      '4. Click "Edit API Key" to restrict it',
      '5. Under "API restrictions", select:',
      '   - Maps SDK for Android',
      '   - Maps SDK for iOS',
      '   - Places API',
      '6. Copy the API key',
    ],
    freeTrialAvailable: true,
    estimatedSetupTime: '5 minutes',
  },

  // ========== CONTENT APIS ==========
  YOUTUBE_API_KEY: {
    name: 'YOUTUBE_API_KEY',
    category: 'api',
    provider: 'Google',
    description: 'YouTube Data API v3 for tattoo tutorials and content',
    service: 'content-api',
    documentationUrl: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com',
    instructions: [
      '1. Go to https://console.cloud.google.com/apis/library/youtube.googleapis.com',
      '2. Enable the "YouTube Data API v3"',
      '3. Go to Credentials → Create Credentials → API Key',
      '4. Restrict the key to YouTube Data API v3 only',
      '5. Copy the API key',
    ],
    freeTrialAvailable: true,
    estimatedSetupTime: '3 minutes',
  },

  INSTAGRAM_CLIENT_ID: {
    name: 'INSTAGRAM_CLIENT_ID',
    category: 'api',
    provider: 'Meta',
    description: 'Instagram Graph API Client ID for artist content',
    service: 'explore-api',
    documentationUrl: 'https://developers.facebook.com/apps/',
    instructions: [
      '1. Go to https://developers.facebook.com/apps/',
      '2. Click "Create App" → "Consumer" or "Business"',
      '3. Add the "Instagram Graph API" product',
      '4. Go to App Settings → Basic',
      '5. Copy the App ID (this is your Client ID)',
    ],
    freeTrialAvailable: true,
    estimatedSetupTime: '15 minutes',
  },

  INSTAGRAM_CLIENT_SECRET: {
    name: 'INSTAGRAM_CLIENT_SECRET',
    category: 'api',
    provider: 'Meta',
    description: 'Instagram Graph API Client Secret',
    service: 'explore-api',
    documentationUrl: 'https://developers.facebook.com/apps/',
    instructions: [
      '1. Go to your Facebook App dashboard',
      '2. Go to App Settings → Basic',
      '3. Click "Show" next to App Secret',
      '4. Enter your Facebook password to reveal',
      '5. Copy the App Secret',
    ],
    freeTrialAvailable: true,
    estimatedSetupTime: '2 minutes',
  },

  TIKTOK_CLIENT_KEY: {
    name: 'TIKTOK_CLIENT_KEY',
    category: 'api',
    provider: 'TikTok',
    description: 'TikTok API Client Key for tattoo content',
    service: 'content-api',
    documentationUrl: 'https://developers.tiktok.com/apps/',
    instructions: [
      '1. Go to https://developers.tiktok.com/',
      '2. Sign in and go to "My Apps"',
      '3. Click "Create App"',
      '4. Fill in app details and select required permissions',
      '5. After approval, find Client Key in app dashboard',
    ],
    freeTrialAvailable: true,
    estimatedSetupTime: '10 minutes (+ approval time)',
  },

  TIKTOK_CLIENT_SECRET: {
    name: 'TIKTOK_CLIENT_SECRET',
    category: 'api',
    provider: 'TikTok',
    description: 'TikTok API Client Secret',
    service: 'content-api',
    documentationUrl: 'https://developers.tiktok.com/apps/',
    instructions: [
      '1. Go to your TikTok app dashboard',
      '2. Find Client Secret in the app configuration',
      '3. Copy the secret value',
    ],
    freeTrialAvailable: true,
    estimatedSetupTime: '1 minute',
  },

  PINTEREST_ACCESS_TOKEN: {
    name: 'PINTEREST_ACCESS_TOKEN',
    category: 'api',
    provider: 'Pinterest',
    description: 'Pinterest API access token for tattoo inspiration',
    service: 'content-api',
    documentationUrl: 'https://developers.pinterest.com/apps/',
    instructions: [
      '1. Go to https://developers.pinterest.com/',
      '2. Create a new app',
      '3. Request access to required scopes',
      '4. Generate an access token in the app dashboard',
      '5. Copy the access token',
    ],
    freeTrialAvailable: true,
    estimatedSetupTime: '10 minutes',
  },

  // ========== AI PROVIDERS ==========
  OPENAI_API_KEY: {
    name: 'OPENAI_API_KEY',
    category: 'ai',
    provider: 'OpenAI',
    description: 'OpenAI API key for GPT models (alternative to Gemini)',
    service: 'studio-api',
    documentationUrl: 'https://platform.openai.com/api-keys',
    instructions: [
      '1. Go to https://platform.openai.com/api-keys',
      '2. Sign in or create an account',
      '3. Click "Create new secret key"',
      '4. Name it (e.g., "tat-life-production")',
      '5. Copy the key immediately (only shown once!)',
    ],
    freeTrialAvailable: false,
    estimatedSetupTime: '3 minutes',
  },

  SD_API_KEY: {
    name: 'SD_API_KEY',
    category: 'ai',
    provider: 'Stability AI',
    description: 'Stable Diffusion API key for image generation',
    service: 'studio-api',
    documentationUrl: 'https://platform.stability.ai/account/keys',
    instructions: [
      '1. Go to https://platform.stability.ai/',
      '2. Sign up or log in',
      '3. Go to Account → API Keys',
      '4. Click "Create API Key"',
      '5. Copy the generated key',
    ],
    freeTrialAvailable: true,
    estimatedSetupTime: '3 minutes',
  },

  VERTEX_AI_PROJECT: {
    name: 'VERTEX_AI_PROJECT',
    category: 'ai',
    provider: 'Google Cloud',
    description: 'Vertex AI project ID for ML models',
    service: 'explore-api',
    documentationUrl: 'https://console.cloud.google.com/vertex-ai',
    instructions: [
      '1. Go to https://console.cloud.google.com/vertex-ai',
      '2. Enable Vertex AI API for your project',
      '3. Your project ID is in the URL or project selector',
      '4. Use the project ID as the value',
    ],
    freeTrialAvailable: true,
    estimatedSetupTime: '5 minutes',
  },

  // ========== SELF-HOSTED AI ==========
  CUSTOM_LLM_URL: {
    name: 'CUSTOM_LLM_URL',
    category: 'ai',
    provider: 'Self-hosted',
    description: 'URL for self-hosted LLM (Railway, RunPod, etc.)',
    service: 'studio-api',
    documentationUrl: 'https://railway.app/new',
    instructions: [
      '1. Deploy an OpenAI-compatible LLM to Railway/RunPod',
      '2. Options: Ollama, vLLM, LocalAI, text-generation-webui',
      '3. Get the deployed URL (e.g., https://your-app.up.railway.app)',
      '4. Ensure /v1/chat/completions endpoint is working',
    ],
    freeTrialAvailable: true,
    estimatedSetupTime: '30 minutes',
  },

  CUSTOM_LLM_API_KEY: {
    name: 'CUSTOM_LLM_API_KEY',
    category: 'ai',
    provider: 'Self-hosted',
    description: 'API key for self-hosted LLM (if required)',
    service: 'studio-api',
    documentationUrl: 'https://railway.app/new',
    instructions: [
      '1. Generate a secure random API key',
      '2. Configure your LLM server to require this key',
      '3. Set as Authorization: Bearer <key>',
    ],
    freeTrialAvailable: true,
    estimatedSetupTime: '2 minutes',
  },

  CUSTOM_IMAGE_URL: {
    name: 'CUSTOM_IMAGE_URL',
    category: 'ai',
    provider: 'Self-hosted',
    description: 'URL for self-hosted image generation (Stable Diffusion, etc.)',
    service: 'studio-api',
    documentationUrl: 'https://github.com/AUTOMATIC1111/stable-diffusion-webui',
    instructions: [
      '1. Deploy SD WebUI (Automatic1111) to Railway/RunPod',
      '2. Enable --api flag in launch arguments',
      '3. Get the deployed URL',
      '4. Test with /sdapi/v1/txt2img endpoint',
    ],
    freeTrialAvailable: true,
    estimatedSetupTime: '45 minutes',
  },

  CUSTOM_IMAGE_API_KEY: {
    name: 'CUSTOM_IMAGE_API_KEY',
    category: 'ai',
    provider: 'Self-hosted',
    description: 'API key for self-hosted image generation (if required)',
    service: 'studio-api',
    documentationUrl: 'https://github.com/AUTOMATIC1111/stable-diffusion-webui',
    instructions: [
      '1. Configure authentication on your SD server',
      '2. Generate a secure API key',
      '3. Add to your deployment environment',
    ],
    freeTrialAvailable: true,
    estimatedSetupTime: '5 minutes',
  },

  // ========== BUSINESS INTEGRATIONS ==========
  STRIPE_SECRET_KEY: {
    name: 'STRIPE_SECRET_KEY',
    category: 'payment',
    provider: 'Stripe',
    description: 'Stripe secret key for payment processing',
    service: 'studio-api',
    documentationUrl: 'https://dashboard.stripe.com/apikeys',
    instructions: [
      '1. Go to https://dashboard.stripe.com/apikeys',
      '2. Sign up or log in to Stripe',
      '3. Toggle "Test mode" for development keys',
      '4. Copy the "Secret key" (starts with sk_test_ or sk_live_)',
      '5. Never expose this key in client-side code!',
    ],
    freeTrialAvailable: true,
    estimatedSetupTime: '5 minutes',
  },

  STRIPE_PUBLISHABLE_KEY: {
    name: 'STRIPE_PUBLISHABLE_KEY',
    category: 'payment',
    provider: 'Stripe',
    description: 'Stripe publishable key for client-side',
    service: 'tatlife-app',
    documentationUrl: 'https://dashboard.stripe.com/apikeys',
    instructions: [
      '1. Go to https://dashboard.stripe.com/apikeys',
      '2. Copy the "Publishable key" (starts with pk_test_ or pk_live_)',
      '3. This key is safe to include in client apps',
    ],
    freeTrialAvailable: true,
    estimatedSetupTime: '1 minute',
  },

  SENDGRID_API_KEY: {
    name: 'SENDGRID_API_KEY',
    category: 'api',
    provider: 'SendGrid',
    description: 'SendGrid API key for transactional emails',
    service: 'studio-api',
    documentationUrl: 'https://app.sendgrid.com/settings/api_keys',
    instructions: [
      '1. Go to https://app.sendgrid.com/settings/api_keys',
      '2. Sign up for a free account (100 emails/day free)',
      '3. Click "Create API Key"',
      '4. Select "Full Access" or "Restricted Access" with Mail Send',
      '5. Copy the key (only shown once!)',
    ],
    freeTrialAvailable: true,
    estimatedSetupTime: '5 minutes',
  },

  TWILIO_ACCOUNT_SID: {
    name: 'TWILIO_ACCOUNT_SID',
    category: 'api',
    provider: 'Twilio',
    description: 'Twilio Account SID for SMS notifications',
    service: 'studio-api',
    documentationUrl: 'https://console.twilio.com/',
    instructions: [
      '1. Go to https://console.twilio.com/',
      '2. Sign up for a free trial',
      '3. Find Account SID on the dashboard',
      '4. Copy the Account SID (starts with AC)',
    ],
    freeTrialAvailable: true,
    estimatedSetupTime: '5 minutes',
  },

  TWILIO_AUTH_TOKEN: {
    name: 'TWILIO_AUTH_TOKEN',
    category: 'api',
    provider: 'Twilio',
    description: 'Twilio Auth Token for SMS authentication',
    service: 'studio-api',
    documentationUrl: 'https://console.twilio.com/',
    instructions: [
      '1. Go to your Twilio dashboard',
      '2. Click "Show" next to Auth Token',
      '3. Copy the Auth Token',
    ],
    freeTrialAvailable: true,
    estimatedSetupTime: '1 minute',
  },
};
