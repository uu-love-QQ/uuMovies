import Hls, {
  type HlsConfig,
  type Loader,
  type LoaderContext,
  type LoaderConfiguration,
  type LoaderCallbacks,
  type LoaderResponse,
  type LoaderStats,
  type PlaylistLoaderContext,
  type NullableNetworkDetails,
} from 'hls.js';

function extractTrailingSeq(uri: string): number | null {
  const m = uri.match(/(\d+)\.ts/i);
  if (!m) return null;
  const numStr = m[1].slice(-4);
  const n = parseInt(numStr, 10);
  return isNaN(n) ? null : n;
}

function isAdUri(uri: string): boolean {
  const lower = uri.toLowerCase();
  const adPatterns = [
    '/adjump/',
    '/ad/',
    '/ads/',
    'guanggao',
    'advert',
    '/ad_',
    'googleads',
    'doubleclick',
    'appad',
    'union',
  ];
  return adPatterns.some((pattern) => lower.includes(pattern));
}

/**
 * Filter ad segments out of M3U8 playlist:
 * 1. Blacklisted URLs (/adjump/, etc.)
 * 2. Sandwiched foreign segments between #EXT-X-DISCONTINUITY (e.g. 量子资源 casino ads)
 */
export function sanitizeM3u8Content(content: string): string {
  // If not a media playlist (e.g. master playlist with #EXT-X-STREAM-INF), return untouched
  if (content.includes('#EXT-X-STREAM-INF') || !content.includes('#EXTINF')) {
    return content;
  }

  const lines = content.split(/\r?\n/);
  const headers: string[] = [];
  const blocks: { extinf: string; uri: string }[][] = [];
  let currentBlock: { extinf: string; uri: string }[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) {
      i++;
      continue;
    }

    if (line.startsWith('#EXT-X-DISCONTINUITY')) {
      if (currentBlock.length > 0) {
        blocks.push(currentBlock);
        currentBlock = [];
      }
      i++;
      continue;
    }

    if (line.startsWith('#EXTINF')) {
      const extinf = line;
      i++;
      while (
        i < lines.length &&
        lines[i].trim().startsWith('#') &&
        !lines[i].trim().startsWith('#EXTINF')
      ) {
        i++;
      }
      if (i < lines.length) {
        const uri = lines[i].trim();
        if (uri && !uri.startsWith('#')) {
          currentBlock.push({ extinf, uri });
        }
      }
      i++;
      continue;
    }

    if (blocks.length === 0 && currentBlock.length === 0 && line.startsWith('#')) {
      headers.push(line);
    }
    i++;
  }

  if (currentBlock.length > 0) {
    blocks.push(currentBlock);
  }

  const keep = new Array(blocks.length).fill(true);

  // 1. Blacklisted URI check
  for (let idx = 0; idx < blocks.length; idx++) {
    if (blocks[idx].some((item) => isAdUri(item.uri))) {
      keep[idx] = false;
    }
  }

  // 2. Discontinuity Sandwich Anomaly Detection
  for (let k = 1; k < blocks.length - 1; k++) {
    if (!keep[k]) continue;
    const prevB = blocks[k - 1];
    const nextB = blocks[k + 1];
    if (prevB.length > 0 && nextB.length > 0) {
      const prevSeq = extractTrailingSeq(prevB[prevB.length - 1].uri);
      const nextSeq = extractTrailingSeq(nextB[0].uri);
      if (prevSeq !== null && nextSeq !== null) {
        // If next sequence seamlessly continues prev sequence, middle block is an ad!
        if (nextSeq === prevSeq + 1 || nextSeq === prevSeq) {
          keep[k] = false;
        }
      }
    }
  }

  const out: string[] = [...headers];
  for (let idx = 0; idx < blocks.length; idx++) {
    if (!keep[idx]) continue;
    for (const item of blocks[idx]) {
      out.push(item.extinf);
      out.push(item.uri);
    }
  }
  out.push('#EXT-X-ENDLIST');
  return out.join('\n');
}

/**
 * Creates an Hls.js Playlist Loader that intercepts and strips in-stream ads
 */
export function createAdFilterPlaylistLoader(): new (config: HlsConfig) => Loader<PlaylistLoaderContext> {
  const BaseLoader = Hls.DefaultConfig.loader;
  const LoaderClass = class AdFilterLoader extends BaseLoader {
    constructor(config: HlsConfig) {
      super(config);
      const originalLoad = this.load.bind(this);
      this.load = (
        context: PlaylistLoaderContext,
        cfg: LoaderConfiguration,
        callbacks: LoaderCallbacks<PlaylistLoaderContext>
      ) => {
        const origSuccess = callbacks.onSuccess;
        callbacks.onSuccess = (
          response: LoaderResponse,
          stats: LoaderStats,
          ctx: PlaylistLoaderContext,
          networkDetails: NullableNetworkDetails
        ) => {
          if (typeof response.data === 'string') {
            response.data = sanitizeM3u8Content(response.data);
          }
          if (origSuccess) {
            origSuccess(response, stats, ctx, networkDetails);
          }
        };
        originalLoad(context, cfg, callbacks as unknown as LoaderCallbacks<LoaderContext>);
      };
    }
  };

  // Safe cast for constructor contract with Hls.js PlaylistLoaderConstructor
  return LoaderClass as unknown as new (config: HlsConfig) => Loader<PlaylistLoaderContext>;
}
