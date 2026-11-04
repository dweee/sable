import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { downloadVerified, sha256 } from '../lib/download.mjs';

const assetsDir = join(import.meta.dirname, '../../static/deepfilternet3');

const assets = [
  {
    path: 'v3/pkg/df_bg.wasm',
    // The upstream CDN answers HTTP 403 to some clients. This commit-pinned copy is
    // byte-identical to the v3 asset, so try it first; the hash below still gates both.
    urls: [
      'https://raw.githubusercontent.com/fluxerapp/fluxer/3cec27ba57b965b9bfddd8d21bb2683056fba55c/fluxer_static/libs/deepfilternet3/v3/pkg/df_bg.wasm',
      'https://cdn.mezon.ai/AI/models/datas/noise_suppression/deepfilternet3/v3/pkg/df_bg.wasm',
    ],
    sha256: '440b5d12b6ea7d95008736f844221d7874ee15de5cb10d3015002470fdba0432',
  },
  {
    path: 'v3/models/DeepFilterNet3_onnx.tar.gz',
    urls: ['https://github.com/Rikorose/DeepFilterNet/raw/84d57ec2c08fe08e68a13fb32a58cd7092060a0f/models/DeepFilterNet3_onnx.tar.gz'],
    sha256: 'c94d91f70911001c946e0fabb4aa9adc37045f45a03b56008cb0c8244cb63616',
  },
];

/** @param {{ path: string; urls: string[]; sha256: string }} asset */
async function provision({ path, urls, sha256: expected }) {
  const target = join(assetsDir, path);
  const existing = await readFile(target).catch(() => undefined);
  if (existing && sha256(existing) === expected) return;

  const bytes = await downloadVerified(urls, expected);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(`${target}.tmp`, bytes);
  await rename(`${target}.tmp`, target);
}

export async function fetchDeepFilterNet() {
  for (const asset of assets) await provision(asset);
}

if (import.meta.main) await fetchDeepFilterNet();
