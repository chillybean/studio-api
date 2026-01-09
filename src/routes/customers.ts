/**
 * Customer CRM Routes
 * 
 * Ported from Tattoo Workshop - Customer management for tattoo studios
 */

import { Router, Request, Response } from 'express';
import { getFirestore } from '../config/firebase';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

const router = Router();
const db = () => getFirestore();

// Validation schemas
const customerSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  dateOfBirth: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  emergencyContact: z.string().optional().nullable(),
  emergencyPhone: z.string().optional().nullable(),
  allergies: z.string().optional().nullable(),
  medicalConditions: z.string().optional().nullable(),
  skinType: z.enum(['normal', 'sensitive', 'dry', 'oily']).optional().nullable(),
  preferredStyles: z.array(z.string()).optional(),
  notes: z.string().optional().nullable(),
  source: z.enum(['walk-in', 'referral', 'social-media', 'website', 'other']).optional(),
  tags: z.array(z.string()).optional(),
});

const updateCustomerSchema = customerSchema.partial();

/**
 * GET /api/customers
 * List all customers for a studio
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const studioId = req.headers['x-studio-id'] as string;
    if (!studioId) {
      return res.status(400).json({ error: 'Studio ID is required' });
    }

    const { search, limit = '50', offset = '0', sortBy = 'createdAt', sortOrder = 'desc' } = req.query;

    let query = db()
      .collection('studios')
      .doc(studioId)
      .collection('customers')
      .orderBy(sortBy as string, sortOrder === 'asc' ? 'asc' : 'desc')
      .limit(parseInt(limit as string));

    const snapshot = await query.get();
    
    let customers = snapshot.docs.map((doc: any) => ({
      id: doc.id,
      ...doc.data()
    }));

    // Client-side search (Firestore doesn't support full-text search)
    if (search) {
      const searchLower = (search as string).toLowerCase();
      customers = customers.filter((c: any) => 
        c.name?.toLowerCase().includes(searchLower) ||
        c.email?.toLowerCase().includes(searchLower) ||
        c.phone?.includes(searchLower)
      );
    }

    res.json({
      success: true,
      customers,
      total: customers.length,
    });

  } catch (error: any) {
    console.error('List Customers Error:', error);
    res.status(500).json({ error: 'Failed to list customers', message: error.message });
  }
});

/**
 * GET /api/customers/:id
 * Get a single customer with their history
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const studioId = req.headers['x-studio-id'] as string;
    if (!studioId) {
      return res.status(400).json({ error: 'Studio ID is required' });
    }

    const { id } = req.params;

    const customerDoc = await db()
      .collection('studios')
      .doc(studioId)
      .collection('customers')
      .doc(id)
      .get();

    if (!customerDoc.exists) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    // Get customer's appointment history
    const appointmentsSnapshot = await db()
      .collection('studios')
      .doc(studioId)
      .collection('appointments')
      .where('customerId', '==', id)
      .orderBy('date', 'desc')
      .limit(20)
      .get();

    const appointments = appointmentsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    // Get customer's gallery items (tattoos done)
    const gallerySnapshot = await db()
      .collection('studios')
      .doc(studioId)
      .collection('gallery')
      .where('customerId', '==', id)
      .limit(20)
      .get();

    const gallery = gallerySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json({
      success: true,
      customer: {
        id: customerDoc.id,
        ...customerDoc.data(),
        appointments,
        gallery,
        stats: {
          totalAppointments: appointments.length,
          totalTattoos: gallery.length,
          totalSpent: appointments.reduce((sum, apt: any) => sum + (apt.price || 0), 0),
        }
      }
    });

  } catch (error: any) {
    console.error('Get Customer Error:', error);
    res.status(500).json({ error: 'Failed to get customer', message: error.message });
  }
});

/**
 * POST /api/customers
 * Create a new customer
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const studioId = req.headers['x-studio-id'] as string;
    if (!studioId) {
      return res.status(400).json({ error: 'Studio ID is required' });
    }

    const validation = customerSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Invalid input', 
        details: validation.error.errors 
      });
    }

    const customerId = uuidv4();
    const now = new Date().toISOString();

    const customerData = {
      ...validation.data,
      id: customerId,
      studioId,
      createdAt: now,
      updatedAt: now,
      appointmentCount: 0,
      totalSpent: 0,
      lastVisit: null,
      status: 'active',
    };

    await db()
      .collection('studios')
      .doc(studioId)
      .collection('customers')
      .doc(customerId)
      .set(customerData);

    res.status(201).json({
      success: true,
      customer: customerData,
    });

  } catch (error: any) {
    console.error('Create Customer Error:', error);
    res.status(500).json({ error: 'Failed to create customer', message: error.message });
  }
});

/**
 * PUT /api/customers/:id
 * Update a customer
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const studioId = req.headers['x-studio-id'] as string;
    if (!studioId) {
      return res.status(400).json({ error: 'Studio ID is required' });
    }

    const { id } = req.params;

    const validation = updateCustomerSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Invalid input', 
        details: validation.error.errors 
      });
    }

    const customerRef = db()
      .collection('studios')
      .doc(studioId)
      .collection('customers')
      .doc(id);

    const customerDoc = await customerRef.get();
    if (!customerDoc.exists) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const updateData = {
      ...validation.data,
      updatedAt: new Date().toISOString(),
    };

    await customerRef.update(updateData);

    res.json({
      success: true,
      customer: {
        id,
        ...customerDoc.data(),
        ...updateData,
      }
    });

  } catch (error: any) {
    console.error('Update Customer Error:', error);
    res.status(500).json({ error: 'Failed to update customer', message: error.message });
  }
});

/**
 * DELETE /api/customers/:id
 * Delete a customer (soft delete)
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const studioId = req.headers['x-studio-id'] as string;
    if (!studioId) {
      return res.status(400).json({ error: 'Studio ID is required' });
    }

    const { id } = req.params;
    const { hard } = req.query;

    const customerRef = db()
      .collection('studios')
      .doc(studioId)
      .collection('customers')
      .doc(id);

    const customerDoc = await customerRef.get();
    if (!customerDoc.exists) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    if (hard === 'true') {
      // Hard delete
      await customerRef.delete();
    } else {
      // Soft delete
      await customerRef.update({
        status: 'deleted',
        deletedAt: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      message: 'Customer deleted successfully',
    });

  } catch (error: any) {
    console.error('Delete Customer Error:', error);
    res.status(500).json({ error: 'Failed to delete customer', message: error.message });
  }
});

/**
 * POST /api/customers/:id/notes
 * Add a note to a customer
 */
router.post('/:id/notes', async (req: Request, res: Response) => {
  try {
    const studioId = req.headers['x-studio-id'] as string;
    if (!studioId) {
      return res.status(400).json({ error: 'Studio ID is required' });
    }

    const { id } = req.params;
    const { note, type = 'general' } = req.body;

    if (!note) {
      return res.status(400).json({ error: 'Note content is required' });
    }

    const noteId = uuidv4();
    const noteData = {
      id: noteId,
      customerId: id,
      content: note,
      type,
      createdAt: new Date().toISOString(),
      createdBy: req.headers['x-user-id'] || 'system',
    };

    await db()
      .collection('studios')
      .doc(studioId)
      .collection('customers')
      .doc(id)
      .collection('notes')
      .doc(noteId)
      .set(noteData);

    res.status(201).json({
      success: true,
      note: noteData,
    });

  } catch (error: any) {
    console.error('Add Note Error:', error);
    res.status(500).json({ error: 'Failed to add note', message: error.message });
  }
});

/**
 * GET /api/customers/stats/overview
 * Get customer statistics for the studio
 */
router.get('/stats/overview', async (req: Request, res: Response) => {
  try {
    const studioId = req.headers['x-studio-id'] as string;
    if (!studioId) {
      return res.status(400).json({ error: 'Studio ID is required' });
    }

    const customersSnapshot = await db()
      .collection('studios')
      .doc(studioId)
      .collection('customers')
      .where('status', '==', 'active')
      .get();

    const customers = customersSnapshot.docs.map(doc => doc.data());

    // Calculate stats
    const totalCustomers = customers.length;
    const newThisMonth = customers.filter(c => {
      const createdAt = new Date(c.createdAt);
      const now = new Date();
      return createdAt.getMonth() === now.getMonth() && 
             createdAt.getFullYear() === now.getFullYear();
    }).length;

    const totalRevenue = customers.reduce((sum, c) => sum + (c.totalSpent || 0), 0);
    const avgSpend = totalCustomers > 0 ? totalRevenue / totalCustomers : 0;

    // Source breakdown
    const sourceBreakdown: Record<string, number> = {};
    customers.forEach(c => {
      const source = c.source || 'unknown';
      sourceBreakdown[source] = (sourceBreakdown[source] || 0) + 1;
    });

    res.json({
      success: true,
      stats: {
        totalCustomers,
        newThisMonth,
        totalRevenue,
        avgSpend,
        sourceBreakdown,
      }
    });

  } catch (error: any) {
    console.error('Customer Stats Error:', error);
    res.status(500).json({ error: 'Failed to get stats', message: error.message });
  }
});

export default router;
