/**
 * What the server, the client and a deployment all speak: the API's error
 * codes, the entitlement, gate and rate-limit seams, the relay's frames, and
 * `PROVIDER_KINDS`.
 */

export { API_ERROR_CODES, type ApiErrorCode, AUTH_MODES, type AuthMode } from './api.js';
export { alwaysAllowed, type ConnectCodeCheck, type ConnectGate, ENTITLEMENT_CODES, type EntitlementCode, type EntitlementContext, type EntitlementDecision, type EntitlementProvider, type EntitlementSubject, GATE_LIMITS, MAX_CODE_HOLD_SECONDS, MAX_CODE_REASON, MAX_CONNECT_CODE, neverLimited, type RateLimitDecision, type RateLimiter } from './entitlements.js';
export { PROVIDER_KINDS, type ProviderKind } from './providerKinds.js';
export { RELAY_CHANGED, RELAY_CLOSE, RELAY_PING, RELAY_PONG, RELAY_PUSHED, RELAY_PUSHED_INTERVAL_MS } from './relay.js';
