export function packageFlavor(flavor = 'fork', sandboxed = false) {
  if (sandboxed) {
    if (flavor === 'fork') throw new Error('The fork has no approved sandboxed identity');
    return {
      config: 'electron-builder.sandboxed.yml',
      identifier: 'moe.sable.client.sandboxed',
    };
  }
  if (flavor === 'fork') {
    return { config: 'electron-builder.fork.yml', identifier: 'moe.sable.next' };
  }
  if (flavor === 'stable') {
    return { config: 'electron-builder.stable.yml', identifier: 'moe.sable.client' };
  }
  return { config: 'electron-builder.nightly.yml', identifier: 'moe.sable.next.nightly' };
}
