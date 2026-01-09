/**
 * Custom LLM Provider
 * 
 * Supports self-hosted LLMs via OpenAI-compatible API
 * Works with: Ollama, vLLM, text-generation-inference, LocalAI, LM Studio, etc.
 * Can be hosted on: Railway, RunPod, Vast.ai, local machine, etc.
 */

import { 
  IAIProvider, 
  AIProviderType, 
  TextGenerationRequest, 
  TextGenerationResponse 
} from './types';

interface CustomLLMConfig {
  baseUrl: string;
  apiKey?: string;
  model?: string;
  timeout?: number;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionRequest {
  model: string;
  messages: ChatCompletionMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
}

interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: ChatCompletionMessage;
    finish_reason: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class CustomLLMProvider implements IAIProvider {
  readonly name: AIProviderType = 'custom-llm';
  readonly supportsText = true;
  readonly supportsImages = false;
  
  private baseUrl: string;
  private apiKey?: string;
  private model: string;
  private timeout: number;
  private maxTokens: number;
  private temperature: number;
  private systemPrompt: string;
  
  constructor(config: CustomLLMConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.model = config.model || 'default';
    this.timeout = config.timeout || 60000;
    this.maxTokens = config.maxTokens || 2048;
    this.temperature = config.temperature || 0.7;
    this.systemPrompt = config.systemPrompt || 
      'You are an expert tattoo artist and consultant with 20+ years of experience.';
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
  
  async generateText(request: TextGenerationRequest): Promise<TextGenerationResponse> {
    const messages: ChatCompletionMessage[] = [];
    
    // Add system prompt
    const systemPrompt = request.systemPrompt || this.systemPrompt;
    if (systemPrompt) {
      messages.push({
        role: 'system',
        content: systemPrompt,
      });
    }
    
    // Add user message
    messages.push({
      role: 'user',
      content: request.prompt,
    });
    
    const payload: ChatCompletionRequest = {
      model: this.model,
      messages,
      max_tokens: request.maxTokens || this.maxTokens,
      temperature: request.temperature || this.temperature,
      stream: false,
    };
    
    // Try OpenAI-compatible endpoint first
    let endpoint = `${this.baseUrl}/v1/chat/completions`;
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeout),
    });
    
    if (!response.ok) {
      // Try alternative endpoint format (some servers use different paths)
      endpoint = `${this.baseUrl}/chat/completions`;
      const retryResponse = await fetch(endpoint, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeout),
      });
      
      if (!retryResponse.ok) {
        const error = await response.text();
        throw new Error(`Custom LLM API error: ${response.status} - ${error}`);
      }
      
      return this.parseResponse(await retryResponse.json());
    }
    
    return this.parseResponse(await response.json());
  }
  
  private parseResponse(data: ChatCompletionResponse): TextGenerationResponse {
    const choice = data.choices[0];
    
    return {
      text: choice?.message?.content || '',
      provider: this.name,
      model: data.model || this.model,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      } : undefined,
    };
  }
  
  /**
   * Get available models from the server
   */
  async getModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        headers: this.getHeaders(),
      });
      
      if (!response.ok) {
        return [this.model];
      }
      
      const data = await response.json();
      return data.data?.map((m: any) => m.id) || [this.model];
    } catch {
      return [this.model];
    }
  }
  
  async checkHealth(): Promise<{ healthy: boolean; message: string }> {
    try {
      // Try models endpoint first
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      
      if (response.ok) {
        const data = await response.json();
        const modelCount = data.data?.length || 0;
        return {
          healthy: true,
          message: `Custom LLM operational (${modelCount} models available)`,
        };
      }
      
      // Try health endpoint
      const healthResponse = await fetch(`${this.baseUrl}/health`, {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      
      if (healthResponse.ok) {
        return {
          healthy: true,
          message: 'Custom LLM operational',
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

/**
 * Factory function for common self-hosted LLM setups
 */
export const CustomLLMPresets = {
  /**
   * Ollama local instance
   */
  ollama: (model: string = 'llama2') => new CustomLLMProvider({
    baseUrl: 'http://localhost:11434',
    model,
  }),
  
  /**
   * Railway deployment
   */
  railway: (projectUrl: string, apiKey?: string, model?: string) => new CustomLLMProvider({
    baseUrl: projectUrl,
    apiKey,
    model: model || 'default',
  }),
  
  /**
   * RunPod serverless
   */
  runpod: (endpointId: string, apiKey: string, model?: string) => new CustomLLMProvider({
    baseUrl: `https://api.runpod.ai/v2/${endpointId}/openai`,
    apiKey,
    model: model || 'default',
  }),
  
  /**
   * vLLM server
   */
  vllm: (baseUrl: string, model: string) => new CustomLLMProvider({
    baseUrl,
    model,
  }),
  
  /**
   * LocalAI instance
   */
  localai: (baseUrl: string = 'http://localhost:8080', model?: string) => new CustomLLMProvider({
    baseUrl,
    model: model || 'gpt-3.5-turbo',
  }),
  
  /**
   * LM Studio
   */
  lmstudio: (model?: string) => new CustomLLMProvider({
    baseUrl: 'http://localhost:1234',
    model: model || 'local-model',
  }),
};
