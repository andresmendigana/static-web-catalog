/**
 * Durable publication state stored in the existing operation table.
 *
 * The adapter uses injected DynamoDB command builders so tests can use a
 * deterministic double and never need AWS credentials or network access.
 */
import { PUBLICATION_STATUS } from '../domain/catalog-contracts.js';
import {
  PUBLICATION_STATE_KEY,
  createPublicationState,
  sanitizePublicationCause,
} from '../application/publication/projection-sync.js';

const DEFAULT_COMMANDS = Object.freeze({
  GetCommand: (input) => ({ type: 'GetCommand', input }),
  UpdateCommand: (input) => ({ type: 'UpdateCommand', input }),
});

export function publicationStateKeys(ownerId) {
  if (typeof ownerId !== 'string' || ownerId.length === 0 || ownerId.includes('#')) {
    throw new TypeError('ownerId must be a non-empty safe identifier');
  }
  return { PK: `OWNER#${ownerId}`, SK: PUBLICATION_STATE_KEY };
}

export class DynamoDbPublicationStateStore {
  constructor({ client, tableName, commands = DEFAULT_COMMANDS, clock = () => new Date().toISOString() } = {}) {
    if (!client || typeof client.send !== 'function') throw new TypeError('A DynamoDB client with send() is required');
    if (typeof tableName !== 'string' || tableName.length === 0) throw new TypeError('A DynamoDB table name is required');
    this.client = client;
    this.tableName = tableName;
    this.commands = { ...DEFAULT_COMMANDS, ...commands };
    this.clock = clock;
  }

  async get(ownerId) {
    const response = await this._send('GetCommand', {
      TableName: this.tableName,
      Key: publicationStateKeys(ownerId),
      ConsistentRead: true,
    });
    return response?.Item ? toPublicationState(response.Item) : null;
  }

  /** Atomically advances the logical catalog version and marks it pending. */
  async markCatalogMutationPending({ ownerId, updatedAt = this.clock() } = {}) {
    const response = await this._send('UpdateCommand', {
      TableName: this.tableName,
      Key: publicationStateKeys(ownerId),
      UpdateExpression: 'SET #entityType = :entityType, #catalogVersion = if_not_exists(#catalogVersion, :zero) + :one, #status = :pending, #updatedAt = :updatedAt REMOVE #reason',
      ExpressionAttributeNames: {
        '#entityType': 'entityType',
        '#catalogVersion': 'catalogVersion',
        '#status': 'status',
        '#updatedAt': 'updatedAt',
        '#reason': 'reason',
      },
      ExpressionAttributeValues: {
        ':entityType': 'PUBLICATION_STATE',
        ':zero': 0,
        ':one': 1,
        ':pending': PUBLICATION_STATUS.PENDING,
        ':updatedAt': updatedAt,
      },
      ReturnValues: 'ALL_NEW',
    });
    return toPublicationState(response?.Attributes ?? {
      catalogVersion: 1,
      projectionVersion: null,
      status: PUBLICATION_STATUS.PENDING,
      updatedAt,
    });
  }

  async markFailed({ ownerId, catalogVersion, reason, updatedAt = this.clock() } = {}) {
    return this._markOutcome({
      ownerId,
      catalogVersion,
      status: PUBLICATION_STATUS.FAILED,
      reason,
      updatedAt,
    });
  }

  async markReconciliationRequired({ ownerId, catalogVersion, reason, updatedAt = this.clock() } = {}) {
    return this._markOutcome({
      ownerId,
      catalogVersion,
      status: PUBLICATION_STATUS.RECONCILIATION_REQUIRED,
      reason,
      updatedAt,
    });
  }

  async markSucceeded({
    ownerId,
    catalogVersion,
    projectionVersion = catalogVersion,
    releaseId = null,
    updatedAt = this.clock(),
  } = {}) {
    const current = await this.get(ownerId);
    if (current && current.catalogVersion > catalogVersion) return current;
    if (current && (current.projectionVersion ?? -1) >= projectionVersion) return current;
    const response = await this._send('UpdateCommand', {
      TableName: this.tableName,
      Key: publicationStateKeys(ownerId),
      UpdateExpression: 'SET #status = :succeeded, #projectionVersion = :projectionVersion, #catalogVersion = :catalogVersion, #releaseId = :releaseId, #updatedAt = :updatedAt REMOVE #reason',
      ConditionExpression: '#catalogVersion = :catalogVersion AND (attribute_not_exists(#projectionVersion) OR #projectionVersion < :projectionVersion)',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#projectionVersion': 'projectionVersion',
        '#catalogVersion': 'catalogVersion',
        '#releaseId': 'releaseId',
        '#updatedAt': 'updatedAt',
        '#reason': 'reason',
      },
      ExpressionAttributeValues: {
        ':succeeded': PUBLICATION_STATUS.SUCCEEDED,
        ':projectionVersion': projectionVersion,
        ':catalogVersion': catalogVersion,
        ':releaseId': releaseId,
        ':updatedAt': updatedAt,
      },
      ReturnValues: 'ALL_NEW',
    });
    return toPublicationState(response?.Attributes ?? {
      ...(current ?? {}),
      status: PUBLICATION_STATUS.SUCCEEDED,
      catalogVersion,
      projectionVersion,
      releaseId,
      updatedAt,
      reason: null,
    });
  }

  async _markOutcome({ ownerId, catalogVersion, status, reason, updatedAt }) {
    const safeReason = sanitizePublicationCause(
      reason && typeof reason === 'object' ? reason : { code: reason },
    );
    const current = await this.get(ownerId);
    if (current && current.catalogVersion > catalogVersion) return current;
    const response = await this._send('UpdateCommand', {
      TableName: this.tableName,
      Key: publicationStateKeys(ownerId),
      UpdateExpression: 'SET #status = :status, #catalogVersion = :catalogVersion, #reason = :reason, #updatedAt = :updatedAt',
      ConditionExpression: '#catalogVersion = :catalogVersion',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#catalogVersion': 'catalogVersion',
        '#reason': 'reason',
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ':status': status,
        ':catalogVersion': catalogVersion,
        ':reason': safeReason,
        ':updatedAt': updatedAt,
      },
      ReturnValues: 'ALL_NEW',
    });
    return toPublicationState(response?.Attributes ?? {
      ...(current ?? {}),
      status,
      catalogVersion,
      updatedAt,
      reason: safeReason,
    });
  }

  async _send(name, input) {
    const constructor = this.commands[name];
    if (typeof constructor !== 'function') throw new TypeError(`Missing DynamoDB command constructor: ${name}`);
    let command;
    try {
      command = constructor(input);
    } catch (error) {
      if (!/class constructor|cannot be invoked without 'new'/iu.test(String(error?.message))) throw error;
      command = new constructor(input);
    }
    return this.client.send(command);
  }
}

function toPublicationState(item) {
  return createPublicationState({
    catalogVersion: Number.isSafeInteger(item.catalogVersion) ? item.catalogVersion : Number(item.catalogVersion ?? 0),
    projectionVersion: item.projectionVersion === undefined || item.projectionVersion === null
      ? null
      : Number(item.projectionVersion),
    status: item.status ?? PUBLICATION_STATUS.PENDING,
    releaseId: item.releaseId ?? null,
    updatedAt: item.updatedAt ?? new Date(0).toISOString(),
    reason: item.reason ?? null,
  });
}
