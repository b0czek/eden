export interface NativeFailureDetails {
  path?: string;
  descriptor?: number;
  message?: string;
}

/** Shared by synchronous preload I/O and the main-process Effect adapter. */
export class FilesystemIoFailed extends Error {
  readonly _tag = "FilesystemIoFailed";
  readonly operation: string;
  readonly path?: string;
  readonly descriptor?: number;

  constructor(
    details: NativeFailureDetails & {
      operation: string;
      message: string;
      cause: unknown;
    },
  ) {
    super(details.message, { cause: details.cause });
    this.name = this._tag;
    this.operation = details.operation;
    this.path = details.path;
    this.descriptor = details.descriptor;
  }

  /** Native errno is retained for existing absence/cross-device recovery. */
  get code(): string | undefined {
    return (this.cause as NodeJS.ErrnoException | undefined)?.code;
  }
}

export function nativeFailure(
  operation: string,
  cause: unknown,
  details: NativeFailureDetails = {},
): FilesystemIoFailed {
  return new FilesystemIoFailed({
    operation,
    path: details.path ?? (cause as NodeJS.ErrnoException)?.path,
    descriptor: details.descriptor,
    cause,
    message:
      details.message ??
      `Filesystem ${operation} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
  });
}
