/**
 * Pricelist Routes
 * 
 * Ported from Tattoo Workshop - Service/pricing management for tattoo studios
 */

import { Router, Request, Response } from 'express';
import { getFirestore } from '../config/firebase';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

const router = Router();
const db = () => getFirestore();

// Analytics threshold for "popular" services
const POPULAR_THRESHOLD = 10;

// Validation schemas
const serviceSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  category: z.enum(['tattoo', 'piercing', 'consultation', 'touch-up', 'cover-up', 'removal', 'other']),
  pricingType: z.enum(['fixed', 'hourly', 'custom', 'starting-at']),
  price: z.number().min(0).optional(),
  minPrice: z.number().min(0).optional(),
  maxPrice: z.number().min(0).optional(),
  hourlyRate: z.number().min(0).optional(),
  duration: z.number().min(15).optional(), // minutes
  depositRequired: z.boolean().optional(),
  depositAmount: z.number().min(0).optional(),
  depositPercentage: z.number().min(0).max(100).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().optional(),
  notes: z.string().optional(),
  artistIds: z.array(z.string()).optional(), // Artists who offer this service
});

/**
 * Compute analytics for a service from appointments
 */
async function computeServiceAnalytics(studioId: string, serviceId: string) {
  try {
    // Get all completed appointments for this service
    const appointmentsSnapshot = await db()
      .collection('studios')
      .doc(studioId)
      .collection('appointments')
      .where('serviceId', '==', serviceId)
      .where('status', '==', 'completed')
      .get();

    if (appointmentsSnapshot.empty) {
      return {
        bookingCount: 0,
        totalRevenue: 0,
        avgRating: null,
        lastBooked: null,
      };
    }

    const appointments = appointmentsSnapshot.docs.map(doc => doc.data());

    // Calculate stats
    const bookingCount = appointments.length;
    const totalRevenue = appointments.reduce((sum, apt) => {
      return sum + (apt.finalPrice || apt.estimatedPrice || apt.price || 0);
    }, 0);

    // Find last booked date
    const sortedByDate = appointments
      .map(apt => apt.completedAt || apt.date)
      .filter(date => date != null)
      .sort((a, b) => b.localeCompare(a));
    const lastBooked = sortedByDate[0] || null;

    // Get ratings from reviews (if available)
    let avgRating = null;
    try {
      const reviewsSnapshot = await db()
        .collection('studios')
        .doc(studioId)
        .collection('reviews')
        .where('serviceId', '==', serviceId)
        .get();

      if (!reviewsSnapshot.empty) {
        const ratings = reviewsSnapshot.docs
          .map(doc => doc.data().rating)
          .filter(r => typeof r === 'number' && r > 0);
        
        if (ratings.length > 0) {
          avgRating = ratings.reduce((sum, r) => sum + r, 0) / ratings.length;
        }
      }
    } catch (err) {
      // Reviews collection may not exist, silently continue
    }

    return {
      bookingCount,
      totalRevenue,
      avgRating,
      lastBooked,
    };
  } catch (error) {
    console.error(`Analytics computation error for service ${serviceId}:`, error);
    return {
      bookingCount: 0,
      totalRevenue: 0,
      avgRating: null,
      lastBooked: null,
    };
  }
}

/**
 * GET /api/pricelist
 * Get all services/prices for a studio
 * Query params:
 *   - includeAnalytics=true : Add booking stats and revenue data
 *   - category : Filter by category
 *   - activeOnly : true/false (default: true)
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const studioId = req.headers['x-studio-id'] as string;
    if (!studioId) {
      return res.status(400).json({ error: 'Studio ID is required' });
    }

    const { category, activeOnly = 'true', includeAnalytics = 'false' } = req.query;

    let query: any = db()
      .collection('studios')
      .doc(studioId)
      .collection('services')
      .orderBy('sortOrder', 'asc');

    const snapshot = await query.get();
    
    let services = snapshot.docs.map((doc: any) => ({
      id: doc.id,
      ...doc.data()
    }));

    // Add analytics if requested
    if (includeAnalytics === 'true') {
      const analyticsPromises = services.map(async (service: any) => {
        const analytics = await computeServiceAnalytics(studioId, service.id);
        return {
          ...service,
          ...analytics,
        };
      });
      services = await Promise.all(analyticsPromises);
    }

    // Filter
    if (category) {
      services = services.filter((s: any) => s.category === category);
    }
    if (activeOnly === 'true') {
      services = services.filter((s: any) => s.isActive !== false);
    }

    // Group by category
    const grouped: Record<string, any[]> = {};
    services.forEach((service: any) => {
      const cat = service.category || 'other';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(service);
    });

    res.json({
      success: true,
      services,
      grouped,
      total: services.length,
    });

  } catch (error: any) {
    console.error('List Pricelist Error:', error);
    res.status(500).json({ error: 'Failed to list services', message: error.message });
  }
});

/**
 * GET /api/pricelist/:id
 * Get a single service
 * Query params:
 *   - includeAnalytics=true : Add booking stats and revenue data
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const studioId = req.headers['x-studio-id'] as string;
    if (!studioId) {
      return res.status(400).json({ error: 'Studio ID is required' });
    }

    const { id } = req.params;
    const { includeAnalytics = 'false' } = req.query;

    const serviceDoc = await db()
      .collection('studios')
      .doc(studioId)
      .collection('services')
      .doc(id)
      .get();

    if (!serviceDoc.exists) {
      return res.status(404).json({ error: 'Service not found' });
    }

    let service = {
      id: serviceDoc.id,
      ...serviceDoc.data()
    };

    // Add analytics if requested
    if (includeAnalytics === 'true') {
      const analytics = await computeServiceAnalytics(studioId, id);
      service = { ...service, ...analytics };
    }

    res.json({
      success: true,
      service
    });

  } catch (error: any) {
    console.error('Get Service Error:', error);
    res.status(500).json({ error: 'Failed to get service', message: error.message });
  }
});

/**
 * GET /api/pricelist/:id/stats
 * Get detailed analytics for a service
 */
router.get('/:id/stats', async (req: Request, res: Response) => {
  try {
    const studioId = req.headers['x-studio-id'] as string;
    if (!studioId) {
      return res.status(400).json({ error: 'Studio ID is required' });
    }

    const { id } = req.params;

    // Verify service exists
    const serviceDoc = await db()
      .collection('studios')
      .doc(studioId)
      .collection('services')
      .doc(id)
      .get();

    if (!serviceDoc.exists) {
      return res.status(404).json({ error: 'Service not found' });
    }

    const service = serviceDoc.data();

    // Get all appointments for this service
    const appointmentsSnapshot = await db()
      .collection('studios')
      .doc(studioId)
      .collection('appointments')
      .where('serviceId', '==', id)
      .get();

    const appointments = appointmentsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    const completedAppointments = appointments.filter(apt => apt.status === 'completed');

    // Basic stats
    const bookingCount = completedAppointments.length;
    const totalRevenue = completedAppointments.reduce((sum, apt) => {
      return sum + (apt.finalPrice || apt.estimatedPrice || apt.price || 0);
    }, 0);

    // Recent bookings
    const recentBookings = completedAppointments
      .sort((a, b) => (b.completedAt || b.date).localeCompare(a.completedAt || a.date))
      .slice(0, 10)
      .map(apt => ({
        id: apt.id,
        customerName: apt.customerName || 'Unknown',
        date: apt.date,
        price: apt.finalPrice || apt.estimatedPrice || apt.price || 0,
        status: apt.status,
        completedAt: apt.completedAt,
      }));

    // Monthly stats (last 6 months)
    const now = new Date();
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, 1);
    
    const monthlyMap: Record<string, { bookings: number; revenue: number }> = {};
    completedAppointments.forEach(apt => {
      const date = apt.completedAt || apt.date;
      if (!date) return;
      
      const aptDate = new Date(date);
      if (aptDate < sixMonthsAgo) return;
      
      const monthKey = `${aptDate.getFullYear()}-${String(aptDate.getMonth() + 1).padStart(2, '0')}`;
      
      if (!monthlyMap[monthKey]) {
        monthlyMap[monthKey] = { bookings: 0, revenue: 0 };
      }
      
      monthlyMap[monthKey].bookings++;
      monthlyMap[monthKey].revenue += apt.finalPrice || apt.estimatedPrice || apt.price || 0;
    });

    const monthlyStats = Object.entries(monthlyMap)
      .map(([month, stats]) => ({ month, ...stats }))
      .sort((a, b) => a.month.localeCompare(b.month));

    // Ratings
    let avgRating = null;
    try {
      const reviewsSnapshot = await db()
        .collection('studios')
        .doc(studioId)
        .collection('reviews')
        .where('serviceId', '==', id)
        .get();

      if (!reviewsSnapshot.empty) {
        const ratings = reviewsSnapshot.docs
          .map(doc => doc.data().rating)
          .filter(r => typeof r === 'number' && r > 0);
        
        if (ratings.length > 0) {
          avgRating = ratings.reduce((sum, r) => sum + r, 0) / ratings.length;
        }
      }
    } catch (err) {
      // Reviews may not exist
    }

    const lastBooked = completedAppointments.length > 0
      ? completedAppointments[0].completedAt || completedAppointments[0].date
      : null;

    res.json({
      success: true,
      serviceId: id,
      serviceName: service?.name || 'Unknown',
      bookingCount,
      totalRevenue,
      avgRating,
      lastBooked,
      recentBookings,
      monthlyStats,
    });

  } catch (error: any) {
    console.error('Get Service Stats Error:', error);
    res.status(500).json({ error: 'Failed to get service stats', message: error.message });
  }
});

/**
 * POST /api/pricelist
 * Create a new service
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const studioId = req.headers['x-studio-id'] as string;
    if (!studioId) {
      return res.status(400).json({ error: 'Studio ID is required' });
    }

    const validation = serviceSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Invalid input', 
        details: validation.error.errors 
      });
    }

    const serviceId = uuidv4();
    const now = new Date().toISOString();

    // Get max sort order
    const existingServices = await db()
      .collection('studios')
      .doc(studioId)
      .collection('services')
      .orderBy('sortOrder', 'desc')
      .limit(1)
      .get();

    const maxOrder = existingServices.docs[0]?.data()?.sortOrder || 0;

    const serviceData = {
      ...validation.data,
      id: serviceId,
      studioId,
      isActive: validation.data.isActive ?? true,
      sortOrder: validation.data.sortOrder ?? maxOrder + 1,
      createdAt: now,
      updatedAt: now,
    };

    await db()
      .collection('studios')
      .doc(studioId)
      .collection('services')
      .doc(serviceId)
      .set(serviceData);

    res.status(201).json({
      success: true,
      service: serviceData,
    });

  } catch (error: any) {
    console.error('Create Service Error:', error);
    res.status(500).json({ error: 'Failed to create service', message: error.message });
  }
});

/**
 * PUT /api/pricelist/:id
 * Update a service
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const studioId = req.headers['x-studio-id'] as string;
    if (!studioId) {
      return res.status(400).json({ error: 'Studio ID is required' });
    }

    const { id } = req.params;

    const validation = serviceSchema.partial().safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Invalid input', 
        details: validation.error.errors 
      });
    }

    const serviceRef = db()
      .collection('studios')
      .doc(studioId)
      .collection('services')
      .doc(id);

    const serviceDoc = await serviceRef.get();
    if (!serviceDoc.exists) {
      return res.status(404).json({ error: 'Service not found' });
    }

    const updateData = {
      ...validation.data,
      updatedAt: new Date().toISOString(),
    };

    await serviceRef.update(updateData);

    res.json({
      success: true,
      service: {
        id,
        ...serviceDoc.data(),
        ...updateData,
      }
    });

  } catch (error: any) {
    console.error('Update Service Error:', error);
    res.status(500).json({ error: 'Failed to update service', message: error.message });
  }
});

/**
 * DELETE /api/pricelist/:id
 * Delete a service
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const studioId = req.headers['x-studio-id'] as string;
    if (!studioId) {
      return res.status(400).json({ error: 'Studio ID is required' });
    }

    const { id } = req.params;

    const serviceRef = db()
      .collection('studios')
      .doc(studioId)
      .collection('services')
      .doc(id);

    const serviceDoc = await serviceRef.get();
    if (!serviceDoc.exists) {
      return res.status(404).json({ error: 'Service not found' });
    }

    await serviceRef.delete();

    res.json({
      success: true,
      message: 'Service deleted successfully',
    });

  } catch (error: any) {
    console.error('Delete Service Error:', error);
    res.status(500).json({ error: 'Failed to delete service', message: error.message });
  }
});

/**
 * POST /api/pricelist/reorder
 * Reorder services
 */
router.post('/reorder', async (req: Request, res: Response) => {
  try {
    const studioId = req.headers['x-studio-id'] as string;
    if (!studioId) {
      return res.status(400).json({ error: 'Studio ID is required' });
    }

    const { serviceIds } = req.body;
    if (!Array.isArray(serviceIds)) {
      return res.status(400).json({ error: 'serviceIds array is required' });
    }

    const batch = db().batch();
    
    serviceIds.forEach((id: string, index: number) => {
      const ref = db()
        .collection('studios')
        .doc(studioId)
        .collection('services')
        .doc(id);
      batch.update(ref, { sortOrder: index, updatedAt: new Date().toISOString() });
    });

    await batch.commit();

    res.json({
      success: true,
      message: 'Services reordered successfully',
    });

  } catch (error: any) {
    console.error('Reorder Error:', error);
    res.status(500).json({ error: 'Failed to reorder services', message: error.message });
  }
});

/**
 * POST /api/pricelist/estimate
 * Calculate price estimate for a tattoo
 */
router.post('/estimate', async (req: Request, res: Response) => {
  try {
    const studioId = req.headers['x-studio-id'] as string;
    if (!studioId) {
      return res.status(400).json({ error: 'Studio ID is required' });
    }

    const { serviceId, size, complexity, colorwork, hours } = req.body;

    // Get service details
    const serviceDoc = await db()
      .collection('studios')
      .doc(studioId)
      .collection('services')
      .doc(serviceId)
      .get();

    if (!serviceDoc.exists) {
      return res.status(404).json({ error: 'Service not found' });
    }

    const service = serviceDoc.data()!;

    let estimate = {
      basePrice: 0,
      adjustments: [] as { reason: string; amount: number }[],
      total: 0,
      depositRequired: service.depositRequired || false,
      depositAmount: 0,
    };

    if (service.pricingType === 'fixed') {
      estimate.basePrice = service.price || 0;
    } else if (service.pricingType === 'hourly') {
      const estHours = hours || 1;
      estimate.basePrice = (service.hourlyRate || 0) * estHours;
      estimate.adjustments.push({ reason: `${estHours} hours @ $${service.hourlyRate}/hr`, amount: 0 });
    } else if (service.pricingType === 'starting-at') {
      estimate.basePrice = service.minPrice || 0;
    }

    // Size adjustments
    if (size === 'large') {
      const adj = estimate.basePrice * 0.5;
      estimate.adjustments.push({ reason: 'Large size (+50%)', amount: adj });
      estimate.basePrice += adj;
    } else if (size === 'extra-large') {
      const adj = estimate.basePrice;
      estimate.adjustments.push({ reason: 'Extra large size (+100%)', amount: adj });
      estimate.basePrice += adj;
    }

    // Complexity adjustments
    if (complexity === 'high') {
      const adj = estimate.basePrice * 0.3;
      estimate.adjustments.push({ reason: 'High complexity (+30%)', amount: adj });
      estimate.basePrice += adj;
    }

    // Color adjustments
    if (colorwork === 'full-color') {
      const adj = estimate.basePrice * 0.25;
      estimate.adjustments.push({ reason: 'Full color (+25%)', amount: adj });
      estimate.basePrice += adj;
    }

    estimate.total = Math.round(estimate.basePrice);

    // Calculate deposit
    if (estimate.depositRequired) {
      if (service.depositAmount) {
        estimate.depositAmount = service.depositAmount;
      } else if (service.depositPercentage) {
        estimate.depositAmount = Math.round(estimate.total * (service.depositPercentage / 100));
      } else {
        estimate.depositAmount = Math.round(estimate.total * 0.2); // Default 20%
      }
    }

    res.json({
      success: true,
      estimate,
      service: {
        id: serviceDoc.id,
        name: service.name,
        pricingType: service.pricingType,
      }
    });

  } catch (error: any) {
    console.error('Estimate Error:', error);
    res.status(500).json({ error: 'Failed to calculate estimate', message: error.message });
  }
});

export default router;
