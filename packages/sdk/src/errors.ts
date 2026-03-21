/**
 * AgentLairError — thrown when the API returns a non-2xx response.
 */
export class AgentLairError extends Error {
  /** HTTP status code */
  readonly status: number;
  /** Machine-readable error code from the API */
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'AgentLairError';
    this.status = status;
    this.code = code;
  }
}
