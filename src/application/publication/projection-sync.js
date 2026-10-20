/**
 * Asynchronous publication coordination for Stage 3.
 *
 * The module is deliberately AWS-free. State persistence, SQS delivery, and
 * publication are ports injected by the Lambda/runtime boundary, which keeps
 * all unit tests offline and makes duplicate Standard-queue delivery safe.
 */
import { PUBLICATION_STATUS } from '../../domain/catalog-contracts.js';

export const PROJECTION_JOB_SCHEMA_VERSION = 'stage3-projection-job-v1';
export const PUBLICATION_STATE_KEY = 'PUBLICATION#STATE';
export const MAX_CATALOG_VERSION = Number.MAX_SAFE_INTEGER;

const SAFE_OWNER = /^[^#\u0000-\u001f\u007f]+$/u;
const SAFE_CORRELATION_ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const SAFE_RELEASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SAFE_CAUSE = /^[A-Z][A-Z0-9_-]{1,63}$/u;

const CAUSE_CODES = Object.freeze({
  VALIDATION: 'VALIDATION_FAILED',
  VERSION: 'VERSION_CONFLICT',
  COLLISION: 'RELEASE_COLLISION',
  DEPENDENCY: 'DEPENDENCY_UNAVAILABLE',
  TIMEOUT: 'PUBLICATION_TIMEOUT',
  UNKNOWN: 'PROJECTION_FAILED',
});

/**
 * Creates the only message shape accepted by the projection consumer.
 * `catalogVersion` is the logical idempotency key; no FIFO group/dedup key is
 * needed because the worker guards publication by this version.
 */
export function createProjectionJob({
  ownerId,
  catalogVersion,
  correlationId = undefined,
  requestedAt = new Date().toISOString(),
} = {}) {
  assertOwnerId(ownerId);
  assertCatalogVersion(catalogVersion);
  if (typeof requestedAt !== 'string' || Number.isNaN(Date.parse(requestedAt))) {
    throw new TypeError('requestedAt must be an ISO datetime');
  }
  const job = {
    schemaVersion: PROJECTION_JOB_SCHEMA_VERSION,
    ownerId,
    catalogVersion,
    requestedAt,
  };
  if (correlationId !== undefined) {
    if (typeof correlationId !== 'string' || !SAFE_CORRELATION_ID.test(correlationId)) {
      throw new TypeError('correlationId must be a safe identifier');
    }
    job.correlationId = correlationId;
  }
  return Object.freeze(job);
}

export function assertProjectionJob(job) {
  if (!job || typeof job !== 'object' || Array.isArray(job)) {
    throw new TypeError('Projection job must be an object');
  }
  if (job.schemaVersion !== PROJECTION_JOB_SCHEMA_VERSION) {
    throw new TypeError('Projection job schemaVersion is unsupported');
  }
  assertOwnerId(job.ownerId);
  assertCatalogVersion(job.catalogVersion);
  if (typeof job.requestedAt !== 'string' || Number.isNaN(Date.parse(job.requestedAt))) {
    throw new TypeError('Projection job requestedAt is invalid');
  }
  if (job.correlationId !== undefined
    && (typeof job.correlationId !== 'string' || !SAFE_CORRELATION_ID.test(job.correlationId))) {
    throw new TypeError('Projection job correlationId is invalid');
  }
  return job;
}

export function createPublicationState({
  catalogVersion = 0,
  projectionVersion = null,
  status = PUBLICATION_STATUS.PENDING,
  releaseId = null,
  updatedAt = new Date().toISOString(),
  reason = null,
} = {}) {
  assertCatalogVersion(catalogVersion, { allowZero: true });
  if (projectionVersion !== null) assertCatalogVersion(projectionVersion, { allowZero: true });
  if (!Object.values(PUBLICATION_STATUS).includes(status)) {
    throw new TypeError('Publication status is invalid');
  }
  if (releaseId !== null && (typeof releaseId !== 'string' || !SAFE_RELEASE_ID.test(releaseId))) {
    throw new TypeError('releaseId is invalid');
  }
  if (typeof updatedAt !== 'string' || Number.isNaN(Date.parse(updatedAt))) {
    throw new TypeError('updatedAt must be an ISO datetime');
  }
  if (reason !== null && (typeof reason !== 'string' || !SAFE_CAUSE.test(reason))) {
    throw new TypeError('Publication reason must be a sanitized cause code');
  }
  return Object.freeze({
    status,
    catalogVersion,
    projectionVersion,
    releaseId,
    updatedAt,
    reason,
  });
}

/**
 * Maps provider/domain failures to a stable code. Raw messages, causes,
 * credentials, URLs, claims and stack traces never enter publication state.
 */
export function sanitizePublicationCause(error) {
  const code = String(error?.code ?? error?.name ?? '').toUpperCase();
  const message = String(error?.message ?? '').toUpperCase();
  if (code.includes('VALIDATION') || code.startsWith('INVALID_') || message.includes('VALIDAT')) {
    return CAUSE_CODES.VALIDATION;
  }
  if (code.includes('CONDITIONAL') || code.includes('VERSION') || message.includes('STALE')) {
    return CAUSE_CODES.VERSION;
  }
  if (code.includes('COLLISION') || code.includes('EXISTS') || message.includes('COLLISION')) {
    return CAUSE_CODES.COLLISION;
  }
  if (code.includes('TIMEOUT') || message.includes('TIMEOUT')) return CAUSE_CODES.TIMEOUT;
  if (code.includes('THROTTL') || code.includes('SERVICE') || code.includes('UNAVAILABLE')
    || code.includes('NETWORK') || code.includes('TRANSIENT')) {
    return CAUSE_CODES.DEPENDENCY;
  }
  return CAUSE_CODES.UNKNOWN;
}

/**
 * Coordinates a confirmed mutation: increment state first, enqueue exactly one
 * logical-version job, and retain a sanitized failed state if SQS is down.
 */
export class ProjectionSyncCoordinator {
  constructor({ stateStore, queuePublisher, clock = () => new Date().toISOString() } = {}) {
    if (!stateStore || typeof stateStore.markCatalogMutationPending !== 'function') {
      throw new TypeError('stateStore.markCatalogMutationPending() is required');
    }
    if (!queuePublisher || typeof queuePublisher.enqueue !== 'function') {
      throw new TypeError('queuePublisher.enqueue() is required');
    }
    this.stateStore = stateStore;
    this.queuePublisher = queuePublisher;
    this.clock = clock;
  }

  async recordMutation({ ownerId, correlationId } = {}) {
    const pending = await this.stateStore.markCatalogMutationPending({ ownerId, updatedAt: this.clock() });
    const job = createProjectionJob({
      ownerId,
      catalogVersion: pending.catalogVersion,
      correlationId,
      requestedAt: pending.updatedAt,
    });
    try {
      await this.queuePublisher.enqueue(job);
      return pending;
    } catch (error) {
      const reason = sanitizePublicationCause(error);
      if (typeof this.stateStore.markFailed === 'function') {
        return this.stateStore.markFailed({
          ownerId,
          catalogVersion: pending.catalogVersion,
          reason,
          updatedAt: this.clock(),
        });
      }
      return Object.freeze({ ...pending, status: PUBLICATION_STATUS.FAILED, reason });
    }
  }
}

/**
 * SQS/Lambda consumer with partial-batch failure semantics. Duplicate,
 * already-published, and older messages are acknowledged; transient failures
 * are returned for bounded SQS redrive. The final attempt is marked
 * reconciliation-required before the message is allowed to reach the DLQ.
 */
export class ProjectionWorker {
  constructor({
    stateStore,
    publish,
    logger = () => {},
    maxReceiveCount = 5,
    clock = () => new Date().toISOString(),
  } = {}) {
    if (!stateStore || typeof stateStore.get !== 'function') throw new TypeError('stateStore.get() is required');
    if (typeof publish !== 'function') throw new TypeError('publish() is required');
    if (!Number.isInteger(maxReceiveCount) || maxReceiveCount < 1) {
      throw new TypeError('maxReceiveCount must be a positive integer');
    }
    this.stateStore = stateStore;
    this.publish = publish;
    this.logger = logger;
    this.maxReceiveCount = maxReceiveCount;
    this.clock = clock;
  }

  async handle(event = {}) {
    const batchItemFailures = [];
    for (const record of Array.isArray(event.Records) ? event.Records : []) {
      try {
        await this.processRecord(record);
      } catch (error) {
        const messageId = safeMessageId(record?.messageId);
        const attempt = receiveCount(record);
        let job = null;
        try {
          job = parseRecordJob(record);
        } catch {
          // Malformed messages cannot be associated with a catalog state, but
          // they still need SQS redrive/DLQ handling.
        }
        if (job && typeof this.stateStore.markFailed === 'function') {
          const reason = sanitizePublicationCause(error);
          try {
            if (attempt >= this.maxReceiveCount && typeof this.stateStore.markReconciliationRequired === 'function') {
              await this.stateStore.markReconciliationRequired({
                ownerId: job.ownerId,
                catalogVersion: job.catalogVersion,
                reason,
                updatedAt: this.clock(),
              });
            } else {
              await this.stateStore.markFailed({
                ownerId: job.ownerId,
                catalogVersion: job.catalogVersion,
                reason,
                updatedAt: this.clock(),
              });
            }
          } catch {
            // A state-store outage must not acknowledge a failed message; the
            // SQS retry remains the recovery mechanism.
          }
        }
        this.logger({
          operation: 'projection',
          result: attempt >= this.maxReceiveCount ? PUBLICATION_STATUS.RECONCILIATION_REQUIRED : PUBLICATION_STATUS.FAILED,
          messageId,
          catalogVersion: job?.catalogVersion,
          reason: sanitizePublicationCause(error),
        });
        if (messageId) batchItemFailures.push({ itemIdentifier: messageId });
      }
    }
    return { batchItemFailures };
  }

  async processRecord(record) {
    const job = parseRecordJob(record);
    const state = await this.stateStore.get(job.ownerId);
    if (!state || state.catalogVersion < job.catalogVersion) {
      throw new Error('Projection state is not ready for this version');
    }
    // A newer confirmed catalog version supersedes an older message. The
    // newer message is responsible for publishing the latest complete state.
    if (state.catalogVersion > job.catalogVersion || (state.projectionVersion ?? -1) >= job.catalogVersion) {
      return Object.freeze({ ignored: true, catalogVersion: job.catalogVersion });
    }
    const publication = await this.publish(job);
    const releaseId = publication?.releaseId ?? null;
    if (typeof this.stateStore.markSucceeded !== 'function') {
      throw new Error('stateStore.markSucceeded() is required');
    }
    return this.stateStore.markSucceeded({
      ownerId: job.ownerId,
      catalogVersion: job.catalogVersion,
      projectionVersion: job.catalogVersion,
      releaseId,
      updatedAt: this.clock(),
    });
  }
}

function parseRecordJob(record) {
  let parsed;
  try {
    parsed = typeof record?.body === 'string' ? JSON.parse(record.body) : record?.body;
  } catch {
    throw new Error('Projection message is malformed');
  }
  return assertProjectionJob(parsed);
}

function receiveCount(record) {
  const value = Number(record?.attributes?.ApproximateReceiveCount ?? 1);
  return Number.isInteger(value) && value > 0 ? value : 1;
}

function safeMessageId(value) {
  return typeof value === 'string' && SAFE_CORRELATION_ID.test(value) ? value : null;
}

function assertOwnerId(value) {
  if (typeof value !== 'string' || value.length === 0 || !SAFE_OWNER.test(value)) {
    throw new TypeError('ownerId must be a safe non-empty identifier');
  }
}

function assertCatalogVersion(value, { allowZero = false } = {}) {
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(value) || value < minimum || value > MAX_CATALOG_VERSION) {
    throw new TypeError(`catalogVersion must be a safe integer >= ${minimum}`);
  }
}

export { CAUSE_CODES };
