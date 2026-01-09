/**
 * Settings Routes
 * 
 * Studio settings and configuration
 */

import { Router, Request, Response } from 'express';
import { getFirestore } from '../config/firebase';
import { z } from 'zod';

const router = Router();
const db = () => getFirestore();

// Validation schemas
const settingsSchema = z.object({
  // Business Info
  businessName: z.string().optional(),
  businessEmail: z.string().email().optional(),
  businessPhone: z.string().optional(),
  businessAddress: z.string().optional(),
  businessDescription: z.string().optional(),
  logoUrl: z.string().url().optional(),
  coverImageUrl: z.string().url().optional(),
  website: z.string().url().optional(),
  
  // Social Media
  socialMedia: z.object({
    instagram: z.string().optional(),
    facebook: z.string().optional(),
    twitter: z.string().optional(),
    tiktok: z.string().optional(),
  }).optional(),
  
  // Working Hours
  workingHours: z.object({
    monday: z.object({ open: z.string(), close: z.string(), closed: z.boolean().optional() }).optional(),
    tuesday: z.object({ open: z.string(), close: z.string(), closed: z.boolean().optional() }).optional(),
    wednesday: z.object({ open: z.string(), close: z.string(), closed: z.boolean().optional() }).optional(),
    thursday: z.object({ open: z.string(), close: z.string(), closed: z.boolean().optional() }).optional(),
    friday: z.object({ open: z.string(), close: z.string(), closed: z.boolean().optional() }).optional(),
    saturday: z.object({ open: z.string(), close: z.string(), closed: z.boolean().optional() }).optional(),
    sunday: z.object({ open: z.string(), close: z.string(), closed: z.boolean().optional() }).optional(),
  }).optional(),
  
  // Booking Settings
  bookingSettings: z.object({
    allowOnlineBooking: z.boolean().optional(),
    requireDeposit: z.boolean().optional(),
    defaultDepositPercentage: z.number().min(0).max(100).optional(),
    minAdvanceBookingHours: z.number().min(0).optional(),
    maxAdvanceBookingDays: z.number().min(1).optional(),
    appointmentBuffer: z.number().min(0).optional(), // minutes between appointments
    cancellationPolicy: z.string().optional(),
    confirmationRequired: z.boolean().optional(),
  }).optional(),
  
  // Notification Settings
  notifications: z.object({
    emailReminders: z.boolean().optional(),
    smsReminders: z.boolean().optional(),
    reminderHoursBefore: z.number().optional(),
    sendConfirmationEmail: z.boolean().optional(),
  }).optional(),
  
  // AI Settings
  aiSettings: z.object({
    enabled: z.boolean().optional(),
    geminiApiKey: z.string().optional(), // Encrypted
  }).optional(),
  
  // Display Preferences
  displayPreferences: z.object({
    theme: z.enum(['light', 'dark', 'auto']).optional(),
    language: z.string().optional(),
    timezone: z.string().optional(),
    currency: z.string().optional(),
    dateFormat: z.string().optional(),
  }).optional(),
});

/**
 * GET /api/settings
 * Get studio settings
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const studioId = req.headers['x-studio-id'] as string;
    if (!studioId) {
      return res.status(400).json({ error: 'Studio ID is required' });
    }

    const settingsDoc = await db()
      .collection('studios')
      .doc(studioId)
      .get();

    const settings = settingsDoc.exists ? settingsDoc.data() : {};

    // Remove sensitive data
    if (settings?.aiSettings?.geminiApiKey) {
      settings.aiSettings.geminiApiKey = '***configured***';
    }

    res.json({
      success: true,
      settings: {
        id: studioId,
        ...settings,
      }
    });

  } catch (error: any) {
    console.error('Get Settings Error:', error);
    res.status(500).json({ error: 'Failed to get settings', message: error.message });
  }
});

/**
 * PUT /api/settings
 * Update studio settings
 */
router.put('/', async (req: Request, res: Response) => {
  try {
    const studioId = req.headers['x-studio-id'] as string;
    if (!studioId) {
      return res.status(400).json({ error: 'Studio ID is required' });
    }

    const validation = settingsSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Invalid input', 
        details: validation.error.errors 
      });
    }

    const updateData = {
      ...validation.data,
      updatedAt: new Date().toISOString(),
    };

    await db()
      .collection('studios')
      .doc(studioId)
      .set(updateData, { merge: true });

    // Remove sensitive data from response
    if (updateData.aiSettings?.geminiApiKey) {
      updateData.aiSettings.geminiApiKey = '***configured***';
    }

    res.json({
      success: true,
      settings: {
        id: studioId,
        ...updateData,
      }
    });

  } catch (error: any) {
    console.error('Update Settings Error:', error);
    res.status(500).json({ error: 'Failed to update settings', message: error.message });
  }
});

/**
 * GET /api/settings/public/:studioId
 * Get public studio info (no auth required)
 */
router.get('/public/:studioId', async (req: Request, res: Response) => {
  try {
    const { studioId } = req.params;

    const settingsDoc = await db()
      .collection('studios')
      .doc(studioId)
      .get();

    if (!settingsDoc.exists) {
      return res.status(404).json({ error: 'Studio not found' });
    }

    const settings = settingsDoc.data() || {};

    // Return only public information
    res.json({
      success: true,
      studio: {
        id: studioId,
        businessName: settings.businessName,
        businessDescription: settings.businessDescription,
        businessPhone: settings.businessPhone,
        businessAddress: settings.businessAddress,
        logoUrl: settings.logoUrl,
        coverImageUrl: settings.coverImageUrl,
        website: settings.website,
        socialMedia: settings.socialMedia,
        workingHours: settings.workingHours,
        allowOnlineBooking: settings.bookingSettings?.allowOnlineBooking,
      }
    });

  } catch (error: any) {
    console.error('Get Public Settings Error:', error);
    res.status(500).json({ error: 'Failed to get studio info', message: error.message });
  }
});

/**
 * POST /api/settings/working-hours
 * Update working hours specifically
 */
router.post('/working-hours', async (req: Request, res: Response) => {
  try {
    const studioId = req.headers['x-studio-id'] as string;
    if (!studioId) {
      return res.status(400).json({ error: 'Studio ID is required' });
    }

    const { workingHours } = req.body;

    await db()
      .collection('studios')
      .doc(studioId)
      .set({
        workingHours,
        updatedAt: new Date().toISOString(),
      }, { merge: true });

    res.json({
      success: true,
      workingHours,
    });

  } catch (error: any) {
    console.error('Update Working Hours Error:', error);
    res.status(500).json({ error: 'Failed to update working hours', message: error.message });
  }
});

/**
 * POST /api/settings/booking
 * Update booking settings specifically
 */
router.post('/booking', async (req: Request, res: Response) => {
  try {
    const studioId = req.headers['x-studio-id'] as string;
    if (!studioId) {
      return res.status(400).json({ error: 'Studio ID is required' });
    }

    const { bookingSettings } = req.body;

    await db()
      .collection('studios')
      .doc(studioId)
      .set({
        bookingSettings,
        updatedAt: new Date().toISOString(),
      }, { merge: true });

    res.json({
      success: true,
      bookingSettings,
    });

  } catch (error: any) {
    console.error('Update Booking Settings Error:', error);
    res.status(500).json({ error: 'Failed to update booking settings', message: error.message });
  }
});

/**
 * POST /api/settings/ai-key
 * Update AI API key (encrypted storage)
 */
router.post('/ai-key', async (req: Request, res: Response) => {
  try {
    const studioId = req.headers['x-studio-id'] as string;
    if (!studioId) {
      return res.status(400).json({ error: 'Studio ID is required' });
    }

    const { geminiApiKey } = req.body;

    if (!geminiApiKey) {
      return res.status(400).json({ error: 'API key is required' });
    }

    // In production, encrypt this before storing
    await db()
      .collection('studios')
      .doc(studioId)
      .set({
        aiSettings: {
          enabled: true,
          geminiApiKey, // Should be encrypted in production
          updatedAt: new Date().toISOString(),
        },
        updatedAt: new Date().toISOString(),
      }, { merge: true });

    res.json({
      success: true,
      message: 'AI API key updated successfully',
    });

  } catch (error: any) {
    console.error('Update AI Key Error:', error);
    res.status(500).json({ error: 'Failed to update AI key', message: error.message });
  }
});

/**
 * GET /api/settings/artists
 * Get artists for the studio
 */
router.get('/artists', async (req: Request, res: Response) => {
  try {
    const studioId = req.headers['x-studio-id'] as string;
    if (!studioId) {
      return res.status(400).json({ error: 'Studio ID is required' });
    }

    const snapshot = await db()
      .collection('studios')
      .doc(studioId)
      .collection('artists')
      .get();

    const artists = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json({
      success: true,
      artists,
    });

  } catch (error: any) {
    console.error('Get Artists Error:', error);
    res.status(500).json({ error: 'Failed to get artists', message: error.message });
  }
});

export default router;
