/**
 * AI Provider Interface
 * 
 * Abstract interface for AI providers to enable swapping between:
 * - Google Gemini (text + image generation)
 * - ComfyUI (image generation)
 * - Stable Diffusion (image generation)
 * - Custom self-hosted LLMs (Railway, RunPod, etc.)
 * - Custom self-hosted Image Gen (Railway, RunPod, etc.)
 */

export interface AIProviderConfig {
  provider: AIProviderType;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeout?: number;
  customHeaders?: Record<string, string>;
}

export type AIProviderType = 
  | 'gemini' 
  | 'gemini-imagen'
  | 'openai' 
  | 'comfyui' 
  | 'stable-diffusion' 
  | 'custom-llm'
  | 'custom-image'
  | 'replicate'
  | 'runway'
  | 'huggingface';

export interface TextGenerationRequest {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

export interface TextGenerationResponse {
  text: string;
  provider: AIProviderType;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ImageGenerationRequest {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfgScale?: number;
  seed?: number;
  style?: string;
  sampler?: string;
}

export interface ImageGenerationResponse {
  images: GeneratedImage[];
  provider: AIProviderType;
  model: string;
  seed?: number;
}

export interface GeneratedImage {
  url?: string;
  base64?: string;
  width: number;
  height: number;
}

export interface DesignSuggestion {
  text: string;
  images?: GeneratedImage[];
  provider: AIProviderType;
}

/**
 * Base AI Provider Interface
 */
export interface IAIProvider {
  readonly name: AIProviderType;
  readonly supportsText: boolean;
  readonly supportsImages: boolean;
  
  // Text generation (for design suggestions, chat)
  generateText?(request: TextGenerationRequest): Promise<TextGenerationResponse>;
  
  // Image generation (for tattoo visualizations)
  generateImage?(request: ImageGenerationRequest): Promise<ImageGenerationResponse>;
  
  // Health check
  checkHealth(): Promise<{ healthy: boolean; message: string }>;
}

/**
 * Tattoo-specific design request
 */
export interface TattooDesignRequest {
  description: string;
  style?: string;
  placement?: string;
  size?: 'small' | 'medium' | 'large' | 'extra-large';
  colorPreference?: 'black-grey' | 'color' | 'watercolor' | 'no-preference';
  additionalNotes?: string;
  generateImage?: boolean; // Whether to also generate a visual
}

export interface TattooDesignResponse {
  suggestion: string;
  images?: GeneratedImage[];
  providers: {
    text: AIProviderType;
    image?: AIProviderType;
  };
  generatedAt: string;
}
