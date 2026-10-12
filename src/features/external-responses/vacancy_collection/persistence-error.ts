/** Storage errors must abort collection, never masquerade as inaccessible websites. */
export class CollectionPersistenceError extends Error {
  constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = 'CollectionPersistenceError' }
}
