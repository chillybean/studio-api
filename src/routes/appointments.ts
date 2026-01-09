/**
 * Appointments Routes
 * 
 * Ported from Tattoo Workshop - Appointment/booking management for tattoo studios
 */

import { Router, Request, Response } from 'express';
import { getFirestore } from '../config/firebase';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

const router = Router();
const db = () => getFirestore();

// Validation schemas
const appointmentSchema = z.object({
  customerId: z.string().min(1, 'Customer ID is required'),
  customerName: z.string().optional(),
  artistId: z.string().optional(),
  artistName: z.string().optional(),
  date: z.string().min(1, 'Date is required'),
  startTime: z.string().min(1, 'Start time is required'),
  endTime: z.string().optional(),
  duration: z.number().min(15).optional(), // minutes
  type: z.enum(['consultation', 'tattoo', 'touch-up', 'cover-up', 'removal', 'other']).optional(),
  designDescription: z.string().optional(),
  placement: z.string().optional(),
  size: z.string().optional(),
  style: z.string().optional(),
  estimatedPrice: z.number().optional(),
  deposit: z.number().optional(),
  depositPaid: z.boolean().optional(),
  notes: z.string().optional(),
  referenceImages: z.array(z.string()).optional(),
  status: z.enum(['scheduled', 'confirmed', 'in-progress', 'completed', 'cancelled', 'no-show']).optional(),
});

const updateAppointmentSchema = appointmentSchema.partial();

/**
 * GET /api/appointments
 * List appointments for a studio
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const studioId = req.headers['x-studio-id'] as string;
    if (!studioId) {
      return res.status(400).json({ error: 'Studio ID is required' });
    }

    const { 
      startDate, 
      endDate, 
      status, 
      artistId, 
      customerId,
      limit = '100' 
    } = req.query;

    let query: any = db()
      .collection('studios')
      .doc(studioId)
      .collection('appointments');

    // Filter by date range
    if (startDate) {
      query = query.where('date', '>=', startDate);
    }
    if (endDate) {
      query = query.where('date', '<=', endDate);
    }

    // Order by date
    query = query.orderBy('date', 'asc').limit(parseInt(limit as string));

    const snapshot = await query.get();
    
    let appointments = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    // Additional client-side filters
    if (status) {
      appointments = appointments.filter(a => a.status === status);
    }
    if (artistId) {
      appointments = appointments.filter(a => a.artistId === artistId);
    }
    if (customerId) {
      appointments = appointments.filter(a => a.customerId === customerId);
    }

    res.json({
      success: true,
      appointments,
      total: appointments.length,
    });

  } catch (error: any) {
    console.error('List Appointments Error:', error);
    res.status(500).json({ error: 'Failed to list appointments', message: error.message });
  }
});

/**
 * GET /api/appointments/calendar/:year/:month
 * Get calendar view of appointments
 */
router.get('/calendar/:year/:month', async (req: Request, res: Response) => {
  try {
    const studioId = req.headers['x-studio-id'] as string;
    if (!studioId) {
      return res.status(400).json({ error: 'Studio ID is required' });
    }

    const { year, month } = req.params;
    const yearNum = parseInt(year);
    const monthNum = parseInt(month);

    // Calculate date range for the month
    const startDate = new Date(yearNum, monthNum - 1, 1).toISOString().split('T')[0];
    const endDate = new Date(yearNum, monthNum, 0).toISOString().split('T')[0];

    const snapshot = await db()
      .collection('studios')
      .doc(studioId)
      .collection('appointments')
      .where('date', '>=', startDate)
      .where('date', '<=', endDate)
      .orderBy('date', 'asc')
      .get();

    const appointments = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    // Group by date
    const calendarData: Record<string, any[]> = {};
    appointments.forEach(apt => {
      const date = apt.date;
      if (!calendarData[date]) {
        calendarData[date] = [];
      }
      calendarData[date].push(apt);
    });

    res.json({
      success: true,
      year: yearNum,
      month: monthNum,
      calendar: calendarData,
      totalAppointments: appointments.length,
    });

  } catch (error: any) {
    console.error('Calendar Error:', error);
    res.status(500).json({ error: 'Failed to get calendar', message: error.message });
  }
});

/**
 * GET /api/appointments/:id
 * Get a single appointment
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const studioId = req.headers['x-studio-id'] as string;
    if (!studioId) {
      return res.status(400).json({ error: 'Studio ID is required' });
    }

    const { id } = req.params;

    const appointmentDoc = await db()
      .collection('studios')
      .doc(studioId)
      .collection('appointments')
      .doc(id)
      .get();

    if (!appointmentDoc.exists) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    // Get customer info if available
    const appointmentData = appointmentDoc.data();
    let customer = null;
    if (appointmentData?.customerId) {
      const customerDoc = await db()
        .collection('studios')
        .doc(studioId)
        .collection('customers')
        .doc(appointmentData.customerId)
        .get();
      if (customerDoc.exists) {
        customer = { id: customerDoc.id, ...customerDoc.data() };
      }
    }

    res.json({
      success: true,
      appointment: {
        id: appointmentDoc.id,
        ...appointmentData,
        customer,
      }
    });

  } catch (error: any) {
    console.error('Get Appointment Error:', error);
    res.status(500).json({ error: 'Failed to get appointment', message: error.message });
  }
});

/**
 * POST /api/appointments
 * Create a new appointment
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const studioId = req.headers['x-studio-id'] as string;
    if (!studioId) {
      return res.status(400).json({ error: 'Studio ID is required' });
    }

    const validation = appointmentSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Invalid input', 
        details: validation.error.errors 
      });
    }

    const appointmentId = uuidv4();
    const now = new Date().toISOString();

    const appointmentData = {
      ...validation.data,
      id: appointmentId,
      studioId,
      status: validation.data.status || 'scheduled',
      createdAt: now,
      updatedAt: now,
    };

    await db()
      .collection('studios')
      .doc(studioId)
      .collection('appointments')
      .doc(appointmentId)
      .set(appointmentData);

    // Update customer's last visit and appointment count
    if (validation.data.customerId) {
      const customerRef = db()
        .collection('studios')
        .doc(studioId)
        .collection('customers')
        .doc(validation.data.customerId);
      
      await customerRef.update({
        lastAppointment: validation.data.date,
        appointmentCount: require('firebase-admin').firestore.FieldValue.increment(1),
        updatedAt: now,
      }).catch(() => {}); // Ignore if customer doesn't exist
    }

    res.status(201).json({
      success: true,
      appointment: appointmentData,
    });

  } catch (error: any) {
    console.error('Create Appointment Error:', error);
    res.status(500).json({ error: 'Failed to create appointment', message: error.message });
  }
});

/**
 * PUT /api/appointments/:id
 * Update an appointment
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const studioId = req.headers['x-studio-id'] as string;
    if (!studioId) {
      return res.status(400).json({ error: 'Studio ID is required' });
    }

    const { id } = req.params;

    const validation = updateAppointmentSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Invalid input', 
        details: validation.error.errors 
      });
    }

    const appointmentRef = db()
      .collection('studios')
      .doc(studioId)
      .collection('appointments')
      .doc(id);

    const appointmentDoc = await appointmentRef.get();
    if (!appointmentDoc.exists) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    const updateData = {
      ...validation.data,
      updatedAt: new Date().toISOString(),
    };

    await appointmentRef.update(updateData);

    res.json({
      success: true,
      appointment: {
        id,
        ...appointmentDoc.data(),
        ...updateData,
      }
    });

  } catch (error: any) {
    console.error('Update Appointment Error:', error);
    res.status(500).json({ error: 'Failed to update appointment', message: error.message });
  }
});

/**
 * PATCH /api/appointments/:id/status
 * Update appointment status
 */
router.patch('/:id/status', async (req: Request, res: Response) => {
  try {
    const studioId = req.headers['x-studio-id'] as string;
    if (!studioId) {
      return res.status(400).json({ error: 'Studio ID is required' });
    }

    const { id } = req.params;
    const { status, notes } = req.body;

    const validStatuses = ['scheduled', 'confirmed', 'in-progress', 'completed', 'cancelled', 'no-show'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const appointmentRef = db()
      .collection('studios')
      .doc(studioId)
      .collection('appointments')
      .doc(id);

    const appointmentDoc = await appointmentRef.get();
    if (!appointmentDoc.exists) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    const updateData: any = {
      status,
      updatedAt: new Date().toISOString(),
    };

    if (status === 'completed') {
      updateData.completedAt = new Date().toISOString();
    }
    if (status === 'cancelled') {
      updateData.cancelledAt = new Date().toISOString();
      if (notes) updateData.cancellationReason = notes;
    }

    await appointmentRef.update(updateData);

    // Update customer stats if completed
    if (status === 'completed') {
      const appointmentData = appointmentDoc.data();
      if (appointmentData?.customerId && appointmentData?.estimatedPrice) {
        const customerRef = db()
          .collection('studios')
          .doc(studioId)
          .collection('customers')
          .doc(appointmentData.customerId);
        
        await customerRef.update({
          lastVisit: new Date().toISOString(),
          totalSpent: require('firebase-admin').firestore.FieldValue.increment(appointmentData.estimatedPrice),
        }).catch(() => {});
      }
    }

    res.json({
      success: true,
      appointment: {
        id,
        ...appointmentDoc.data(),
        ...updateData,
      }
    });

  } catch (error: any) {
    console.error('Update Status Error:', error);
    res.status(500).json({ error: 'Failed to update status', message: error.message });
  }
});

/**
 * DELETE /api/appointments/:id
 * Delete/cancel an appointment
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const studioId = req.headers['x-studio-id'] as string;
    if (!studioId) {
      return res.status(400).json({ error: 'Studio ID is required' });
    }

    const { id } = req.params;
    const { hard } = req.query;

    const appointmentRef = db()
      .collection('studios')
      .doc(studioId)
      .collection('appointments')
      .doc(id);

    const appointmentDoc = await appointmentRef.get();
    if (!appointmentDoc.exists) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    if (hard === 'true') {
      await appointmentRef.delete();
    } else {
      await appointmentRef.update({
        status: 'cancelled',
        cancelledAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      message: 'Appointment cancelled successfully',
    });

  } catch (error: any) {
    console.error('Delete Appointment Error:', error);
    res.status(500).json({ error: 'Failed to delete appointment', message: error.message });
  }
});

/**
 * GET /api/appointments/availability/:date
 * Get available time slots for a date
 */
router.get('/availability/:date', async (req: Request, res: Response) => {
  try {
    const studioId = req.headers['x-studio-id'] as string;
    if (!studioId) {
      return res.status(400).json({ error: 'Studio ID is required' });
    }

    const { date } = req.params;
    const { artistId, duration = '60' } = req.query;

    // Get studio settings for working hours
    const settingsDoc = await db()
      .collection('studios')
      .doc(studioId)
      .get();

    const settings = settingsDoc.data() || {};
    const workingHours = settings.workingHours || { start: '09:00', end: '18:00' };

    // Get existing appointments for the date
    let query: any = db()
      .collection('studios')
      .doc(studioId)
      .collection('appointments')
      .where('date', '==', date)
      .where('status', 'in', ['scheduled', 'confirmed', 'in-progress']);

    if (artistId) {
      query = query.where('artistId', '==', artistId);
    }

    const snapshot = await query.get();
    const bookedSlots = snapshot.docs.map(doc => ({
      start: doc.data().startTime,
      end: doc.data().endTime || doc.data().startTime,
    }));

    // Generate available slots
    const availableSlots: string[] = [];
    const slotDuration = parseInt(duration as string);
    
    let currentTime = workingHours.start;
    while (currentTime < workingHours.end) {
      const isBooked = bookedSlots.some(slot => 
        currentTime >= slot.start && currentTime < slot.end
      );
      
      if (!isBooked) {
        availableSlots.push(currentTime);
      }
      
      // Increment by 30 minutes
      const [hours, mins] = currentTime.split(':').map(Number);
      const totalMins = hours * 60 + mins + 30;
      currentTime = `${Math.floor(totalMins / 60).toString().padStart(2, '0')}:${(totalMins % 60).toString().padStart(2, '0')}`;
    }

    res.json({
      success: true,
      date,
      workingHours,
      bookedSlots,
      availableSlots,
    });

  } catch (error: any) {
    console.error('Availability Error:', error);
    res.status(500).json({ error: 'Failed to get availability', message: error.message });
  }
});

export default router;
