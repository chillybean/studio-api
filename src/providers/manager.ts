/**
 * AI Provider Manager
 * 
 * Centralized manager for all AI providers
 * Handles provider selection, fallbacks, and orchestration
 */

import { 
  IAIProvider, 
  AIProviderType, 
  AIProviderConfig,
  TattooDesignRequest,
  TattooDesignResponse,
  TextGenerationRequest,
  ImageGenerationRequest,
  GeneratedImage
} from './types';
import { GeminiProvider } from './gemini';
import { ComfyUIProvider } from './comfyui';
import { StableDiffusionProvider } from './stable-diffusion';
import { CustomLLMProvider } from './custom-llm';

interface ProviderManagerConfig {
  defaultTextProvider?: AIProviderType;
  defaultImageProvider?: AIProviderType;
  providers: {
    gemini?: { apiKey: string; model?: string };
    comfyui?: { baseUrl: string; timeout?: number };
    stableDiffusion?: { baseUrl: string; apiKey?: string; model?: string };
    customLlm?: { baseUrl: string; apiKey?: string; model?: string };
  };
}

export class AIProviderManager {
  private textProviders: Map<AIProviderType, IAIProvider> = new Map();
  private imageProviders: Map<AIProviderType, IAIProvider> = new Map();
  private defaultTextProvider: AIProviderType = 'gemini';
  private defaultImageProvider: AIProviderType = 'stable-diffusion';
  
  constructor(config: ProviderManagerConfig) {
    this.defaultTextProvider = config.defaultTextProvider || 'gemini';
    this.defaultImageProvider = config.defaultImageProvider || 'stable-diffusion';
    
    // Initialize configured providers
    if (config.providers.gemini) {
      const provider = new GeminiProvider(
        config.providers.gemini.apiKey,
        config.providers.gemini.model
      );
      this.textProviders.set('gemini', provider);
    }
    
    if (config.providers.comfyui) {
      const provider = new ComfyUIProvider({
        baseUrl: config.providers.comfyui.baseUrl,
        timeout: config.providers.comfyui.timeout,
      });
      this.imageProviders.set('comfyui', provider);
    }
    
    if (config.providers.stableDiffusion) {
      const provider = new StableDiffusionProvider({
        baseUrl: config.providers.stableDiffusion.baseUrl,
        apiKey: config.providers.stableDiffusion.apiKey,
        defaultModel: config.providers.stableDiffusion.model,
      });
      this.imageProviders.set('stable-diffusion', provider);
    }
    
    if (config.providers.customLlm) {
      const provider = new CustomLLMProvider({
        baseUrl: config.providers.customLlm.baseUrl,
        apiKey: config.providers.customLlm.apiKey,
        model: config.providers.customLlm.model,
      });
      this.textProviders.set('custom-llm', provider);
    }
  }
  
  /**
   * Get a text provider
   */
  getTextProvider(type?: AIProviderType): IAIProvider | undefined {
    return this.textProviders.get(type || this.defaultTextProvider);
  }
  
  /**
   * Get an image provider
   */
  getImageProvider(type?: AIProviderType): IAIProvider | undefined {
    return this.imageProviders.get(type || this.defaultImageProvider);
  }
  
  /**
   * Generate tattoo design with text and optional image
   */
  async generateTattooDesign(request: TattooDesignRequest): Promise<TattooDesignResponse> {
    const textProvider = this.getTextProvider();
    
    if (!textProvider) {
      throw new Error('No text generation provider configured');
    }
    
    // Build the prompt
    const prompt = this.buildDesignPrompt(request);
    
    // Generate text suggestion
    const textResponse = await textProvider.generateText!({
      prompt,
      systemPrompt: `You are an expert tattoo artist with 20+ years of experience. 
Provide detailed, professional tattoo design suggestions that are practical and achievable.
Consider style, placement, size, and color preferences when making recommendations.`,
    });
    
    const response: TattooDesignResponse = {
      suggestion: textResponse.text,
      providers: {
        text: textProvider.name,
      },
      generatedAt: new Date().toISOString(),
    };
    
    // Optionally generate image
    if (request.generateImage) {
      const imageProvider = this.getImageProvider();
      
      if (imageProvider && imageProvider.generateImage) {
        try {
          const imageResponse = await imageProvider.generateImage({
            prompt: request.description,
            style: request.style,
            width: 512,
            height: 512,
            steps: 30,
          });
          
          response.images = imageResponse.images;
          response.providers.image = imageProvider.name;
        } catch (error) {
          console.error('Image generation failed:', error);
          // Continue without image
        }
      }
    }
    
    return response;
  }
  
  private buildDesignPrompt(request: TattooDesignRequest): string {
    let prompt = `Create a detailed tattoo design suggestion based on:

**Client Request:** ${request.description}`;

    if (request.style) {
      prompt += `\n**Preferred Style:** ${request.style}`;
    }
    if (request.placement) {
      prompt += `\n**Body Placement:** ${request.placement}`;
    }
    if (request.size) {
      prompt += `\n**Size:** ${request.size}`;
    }
    if (request.colorPreference) {
      prompt += `\n**Color Preference:** ${request.colorPreference}`;
    }
    if (request.additionalNotes) {
      prompt += `\n**Additional Notes:** ${request.additionalNotes}`;
    }

    prompt += `

Please provide:
1. **Design Concept** - Detailed visual description
2. **Style Recommendations** - Best tattoo styles for this concept
3. **Composition & Layout** - How elements should be arranged
4. **Size & Placement Tips** - Optimal sizing considerations
5. **Color Palette** - Recommended colors or shading
6. **Technical Notes** - Line weights, shading techniques
7. **Estimated Session Time** - Rough time estimate
8. **Aftercare Considerations** - Special care notes`;

    return prompt;
  }
  
  /**
   * Chat with AI
   */
  async chat(message: string, history?: { role: string; content: string }[]): Promise<string> {
    const provider = this.getTextProvider();
    
    if (!provider || !provider.generateText) {
      throw new Error('No text generation provider configured');
    }
    
    let prompt = message;
    
    if (history && history.length > 0) {
      const historyText = history
        .slice(-5)
        .map(h => `${h.role}: ${h.content}`)
        .join('\n');
      prompt = `Previous conversation:\n${historyText}\n\nUser: ${message}`;
    }
    
    const response = await provider.generateText({
      prompt,
      systemPrompt: `You are TatBot, an expert AI tattoo consultant for the Tat-Life app.
You have extensive knowledge about tattoo styles, design concepts, placement, aftercare, and finding artists.
Be helpful, friendly, and professional.`,
    });
    
    return response.text;
  }
  
  /**
   * Generate image only
   */
  async generateImage(request: ImageGenerationRequest): Promise<GeneratedImage[]> {
    const provider = this.getImageProvider();
    
    if (!provider || !provider.generateImage) {
      throw new Error('No image generation provider configured');
    }
    
    const response = await provider.generateImage(request);
    return response.images;
  }
  
  /**
   * Get style recommendations
   */
  async getStyleRecommendations(concept: string): Promise<any> {
    const provider = this.getTextProvider();
    
    if (!provider || !provider.generateText) {
      throw new Error('No text generation provider configured');
    }
    
    const response = await provider.generateText({
      prompt: `Recommend the top 5 tattoo styles for this concept: "${concept}"
      
Return JSON format:
{
  "recommendations": [
    {
      "style": "Style Name",
      "matchScore": 95,
      "description": "Why this style fits",
      "pros": ["advantage 1"],
      "cons": ["consideration 1"]
    }
  ]
}

Return ONLY valid JSON.`,
    });
    
    try {
      const jsonMatch = response.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch {}
    
    return { rawResponse: response.text };
  }
  
  /**
   * Check health of all providers
   */
  async checkHealth(): Promise<Record<string, { healthy: boolean; message: string }>> {
    const results: Record<string, { healthy: boolean; message: string }> = {};
    
    for (const [name, provider] of this.textProviders) {
      results[name] = await provider.checkHealth();
    }
    
    for (const [name, provider] of this.imageProviders) {
      if (!results[name]) {
        results[name] = await provider.checkHealth();
      }
    }
    
    return results;
  }
  
  /**
   * List available providers
   */
  getAvailableProviders(): {
    text: AIProviderType[];
    image: AIProviderType[];
    default: { text: AIProviderType; image: AIProviderType };
  } {
    return {
      text: Array.from(this.textProviders.keys()),
      image: Array.from(this.imageProviders.keys()),
      default: {
        text: this.defaultTextProvider,
        image: this.defaultImageProvider,
      },
    };
  }
}

/**
 * Create manager from environment variables
 */
export function createProviderManagerFromEnv(): AIProviderManager {
  const config: ProviderManagerConfig = {
    defaultTextProvider: (process.env.DEFAULT_TEXT_PROVIDER as AIProviderType) || 'gemini',
    defaultImageProvider: (process.env.DEFAULT_IMAGE_PROVIDER as AIProviderType) || 'stable-diffusion',
    providers: {},
  };
  
  // Gemini
  if (process.env.GEMINI_API_KEY) {
    config.providers.gemini = {
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL,
    };
  }
  
  // ComfyUI
  if (process.env.COMFYUI_URL) {
    config.providers.comfyui = {
      baseUrl: process.env.COMFYUI_URL,
      timeout: process.env.COMFYUI_TIMEOUT ? parseInt(process.env.COMFYUI_TIMEOUT) : undefined,
    };
  }
  
  // Stable Diffusion
  if (process.env.SD_API_URL) {
    config.providers.stableDiffusion = {
      baseUrl: process.env.SD_API_URL,
      apiKey: process.env.SD_API_KEY,
      model: process.env.SD_MODEL,
    };
  }
  
  // Custom LLM (Railway, RunPod, etc.)
  if (process.env.CUSTOM_LLM_URL) {
    config.providers.customLlm = {
      baseUrl: process.env.CUSTOM_LLM_URL,
      apiKey: process.env.CUSTOM_LLM_API_KEY,
      model: process.env.CUSTOM_LLM_MODEL,
    };
  }
  
  return new AIProviderManager(config);
}
