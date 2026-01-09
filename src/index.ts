/**
 * Studio API - Main Entry Point
 * 
 * Microservice for tattoo studio management:
 * - AI Design Generation (Gemini)
 * - Customer CRM
 * - Appointments/Bookings
 * - Pricelist Management
 * - Studio Analytics
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { initializeFirebase } from './config/firebase';

// Route imports
import aiRoutes from './routes/ai';
import customersRoutes from './routes/customers';
import appointmentsRoutes from './routes/appointments';
import pricelistRoutes from './routes/pricelist';
import galleryRoutes from './routes/gallery';
import analyticsRoutes from './routes/analytics';
import settingsRoutes from './routes/settings';

// Load environment variables
dotenv.config();

// Initialize Firebase
initializeFirebase();

const app = express();
const PORT = process.env.PORT || 3007;

// Middleware
app.use(helmet());
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
  'http://localhost:3000',
  'https://tat-life.web.app',
  'https://tat-life.firebaseapp.com'
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'studio-api',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// API Routes
app.use('/api/ai', aiRoutes);
app.use('/api/customers', customersRoutes);
app.use('/api/appointments', appointmentsRoutes);
app.use('/api/pricelist', pricelistRoutes);
app.use('/api/gallery', galleryRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/settings', settingsRoutes);

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err.message);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🎨 Studio API running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
  console.log(`🤖 AI endpoints: http://localhost:${PORT}/api/ai`);
  console.log(`👥 Customers: http://localhost:${PORT}/api/customers`);
  console.log(`📅 Appointments: http://localhost:${PORT}/api/appointments`);
});

export default app;
