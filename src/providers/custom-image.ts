/**
 * Custom Image Generation Provider
 * 
 * Supports self-hosted image generation APIs (Railway, RunPod, etc.)
 * Works with OpenAI-compatible image APIs and custom endpoints
 */

import { 
  IAIProvider, 
  AIProviderType, 
  ImageGenerationRequest, 
  ImageGenerationResponse,
  GeneratedImage
} from './types';

interface CustomImageConfig {
  baseUrl: string;
  apiKey?: string;
  model?: string;
  timeout?: number;
  apiFormat?: 'openai' | 'comfyui' | 'a1111' | 'custom';
}

interface OpenAIImageRequest {
  model?: string;
  prompt: string;
  n?: number;
  size?: string;
  quality?: string;
  response_format?: 'url' | 'b64_json';
}

export class CustomImageProvider implements IAIProvider {
  readonly name: AIProviderType = 'custom-llm';
  readonly supportsText = false;
  readonly supportsImages = true;
  
  private baseUrl: string;
  private apiKey?: string;
  private model: string;
  private timeout: number;
  private apiFormat: string;
  
  constructor(config: CustomImageConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.model = config.model || 'default';
    this.timeout = config.timeout || 120000;
    this.apiFormat = config.apiFormat || 'openai';
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
    switch (this.apiFormat) {
      case 'openai':
        return this.generateOpenAIFormat(request);
      case 'a1111':
        return this.generateA1111Format(request);
      case 'custom':
        return this.generateCustomFormat(request);
      default:
        return this.generateOpenAIFormat(request);
    }
  }
  
  /**
   * OpenAI Images API compatible format
   */
  private async generateOpenAIFormat(request: ImageGenerationRequest): Promise<ImageGenerationResponse> {
    const enhancedPrompt = this.enhanceTattooPrompt(request.prompt, request.style);
    
    const size = this.mapToOpenAISize(request.width, request.height);
    
    const payload: OpenAIImageRequest = {
      model: this.model,
      prompt: enhancedPrompt,
      n: 1,
      size,
      response_format: 'b64_json',
    };
    
    const response = await fetch(`${this.baseUrl}/v1/images/generations`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeout),
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Image API error: ${response.status} - ${error}`);
    }
    
    const data = await response.json() as any;
    
    const images: GeneratedImage[] = data.data.map((img: any) => ({
      base64: img.b64_json ? `data:image/png;base64,${img.b64_json}` : undefined,
      url: img.url,
      width: request.width || 1024,
      height: request.height || 1024,
    }));
    
    return {
      images,
      provider: this.name,
      model: this.model,
    };
  }
  
  /**
   * Automatic1111 WebUI API format (for self-hosted SD)
   */
  private async generateA1111Format(request: ImageGenerationRequest): Promise<ImageGenerationResponse> {
    const enhancedPrompt = this.enhanceTattooPrompt(request.prompt, request.style);
    
    const payload = {
      prompt: enhancedPrompt,
      negative_prompt: request.negativePrompt || 
        'blurry, low quality, distorted, watermark, text, nsfw',
      width: request.width || 512,
      height: request.height || 512,
      steps: request.steps || 30,
      cfg_scale: request.cfgScale || 7.5,
      seed: request.seed || -1,
      sampler_name: request.sampler || 'DPM++ 2M Karras',
      batch_size: 1,
    };
    
    const response = await fetch(`${this.baseUrl}/sdapi/v1/txt2img`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeout),
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`A1111 API error: ${response.status} - ${error}`);
    }
    
    const data = await response.json() as any;
    
    const images: GeneratedImage[] = data.images.map((base64: string) => ({
      base64: `data:image/png;base64,${base64}`,
      width: payload.width,
      height: payload.height,
    }));
    
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
      model: this.model,
      seed,
    };
  }
  
  /**
   * Custom API format - flexible for any endpoint
   */
  private async generateCustomFormat(request: ImageGenerationRequest): Promise<ImageGenerationResponse> {
    const enhancedPrompt = this.enhanceTattooPrompt(request.prompt, request.style);
    
    // Generic payload that works with most image APIs
    const payload = {
      prompt: enhancedPrompt,
      negative_prompt: request.negativePrompt,
      width: request.width || 512,
      height: request.height || 512,
      steps: request.steps || 30,
      guidance_scale: request.cfgScale || 7.5,
      seed: request.seed,
      style: request.style,
      model: this.model,
    };
    
    // Try common endpoint patterns
    const endpoints = [
      '/generate',
      '/v1/generate',
      '/api/generate',
      '/predict',
      '/inference',
    ];
    
    let response: Response | null = null;
    let lastError = '';
    
    for (const endpoint of endpoints) {
      try {
        response = await fetch(`${this.baseUrl}${endpoint}`, {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this.timeout),
        });
        
        if (response.ok) break;
        lastError = `${endpoint}: ${response.status}`;
      } catch (e: any) {
        lastError = `${endpoint}: ${e.message}`;
      }
    }
    
    if (!response || !response.ok) {
      throw new Error(`Custom image API error: ${lastError}`);
    }
    
    const data = await response.json() as any;
    
    // Handle various response formats
    const images: GeneratedImage[] = [];
    
    if (data.images) {
      // Array of images
      for (const img of Array.isArray(data.images) ? data.images : [data.images]) {
        images.push(this.parseImageResponse(img, request.width, request.height));
      }
    } else if (data.image) {
      images.push(this.parseImageResponse(data.image, request.width, request.height));
    } else if (data.output) {
      // Some APIs use 'output'
      for (const img of Array.isArray(data.output) ? data.output : [data.output]) {
        images.push(this.parseImageResponse(img, request.width, request.height));
      }
    } else if (data.data) {
      // OpenAI-like format
      for (const img of data.data) {
        images.push(this.parseImageResponse(img, request.width, request.height));
      }
    }
    
    return {
      images,
      provider: this.name,
      model: this.model,
      seed: data.seed,
    };
  }
  
  private parseImageResponse(img: any, width?: number, height?: number): GeneratedImage {
    if (typeof img === 'string') {
      // Could be URL or base64
      if (img.startsWith('http')) {
        return { url: img, width: width || 512, height: height || 512 };
      } else if (img.startsWith('data:')) {
        return { base64: img, width: width || 512, height: height || 512 };
      } else {
        // Assume base64 without prefix
        return { base64: `data:image/png;base64,${img}`, width: width || 512, height: height || 512 };
      }
    } else if (typeof img === 'object') {
      return {
        url: img.url,
        base64: img.base64 || img.b64_json ? 
          (img.b64_json ? `data:image/png;base64,${img.b64_json}` : img.base64) : undefined,
        width: img.width || width || 512,
        height: img.height || height || 512,
      };
    }
    
    throw new Error('Unknown image response format');
  }
  
  private mapToOpenAISize(width?: number, height?: number): string {
    if (!width || !height) return '1024x1024';
    
    // Map to closest OpenAI supported size
    const sizes = ['256x256', '512x512', '1024x1024', '1024x1792', '1792x1024'];
    
    if (width > height * 1.5) return '1792x1024';
    if (height > width * 1.5) return '1024x1792';
    if (width <= 384) return '256x256';
    if (width <= 768) return '512x512';
    return '1024x1024';
  }
  
  private enhanceTattooPrompt(prompt: string, style?: string): string {
    const styleEnhancements: Record<string, string> = {
      'traditional': 'american traditional tattoo flash, bold outlines',
      'neo-traditional': 'neo-traditional tattoo design, illustrative',
      'japanese': 'japanese irezumi tattoo, ukiyo-e',
      'blackwork': 'blackwork tattoo, solid black, geometric',
      'geometric': 'geometric tattoo, sacred geometry',
      'realism': 'realistic tattoo, photorealistic',
      'watercolor': 'watercolor tattoo art',
      'minimalist': 'minimalist tattoo, fine line',
      'dotwork': 'dotwork tattoo, stippling',
      'tribal': 'tribal tattoo, polynesian',
    };
    
    const stylePrefix = style && styleEnhancements[style.toLowerCase()] 
      ? styleEnhancements[style.toLowerCase()] 
      : 'tattoo design';
    
    return `${stylePrefix}, ${prompt}, professional tattoo art, clean lines`;
  }
  
  /**
   * Get server info/models
   */
  async getServerInfo(): Promise<any> {
    try {
      // Try various info endpoints
      const endpoints = ['/info', '/v1/models', '/api/info', '/health'];
      
      for (const endpoint of endpoints) {
        try {
          const response = await fetch(`${this.baseUrl}${endpoint}`, {
            headers: this.getHeaders(),
            signal: AbortSignal.timeout(5000),
          });
          
          if (response.ok) {
            return await response.json();
          }
        } catch {}
      }
      
      return null;
    } catch {
      return null;
    }
  }
  
  async checkHealth(): Promise<{ healthy: boolean; message: string }> {
    try {
      const info = await this.getServerInfo();
      
      if (info) {
        return {
          healthy: true,
          message: `Custom image server operational${info.model ? ` (${info.model})` : ''}`,
        };
      }
      
      // If no info endpoint, try a simple GET
      const response = await fetch(this.baseUrl, {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      
      return {
        healthy: response.ok || response.status === 404, // 404 means server is up
        message: response.ok ? 'Server responding' : `Server returned ${response.status}`,
      };
    } catch (error: any) {
      return {
        healthy: false,
        message: `Connection failed: ${error.message}`,
      };
    }
  }
}

/**
 * Factory presets for common self-hosted image generation setups
 */
export const CustomImagePresets = {
  /**
   * Railway deployment with OpenAI-compatible API
   */
  railway: (projectUrl: string, apiKey?: string, model?: string) => new CustomImageProvider({
    baseUrl: projectUrl,
    apiKey,
    model: model || 'default',
    apiFormat: 'openai',
  }),
  
  /**
   * Railway with Automatic1111 WebUI
   */
  railwayA1111: (projectUrl: string, apiKey?: string, model?: string) => new CustomImageProvider({
    baseUrl: projectUrl,
    apiKey,
    model,
    apiFormat: 'a1111',
  }),
  
  /**
   * RunPod serverless SD
   */
  runpod: (endpointId: string, apiKey: string) => new CustomImageProvider({
    baseUrl: `https://api.runpod.ai/v2/${endpointId}`,
    apiKey,
    apiFormat: 'custom',
  }),
  
  /**
   * Replicate API
   */
  replicate: (apiKey: string, model?: string) => new CustomImageProvider({
    baseUrl: 'https://api.replicate.com',
    apiKey,
    model: model || 'stability-ai/sdxl',
    apiFormat: 'custom',
  }),
  
  /**
   * Hugging Face Inference API
   */
  huggingface: (apiKey: string, model?: string) => new CustomImageProvider({
    baseUrl: 'https://api-inference.huggingface.co',
    apiKey,
    model: model || 'stabilityai/stable-diffusion-xl-base-1.0',
    apiFormat: 'custom',
  }),
  
  /**
   * Local Automatic1111 WebUI
   */
  localA1111: (port: number = 7860) => new CustomImageProvider({
    baseUrl: `http://localhost:${port}`,
    apiFormat: 'a1111',
  }),
  
  /**
   * Generic custom endpoint
   */
  custom: (baseUrl: string, apiKey?: string) => new CustomImageProvider({
    baseUrl,
    apiKey,
    apiFormat: 'custom',
  }),
};
