/**
 * Stable Diffusion AI Provider
 * 
 * Image generation using Automatic1111 WebUI API or similar SD implementations
 * Supports local hosting, RunPod, Railway, etc.
 */

import { 
  IAIProvider, 
  AIProviderType, 
  ImageGenerationRequest, 
  ImageGenerationResponse,
  GeneratedImage
} from './types';

interface StableDiffusionConfig {
  baseUrl: string;
  apiKey?: string;
  timeout?: number;
  defaultModel?: string;
}

interface Txt2ImgRequest {
  prompt: string;
  negative_prompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfg_scale?: number;
  seed?: number;
  sampler_name?: string;
  batch_size?: number;
  n_iter?: number;
  restore_faces?: boolean;
  enable_hr?: boolean;
  hr_scale?: number;
  hr_upscaler?: string;
  override_settings?: Record<string, any>;
}

export class StableDiffusionProvider implements IAIProvider {
  readonly name: AIProviderType = 'stable-diffusion';
  readonly supportsText = false;
  readonly supportsImages = true;
  
  private baseUrl: string;
  private apiKey?: string;
  private timeout: number;
  private defaultModel?: string;
  
  constructor(config: StableDiffusionConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.timeout = config.timeout || 120000;
    this.defaultModel = config.defaultModel;
  }
  
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    
    return headers;
  }
  
  async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResponse> {
    const enhancedPrompt = this.enhanceTattooPrompt(request.prompt, request.style);
    
    const payload: Txt2ImgRequest = {
      prompt: enhancedPrompt,
      negative_prompt: request.negativePrompt || 
        'blurry, low quality, distorted, deformed, ugly, bad anatomy, watermark, signature, text, nsfw',
      width: request.width || 512,
      height: request.height || 512,
      steps: request.steps || 30,
      cfg_scale: request.cfgScale || 7.5,
      seed: request.seed || -1,
      sampler_name: request.sampler || 'DPM++ 2M Karras',
      batch_size: 1,
      n_iter: 1,
      restore_faces: false,
    };
    
    // Optionally switch model
    if (this.defaultModel) {
      payload.override_settings = {
        sd_model_checkpoint: this.defaultModel,
      };
    }
    
    const response = await fetch(`${this.baseUrl}/sdapi/v1/txt2img`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeout),
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Stable Diffusion API error: ${response.status} - ${error}`);
    }
    
    const data = await response.json() as any;
    
    const images: GeneratedImage[] = data.images.map((base64: string) => ({
      base64: `data:image/png;base64,${base64}`,
      width: payload.width!,
      height: payload.height!,
    }));
    
    // Extract seed from info
    let seed: number | undefined;
    if (data.info) {
      try {
        const info = JSON.parse(data.info);
        seed = info.seed;
      } catch {}
    }
    
    return {
      images,
      provider: this.name,
      model: this.defaultModel || 'stable-diffusion',
      seed,
    };
  }
  
  private enhanceTattooPrompt(prompt: string, style?: string): string {
    const styleEnhancements: Record<string, string> = {
      'traditional': '(american traditional tattoo:1.3), bold outlines, limited palette, flash sheet style',
      'neo-traditional': '(neo-traditional tattoo:1.3), illustrative, ornate, rich colors',
      'japanese': '(japanese irezumi:1.3), ukiyo-e style, waves, koi, dragon, cherry blossoms',
      'blackwork': '(blackwork tattoo:1.3), solid black, geometric, ornamental',
      'geometric': '(geometric tattoo:1.3), sacred geometry, mandala, precise lines, symmetry',
      'realism': '(realistic tattoo:1.3), photorealistic, detailed shading, hyperrealistic',
      'watercolor': '(watercolor tattoo:1.3), paint splashes, gradient, artistic, flowing',
      'minimalist': '(fine line tattoo:1.3), minimalist, delicate, simple, clean',
      'dotwork': '(dotwork tattoo:1.3), stippling, dot patterns, ornamental',
      'tribal': '(tribal tattoo:1.3), polynesian, maori, bold black patterns',
      'trash-polka': '(trash polka tattoo:1.3), red and black, realistic, abstract elements',
      'new-school': '(new school tattoo:1.3), cartoon style, vibrant colors, exaggerated',
    };
    
    const baseQuality = 'masterpiece, best quality, highly detailed, professional tattoo design, clean linework';
    const stylePrefix = style && styleEnhancements[style.toLowerCase().replace(/\s+/g, '-')] 
      ? styleEnhancements[style.toLowerCase().replace(/\s+/g, '-')] 
      : '(tattoo design:1.2)';
    
    return `${stylePrefix}, ${prompt}, ${baseQuality}`;
  }
  
  /**
   * Get available models
   */
  async getModels(): Promise<string[]> {
    const response = await fetch(`${this.baseUrl}/sdapi/v1/sd-models`, {
      headers: this.getHeaders(),
    });
    
    if (!response.ok) {
      throw new Error('Failed to fetch models');
    }
    
    const models = await response.json() as any;
    return models.map((m: any) => m.model_name || m.title);
  }
  
  /**
   * Get available samplers
   */
  async getSamplers(): Promise<string[]> {
    const response = await fetch(`${this.baseUrl}/sdapi/v1/samplers`, {
      headers: this.getHeaders(),
    });
    
    if (!response.ok) {
      throw new Error('Failed to fetch samplers');
    }
    
    const samplers = await response.json() as any;
    return samplers.map((s: any) => s.name);
  }
  
  async checkHealth(): Promise<{ healthy: boolean; message: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/sdapi/v1/progress`, {
        headers: this.getHeaders(),
      });
      
      if (response.ok) {
        const data = await response.json() as any;
        return {
          healthy: true,
          message: `Stable Diffusion operational (progress: ${Math.round(data.progress * 100)}%)`,
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
