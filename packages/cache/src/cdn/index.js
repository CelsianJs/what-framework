// CDN adapters — all OPTIONAL. The origin cache does full ISR without them;
// these add edge purge on revalidatePath/revalidateTag. A CDNAdapter is just
// { purge(urls), purgeTags(tags) }.

export { createCloudflareCDN } from './cloudflare.js';
export { createFastlyCDN } from './fastly.js';
export { createVercelCDN } from './vercel.js';
