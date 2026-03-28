/**
 * Token counter — tracks input/output tokens across LLM API calls.
 * Wraps provider-specific response formats into a unified counter.
 */

export class TokenCounter {
  constructor() {
    this.calls = [];
    this.totalInput = 0;
    this.totalOutput = 0;
  }

  /**
   * Record a single API call's token usage.
   * Accepts provider-specific response formats and normalizes them.
   */
  record(response, provider = 'anthropic') {
    let input = 0;
    let output = 0;

    switch (provider) {
      case 'anthropic': {
        // Anthropic: response.usage.input_tokens, response.usage.output_tokens
        input = response?.usage?.input_tokens || 0;
        output = response?.usage?.output_tokens || 0;
        break;
      }
      case 'openai': {
        // OpenAI: response.usage.prompt_tokens, response.usage.completion_tokens
        input = response?.usage?.prompt_tokens || 0;
        output = response?.usage?.completion_tokens || 0;
        break;
      }
      case 'moonshot': {
        // Moonshot/Kimi: same as OpenAI format
        input = response?.usage?.prompt_tokens || 0;
        output = response?.usage?.completion_tokens || 0;
        break;
      }
      default: {
        // Try common patterns
        input = response?.usage?.input_tokens || response?.usage?.prompt_tokens || 0;
        output = response?.usage?.output_tokens || response?.usage?.completion_tokens || 0;
      }
    }

    this.calls.push({
      timestamp: Date.now(),
      input,
      output,
      total: input + output,
      provider,
    });

    this.totalInput += input;
    this.totalOutput += output;
  }

  /**
   * Estimate cost in USD based on provider pricing.
   * Pricing as of March 2026 — update as needed.
   */
  estimateCost(provider = 'anthropic', model = '') {
    // Rough pricing per 1M tokens (input / output)
    const pricing = {
      'claude-opus-4-6': { input: 15, output: 75 },
      'claude-sonnet-4-6': { input: 3, output: 15 },
      'gpt-5.4': { input: 2.50, output: 10 },
      'kimi-k2': { input: 0.60, output: 2.40 },
      'llama-4-maverick': { input: 0.20, output: 0.60 },
    };

    const rates = pricing[model] || pricing['claude-opus-4-6'];
    const inputCost = (this.totalInput / 1_000_000) * rates.input;
    const outputCost = (this.totalOutput / 1_000_000) * rates.output;

    return {
      inputCost: Math.round(inputCost * 10000) / 10000,
      outputCost: Math.round(outputCost * 10000) / 10000,
      totalCost: Math.round((inputCost + outputCost) * 10000) / 10000,
      currency: 'USD',
    };
  }

  get summary() {
    return {
      inputTokens: this.totalInput,
      outputTokens: this.totalOutput,
      totalTokens: this.totalInput + this.totalOutput,
      apiCalls: this.calls.length,
      callDetails: this.calls,
    };
  }

  reset() {
    this.calls = [];
    this.totalInput = 0;
    this.totalOutput = 0;
  }
}
