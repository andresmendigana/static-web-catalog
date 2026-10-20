/** Offline-testable SQS Standard projection queue adapter. */
import {
  assertProjectionJob,
} from '../application/publication/projection-sync.js';

const DEFAULT_COMMANDS = Object.freeze({
  SendMessageCommand: (input) => ({ type: 'SendMessageCommand', input }),
});

export class SqsProjectionQueue {
  constructor({ client, queueUrl, commands = DEFAULT_COMMANDS } = {}) {
    if (!client || typeof client.send !== 'function') throw new TypeError('An SQS client with send() is required');
    if (typeof queueUrl !== 'string' || queueUrl.length === 0) throw new TypeError('A projection queue URL is required');
    this.client = client;
    this.queueUrl = queueUrl;
    this.commands = { ...DEFAULT_COMMANDS, ...commands };
  }

  async enqueue(job) {
    assertProjectionJob(job);
    const command = this.commands.SendMessageCommand;
    if (typeof command !== 'function') throw new TypeError('SendMessageCommand is required');
    const input = {
      QueueUrl: this.queueUrl,
      MessageBody: JSON.stringify(job),
      MessageAttributes: {
        schemaVersion: { DataType: 'String', StringValue: job.schemaVersion },
        ownerId: { DataType: 'String', StringValue: job.ownerId },
        catalogVersion: { DataType: 'Number', StringValue: String(job.catalogVersion) },
      },
    };
    let request;
    try {
      request = command(input);
    } catch (error) {
      if (!/class constructor|cannot be invoked without 'new'/iu.test(String(error?.message))) throw error;
      request = new command(input);
    }
    const response = await this.client.send(request);
    return Object.freeze({ messageId: response?.MessageId ?? null, catalogVersion: job.catalogVersion });
  }
}
