import { AwsClient } from 'npm:aws4fetch@1.0.20'
import { requireEnv } from './admin.ts'

function client() {
  return new AwsClient({
    accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
    service: 's3',
    region: 'auto',
  })
}

const objectUrl = (key: string) =>
  `https://${requireEnv('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com/${requireEnv('R2_BUCKET')}/${key
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`

/** Presigned URL (query-string signature) valid for `expiresSec`. */
export async function presign(method: 'GET' | 'PUT', key: string, expiresSec = 3600): Promise<string> {
  const url = new URL(objectUrl(key))
  url.searchParams.set('X-Amz-Expires', String(expiresSec))
  const signed = await client().sign(url.toString(), { method, aws: { signQuery: true } })
  return signed.url
}

export async function deleteObject(key: string): Promise<void> {
  const res = await client().fetch(objectUrl(key), { method: 'DELETE' })
  if (!res.ok && res.status !== 404) console.error(`R2 delete ${key} failed: ${res.status}`)
}
