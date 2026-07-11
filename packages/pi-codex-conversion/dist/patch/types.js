export class DiffError extends Error {
    constructor(message) {
        super(message);
        this.name = "DiffError";
    }
}
export class ExecutePatchError extends DiffError {
    result;
    failedAction;
    failures;
    constructor(message, result, failures = []) {
        super(message);
        this.name = "ExecutePatchError";
        this.result = result;
        this.failures = failures;
        this.failedAction = failures[0]?.action;
    }
    hasPartialSuccess() {
        return (this.result.changedFiles.length > 0 ||
            this.result.createdFiles.length > 0 ||
            this.result.deletedFiles.length > 0 ||
            this.result.movedFiles.length > 0 ||
            this.result.fuzz > 0);
    }
}
