/**
 * ingestion/embedder.js — Claude text generation via Amazon Bedrock.
 *
 * callClaude()     — plain text response
 * callClaudeJson() — expects JSON response, retries once on throttle
 * callGemini() / callGeminiJson() — aliases kept for compatibility with enricher/translator
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { config }  from '../utils/config.js';
import { logger }  from '../utils/logger.js';

const client     = new BedrockRuntimeClient({ region: config.AWS_REGION });
const TEXT_MODEL = config.BEDROCK_TEXT_MODEL_ID;

export async function callGemini(prompt, { maxTokens = 300 } = {}) {
  return callClaude(prompt, { maxTokens });
}

export async function callClaude(prompt, { maxTokens = 300 } = {}) {
  const res = await client.send(new InvokeModelCommand({
    modelId:     TEXT_MODEL,
    contentType: 'application/json',
    accept:      'application/json',
    body:        JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens:        maxTokens,
      messages:          [{ role: 'user', content: prompt }],
    }),
  }));
  const body = JSON.parse(new TextDecoder().decode(res.body));
  return body.content[0].text;
}

export async function callGeminiJson(system, prompt, { maxTokens = 1000 } = {}) {
  return callClaudeJson(system, prompt, { maxTokens });
}

/**
 * Claude commonly wraps JSON responses in a ```json fence despite instructions.
 * Strips the fence so the caller can parse the payload directly. A truncated
 * response has no closing fence, so the trailing fence is optional.
 *
 * @param {string} text
 * @returns {string}
 */
function stripCodeFence(text) {
  const s = text.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)(?:\n```)?\s*$/.exec(s);
  return fenced ? fenced[1].trim() : s;
}

export async function callClaudeJson(system, prompt, { maxTokens = 1000 } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await client.send(new InvokeModelCommand({
        modelId:     TEXT_MODEL,
        contentType: 'application/json',
        accept:      'application/json',
        body:        JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens:        maxTokens,
          system,
          messages:          [{ role: 'user', content: prompt }],
        }),
      }));
      const body = JSON.parse(new TextDecoder().decode(res.body));
      return stripCodeFence(body.content[0].text);
    } catch (err) {
      const throttled = err.name === 'ThrottlingException' || err.$metadata?.httpStatusCode === 429;
      if (throttled && attempt === 0) {
        logger.warn('Claude JSON retry', { status: err.$metadata?.httpStatusCode });
        await sleep(2000);
      } else {
        throw new Error(`Claude JSON error: ${err.message}`);
      }
    }
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
