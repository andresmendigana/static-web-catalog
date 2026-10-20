/**
 * Idempotency coordination for mutation boundaries.
 *
 * The store is deliberately injected so application code does not depend on
 * DynamoDB. `InMemoryIdempotencyStore` is deterministic and useful for local
 * execution and controlled tests; a durable store can implement the same
 * `execute()` contract when the Lambda handlers are introduced.
 */
import { ConflictError } from '../../domain/errors.js';

const MAX_KEY_LENGTH = 256;
const DEFAULT_PENDING_RETRY_ATTEMPTS = 20;
const DEFAULT_PENDING_RETRY_DELAY_MS = 0;
const RETRY_IDEMPOTENCY_CLAIM = Symbol('retry-idempotency-claim');

/**
 * A stable conflict raised when a key is reused for a different intent.
 * It remains a normal CONFLICT so the HTTP translator returns 409 without
 * exposing the original payload.
 */
export class IdempotencyConflictError extends ConflictError {
  constructor(operation) {
    super(`Idempotency key was already used for a different ${operation} intent`);
    this.name = 'IdempotencyConflictError';
    this.operation = operation;
  }
}

/**
 * Produces a deterministic, non-secret fingerprint for an operation intent.
 * Keys are sorted recursively; array order is significant because it is part
 * of an import or catalog mutation's intent.
 */
export function createIntentFingerprint(operation, intent) {
  if (typeof operation !== 'string' || operation.trim().length === 0) {
    throw new TypeError('Idempotency operation is required');
  }
  return stableSerialize({ operation: operation.trim(), intent });
}

/**
 * Executes an operation once per scope/key/fingerprint. Concurrent retries
 * share the same promise, and completed retries receive the original logical
 * result without invoking the action again. Failed actions release the key so
 * a caller can retry after correcting a transient failure.
 */
export class InMemoryIdempotencyStore {
  constructor({ clone = cloneResult } = {}) {
    if (typeof clone !== 'function') throw new TypeError('clone must be a function');
    this.clone = clone;
    this.entries = new Map();
  }

  async execute({ scope = 'global', key, operation, intent, action } = {}) {
    assertKey(key);
    if (typeof action !== 'function') throw new TypeError('Idempotency action is required');

    const normalizedScope = normalizeScope(scope);
    const fingerprint = createIntentFingerprint(operation, intent);
    const entryKey = `${normalizedScope}\u0000${key}`;
    const existing = this.entries.get(entryKey);

    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new IdempotencyConflictError(operation);
      }
      return this.clone(await existing.promise);
    }

    const entry = { fingerprint, promise: null };
    entry.promise = Promise.resolve()
      .then(action)
      .then((result) => this.clone(result))
      .catch((error) => {
        if (this.entries.get(entryKey) === entry) this.entries.delete(entryKey);
        throw error;
      });
    this.entries.set(entryKey, entry);

    return this.clone(await entry.promise);
  }

  clear() {
    this.entries.clear();
  }
}

/**
 * Normalizes the optional mutation arguments while preserving the old
 * repository signatures. Callers may pass a key string or an options object.
 */
export function mutationOptions(value, idempotencyKey) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return {
      expectedVersion: value.expectedVersion,
      idempotencyKey: value.idempotencyKey ?? idempotencyKey,
    };
  }

  if (typeof value === 'string' && idempotencyKey === undefined) {
    return { expectedVersion: undefined, idempotencyKey: value };
  }

  return {
    expectedVersion: value,
    idempotencyKey,
  };
}

export function idempotencyOnlyOptions(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { idempotencyKey: value.idempotencyKey };
  }
  return { idempotencyKey: value };
}

function assertKey(key) {
  if (typeof key !== 'string' || key.trim().length === 0 || key.length > MAX_KEY_LENGTH) {
    throw new TypeError(`Idempotency key must be a non-empty string of at most ${MAX_KEY_LENGTH} characters`);
  }
}

function normalizeScope(scope) {
  if (typeof scope !== 'string' || scope.length === 0) {
    throw new TypeError('Idempotency scope is required');
  }
  return scope;
}

function cloneResult(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function stableSerialize(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'undefined') return 'undefined';
    if (typeof value === 'number' && Number.isNaN(value)) return 'number:NaN';
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
}

const DEFAULT_DYNAMODB_COMMANDS = Object.freeze({
  GetCommand: (input) => ({ type: 'GetCommand', input }),
  PutCommand: (input) => ({ type: 'PutCommand', input }),
  UpdateCommand: (input) => ({ type: 'UpdateCommand', input }),
  DeleteCommand: (input) => ({ type: 'DeleteCommand', input }),
});

/**
 * Durable idempotency store for Lambda deployments. It stores only the
 * operation fingerprint and the sanitized logical result; callers supply the
 * DynamoDB client/command constructors so tests remain offline.
 *
 * A concurrent invocation that observes a pending claim receives a conflict;
 * a retry after completion reads and returns the stored result. This avoids
 * executing an import or image association twice across processes.
 */
export class DynamoDbIdempotencyStore {
  constructor({
    client,
    tableName,
    commands = DEFAULT_DYNAMODB_COMMANDS,
    clock = () => new Date().toISOString(),
    pendingRetryAttempts = DEFAULT_PENDING_RETRY_ATTEMPTS,
    pendingRetryDelayMs = DEFAULT_PENDING_RETRY_DELAY_MS,
  } = {}) {
    if (!client || typeof client.send !== 'function') throw new TypeError('A DynamoDB client with send() is required');
    if (typeof tableName !== 'string' || tableName.length === 0) throw new TypeError('A DynamoDB table name is required');
    if (!Number.isInteger(pendingRetryAttempts) || pendingRetryAttempts < 0) {
      throw new TypeError('pendingRetryAttempts must be a non-negative integer');
    }
    if (!Number.isInteger(pendingRetryDelayMs) || pendingRetryDelayMs < 0) {
      throw new TypeError('pendingRetryDelayMs must be a non-negative integer');
    }
    this.client = client;
    this.tableName = tableName;
    this.commands = { ...DEFAULT_DYNAMODB_COMMANDS, ...commands };
    this.clock = clock;
    this.pendingRetryAttempts = pendingRetryAttempts;
    this.pendingRetryDelayMs = pendingRetryDelayMs;
    this.inFlight = new Map();
  }

  async execute({ scope, key, operation, intent, action } = {}) {
    assertKey(key);
    if (typeof action !== 'function') throw new TypeError('Idempotency action is required');
    const normalizedScope = normalizeScope(scope);
    const fingerprint = createIntentFingerprint(operation, intent);
    const localKey = `${normalizedScope}\u0000${key}`;
    const inFlight = this.inFlight.get(localKey);

    // A warm Lambda can receive the same request concurrently. Share its
    // promise before consulting DynamoDB so the side effect runs once.
    if (inFlight) {
      if (inFlight.fingerprint !== fingerprint) throw new IdempotencyConflictError(operation);
      return cloneResult(await inFlight.promise);
    }

    const promise = this._executeClaim({
      scope: normalizedScope,
      key,
      operation,
      fingerprint,
      action,
    });
    const entry = { fingerprint, promise };
    this.inFlight.set(localKey, entry);
    try {
      return cloneResult(await promise);
    } finally {
      if (this.inFlight.get(localKey) === entry) this.inFlight.delete(localKey);
    }
  }

  async _executeClaim({ scope, key, operation, fingerprint, action }) {
    const dynamoKey = {
      PK: `IDEMPOTENCY#${scope}`,
      SK: `OP#${key}`,
    };
    const existing = await this._get(dynamoKey);

    if (existing) {
      const result = await this._resolveExisting(existing, dynamoKey, operation, fingerprint);
      if (result !== RETRY_IDEMPOTENCY_CLAIM) return result;
    } else {
      try {
        await this._putPending(dynamoKey, operation, fingerprint);
      } catch (error) {
        if (!isConditionalCheckFailure(error)) throw error;
        const claimed = await this._get(dynamoKey);
        if (!claimed) throw new ConflictError('Idempotency claim could not be resolved', { cause: error });
        const result = await this._resolveExisting(claimed, dynamoKey, operation, fingerprint);
        if (result !== RETRY_IDEMPOTENCY_CLAIM) return result;
      }
    }

    let result;
    try {
      result = await action();
    } catch (error) {
      try {
        await this._deletePending(dynamoKey, fingerprint);
      } catch {
        // Preserve the operation failure. A later reconciliation can remove a
        // stale pending claim without exposing provider details to the client.
      }
      throw error;
    }

    // Keep a successful side effect claimed if completion persistence fails.
    // Deleting the claim here could execute a non-idempotent import or image
    // association twice after a transient DynamoDB error.
    await this._complete(dynamoKey, fingerprint, result);
    return cloneResult(result);
  }

  async _get(Key) {
    const response = await this._send('GetCommand', {
      TableName: this.tableName,
      Key,
      ConsistentRead: true,
    });
    return response?.Item ?? null;
  }

  async _putPending(Key, operation, intentHash) {
    await this._send('PutCommand', {
      TableName: this.tableName,
      Item: {
        ...Key,
        entityType: 'IDEMPOTENCY',
        operation,
        intentHash,
        status: 'pending',
        createdAt: this.clock(),
        updatedAt: this.clock(),
      },
      ConditionExpression: 'attribute_not_exists(#pk) AND attribute_not_exists(#sk)',
      ExpressionAttributeNames: { '#pk': 'PK', '#sk': 'SK' },
    });
  }

  async _complete(Key, intentHash, result) {
    await this._send('UpdateCommand', {
      TableName: this.tableName,
      Key,
      UpdateExpression: 'SET #status = :completed, #result = :result, #updatedAt = :updatedAt',
      ConditionExpression: '#intentHash = :intentHash AND #status = :pending',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#result': 'result',
        '#updatedAt': 'updatedAt',
        '#intentHash': 'intentHash',
      },
      ExpressionAttributeValues: {
        ':completed': 'completed',
        ':pending': 'pending',
        ':result': serializeResult(result),
        ':updatedAt': this.clock(),
        ':intentHash': intentHash,
      },
    });
  }

  async _deletePending(Key, intentHash) {
    await this._send('DeleteCommand', {
      TableName: this.tableName,
      Key,
      ConditionExpression: '#intentHash = :intentHash AND #status = :pending',
      ExpressionAttributeNames: { '#intentHash': 'intentHash', '#status': 'status' },
      ExpressionAttributeValues: { ':intentHash': intentHash, ':pending': 'pending' },
    });
  }

  async _resolveExisting(item, Key, operation, intentHash) {
    if (item.intentHash !== intentHash) throw new IdempotencyConflictError(operation);
    if (item.status === 'completed') {
      try {
        return cloneResult(deserializeResult(item.result));
      } catch (error) {
        throw new ConflictError('Idempotent operation result is unavailable', { cause: error });
      }
    }
    if (item.status !== 'pending') {
      throw new ConflictError('Idempotent operation is not replayable');
    }

    // A claim made by another invocation is not a different intent. Poll its
    // durable state briefly so the retry receives the original logical result
    // instead of a false conflict. If the action failed and released the claim,
    // the caller may safely try to claim it again.
    for (let attempt = 0; attempt < this.pendingRetryAttempts; attempt += 1) {
      if (this.pendingRetryDelayMs > 0) await delay(this.pendingRetryDelayMs);
      const current = await this._get(Key);
      if (!current) return RETRY_IDEMPOTENCY_CLAIM;
      if (current.intentHash !== intentHash) throw new IdempotencyConflictError(operation);
      if (current.status === 'completed') {
        try {
          return cloneResult(deserializeResult(current.result));
        } catch (error) {
          throw new ConflictError('Idempotent operation result is unavailable', { cause: error });
        }
      }
      if (current.status !== 'pending') {
        throw new ConflictError('Idempotent operation is not replayable');
      }
    }

    throw new ConflictError('Idempotent operation is still in progress');
  }

  async _send(commandName, input) {
    const constructor = this.commands[commandName];
    if (typeof constructor !== 'function') throw new TypeError(`Missing DynamoDB command constructor: ${commandName}`);
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

function serializeResult(result) {
  return JSON.stringify({ defined: result !== undefined, value: result });
}

function deserializeResult(value) {
  if (typeof value !== 'string') throw new TypeError('Stored idempotency result is invalid');
  const parsed = JSON.parse(value);
  return parsed.defined ? parsed.value : undefined;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isConditionalCheckFailure(error) {
  return error?.name === 'ConditionalCheckFailedException'
    || error?.code === 'ConditionalCheckFailedException';
}
