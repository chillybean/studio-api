/**
 * Gallery Routes
 * 
 * Studio portfolio/gallery management
 */

import { Router, Request, Response } from 'express';
import { getFirestore, getStorage } from '../config/firebase';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

const router = Router();
const db = () => getFirestore();

// Validation schemas
const galleryItemSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  imageUrl: z.string().url(),
  thumbnailUrl: z.string().url().optional(),
  style: z.string().optional(),
  placement: z.string().optional(),
  artistId: z.string().optional(),
  artistName: z.string().optional(),
  customerId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  isFeatured: z.boolean().optional(),
  isPublic: z.boolean().optional(),
});

/**
 * GET /api/gallery
 * Get gallery items for a studio
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const studioId = req.headers['x-studio-id'] as string;
    if (!studioId) {
      return res.status(400).json({ error: 'Studio ID is required' });
    }

    const { style, artistId, featured, limit = '50', offset = '0' } = req.query;

    let query: any = db()
      .collection('studios')
      .doc(studioId)
      .collection('gallery')
      .orderBy('createdAt', 'desc')
      .limit(parseInt(limit as string));

    const snapshot = await query.get();
    
    let items = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    // Client-side filters
    if (style) {
      items = items.filter(i => i.style === style);
    }
    if (artistId) {
      items = items.filter(i => i.artistId === artistId);
    }
    if (featured === 'true') {
      items = items.filter(i => i.isFeatured === true);
    }

    res.json({
      success: true,
      items,
      total: items.length,
    });

  } catch (error: any) {
    console.error('List Gallery Error:', error);
    res.status(500).json({ error: 'Failed to list gallery', message: error.message });
  }
});

/**
 * GET /api/gallery/public/:studioId
 * Get public gallery for a studio (no auth required)
 */
router.get('/public/:studioId', async (req: Request, res: Response) => {
  try {
    const { studioId } = req.params;
    const { limit = '20' } = req.query;

    const snapshot = await db()
      .collection('studios')
      .doc(studioId)
      .collection('gallery')
      .where('isPublic', '==', true)
      .orderBy('createdAt', 'desc')
      .limit(parseInt(limit as string))
      .get();

    const items = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json({
      success: true,
      items,
      total: items.length,
    });

  } catch (error: any) {
    console.error('Public Gallery Error:', error);
    res.status(500).json({ error: 'Failed to get gallery', message: error.message });
  }
});

/**
 * POST /api/gallery
 * Add item to gallery
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const studioId = req.headers['x-studio-id'] as string;
    if (!studioId) {
      return res.status(400).json({ error: 'Studio ID is required' });
    }

    const validation = galleryItemSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Invalid input', 
        details: validation.error.errors 
      });
    }

    const itemId = uuidv4();
    const now = new Date().toISOString();

    const itemData = {
      ...validation.data,
      id: itemId,
      studioId,
      isPublic: validation.data.isPublic ?? true,
      isFeatured: validation.data.isFeatured ?? false,
      createdAt: now,
      updatedAt: now,
    };

    await db()
      .collection('studios')
      .doc(studioId)
      .collection('gallery')
      .doc(itemId)
      .set(itemData);

    res.status(201).json({
      success: true,
      item: itemData,
    });

  } catch (error: any) {
    console.error('Add Gallery Item Error:', error);
    res.status(500).json({ error: 'Failed to add item', message: error.message });
  }
});

/**
 * PUT /api/gallery/:id
 * Update gallery item
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const studioId = req.headers['x-studio-id'] as string;
    if (!studioId) {
      return res.status(400).json({ error: 'Studio ID is required' });
    }

    const { id } = req.params;

    const validation = galleryItemSchema.partial().safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Invalid input', 
        details: validation.error.errors 
      });
    }

    const itemRef = db()
      .collection('studios')
      .doc(studioId)
      .collection('gallery')
      .doc(id);

    const itemDoc = await itemRef.get();
    if (!itemDoc.exists) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const updateData = {
      ...validation.data,
      updatedAt: new Date().toISOString(),
    };

    await itemRef.update(updateData);

    res.json({
      success: true,
      item: {
        id,
        ...itemDoc.data(),
        ...updateData,
      }
    });

  } catch (error: any) {
    console.error('Update Gallery Item Error:', error);
    res.status(500).json({ error: 'Failed to update item', message: error.message });
  }
});

/**
 * DELETE /api/gallery/:id
 * Delete gallery item
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const studioId = req.headers['x-studio-id'] as string;
    if (!studioId) {
      return res.status(400).json({ error: 'Studio ID is required' });
    }

    const { id } = req.params;

    const itemRef = db()
      .collection('studios')
      .doc(studioId)
      .collection('gallery')
      .doc(id);

    const itemDoc = await itemRef.get();
    if (!itemDoc.exists) {
      return res.status(404).json({ error: 'Item not found' });
    }

    await itemRef.delete();

    res.json({
      success: true,
      message: 'Item deleted successfully',
    });

  } catch (error: any) {
    console.error('Delete Gallery Item Error:', error);
    res.status(500).json({ error: 'Failed to delete item', message: error.message });
  }
});

/**
 * POST /api/gallery/:id/feature
 * Toggle featured status
 */
router.post('/:id/feature', async (req: Request, res: Response) => {
  try {
    const studioId = req.headers['x-studio-id'] as string;
    if (!studioId) {
      return res.status(400).json({ error: 'Studio ID is required' });
    }

    const { id } = req.params;
    const { featured } = req.body;

    const itemRef = db()
      .collection('studios')
      .doc(studioId)
      .collection('gallery')
      .doc(id);

    await itemRef.update({
      isFeatured: featured === true,
      updatedAt: new Date().toISOString(),
    });

    res.json({
      success: true,
      isFeatured: featured === true,
    });

  } catch (error: any) {
    console.error('Feature Item Error:', error);
    res.status(500).json({ error: 'Failed to update item', message: error.message });
  }
});

/**
 * GET /api/gallery/styles
 * Get all unique styles in gallery
 */
router.get('/styles/list', async (req: Request, res: Response) => {
  try {
    const studioId = req.headers['x-studio-id'] as string;
    if (!studioId) {
      return res.status(400).json({ error: 'Studio ID is required' });
    }

    const snapshot = await db()
      .collection('studios')
      .doc(studioId)
      .collection('gallery')
      .get();

    const styles = new Set<string>();
    snapshot.docs.forEach(doc => {
      const style = doc.data().style;
      if (style) styles.add(style);
    });

    res.json({
      success: true,
      styles: Array.from(styles).sort(),
    });

  } catch (error: any) {
    console.error('Get Styles Error:', error);
    res.status(500).json({ error: 'Failed to get styles', message: error.message });
  }
});

export default router;
