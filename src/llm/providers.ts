export const KIMI_DEFAULT_BASE_URL = 'https://api.moonshot.ai/v1';
export const KIMI_DEFAULT_MODEL = 'kimi-k2.6';
export const KIMI_MODELS = [
  'kimi-k2.6',
  'kimi-k2.5',
  'moonshot-v1-auto',
  'moonshot-v1-8k',
  'moonshot-v1-32k',
  'moonshot-v1-128k',
  'moonshot-v1-8k-vision-preview',
  'moonshot-v1-32k-vision-preview',
  'moonshot-v1-128k-vision-preview',
];

export const GROQ_DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1';
export const GROQ_DEFAULT_MODEL = 'openai/gpt-oss-20b';
export const GROQ_MODELS = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'qwen/qwen3-32b',
  'deepseek-r1-distill-llama-70b',
  'compound-beta',
  'compound-beta-mini',
];

export const GEMINI_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
export const GEMINI_DEFAULT_MODEL = 'models/gemini-3.5-flash';

export const GEMINI_BEST_FIT_MODELS = [
  'models/gemini-3.5-flash',
  'models/gemini-flash-latest',
  'models/gemini-3-flash-preview',
  'models/gemini-3.1-flash-lite',
  'models/gemini-2.5-flash-lite',
];

export const GEMINI_CHEAP_MODELS = [
  'models/gemini-flash-lite-latest',
  'models/gemini-3.1-flash-lite-preview',
  'models/gemma-4-26b-a4b-it',
];

export const GEMINI_RECOMMENDED_MODELS = [...GEMINI_BEST_FIT_MODELS, ...GEMINI_CHEAP_MODELS];
