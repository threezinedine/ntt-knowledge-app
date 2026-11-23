import type { ApiErrorBody } from '@km/core';
import type { FastifyInstance } from 'fastify';

/** Loopback names are always allowed. */
export const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'] as const;

/** Strips the port from a Host header, keeping bracketed IPv6 literals intact. */
export function hostnameOf(hostHeader: string): string {
  const host = hostHeader.trim().toLowerCase();
  if (host.startsWith('[')) return host.slice(0, host.indexOf(']') + 1);
  const colon = host.lastIndexOf(':');
  return colon === -1 ? host : host.slice(0, colon);
}

/**
 * DNS-rebinding defence: a malicious page can point its own domain at
 * 127.0.0.1 and then read the API "same-origin". Browsers still send the
 * attacker's hostname in `Host`, so only accept hostnames we know.
 */
export function registerHostGuard(app: FastifyInstance, extraHosts: readonly string[]): void {
  const allowed = new Set<string>([...LOOPBACK_HOSTS, ...extraHosts.map((h) => h.toLowerCase())]);
  app.addHook('onRequest', async (request, reply) => {
    const host = request.headers.host;
    if (host !== undefined && allowed.has(hostnameOf(host))) return;
    const body: ApiErrorBody = {
      error: {
        code: 'FORBIDDEN_HOST',
        message: `Host "${host ?? ''}" is not allowed. Add it to KM_ALLOWED_HOSTS.`,
      },
    };
    await reply.status(403).send(body);
  });
}
