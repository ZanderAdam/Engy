import fs from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_WAKE_WORD = 'ENGY';

enum SentencePieceType {
  Normal = 1,
  UserDefined = 4,
}

export interface BpeModel {
  pieceScores: Map<string, number>;
  minNormalScore: number;
  maxPieceLength: number;
  addDummyPrefix: boolean;
  removeExtraWhitespaces: boolean;
  escapeWhitespaces: boolean;
}

type ProtoValue = number | Buffer;
type ProtoMessage = Map<number, ProtoValue[]>;

// Every varint this file reads (field tags, piece type enums, lengths of a
// ~240KB file) fits well within Number.MAX_SAFE_INTEGER, so plain numbers
// (accumulated by place value) avoid the ES2020 BigInt literals this
// package's tsconfig target (ES2017) rejects.
function readVarint(buf: Buffer, pos: number): [number, number] {
  let result = 0;
  let place = 1;
  let p = pos;
  for (;;) {
    const byte = buf[p++];
    result += (byte & 0x7f) * place;
    if ((byte & 0x80) === 0) break;
    place *= 128;
  }
  return [result, p];
}

// Minimal reader for the protobuf wire types SentencePiece's ModelProto uses
// (varint, fixed32 float, length-delimited) — no schema compiler, since we
// only ever read this one message shape (sentencepiece_model.proto).
function parseProtoMessage(buf: Buffer, start: number, end: number): ProtoMessage {
  const fields: ProtoMessage = new Map();
  let pos = start;
  while (pos < end) {
    const [tag, tagEnd] = readVarint(buf, pos);
    pos = tagEnd;
    const fieldNumber = Math.floor(tag / 8);
    const wireType = tag % 8;
    let value: ProtoValue;
    switch (wireType) {
      case 0: {
        const [v, p] = readVarint(buf, pos);
        value = v;
        pos = p;
        break;
      }
      case 1:
        value = buf.readDoubleLE(pos);
        pos += 8;
        break;
      case 2: {
        const [len, p] = readVarint(buf, pos);
        value = buf.subarray(p, p + len);
        pos = p + len;
        break;
      }
      case 5:
        value = buf.readFloatLE(pos);
        pos += 4;
        break;
      default:
        throw new Error(`bpe.model: unsupported protobuf wire type ${wireType}`);
    }
    const existing = fields.get(fieldNumber);
    if (existing) existing.push(value);
    else fields.set(fieldNumber, [value]);
  }
  return fields;
}

function fieldBuffer(msg: ProtoMessage, field: number): Buffer | undefined {
  const value = msg.get(field)?.[0];
  return value instanceof Buffer ? value : undefined;
}

function fieldNumber(msg: ProtoMessage, field: number): number | undefined {
  const value = msg.get(field)?.[0];
  return typeof value === 'number' ? value : undefined;
}

// Field numbers below are ModelProto's, from sentencepiece_model.proto:
// pieces=1 {piece=1, score=2, type=3}, trainer_spec=2 {model_type=3},
// normalizer_spec=3 {add_dummy_prefix=3, remove_extra_whitespaces=4, escape_whitespaces=5}.
const UNIGRAM_MODEL_TYPE = 1;

/**
 * Parses a SentencePiece `bpe.model` file into the piece scores and
 * normalization flags `encodeToPieces` needs. Despite the filename, icefall
 * and k2 export Unigram-type SentencePiece models under this name — this
 * only implements Unigram (Viterbi) segmentation, not literal BPE merging,
 * and rejects a model whose trainer_spec says otherwise.
 */
export function parseBpeModel(buffer: Buffer): BpeModel {
  const top = parseProtoMessage(buffer, 0, buffer.length);

  const trainerSpecBuf = fieldBuffer(top, 2);
  if (trainerSpecBuf) {
    const trainerSpec = parseProtoMessage(trainerSpecBuf, 0, trainerSpecBuf.length);
    const modelType = fieldNumber(trainerSpec, 3) ?? UNIGRAM_MODEL_TYPE;
    if (modelType !== UNIGRAM_MODEL_TYPE) {
      throw new Error(
        `bpe.model has SentencePiece model_type ${modelType}, but only Unigram (1) is supported`,
      );
    }
  }

  let addDummyPrefix = true;
  let removeExtraWhitespaces = true;
  let escapeWhitespaces = true;
  const normalizerSpecBuf = fieldBuffer(top, 3);
  if (normalizerSpecBuf) {
    const normalizerSpec = parseProtoMessage(normalizerSpecBuf, 0, normalizerSpecBuf.length);
    addDummyPrefix = (fieldNumber(normalizerSpec, 3) ?? 1) !== 0;
    removeExtraWhitespaces = (fieldNumber(normalizerSpec, 4) ?? 1) !== 0;
    escapeWhitespaces = (fieldNumber(normalizerSpec, 5) ?? 1) !== 0;
  }

  const pieceScores = new Map<string, number>();
  let minNormalScore = Infinity;
  let maxPieceLength = 0;
  for (const pieceBuf of top.get(1) ?? []) {
    if (!(pieceBuf instanceof Buffer)) continue;
    const piece = parseProtoMessage(pieceBuf, 0, pieceBuf.length);
    const text = fieldBuffer(piece, 1)?.toString('utf8');
    if (!text) continue;
    const scoreValue = piece.get(2)?.[0];
    const score = typeof scoreValue === 'number' ? scoreValue : 0;
    const type = fieldNumber(piece, 3) ?? SentencePieceType.Normal;

    if (type === SentencePieceType.Normal || type === SentencePieceType.UserDefined) {
      pieceScores.set(text, score);
      maxPieceLength = Math.max(maxPieceLength, [...text].length);
    }
    if (type === SentencePieceType.Normal) {
      minNormalScore = Math.min(minNormalScore, score);
    }
  }

  return {
    pieceScores,
    minNormalScore,
    maxPieceLength,
    addDummyPrefix,
    removeExtraWhitespaces,
    escapeWhitespaces,
  };
}

// Matches unigram_model.cc's kUnkPenalty: an unmatched character still gets
// a node (so the lattice always has a path), scored well below any real
// piece rather than excluded outright.
const UNK_PENALTY = 10.0;

function normalizeForModel(text: string, model: BpeModel): string {
  // The GigaSpeech vocabulary this model trains on is uppercase-only.
  let normalized = text.toUpperCase().normalize('NFKC').trim();
  if (model.removeExtraWhitespaces) normalized = normalized.replace(/\s+/g, ' ');
  if (model.addDummyPrefix) normalized = ` ${normalized}`;
  if (model.escapeWhitespaces) normalized = normalized.replace(/ /g, '▁');
  return normalized;
}

/**
 * Ports sentencepiece's Unigram Viterbi segmentation (`unigram_model.cc`'s
 * `PopulateNodes` + `Viterbi`) — the algorithm behind `text2token.py`'s
 * `sp.encode(..., out_type=str)` for a "bpe.model" that is actually a
 * Unigram LM: the best-scoring segmentation is found by dynamic programming
 * over every vocabulary piece that matches a substring, not by greedy
 * pairwise merging (that is BPE-type sentencepiece models, not this one).
 */
export function encodeToPieces(text: string, model: BpeModel): string[] {
  const normalized = normalizeForModel(text, model);
  const symbols = Array.from(normalized);
  const n = symbols.length;
  if (n === 0) return [];

  const unkScore = model.minNormalScore - UNK_PENALTY;
  const bestScore = new Array<number>(n + 1).fill(-Infinity);
  const bestSplitLength = new Array<number>(n + 1).fill(0);
  bestScore[0] = 0;

  for (let begin = 0; begin < n; begin++) {
    if (bestScore[begin] === -Infinity) continue;
    let hasSingleCharPiece = false;
    const maxLen = Math.min(model.maxPieceLength, n - begin);
    for (let len = 1; len <= maxLen; len++) {
      const candidate = symbols.slice(begin, begin + len).join('');
      const score = model.pieceScores.get(candidate);
      if (score === undefined) continue;
      if (len === 1) hasSingleCharPiece = true;
      const end = begin + len;
      const total = bestScore[begin] + score;
      if (total > bestScore[end]) {
        bestScore[end] = total;
        bestSplitLength[end] = len;
      }
    }
    if (!hasSingleCharPiece) {
      const end = begin + 1;
      const total = bestScore[begin] + unkScore;
      if (total > bestScore[end]) {
        bestScore[end] = total;
        bestSplitLength[end] = 1;
      }
    }
  }

  const pieces: string[] = [];
  let pos = n;
  while (pos > 0) {
    const len = bestSplitLength[pos];
    pieces.push(symbols.slice(pos - len, pos).join(''));
    pos -= len;
  }
  pieces.reverse();
  return pieces;
}

interface EncodeKeywordOptions {
  /** Distinct id reported back in `KeywordResult.keyword` — the "@" field.
   * Defaults to the phrase, uppercased with whitespace collapsed to
   * underscores, since the keywords-file format requires this field to be
   * a single whitespace-free token. */
  id?: string;
  /** Per-keyword boost score — the ":" field. */
  boost?: number;
  /** Per-keyword trigger threshold — the "#" field. */
  threshold?: number;
}

/**
 * Formats one `sherpa-onnx` keywords-file line: `TOKENS [:boost] [#threshold] @id`.
 */
export function formatKeywordLine(pieces: string[], id: string, options: EncodeKeywordOptions = {}): string {
  const parts = [pieces.join(' ')];
  if (options.boost !== undefined) parts.push(`:${options.boost}`);
  if (options.threshold !== undefined) parts.push(`#${options.threshold}`);
  parts.push(`@${id}`);
  return parts.join(' ');
}

async function loadTokenVocabulary(tokensPath: string): Promise<Set<string>> {
  const text = await fs.readFile(tokensPath, 'utf8');
  const tokens = new Set<string>();
  for (const line of text.split('\n')) {
    const token = line.trim().split(/\s+/)[0];
    if (token) tokens.add(token);
  }
  return tokens;
}

/**
 * Encodes one wake phrase into a `sherpa-onnx` keywords-file line, reading
 * `bpe.model` and `tokens.txt` from an already-resolved KWS model directory
 * (see `resolveKwsModelDir` in `kws-models.ts`). Meant to be called once per
 * configured wake word, not per turn: unlike the live ASR vocabulary, this
 * phrase is fixed at config time (see
 * `docs/projects/initial/milestones/m13-voice-navigation-input.plan.md`,
 * TG2 "How a turn works").
 */
export async function encodeWakeWord(
  phrase: string,
  kwsModelDir: string,
  options: EncodeKeywordOptions = {},
): Promise<string> {
  const [bpeModelBuffer, vocabulary] = await Promise.all([
    fs.readFile(path.join(kwsModelDir, 'bpe.model')),
    loadTokenVocabulary(path.join(kwsModelDir, 'tokens.txt')),
  ]);

  const model = parseBpeModel(bpeModelBuffer);
  const pieces = encodeToPieces(phrase, model);
  const oov = pieces.filter((piece) => !vocabulary.has(piece));
  if (oov.length > 0) {
    throw new Error(
      `Wake word "${phrase}" contains characters this model has no token for: ${oov.join(', ')}`,
    );
  }

  const id = options.id ?? phrase.trim().toUpperCase().replace(/\s+/g, '_');
  return formatKeywordLine(pieces, id, options);
}
