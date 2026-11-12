import { deflateSync } from 'node:zlib';
import { expect, test } from 'vitest';
import { persistedSearchBodies } from './search-snapshot';

const roomId = '!room:example.test';
const record = (key: string, value: unknown, compressed = false) => {
  const bytes = Buffer.from(JSON.stringify(value));
  return {
    key,
    valueEncoded: {
      ta: { k: 'ui8', b: (compressed ? deflateSync(bytes) : bytes).toString('base64') },
    },
  };
};
const state = (records: ReturnType<typeof record>[]) => ({
  origins: [
    {
      indexedDB: [
        {
          name: 'account::sable-search',
          stores: [{ records: [record('sable.search.rooms', [roomId]), ...records] }],
        },
      ],
    },
  ],
});

test('a room key alone does not prove the seeded messages were flushed', () => {
  const manifest = record(`sable.search.room.${roomId}`, { version: 5, chunks: [{ id: 0 }] });
  expect(persistedSearchBodies(state([manifest]), roomId)).toEqual([]);
});

test.each([false, true])(
  'reads only manifest-referenced documents (compressed: %s)',
  (compressed) => {
    const records = [
      record(`sable.search.room.${roomId}`, { version: 5, chunks: [{ id: 0 }] }, compressed),
      record(
        `sable.search.chunk.${roomId}.0`,
        { version: 5, documents: [{ body: 'Welcome to Random' }] },
        compressed
      ),
      record(
        `sable.search.chunk.${roomId}.1`,
        { version: 5, documents: [{ body: 'Orphan document' }] },
        compressed
      ),
    ];
    expect(persistedSearchBodies(state(records), roomId)).toEqual(['Welcome to Random']);
  }
);

test('an unlisted room cannot be restored even when its manifest and chunk exist', () => {
  const snapshot = state([
    record(`sable.search.room.${roomId}`, { chunks: [{ id: 0 }] }),
    record(`sable.search.chunk.${roomId}.0`, { documents: [{ body: 'Welcome to Random' }] }),
    record('sable.search.rooms', []),
  ]);
  expect(persistedSearchBodies(snapshot, roomId)).toEqual([]);
});
