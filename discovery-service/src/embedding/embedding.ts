import { readFileSync } from 'fs';
import { join } from 'path';
import type { Tags } from '../types.js';

// Dynamic import — onnxruntime-node is optional (large native binary)
let ort: typeof import('onnxruntime-node') | null = null;

export class EmbeddingService {
  private session: any | null = null;
  private tokenizer: SimpleTokenizer | null = null;
  private modelPath: string;

  constructor(modelPath: string) {
    this.modelPath = modelPath;
  }

  async load(): Promise<void> {
    try {
      ort = await import('onnxruntime-node');
      const modelFile = join(this.modelPath, 'model.onnx');
      this.session = await ort.InferenceSession.create(modelFile, {
        executionProviders: ['cpu'],
      });
      this.tokenizer = new SimpleTokenizer(
        join(this.modelPath, 'vocab.txt'),
      );
    } catch {
      // Fallback: use a simple hash-based embedding if model not available
      // This allows development without downloading the full model
      console.warn(
        'ONNX model not found at %s, using fallback hash embeddings. '
        + 'Download all-MiniLM-L6-v2 ONNX model for production use.',
        this.modelPath,
      );
      this.session = null;
      this.tokenizer = null;
    }
  }

  async embed(tags: Tags): Promise<number[]> {
    // Flatten all tag tiers into a single text for embedding
    const text = [
      ...tags.broad,
      ...tags.mid,
      ...tags.specific,
    ].join(', ');

    if (this.session && this.tokenizer) {
      return this.embedWithModel(text);
    }
    return this.fallbackEmbed(text);
  }

  async cosineSimilarity(a: number[], b: number[]): Promise<number> {
    if (a.length !== b.length || a.length === 0) return 0;

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    if (denom === 0) return 0;
    return dot / denom;
  }

  private async embedWithModel(text: string): Promise<number[]> {
    if (!this.session || !this.tokenizer || !ort) {
      throw new Error('Model not loaded');
    }

    const tokens = this.tokenizer.tokenize(text);
    const inputIds = new BigInt64Array(tokens.map((t) => BigInt(t)));
    const attentionMask = new BigInt64Array(tokens.length).fill(1n);
    const tokenTypeIds = new BigInt64Array(tokens.length).fill(0n);

    const feeds = {
      input_ids: new ort.Tensor('int64', inputIds, [1, tokens.length]),
      attention_mask: new ort.Tensor('int64', attentionMask, [1, tokens.length]),
      token_type_ids: new ort.Tensor('int64', tokenTypeIds, [1, tokens.length]),
    };

    const results = await this.session.run(feeds);

    // Mean pooling over token embeddings
    const output = results['last_hidden_state'] || results['token_embeddings'];
    if (!output) {
      throw new Error('Unexpected model output keys: ' + Object.keys(results).join(', '));
    }

    const data = output.data as Float32Array;
    const hiddenSize = output.dims[2];
    const seqLen = output.dims[1];

    const pooled = new Array(hiddenSize).fill(0);
    for (let i = 0; i < seqLen; i++) {
      for (let j = 0; j < hiddenSize; j++) {
        pooled[j] += data[i * hiddenSize + j];
      }
    }
    for (let j = 0; j < hiddenSize; j++) {
      pooled[j] /= seqLen;
    }

    // L2 normalize
    const norm = Math.sqrt(pooled.reduce((s, v) => s + v * v, 0));
    if (norm > 0) {
      for (let j = 0; j < hiddenSize; j++) {
        pooled[j] /= norm;
      }
    }

    return pooled;
  }

  /**
   * Fallback embedding using character n-gram hashing.
   * Not as good as a real model but allows development and testing
   * without downloading a 90MB ONNX model.
   * Produces a 128-dimensional vector.
   */
  private fallbackEmbed(text: string): number[] {
    const dims = 128;
    const vec = new Array(dims).fill(0);
    const normalized = text.toLowerCase().trim();

    // Character trigram hashing
    for (let i = 0; i < normalized.length - 2; i++) {
      const trigram = normalized.substring(i, i + 3);
      let hash = 0;
      for (let c = 0; c < trigram.length; c++) {
        hash = (hash * 31 + trigram.charCodeAt(c)) | 0;
      }
      const idx = Math.abs(hash) % dims;
      vec[idx] += 1;
    }

    // Word-level hashing for better semantic signal
    const words = normalized.split(/[\s,]+/).filter(Boolean);
    for (const word of words) {
      let hash = 0;
      for (let c = 0; c < word.length; c++) {
        hash = (hash * 37 + word.charCodeAt(c)) | 0;
      }
      const idx = Math.abs(hash) % dims;
      vec[idx] += 2; // Words weighted more than trigrams
    }

    // L2 normalize
    const norm = Math.sqrt(vec.reduce((s: number, v: number) => s + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < dims; i++) {
        vec[i] /= norm;
      }
    }

    return vec;
  }
}

/**
 * Minimal WordPiece tokenizer for BERT-style models.
 * Loads a vocab.txt and does basic tokenization.
 */
class SimpleTokenizer {
  private vocab: Map<string, number>;

  constructor(vocabPath: string) {
    this.vocab = new Map();
    try {
      const text = readFileSync(vocabPath, 'utf-8');
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const token = lines[i].trim();
        if (token) this.vocab.set(token, i);
      }
    } catch {
      console.warn('Vocab file not found at', vocabPath);
    }
  }

  tokenize(text: string): number[] {
    const CLS = this.vocab.get('[CLS]') ?? 101;
    const SEP = this.vocab.get('[SEP]') ?? 102;
    const UNK = this.vocab.get('[UNK]') ?? 100;

    const tokens: number[] = [CLS];
    const words = text.toLowerCase().split(/\s+/).filter(Boolean);

    for (const word of words) {
      // Simple wordpiece: try full word, then prefix subwords
      const id = this.vocab.get(word);
      if (id !== undefined) {
        tokens.push(id);
      } else {
        // Try character-by-character fallback
        let remaining = word;
        let isFirst = true;
        while (remaining.length > 0) {
          let found = false;
          for (let end = remaining.length; end > 0; end--) {
            const sub = isFirst ? remaining.slice(0, end) : '##' + remaining.slice(0, end);
            const subId = this.vocab.get(sub);
            if (subId !== undefined) {
              tokens.push(subId);
              remaining = remaining.slice(isFirst ? end : end);
              isFirst = false;
              found = true;
              break;
            }
          }
          if (!found) {
            tokens.push(UNK);
            break;
          }
        }
      }
    }

    tokens.push(SEP);
    return tokens;
  }
}
