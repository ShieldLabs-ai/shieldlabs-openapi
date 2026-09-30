#!/usr/bin/env node
// Lists every operation of the ShieldLabs API with the server it must be sent to.
// Useful when a client generator ignores per-operation servers and you configure base URLs by hand.
//
//   node examples/node-list-operations/index.mjs
import spec from '@shieldlabs/openapi' with { type: 'json' };

const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace'];

console.log(`${spec.info.title} ${spec.info.version}\n`);
for (const [route, pathItem] of Object.entries(spec.paths)) {
  for (const method of METHODS) {
    const operation = pathItem[method];
    if (!operation) continue;
    const servers = (operation.servers ?? pathItem.servers ?? spec.servers).map((server) => server.url);
    const flags = [operation.deprecated ? 'deprecated' : null, operation.security?.length ? null : 'no auth']
      .filter(Boolean)
      .join(', ');
    console.log(`${operation.operationId}${flags ? ` (${flags})` : ''}`);
    for (const server of servers) console.log(`  ${method.toUpperCase()} ${server}${route}`);
  }
}
for (const [event, pathItem] of Object.entries(spec.webhooks ?? {})) {
  console.log(`${pathItem.post.operationId} (webhook)`);
  console.log(`  POST <your endpoint>  event_type: ${event}`);
}
