/**
 * Secrets Management Routes
 * 
 * Admin API for managing API keys and secrets
 * Requires admin authentication
 */

import { Router, Request, Response } from 'express';
import { 
  getSecret, 
  setSecret, 
  deleteSecret, 
  rotateSecret,
  listSecrets, 
  getSecretMetadata,
  validateSecrets,
  SecretTemplates,
  SecretMetadata
} from '../config/secrets';
import { getFirestore } from '../config/firebase';

const router = Router();

/**
 * Middleware to verify admin access
 */
async function requireAdmin(req: Request, res: Response, next: Function) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  
  try {
    // Verify the token and check admin status
    const { getAuth } = await import('firebase-admin/auth');
    const decodedToken = await getAuth().verifyIdToken(token);
    
    // Check if user is admin
    const db = getFirestore();
    const userDoc = await db.collection('users').doc(decodedToken.uid).get();
    const userData = userDoc.data();
    
    if (!userData?.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    (req as any).adminUser = {
      uid: decodedToken.uid,
      email: decodedToken.email,
    };

    next();
  } catch (error: any) {
    return res.status(401).json({ error: 'Invalid token', message: error.message });
  }
}

/**
 * GET /api/secrets
 * List all secrets metadata (not values)
 */
router.get('/', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { category, service } = req.query;
    
    let secrets = await listSecrets();

    // Filter by category or service
    if (category) {
      secrets = secrets.filter((s: SecretMetadata) => s.category === category);
    }
    if (service) {
      secrets = secrets.filter((s: SecretMetadata) => s.service === service);
    }

    // Group by category
    const grouped: Record<string, SecretMetadata[]> = {};
    secrets.forEach((secret: SecretMetadata) => {
      const cat = secret.category || 'other';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(secret);
    });

    res.json({
      success: true,
      secrets,
      grouped,
      total: secrets.length,
    });
  } catch (error: any) {
    console.error('List Secrets Error:', error);
    res.status(500).json({ error: 'Failed to list secrets', message: error.message });
  }
});

/**
 * GET /api/secrets/:name
 * Get secret metadata (not value)
 */
router.get('/:name', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const metadata = await getSecretMetadata(name);

    if (!metadata) {
      return res.status(404).json({ error: 'Secret not found' });
    }

    res.json({
      success: true,
      secret: metadata,
    });
  } catch (error: any) {
    console.error('Get Secret Metadata Error:', error);
    res.status(500).json({ error: 'Failed to get secret', message: error.message });
  }
});

/**
 * POST /api/secrets
 * Create a new secret
 */
router.post('/', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { name, value, description, category, service, provider, expiresAt } = req.body;

    if (!name || !value) {
      return res.status(400).json({ error: 'Name and value are required' });
    }

    // Validate name format (uppercase, underscores)
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
      return res.status(400).json({ 
        error: 'Invalid secret name format. Use UPPERCASE_WITH_UNDERSCORES' 
      });
    }

    const success = await setSecret(name, value, {
      name,
      description,
      category: category || 'other',
      service: service || 'studio-api',
      provider: provider || 'Custom',
      expiresAt,
      createdAt: new Date().toISOString(),
    });

    if (!success) {
      return res.status(500).json({ error: 'Failed to create secret' });
    }

    // Log the action
    const db = getFirestore();
    await db.collection('secrets_audit_log').add({
      action: 'create',
      secretName: name,
      performedBy: (req as any).adminUser.email,
      timestamp: new Date().toISOString(),
    });

    res.status(201).json({
      success: true,
      message: `Secret ${name} created successfully`,
    });
  } catch (error: any) {
    console.error('Create Secret Error:', error);
    res.status(500).json({ error: 'Failed to create secret', message: error.message });
  }
});

/**
 * PUT /api/secrets/:name
 * Update a secret value (rotate)
 */
router.put('/:name', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const { value, description, expiresAt } = req.body;

    if (!value) {
      return res.status(400).json({ error: 'Value is required' });
    }

    // Check if secret exists
    const existing = await getSecretMetadata(name);
    if (!existing) {
      return res.status(404).json({ error: 'Secret not found' });
    }

    const success = await rotateSecret(name, value);

    if (!success) {
      return res.status(500).json({ error: 'Failed to update secret' });
    }

    // Update metadata if provided
    if (description || expiresAt) {
      const db = getFirestore();
      await db.collection('secrets_metadata').doc(name).update({
        ...(description && { description }),
        ...(expiresAt && { expiresAt }),
        updatedAt: new Date().toISOString(),
      });
    }

    // Log the action
    const db = getFirestore();
    await db.collection('secrets_audit_log').add({
      action: 'rotate',
      secretName: name,
      performedBy: (req as any).adminUser.email,
      timestamp: new Date().toISOString(),
    });

    res.json({
      success: true,
      message: `Secret ${name} updated successfully`,
    });
  } catch (error: any) {
    console.error('Update Secret Error:', error);
    res.status(500).json({ error: 'Failed to update secret', message: error.message });
  }
});

/**
 * DELETE /api/secrets/:name
 * Delete a secret
 */
router.delete('/:name', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { name } = req.params;

    const success = await deleteSecret(name);

    if (!success) {
      return res.status(500).json({ error: 'Failed to delete secret' });
    }

    // Log the action
    const db = getFirestore();
    await db.collection('secrets_audit_log').add({
      action: 'delete',
      secretName: name,
      performedBy: (req as any).adminUser.email,
      timestamp: new Date().toISOString(),
    });

    res.json({
      success: true,
      message: `Secret ${name} deleted successfully`,
    });
  } catch (error: any) {
    console.error('Delete Secret Error:', error);
    res.status(500).json({ error: 'Failed to delete secret', message: error.message });
  }
});

/**
 * POST /api/secrets/validate
 * Validate that required secrets exist
 */
router.post('/validate', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { secrets } = req.body;

    if (!Array.isArray(secrets)) {
      return res.status(400).json({ error: 'Secrets must be an array' });
    }

    const result = await validateSecrets(secrets);

    res.json({
      success: true,
      valid: result.valid,
      missing: result.missing,
    });
  } catch (error: any) {
    console.error('Validate Secrets Error:', error);
    res.status(500).json({ error: 'Failed to validate secrets', message: error.message });
  }
});

/**
 * GET /api/secrets/templates
 * Get predefined secret templates
 */
router.get('/templates/all', requireAdmin, async (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      templates: SecretTemplates,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get templates', message: error.message });
  }
});

/**
 * GET /api/secrets/audit-log
 * Get secrets audit log
 */
router.get('/audit/log', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { limit = 50 } = req.query;

    const db = getFirestore();
    const snapshot = await db.collection('secrets_audit_log')
      .orderBy('timestamp', 'desc')
      .limit(parseInt(limit as string))
      .get();

    const logs = snapshot.docs.map((doc: any) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.json({
      success: true,
      logs,
    });
  } catch (error: any) {
    console.error('Get Audit Log Error:', error);
    res.status(500).json({ error: 'Failed to get audit log', message: error.message });
  }
});

/**
 * GET /api/secrets/usage
 * Get secrets usage statistics
 */
router.get('/stats/usage', requireAdmin, async (req: Request, res: Response) => {
  try {
    const secrets = await listSecrets();

    const stats = {
      total: secrets.length,
      byCategory: {} as Record<string, number>,
      byProvider: {} as Record<string, number>,
      expiringSoon: [] as SecretMetadata[],
      neverUsed: [] as SecretMetadata[],
      mostUsed: [] as SecretMetadata[],
    };

    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    secrets.forEach((secret: SecretMetadata) => {
      // Count by category
      stats.byCategory[secret.category] = (stats.byCategory[secret.category] || 0) + 1;
      
      // Count by provider
      stats.byProvider[secret.provider] = (stats.byProvider[secret.provider] || 0) + 1;

      // Check expiring soon
      if (secret.expiresAt && new Date(secret.expiresAt) < thirtyDaysFromNow) {
        stats.expiringSoon.push(secret);
      }

      // Check never used
      if (!secret.lastUsedAt) {
        stats.neverUsed.push(secret);
      }
    });

    // Sort by usage and get top 5
    stats.mostUsed = [...secrets]
      .filter((s: SecretMetadata) => s.usageCount)
      .sort((a: SecretMetadata, b: SecretMetadata) => (b.usageCount || 0) - (a.usageCount || 0))
      .slice(0, 5);

    res.json({
      success: true,
      stats,
    });
  } catch (error: any) {
    console.error('Get Usage Stats Error:', error);
    res.status(500).json({ error: 'Failed to get usage stats', message: error.message });
  }
});

export default router;
