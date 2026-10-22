// Errors raised by the storage layer.
export class ConflictError extends Error {
    constructor(message = 'The camp was changed by another request.') { super(message); this.code = 'CONFLICT'; }
}
export class ExistsError extends Error {
    constructor(message = 'A camp with this id already exists.') { super(message); this.code = 'EXISTS'; }
}
export class NotFoundError extends Error {
    constructor(message = 'Camp not found.') { super(message); this.code = 'NOT_FOUND'; }
}
