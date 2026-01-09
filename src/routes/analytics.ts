/**
 * Analytics Routes
 * 
 * Studio analytics and reporting
 */

import { Router, Request, Response } from 'express';
import { getFirestore } from '../config/firebase';

const router = Router();
const db = () => getFirestore();

/**
 * GET /api/analytics/overview
 * Get studio dashboard overview
 */
router.get('/overview', async (req: Request, res: Response) => {
  try {
    const studioId = req.headers['x-studio-id'] as string;
    if (!studioId) {
      return res.status(400).json({ error: 'Studio ID is required' });
    }

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay())).toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];

    // Get appointments
    const appointmentsSnapshot = await db()
      .collection('studios')
      .doc(studioId)
      .collection('appointments')
      .get();

    const appointments = appointmentsSnapshot.docs.map(doc => doc.data());

    // Get customers
    const customersSnapshot = await db()
      .collection('studios')
      .doc(studioId)
      .collection('customers')
      .where('status', '==', 'active')
      .get();

    // Calculate stats
    const totalCustomers = customersSnapshot.size;
    const totalAppointments = appointments.length;
    
    const todayAppointments = appointments.filter(a => a.date === today).length;
    const thisWeekAppointments = appointments.filter(a => a.date >= startOfWeek).length;
    const thisMonthAppointments = appointments.filter(a => a.date >= startOfMonth).length;
    
    const completedAppointments = appointments.filter(a => a.status === 'completed');
    const totalRevenue = completedAppointments.reduce((sum, a) => sum + (a.estimatedPrice || 0), 0);
    const monthlyRevenue = completedAppointments
      .filter(a => a.completedAt && a.completedAt >= startOfMonth)
      .reduce((sum, a) => sum + (a.estimatedPrice || 0), 0);

    const upcomingAppointments = appointments
      .filter(a => a.date >= today && ['scheduled', 'confirmed'].includes(a.status))
      .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
      .slice(0, 5);

    res.json({
      success: true,
      overview: {
        customers: {
          total: totalCustomers,
          newThisMonth: customersSnapshot.docs.filter(doc => {
            const data = doc.data();
            return data.createdAt && data.createdAt >= startOfMonth;
          }).length,
        },
        appointments: {
          total: totalAppointments,
          today: todayAppointments,
          thisWeek: thisWeekAppointments,
          thisMonth: thisMonthAppointments,
          upcoming: upcomingAppointments,
        },
        revenue: {
          total: totalRevenue,
          thisMonth: monthlyRevenue,
          avgPerAppointment: completedAppointments.length > 0 
            ? Math.round(totalRevenue / completedAppointments.length) 
            : 0,
        },
        completionRate: totalAppointments > 0 
          ? Math.round((completedAppointments.length / totalAppointments) * 100) 
          : 0,
      },
      timestamp: new Date().toISOString(),
    });

  } catch (error: any) {
    console.error('Analytics Overview Error:', error);
    res.status(500).json({ error: 'Failed to get analytics', message: error.message });
  }
});

/**
 * GET /api/analytics/revenue
 * Get revenue analytics
 */
router.get('/revenue', async (req: Request, res: Response) => {
  try {
    const studioId = req.headers['x-studio-id'] as string;
    if (!studioId) {
      return res.status(400).json({ error: 'Studio ID is required' });
    }

    const { period = '30' } = req.query; // days
    const daysBack = parseInt(period as string);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);
    const startDateStr = startDate.toISOString().split('T')[0];

    const snapshot = await db()
      .collection('studios')
      .doc(studioId)
      .collection('appointments')
      .where('status', '==', 'completed')
      .where('completedAt', '>=', startDateStr)
      .get();

    const appointments = snapshot.docs.map(doc => doc.data());

    // Group by date
    const dailyRevenue: Record<string, number> = {};
    appointments.forEach(apt => {
      const date = apt.completedAt?.split('T')[0] || apt.date;
      if (date) {
        dailyRevenue[date] = (dailyRevenue[date] || 0) + (apt.estimatedPrice || 0);
      }
    });

    // Group by service type
    const revenueByType: Record<string, number> = {};
    appointments.forEach(apt => {
      const type = apt.type || 'other';
      revenueByType[type] = (revenueByType[type] || 0) + (apt.estimatedPrice || 0);
    });

    // Group by artist
    const revenueByArtist: Record<string, { name: string; revenue: number; count: number }> = {};
    appointments.forEach(apt => {
      const artistId = apt.artistId || 'unassigned';
      if (!revenueByArtist[artistId]) {
        revenueByArtist[artistId] = { name: apt.artistName || 'Unassigned', revenue: 0, count: 0 };
      }
      revenueByArtist[artistId].revenue += apt.estimatedPrice || 0;
      revenueByArtist[artistId].count += 1;
    });

    const totalRevenue = appointments.reduce((sum, a) => sum + (a.estimatedPrice || 0), 0);

    res.json({
      success: true,
      period: daysBack,
      totalRevenue,
      appointmentCount: appointments.length,
      avgRevenue: appointments.length > 0 ? Math.round(totalRevenue / appointments.length) : 0,
      dailyRevenue,
      revenueByType,
      revenueByArtist: Object.values(revenueByArtist),
    });

  } catch (error: any) {
    console.error('Revenue Analytics Error:', error);
    res.status(500).json({ error: 'Failed to get revenue analytics', message: error.message });
  }
});

/**
 * GET /api/analytics/appointments
 * Get appointment analytics
 */
router.get('/appointments', async (req: Request, res: Response) => {
  try {
    const studioId = req.headers['x-studio-id'] as string;
    if (!studioId) {
      return res.status(400).json({ error: 'Studio ID is required' });
    }

    const { period = '30' } = req.query;
    const daysBack = parseInt(period as string);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);
    const startDateStr = startDate.toISOString().split('T')[0];

    const snapshot = await db()
      .collection('studios')
      .doc(studioId)
      .collection('appointments')
      .where('date', '>=', startDateStr)
      .get();

    const appointments = snapshot.docs.map(doc => doc.data());

    // Status breakdown
    const statusBreakdown: Record<string, number> = {};
    appointments.forEach(apt => {
      const status = apt.status || 'unknown';
      statusBreakdown[status] = (statusBreakdown[status] || 0) + 1;
    });

    // Type breakdown
    const typeBreakdown: Record<string, number> = {};
    appointments.forEach(apt => {
      const type = apt.type || 'other';
      typeBreakdown[type] = (typeBreakdown[type] || 0) + 1;
    });

    // Day of week distribution
    const dayOfWeekBreakdown: Record<string, number> = {
      'Sunday': 0, 'Monday': 0, 'Tuesday': 0, 'Wednesday': 0,
      'Thursday': 0, 'Friday': 0, 'Saturday': 0
    };
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    appointments.forEach(apt => {
      if (apt.date) {
        const day = new Date(apt.date).getDay();
        dayOfWeekBreakdown[dayNames[day]] += 1;
      }
    });

    // Popular time slots
    const timeSlotBreakdown: Record<string, number> = {};
    appointments.forEach(apt => {
      if (apt.startTime) {
        const hour = apt.startTime.split(':')[0];
        timeSlotBreakdown[`${hour}:00`] = (timeSlotBreakdown[`${hour}:00`] || 0) + 1;
      }
    });

    const completed = appointments.filter(a => a.status === 'completed').length;
    const cancelled = appointments.filter(a => a.status === 'cancelled').length;
    const noShow = appointments.filter(a => a.status === 'no-show').length;

    res.json({
      success: true,
      period: daysBack,
      total: appointments.length,
      completed,
      cancelled,
      noShow,
      completionRate: appointments.length > 0 ? Math.round((completed / appointments.length) * 100) : 0,
      cancellationRate: appointments.length > 0 ? Math.round((cancelled / appointments.length) * 100) : 0,
      statusBreakdown,
      typeBreakdown,
      dayOfWeekBreakdown,
      timeSlotBreakdown,
    });

  } catch (error: any) {
    console.error('Appointment Analytics Error:', error);
    res.status(500).json({ error: 'Failed to get appointment analytics', message: error.message });
  }
});

/**
 * GET /api/analytics/customers
 * Get customer analytics
 */
router.get('/customers', async (req: Request, res: Response) => {
  try {
    const studioId = req.headers['x-studio-id'] as string;
    if (!studioId) {
      return res.status(400).json({ error: 'Studio ID is required' });
    }

    const snapshot = await db()
      .collection('studios')
      .doc(studioId)
      .collection('customers')
      .where('status', '==', 'active')
      .get();

    const customers = snapshot.docs.map(doc => doc.data());

    // Source breakdown
    const sourceBreakdown: Record<string, number> = {};
    customers.forEach(c => {
      const source = c.source || 'unknown';
      sourceBreakdown[source] = (sourceBreakdown[source] || 0) + 1;
    });

    // Top customers by spend
    const topBySpend = [...customers]
      .sort((a, b) => (b.totalSpent || 0) - (a.totalSpent || 0))
      .slice(0, 10)
      .map(c => ({
        id: c.id,
        name: c.name,
        totalSpent: c.totalSpent || 0,
        appointmentCount: c.appointmentCount || 0,
      }));

    // Top customers by visits
    const topByVisits = [...customers]
      .sort((a, b) => (b.appointmentCount || 0) - (a.appointmentCount || 0))
      .slice(0, 10)
      .map(c => ({
        id: c.id,
        name: c.name,
        totalSpent: c.totalSpent || 0,
        appointmentCount: c.appointmentCount || 0,
      }));

    // New customers per month (last 6 months)
    const monthlyNew: Record<string, number> = {};
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthlyNew[key] = 0;
    }
    customers.forEach(c => {
      if (c.createdAt) {
        const key = c.createdAt.substring(0, 7);
        if (monthlyNew.hasOwnProperty(key)) {
          monthlyNew[key] += 1;
        }
      }
    });

    const totalSpent = customers.reduce((sum, c) => sum + (c.totalSpent || 0), 0);
    const avgSpend = customers.length > 0 ? Math.round(totalSpent / customers.length) : 0;

    res.json({
      success: true,
      total: customers.length,
      totalRevenue: totalSpent,
      avgSpendPerCustomer: avgSpend,
      sourceBreakdown,
      topBySpend,
      topByVisits,
      monthlyNewCustomers: monthlyNew,
    });

  } catch (error: any) {
    console.error('Customer Analytics Error:', error);
    res.status(500).json({ error: 'Failed to get customer analytics', message: error.message });
  }
});

export default router;
