/**
 * AI Design Generator Routes
 * 
 * Ported from Tattoo Workshop and enhanced for Tat-Life
 * Uses Google Gemini for tattoo design suggestions and generation
 */

import { Router, Request, Response } from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getFirestore } from '../config/firebase';
import { z } from 'zod';

const router = Router();

// Validation schemas
const generateDesignSchema = z.object({
  description: z.string().min(5, 'Description must be at least 5 characters'),
  style: z.string().optional(),
  placement: z.string().optional(),
  size: z.enum(['small', 'medium', 'large', 'extra-large']).optional(),
  colorPreference: z.enum(['black-grey', 'color', 'watercolor', 'no-preference']).optional(),
  additionalNotes: z.string().optional(),
});

const styleRecommendationSchema = z.object({
  concept: z.string().min(3, 'Concept must be at least 3 characters'),
  preferences: z.object({
    boldness: z.enum(['subtle', 'moderate', 'bold']).optional(),
    complexity: z.enum(['minimal', 'moderate', 'detailed']).optional(),
    meaning: z.string().optional(),
  }).optional(),
});

// Initialize Gemini AI
function getGeminiModel() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not configured');
  }
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({ model: 'gemini-pro' });
}

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

    const { description, style, placement, size, colorPreference, additionalNotes } = validation.data;

    const model = getGeminiModel();

    const prompt = `As a professional tattoo artist with 20+ years of experience, create a detailed tattoo design suggestion based on the following:

**Client Request:** ${description}
${style ? `**Preferred Style:** ${style}` : ''}
${placement ? `**Body Placement:** ${placement}` : ''}
${size ? `**Size:** ${size}` : ''}
${colorPreference ? `**Color Preference:** ${colorPreference}` : ''}
${additionalNotes ? `**Additional Notes:** ${additionalNotes}` : ''}

Please provide a comprehensive design suggestion including:

1. **Design Concept** - A vivid description of the tattoo design
2. **Visual Elements** - Specific imagery, symbols, and motifs to include
3. **Style Recommendations** - Best tattoo styles that would work (e.g., Traditional, Neo-Traditional, Blackwork, Realism, Japanese, Geometric, Watercolor, etc.)
4. **Composition & Layout** - How elements should be arranged
5. **Size & Placement Tips** - Optimal sizing and placement considerations
6. **Color Palette** - Recommended colors or shading approach
7. **Technical Considerations** - Line weights, shading techniques, aging considerations
8. **Symbolism & Meaning** - Cultural or personal significance of elements
9. **Estimated Session Time** - Rough estimate for completion
10. **Aftercare Considerations** - Special care based on placement/style

Format your response in a clear, organized manner that both the client and artist can reference.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const designSuggestion = response.text();

    // Log the generation for analytics
    const db = getFirestore();
    await db.collection('ai_generations').add({
      type: 'design',
      input: validation.data,
      outputLength: designSuggestion.length,
      createdAt: new Date().toISOString(),
      userId: req.headers['x-user-id'] || 'anonymous',
    });

    res.json({
      success: true,
      design: {
        suggestion: designSuggestion,
        input: validation.data,
        generatedAt: new Date().toISOString(),
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

    const { concept, preferences } = validation.data;

    const model = getGeminiModel();

    const prompt = `As a tattoo style expert, recommend the best tattoo styles for the following concept:

**Concept:** ${concept}
${preferences?.boldness ? `**Boldness Preference:** ${preferences.boldness}` : ''}
${preferences?.complexity ? `**Complexity Preference:** ${preferences.complexity}` : ''}
${preferences?.meaning ? `**Intended Meaning:** ${preferences.meaning}` : ''}

Provide your top 5 style recommendations in this JSON format:
{
  "recommendations": [
    {
      "style": "Style Name",
      "matchScore": 95,
      "description": "Brief description of why this style fits",
      "pros": ["advantage 1", "advantage 2"],
      "cons": ["consideration 1"],
      "exampleArtists": ["Famous Artist 1", "Famous Artist 2"],
      "estimatedCost": "$$-$$$",
      "healingTime": "2-3 weeks"
    }
  ],
  "generalAdvice": "Overall recommendation summary"
}

Return ONLY valid JSON, no additional text.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    // Try to parse as JSON
    let recommendations;
    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        recommendations = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      // Return raw text if JSON parsing fails
      recommendations = { rawResponse: text };
    }

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

    const model = getGeminiModel();

    const prompt = `As a tattoo placement specialist, provide detailed placement advice for:

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

Return ONLY valid JSON.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    let advice;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        advice = JSON.parse(jsonMatch[0]);
      } else {
        advice = { rawResponse: text };
      }
    } catch {
      advice = { rawResponse: text };
    }

    res.json({
      success: true,
      advice,
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

    const model = getGeminiModel();

    const prompt = `As a tattoo pricing expert, estimate the cost for:

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

Return ONLY valid JSON.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    let estimate;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        estimate = JSON.parse(jsonMatch[0]);
      } else {
        estimate = { rawResponse: text };
      }
    } catch {
      estimate = { rawResponse: text };
    }

    res.json({
      success: true,
      estimate,
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

    const model = getGeminiModel();

    // Build conversation context
    let contextPrompt = `You are TatBot, an expert AI tattoo consultant for Tat-Life app. You have extensive knowledge about:
- Tattoo styles (Traditional, Japanese, Blackwork, Realism, Watercolor, etc.)
- Design concepts and symbolism
- Placement and sizing recommendations
- Aftercare and healing
- Finding the right artist
- Tattoo culture and history

Be helpful, friendly, and professional. If asked about specific medical advice, recommend consulting a dermatologist.

`;

    if (conversationHistory && Array.isArray(conversationHistory)) {
      contextPrompt += 'Previous conversation:\n';
      for (const msg of conversationHistory.slice(-5)) {
        contextPrompt += `${msg.role}: ${msg.content}\n`;
      }
    }

    contextPrompt += `\nUser: ${message}\n\nAssistant:`;

    const result = await model.generateContent(contextPrompt);
    const response = await result.response;
    const reply = response.text();

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
 * GET /api/ai/status
 * Check AI service status
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const hasApiKey = !!process.env.GEMINI_API_KEY;
    
    res.json({
      status: hasApiKey ? 'operational' : 'not-configured',
      provider: 'Google Gemini',
      model: 'gemini-pro',
      features: [
        'design-generation',
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

export default router;
