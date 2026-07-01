# Webhook signature verification

Every webhook request carries a signature header so you can confirm it came from ShieldLabs and was not modified in transit.

## The header

```
X-Shield-Signature: sha256=<hex>
```

`<hex>` is the lowercase hex encoding of `HMAC-SHA256(secret, raw_request_body)`.

- **secret** — the per-endpoint signing secret (`whsec_…`) shown when you add the webhook endpoint in the dashboard. Each endpoint has its own secret.
- **raw_request_body** — the exact bytes of the request body, before any JSON parsing or re-serialization. Verify against the raw body; a re-encoded body will not match.

## How to verify

1. Read the raw request body as bytes.
2. Compute `HMAC-SHA256(secret, body)` and hex-encode it.
3. Compare it, using a constant-time comparison, to the hex after `sha256=` in `X-Shield-Signature`.
4. If they differ, reject the request.

Treat `data.request_id` as an idempotency key: the same visit may be delivered more than once.

## Reference (from Shield.Core)

`internal/provider/webhook/sender.go` sets:

```go
req.Header.Set("X-Shield-Signature", "sha256="+sign(secret, body))

// sign returns hex(HMAC-SHA256(secret, body)).
func sign(secret string, body []byte) string {
    mac := hmac.New(sha256.New, []byte(secret))
    mac.Write(body)
    return hex.EncodeToString(mac.Sum(nil))
}
```

## Example (Node.js)

```js
import crypto from "node:crypto";

export function verifyWebhook(rawBody, header, secret) {
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

This is the reference the `verifyWebhook` helpers in the ShieldLabs SDKs (`@shieldlabs/node`, `shieldlabs` for Python, `shieldlabs-go`, `shieldlabs/shieldlabs` for PHP) will implement.
