/**
 * Google Gemini Image Provider
 * 
 * Image generation using Google's Imagen model via Gemini API
 */

import { 
  IAIProvider, 
  AIProviderType, 
  ImageGenerationRequest, 
  ImageGenerationResponse,
  GeneratedImage
} from './types';

interface GeminiImageConfig {
  apiKey: string;
  model?: string;
  timeout?: number;
}

export class GeminiImageProvider implements IAIProvider {
  readonly name: AIProviderType = 'gemini';
  readonly supportsText = false;
  readonly supportsImages = true;
  
  private apiKey: string;
  private model: string;
  private timeout: number;
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
  
  constructor(config: GeminiImageConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model || 'imagen-3.0-generate-002';
    this.timeout = config.timeout || 60000;
  }
  
  async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResponse> {
    const enhancedPrompt = this.enhanceTattooPrompt(request.prompt, request.style);
    
    // Use Imagen API via Gemini
    const response = await fetch(
      `${this.baseUrl}/models/${this.model}:predict?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          instances: [{
            prompt: enhancedPrompt,
          }],
          parameters: {
            sampleCount: 1,
            aspectRatio: this.getAspectRatio(request.width, request.height),
            negativePrompt: request.negativePrompt || 
              'blurry, low quality, distorted, watermark, text',
            // Imagen doesn't use steps/cfg like SD, but we can map to quality
            ...(request.seed && { seed: request.seed }),
          },
        }),
        signal: AbortSignal.timeout(this.timeout),
      }
    );
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini Imagen API error: ${response.status} - ${error}`);
    }
    
    const data = await response.json() as any;
    
    const images: GeneratedImage[] = [];
    
    if (data.predictions) {
      for (const prediction of data.predictions) {
        if (prediction.bytesBase64Encoded) {
          images.push({
            base64: `data:image/png;base64,${prediction.bytesBase64Encoded}`,
            width: request.width || 1024,
            height: request.height || 1024,
          });
        }
      }
    }
    
    return {
      images,
      provider: this.name,
      model: this.model,
      seed: request.seed,
    };
  }
  
  private getAspectRatio(width?: number, height?: number): string {
    if (!width || !height) return '1:1';
    
    const ratio = width / height;
    if (ratio > 1.7) return '16:9';
    if (ratio > 1.3) return '4:3';
    if (ratio < 0.6) return '9:16';
    if (ratio < 0.8) return '3:4';
    return '1:1';
  }
  
  private enhanceTattooPrompt(prompt: string, style?: string): string {
    const styleEnhancements: Record<string, string> = {
      'traditional': 'american traditional tattoo flash art, bold outlines, limited color palette',
      'neo-traditional': 'neo-traditional tattoo design, illustrative, rich colors',
      'japanese': 'japanese irezumi tattoo art, ukiyo-e style',
      'blackwork': 'blackwork tattoo design, solid black ink, geometric',
      'geometric': 'geometric tattoo design, sacred geometry, precise lines',
      'realism': 'realistic tattoo design, photorealistic, detailed shading',
      'watercolor': 'watercolor tattoo art, paint splashes, artistic',
      'minimalist': 'minimalist tattoo, fine line, simple, clean',
      'dotwork': 'dotwork tattoo, stippling, dot patterns',
      'tribal': 'tribal tattoo design, polynesian style',
    };
    
    const stylePrefix = style && styleEnhancements[style.toLowerCase()] 
      ? styleEnhancements[style.toLowerCase()] 
      : 'tattoo design';
    
    return `${stylePrefix}, ${prompt}, professional tattoo art, clean lines, high quality`;
  }
  
  async checkHealth(): Promise<{ healthy: boolean; message: string }> {
    try {
      // Check if we can list models
      const response = await fetch(
        `${this.baseUrl}/models?key=${this.apiKey}`,
        { signal: AbortSignal.timeout(5000) }
      );
      
      if (response.ok) {
        return {
          healthy: true,
          message: 'Gemini Imagen API is operational',
        };
      }
      
      return {
        healthy: false,
        message: `API returned ${response.status}`,
      };
    } catch (error: any) {
      return {
        healthy: false,
        message: `Connection failed: ${error.message}`,
      };
    }
  }
}
