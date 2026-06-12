import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import type { Env, IngestParams } from '../env.js';
import { runIngest, type IngestSummary, type StepLike } from '../run-ingest.js';

export { runIngest, type IngestSummary, type StepLike } from '../run-ingest.js';

export class IngestRegion extends WorkflowEntrypoint<Env, IngestParams> {
  async run(event: WorkflowEvent<IngestParams>, step: WorkflowStep): Promise<IngestSummary> {
    // Cast WorkflowStep to StepLike: the overloads are compatible at runtime;
    // we only call step.do(name, config, callback) which both shapes support.
    return runIngest(this.env, event, step as unknown as StepLike);
  }
}
