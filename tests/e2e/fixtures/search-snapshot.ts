import { inflateSync } from 'node:zlib';

type SearchStorageState = {
  origins: {
    origin?: string;
    indexedDB?: {
      name: string;
      stores: { records: { key: unknown; valueEncoded?: { ta?: { b: string; k: string } } }[] }[];
    }[];
  }[];
};

// The pinned Playwright serializer preserves Uint8Array values in valueEncoded.
// Follow the persisted manifest rather than accepting orphan or unflushed chunks.
export function persistedSearchBodies(state: SearchStorageState, roomId: string): string[] {
  const records = new Map(
    state.origins
      .flatMap((origin) => origin.indexedDB ?? [])
      .filter((database) => database.name.endsWith('::sable-search'))
      .flatMap((database) => database.stores.flatMap((store) => store.records))
      .filter((record) => typeof record.key === 'string')
      .map((record) => [record.key as string, record.valueEncoded] as const)
  );
  const read = (key: string): unknown => {
    const encoded = records.get(key)?.ta;
    if (!encoded || encoded.k !== 'ui8') return null;
    const bytes = Buffer.from(encoded.b, 'base64');
    return JSON.parse((bytes[0] === 0x78 ? inflateSync(bytes) : bytes).toString('utf8')) as unknown;
  };
  const listed = read('sable.search.rooms') as string[] | null;
  if (!listed?.includes(roomId)) return [];
  const manifest = read(`sable.search.room.${roomId}`) as { chunks: { id: number }[] } | null;
  return (manifest?.chunks ?? []).flatMap(({ id }) => {
    const chunk = read(`sable.search.chunk.${roomId}.${String(id)}`) as {
      documents: { body: string }[];
    } | null;
    return (chunk?.documents ?? []).map((document) => document.body);
  });
}
