/**
 * The Worker as a library: `createApp`, handed its configuration by the
 * deployment, and the environment it reads that from.
 */

export { type App, createApp, type CreateAppOptions } from './app.js';
export type { AppEnv, AuthedEnv, Bindings, Variables } from './context.js';

/**
 * So that an app's Worker entry builds its config through the server's own
 * validation (`parseEnv`) rather than reading env by hand, logs what
 * `envWarnings` says of it at boot, and answers as the server does while the
 * config is wrong (`misconfigured`). Together with `createApp` this is the
 * whole of what a deployment needs.
 */
export { type AppConfig, envWarnings, parseEnv } from './env.js';
export { misconfigured } from './http.js';
