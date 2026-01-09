/**
 * AI Design Generator Routes
 * 
 * Multi-provider AI support for tattoo design generation
 * Supports: Gemini, ComfyUI, Stable Diffusion, Custom LLMs
 */

import { Router, Request, Response } from 'express';
import { getFirestore } from '../config/firebase';
import { z } from 'zod';
import { createProviderManagerFromEnv, AIProviderManager } from '../providers';

const router = Router();

// Lazy-load provider manager
let providerManager: AIProviderManager | null = null;

function getProviderManager(): AIProviderManager {
  if (!providerManager) {
    providerManager = createProviderManagerFromEnv();
  }
  return providerManager;
}

// Validation schemas
const generateDesignSchema = z.object({
  description: z.string().min(5, 'Description must be at least 5 characters'),
  style: z.string().optional(),
  placement: z.string().optional(),
  size: z.enum(['small', 'medium', 'large', 'extra-large']).optional(),
  colorPreference: z.enum(['black-grey', 'color', 'watercolor', 'no-preference']).optional(),
  additionalNotes: z.string().optional(),
  generateImage: z.boolean().optional(),
  textProvider: z.enum(['gemini', 'custom-llm', 'openai']).optional(),
  imageProvider: z.enum(['comfyui', 'stable-diffusion', 'replicate']).optional(),
});

const generateImageSchema = z.object({
  prompt: z.string().min(5, 'Prompt must be at least 5 characters'),
  negativePrompt: z.string().optional(),
  style: z.string().optional(),
  width: z.number().min(256).max(1024).optional(),
  height: z.number().min(256).max(1024).optional(),
  steps: z.number().min(10).max(50).optional(),
  cfgScale: z.number().min(1).max(20).optional(),
  seed: z.number().optional(),
  provider: z.enum(['comfyui', 'stable-diffusion', 'replicate']).optional(),
});

const styleRecommendationSchema = z.object({
  concept: z.string().min(3, 'Concept must be at least 3 characters'),
  preferences: z.object({
    boldness: z.enum(['subtle', 'moderate', 'bold']).optional(),
    complexity: z.enum(['minimal', 'moderate', 'detailed']).optional(),
    meaning: z.string().optional(),
  }).optional(),
});

/**
 * POST /api/ai/generate-design
 * Generate a detailed tattoo design suggestion based on user input
 */
router.post('/generate-design', async (req: Request, res: Response) => {
  try {
    const validation = generateDesignSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Invalid input', 
        details: validation.error.errors 
      });
    }

    const { 
      description, 
      style, 
      placement, 
      size, 
      colorPreference, 
      additionalNotes,
      generateImage 
    } = validation.data;

    const manager = getProviderManager();
    
    const result = await manager.generateTattooDesign({
      description,
      style,
      placement,
      size,
      colorPreference,
      additionalNotes,
      generateImage,
    });

    // Log the generation for analytics
    const db = getFirestore();
    await db.collection('ai_generations').add({
      type: 'design',
      input: validation.data,
      providers: result.providers,
      hasImage: !!result.images,
      createdAt: new Date().toISOString(),
      userId: req.headers['x-user-id'] || 'anonymous',
    });

    res.json({
      success: true,
      design: {
        suggestion: result.suggestion,
        images: result.images,
        input: validation.data,
        providers: result.providers,
        generatedAt: result.generatedAt,
      }
    });

  } catch (error: any) {
    console.error('AI Design Generation Error:', error);
    res.status(500).json({ 
      error: 'Failed to generate design',
      message: error.message 
    });
  }
});

/**
 * POST /api/ai/generate-image
 * Generate a tattoo design image
 */
router.post('/generate-image', async (req: Request, res: Response) => {
  try {
    const validation = generateImageSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Invalid input', 
        details: validation.error.errors 
      });
    }

    const manager = getProviderManager();
    
    const images = await manager.generateImage({
      prompt: validation.data.prompt,
      negativePrompt: validation.data.negativePrompt,
      style: validation.data.style,
      width: validation.data.width,
      height: validation.data.height,
      steps: validation.data.steps,
      cfgScale: validation.data.cfgScale,
      seed: validation.data.seed,
    });

    // Log generation
    const db = getFirestore();
    await db.collection('ai_generations').add({
      type: 'image',
      input: validation.data,
      imageCount: images.length,
      createdAt: new Date().toISOString(),
      userId: req.headers['x-user-id'] || 'anonymous',
    });

    res.json({
      success: true,
      images,
      generatedAt: new Date().toISOString(),
    });

  } catch (error: any) {
    console.error('Image Generation Error:', error);
    res.status(500).json({ 
      error: 'Failed to generate image',
      message: error.message 
    });
  }
});

/**
 * POST /api/ai/style-recommendation
 * Get tattoo style recommendations based on a concept
 */
router.post('/style-recommendation', async (req: Request, res: Response) => {
  try {
    const validation = styleRecommendationSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Invalid input', 
        details: validation.error.errors 
      });
    }

    const { concept } = validation.data;
    const manager = getProviderManager();
    
    const recommendations = await manager.getStyleRecommendations(concept);

    res.json({
      success: true,
      concept,
      recommendations,
      generatedAt: new Date().toISOString(),
    });

  } catch (error: any) {
    console.error('Style Recommendation Error:', error);
    res.status(500).json({ 
      error: 'Failed to get style recommendations',
      message: error.message 
    });
  }
});

/**
 * POST /api/ai/placement-advice
 * Get advice on tattoo placement
 */
router.post('/placement-advice', async (req: Request, res: Response) => {
  try {
    const { design, bodyType, existingTattoos, painTolerance } = req.body;

    if (!design) {
      return res.status(400).json({ error: 'Design description is required' });
    }

    const manager = getProviderManager();
    const textProvider = manager.getTextProvider();
    
    if (!textProvider || !textProvider.generateText) {
      return res.status(503).json({ error: 'No text provider available' });
    }

    const response = await textProvider.generateText({
      prompt: `As a tattoo placement specialist, provide detailed placement advice for:

**Design:** ${design}
${bodyType ? `**Body Type:** ${bodyType}` : ''}
${existingTattoos ? `**Existing Tattoos:** ${existingTattoos}` : ''}
${painTolerance ? `**Pain Tolerance:** ${painTolerance}` : ''}

Provide advice in this JSON format:
{
  "topPlacements": [
    {
      "location": "Body part",
      "suitabilityScore": 90,
      "painLevel": "moderate",
      "visibilityLevel": "high",
      "agingConsiderations": "How it will age",
      "sizeRecommendation": "optimal size",
      "pros": ["benefit 1", "benefit 2"],
      "cons": ["consideration 1"]
    }
  ],
  "placementsToAvoid": ["location 1", "location 2"],
  "generalTips": "Overall placement advice"
}

Return ONLY valid JSON.`,
    });

    let advice;
    try {
      const jsonMatch = response.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        advice = JSON.parse(jsonMatch[0]);
      } else {
        advice = { rawResponse: response.text };
      }
    } catch {
      advice = { rawResponse: response.text };
    }

    res.json({
      success: true,
      advice,
      provider: textProvider.name,
      generatedAt: new Date().toISOString(),
    });

  } catch (error: any) {
    console.error('Placement Advice Error:', error);
    res.status(500).json({ 
      error: 'Failed to get placement advice',
      message: error.message 
    });
  }
});

/**
 * POST /api/ai/estimate-cost
 * Estimate tattoo cost based on design details
 */
router.post('/estimate-cost', async (req: Request, res: Response) => {
  try {
    const { design, style, size, placement, location } = req.body;

    if (!design || !size) {
      return res.status(400).json({ error: 'Design and size are required' });
    }

    const manager = getProviderManager();
    const textProvider = manager.getTextProvider();
    
    if (!textProvider || !textProvider.generateText) {
      return res.status(503).json({ error: 'No text provider available' });
    }

    const response = await textProvider.generateText({
      prompt: `As a tattoo pricing expert, estimate the cost for:

**Design:** ${design}
**Style:** ${style || 'Not specified'}
**Size:** ${size}
**Placement:** ${placement || 'Not specified'}
**Geographic Location:** ${location || 'United States (average)'}

Provide estimate in this JSON format:
{
  "estimatedCost": {
    "low": 150,
    "average": 250,
    "high": 400,
    "currency": "USD"
  },
  "estimatedTime": {
    "sessions": 1,
    "hoursPerSession": 2,
    "totalHours": 2
  },
  "priceFactors": [
    "Factor affecting price 1",
    "Factor affecting price 2"
  ],
  "costBreakdown": {
    "artistHourlyRate": "$100-200/hr",
    "setupFee": "$50-100",
    "touchUpPolicy": "Usually included within 30 days"
  },
  "tips": [
    "Negotiation tip 1",
    "When to expect higher prices"
  ]
}

Return ONLY valid JSON.`,
    });

    let estimate;
    try {
      const jsonMatch = response.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        estimate = JSON.parse(jsonMatch[0]);
      } else {
        estimate = { rawResponse: response.text };
      }
    } catch {
      estimate = { rawResponse: response.text };
    }

    res.json({
      success: true,
      estimate,
      provider: textProvider.name,
      generatedAt: new Date().toISOString(),
    });

  } catch (error: any) {
    console.error('Cost Estimate Error:', error);
    res.status(500).json({ 
      error: 'Failed to estimate cost',
      message: error.message 
    });
  }
});

/**
 * POST /api/ai/chat
 * General tattoo consultation chat
 */
router.post('/chat', async (req: Request, res: Response) => {
  try {
    const { message, conversationHistory } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const manager = getProviderManager();
    
    const reply = await manager.chat(message, conversationHistory);

    res.json({
      success: true,
      reply,
      timestamp: new Date().toISOString(),
    });

  } catch (error: any) {
    console.error('Chat Error:', error);
    res.status(500).json({ 
      error: 'Failed to process message',
      message: error.message 
    });
  }
});

/**
 * GET /api/ai/providers
 * List available AI providers
 */
router.get('/providers', async (req: Request, res: Response) => {
  try {
    const manager = getProviderManager();
    const providers = manager.getAvailableProviders();

    res.json({
      success: true,
      providers,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({ 
      error: 'Failed to get providers',
      message: error.message 
    });
  }
});

/**
 * GET /api/ai/status
 * Check AI service status
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const manager = getProviderManager();
    const providers = manager.getAvailableProviders();
    const health = await manager.checkHealth();

    res.json({
      status: Object.values(health).some(h => h.healthy) ? 'operational' : 'degraded',
      providers: {
        available: providers,
        health,
      },
      features: [
        'design-generation',
        'image-generation',
        'style-recommendation',
        'placement-advice',
        'cost-estimation',
        'chat-consultation'
      ],
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({ 
      status: 'error',
      message: error.message 
    });
  }
});

/**
 * GET /api/ai/health
 * Health check for all providers
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    const manager = getProviderManager();
    const health = await manager.checkHealth();

    const allHealthy = Object.values(health).every(h => h.healthy);
    const anyHealthy = Object.values(health).some(h => h.healthy);

    res.status(allHealthy ? 200 : anyHealthy ? 207 : 503).json({
      success: anyHealthy,
      providers: health,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(503).json({ 
      success: false,
      error: error.message 
    });
  }
});

export default router;
