export class DGError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DGError';
  }
}

export class DGCompileError extends DGError {
  constructor(
    message: string,
    readonly step: number,
  ) {
    super(message);
    this.name = 'DGCompileError';
  }
}

export class DGCycleError extends DGError {
  constructor(
    message: string,
    readonly cycle: readonly string[],
  ) {
    super(message);
    this.name = 'DGCycleError';
  }
}

export class DGHaltError extends DGError {
  constructor(
    message: string,
    readonly nodeId: string,
  ) {
    super(message);
    this.name = 'DGHaltError';
  }
}

export class DGMergeError extends DGError {
  constructor(
    message: string,
    readonly nodeId: string,
  ) {
    super(message);
    this.name = 'DGMergeError';
  }
}

export class DGLimitError extends DGError {
  constructor(message: string) {
    super(message);
    this.name = 'DGLimitError';
  }
}

export class DGOutputSizeError extends DGError {
  constructor(
    message: string,
    readonly nodeId: string,
    readonly sizeKb: number,
    readonly maxKb: number,
  ) {
    super(message);
    this.name = 'DGOutputSizeError';
  }
}

export class DGTimeoutError extends DGError {
  constructor(message: string) {
    super(message);
    this.name = 'DGTimeoutError';
  }
}

export class DGMissingInputError extends DGError {
  constructor(
    message: string,
    readonly nodeId: string,
    readonly portName: string,
  ) {
    super(message);
    this.name = 'DGMissingInputError';
  }
}

export class DGMissingOutputError extends DGError {
  constructor(
    message: string,
    readonly nodeId: string,
    readonly portName: string,
  ) {
    super(message);
    this.name = 'DGMissingOutputError';
  }
}
