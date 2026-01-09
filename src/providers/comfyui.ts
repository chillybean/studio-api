/**
 * ComfyUI AI Provider
 * 
 * Image generation using self-hosted ComfyUI instance
 * Supports custom workflows for tattoo-specific generation
 */

import { 
  IAIProvider, 
  AIProviderType, 
  ImageGenerationRequest, 
  ImageGenerationResponse,
  GeneratedImage
} from './types';

interface ComfyUIConfig {
  baseUrl: string;
  timeout?: number;
  customHeaders?: Record<string, string>;
}

interface ComfyUIWorkflow {
  prompt: Record<string, any>;
  client_id?: string;
}

export class ComfyUIProvider implements IAIProvider {
  readonly name: AIProviderType = 'comfyui';
  readonly supportsText = false;
  readonly supportsImages = true;
  
  private baseUrl: string;
  private timeout: number;
  private headers: Record<string, string>;
  
  constructor(config: ComfyUIConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.timeout = config.timeout || 120000; // 2 minutes default
    this.headers = config.customHeaders || {};
  }
  
  async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResponse> {
    // Build ComfyUI workflow for tattoo generation
    const workflow = this.buildTattooWorkflow(request);
    
    // Queue the prompt
    const queueResponse = await fetch(`${this.baseUrl}/prompt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.headers,
      },
      body: JSON.stringify(workflow),
    });
    
    if (!queueResponse.ok) {
      throw new Error(`ComfyUI queue failed: ${queueResponse.statusText}`);
    }
    
    const queueData = await queueResponse.json() as any;
    const promptId = queueData.prompt_id;
    
    // Poll for completion
    const images = await this.waitForCompletion(promptId);
    
    return {
      images,
      provider: this.name,
      model: 'comfyui-custom',
      seed: request.seed,
    };
  }
  
  private buildTattooWorkflow(request: ImageGenerationRequest): ComfyUIWorkflow {
    // Default tattoo-optimized workflow
    // This can be customized based on your ComfyUI setup
    const width = request.width || 512;
    const height = request.height || 512;
    const steps = request.steps || 30;
    const cfg = request.cfgScale || 7.5;
    const seed = request.seed || Math.floor(Math.random() * 2147483647);
    const sampler = request.sampler || 'euler_ancestral';
    
    // Enhance prompt for tattoo generation
    const tattooPrompt = this.enhanceTattooPrompt(request.prompt, request.style);
    const negativePrompt = request.negativePrompt || 
      'blurry, low quality, distorted, deformed, ugly, bad anatomy, watermark, signature, text';
    
    return {
      prompt: {
        // KSampler node
        "3": {
          "class_type": "KSampler",
          "inputs": {
            "seed": seed,
            "steps": steps,
            "cfg": cfg,
            "sampler_name": sampler,
            "scheduler": "normal",
            "denoise": 1,
            "model": ["4", 0],
            "positive": ["6", 0],
            "negative": ["7", 0],
            "latent_image": ["5", 0]
          }
        },
        // Load checkpoint
        "4": {
          "class_type": "CheckpointLoaderSimple",
          "inputs": {
            "ckpt_name": "tattoo_style_v1.safetensors" // Your tattoo model
          }
        },
        // Empty latent
        "5": {
          "class_type": "EmptyLatentImage",
          "inputs": {
            "width": width,
            "height": height,
            "batch_size": 1
          }
        },
        // Positive prompt
        "6": {
          "class_type": "CLIPTextEncode",
          "inputs": {
            "text": tattooPrompt,
            "clip": ["4", 1]
          }
        },
        // Negative prompt
        "7": {
          "class_type": "CLIPTextEncode",
          "inputs": {
            "text": negativePrompt,
            "clip": ["4", 1]
          }
        },
        // VAE Decode
        "8": {
          "class_type": "VAEDecode",
          "inputs": {
            "samples": ["3", 0],
            "vae": ["4", 2]
          }
        },
        // Save image
        "9": {
          "class_type": "SaveImage",
          "inputs": {
            "filename_prefix": "tattoo",
            "images": ["8", 0]
          }
        }
      },
      client_id: `tatlife-${Date.now()}`
    };
  }
  
  private enhanceTattooPrompt(prompt: string, style?: string): string {
    const styleEnhancements: Record<string, string> = {
      'traditional': 'american traditional tattoo style, bold lines, limited color palette, vintage flash art',
      'neo-traditional': 'neo-traditional tattoo, illustrative, rich colors, decorative elements',
      'japanese': 'japanese irezumi tattoo, oriental style, waves, clouds, traditional japanese art',
      'blackwork': 'blackwork tattoo, solid black ink, geometric patterns, tribal elements',
      'geometric': 'geometric tattoo, sacred geometry, precise lines, symmetrical patterns',
      'realism': 'realistic tattoo, photorealistic, detailed shading, 3D effect',
      'watercolor': 'watercolor tattoo, paint splashes, soft edges, vibrant colors, artistic',
      'minimalist': 'minimalist tattoo, fine line, simple, clean, delicate',
      'dotwork': 'dotwork tattoo, stippling, pointillism, intricate dot patterns',
      'tribal': 'tribal tattoo, bold black patterns, polynesian, maori style',
    };
    
    const baseEnhancement = 'tattoo design, clean lines, professional tattoo art, high detail';
    const stylePrefix = style && styleEnhancements[style.toLowerCase()] 
      ? styleEnhancements[style.toLowerCase()] 
      : '';
    
    return `${stylePrefix} ${prompt}, ${baseEnhancement}`.trim();
  }
  
  private async waitForCompletion(promptId: string): Promise<GeneratedImage[]> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < this.timeout) {
      const historyResponse = await fetch(`${this.baseUrl}/history/${promptId}`, {
        headers: this.headers,
      });
      
      if (historyResponse.ok) {
        const history = await historyResponse.json() as any;
        
        if (history[promptId] && history[promptId].outputs) {
          const outputs = history[promptId].outputs;
          const images: GeneratedImage[] = [];
          
          for (const nodeId in outputs) {
            if (outputs[nodeId].images) {
              for (const img of outputs[nodeId].images) {
                // Get image data
                const imageUrl = `${this.baseUrl}/view?filename=${img.filename}&subfolder=${img.subfolder || ''}&type=${img.type || 'output'}`;
                images.push({
                  url: imageUrl,
                  width: 512, // Default, actual size from metadata
                  height: 512,
                });
              }
            }
          }
          
          if (images.length > 0) {
            return images;
          }
        }
      }
      
      // Wait before polling again
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    throw new Error('ComfyUI generation timeout');
  }
  
  async checkHealth(): Promise<{ healthy: boolean; message: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/system_stats`, {
        headers: this.headers,
      });
      
      if (response.ok) {
        return {
          healthy: true,
          message: 'ComfyUI is operational',
        };
      }
      
      return {
        healthy: false,
        message: `ComfyUI returned ${response.status}`,
      };
    } catch (error: any) {
      return {
        healthy: false,
        message: `ComfyUI connection failed: ${error.message}`,
      };
    }
  }
}
