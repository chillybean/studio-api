/**
 * Google Gemini AI Provider
 * 
 * Text generation using Google's Gemini Pro model
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { 
  IAIProvider, 
  AIProviderType, 
  TextGenerationRequest, 
  TextGenerationResponse 
} from './types';

export class GeminiProvider implements IAIProvider {
  readonly name: AIProviderType = 'gemini';
  readonly supportsText = true;
  readonly supportsImages = false; // Gemini Pro is text-only, Gemini Pro Vision can analyze but not generate
  
  private model: any;
  private modelName: string;
  
  constructor(apiKey: string, modelName: string = 'gemini-pro') {
    const genAI = new GoogleGenerativeAI(apiKey);
    this.model = genAI.getGenerativeModel({ model: modelName });
    this.modelName = modelName;
  }
  
  async generateText(request: TextGenerationRequest): Promise<TextGenerationResponse> {
    const prompt = request.systemPrompt 
      ? `${request.systemPrompt}\n\n${request.prompt}`
      : request.prompt;
    
    const result = await this.model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    return {
      text,
      provider: this.name,
      model: this.modelName,
    };
  }
  
  async checkHealth(): Promise<{ healthy: boolean; message: string }> {
    try {
      const result = await this.model.generateContent('Say "OK" if you are working.');
      const response = await result.response;
      return {
        healthy: response.text().toLowerCase().includes('ok'),
        message: 'Gemini API is operational',
      };
    } catch (error: any) {
      return {
        healthy: false,
        message: `Gemini API error: ${error.message}`,
      };
    }
  }
}
