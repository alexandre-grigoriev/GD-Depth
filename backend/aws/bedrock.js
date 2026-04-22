/**
 * aws/bedrock.js — Amazon Bedrock Knowledge Base operations.
 *
 * retrieveFromKB(query, topK)  — vector similarity search via Bedrock KB retrieve().
 * syncKnowledgeBase()          — triggers an ingestion job to sync S3 → KB index.
 * getIngestionJobStatus(jobId) — polls a running ingestion job.
 */

import { BedrockAgentRuntimeClient, RetrieveCommand } from '@aws-sdk/client-bedrock-agent-runtime';
import { BedrockAgentClient, StartIngestionJobCommand, GetIngestionJobCommand } from '@aws-sdk/client-bedrock-agent';
import { config }  from '../utils/config.js';
import { logger }  from '../utils/logger.js';

const runtimeClient = new BedrockAgentRuntimeClient({ region: config.AWS_REGION });
const agentClient   = new BedrockAgentClient({ region: config.AWS_REGION });

/**
 * Retrieves the top-K most relevant chunks from the Bedrock Knowledge Base.
 *
 * @param {string} query
 * @param {number} [topK=10]
 * @returns {Promise<Array<{ text: string, score: number, sourceUri: string | null }>>}
 */
export async function retrieveFromKB(query, topK = 10) {
  const response = await runtimeClient.send(new RetrieveCommand({
    knowledgeBaseId: config.KB_ID,
    retrievalQuery:  { text: query },
    retrievalConfiguration: {
      vectorSearchConfiguration: {
        numberOfResults:    topK,
        overrideSearchType: 'SEMANTIC',
      },
    },
  }));

  return (response.retrievalResults ?? []).map(r => ({
    text:      r.content?.text ?? '',
    score:     r.score         ?? 0,
    sourceUri: r.location?.s3Location?.uri ?? null,
  }));
}

/**
 * Starts a Bedrock KB ingestion job to sync the S3 data source with the vector index.
 * Returns the jobId for optional status polling.
 *
 * @returns {Promise<string>} ingestionJobId
 */
export async function syncKnowledgeBase() {
  try {
    const response = await agentClient.send(new StartIngestionJobCommand({
      knowledgeBaseId: config.KB_ID,
      dataSourceId:    config.KB_DATA_SOURCE_ID,
    }));
    const jobId = response.ingestionJob?.ingestionJobId ?? 'unknown';
    logger.info('KB sync started', { jobId });
    return jobId;
  } catch (err) {
    // Log but don't throw — document is already uploaded to S3, sync failure is non-fatal
    logger.warn('KB sync failed to start', { error: err.message });
    return null;
  }
}

/**
 * Gets the status of a running ingestion job.
 *
 * @param {string} jobId
 * @returns {Promise<string>} status: 'STARTING' | 'IN_PROGRESS' | 'COMPLETE' | 'FAILED'
 */
export async function getIngestionJobStatus(jobId) {
  const response = await agentClient.send(new GetIngestionJobCommand({
    knowledgeBaseId: config.KB_ID,
    dataSourceId:    config.KB_DATA_SOURCE_ID,
    ingestionJobId:  jobId,
  }));
  return response.ingestionJob?.status ?? 'UNKNOWN';
}
