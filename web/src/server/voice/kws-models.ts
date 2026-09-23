import { resolveArchiveModelDir, type ArchiveModel } from './model-store';

const KWS_MODEL_NAME = 'sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01';

const KWS_MODEL: ArchiveModel = {
  name: KWS_MODEL_NAME,
  url: `https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/${KWS_MODEL_NAME}.tar.bz2`,
  requiredFiles: [
    'encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx',
    'decoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx',
    'joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx',
    'tokens.txt',
    'bpe.model',
  ],
};

/**
 * Resolves the local directory for the keyword-spotting model, stored beside
 * the offline ASR model from `models.ts`.
 */
export async function resolveKwsModelDir(): Promise<string> {
  return resolveArchiveModelDir(KWS_MODEL);
}
