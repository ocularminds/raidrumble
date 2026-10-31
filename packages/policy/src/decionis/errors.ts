/** Transport availability is distinct from a refused or malformed grant. */
export class AuthorityFailure extends Error {
  constructor(
    readonly kind: 'unavailable' | 'refused',
    timeout = false,
  ) {
    super(timeout ? 'POLICY_TIMEOUT' : 'POLICY_ERROR');
  }
}
