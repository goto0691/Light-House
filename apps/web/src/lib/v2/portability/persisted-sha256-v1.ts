import { SHA256 } from "@noble/hashes/sha2";

export type PersistedSha256StateV1 = Readonly<{
  version: 1;
  words: readonly [number, number, number, number, number, number, number, number];
  bufferHex: string;
  length: number;
  position: number;
}>;

const WORD_MIN = -0x8000_0000;
const WORD_MAX = 0x7fff_ffff;

function bytesToHex(value: Uint8Array) {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value: string) {
  if (value.length % 2 !== 0 || /[^a-f0-9]/.test(value)) throw new Error("sha256_state_invalid");
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
}

function assertState(value: PersistedSha256StateV1) {
  if (
    value.version !== 1
    || value.words.length !== 8
    || value.words.some((word) => !Number.isInteger(word) || word < WORD_MIN || word > WORD_MAX)
    || !Number.isSafeInteger(value.length)
    || value.length < 0
    || !Number.isInteger(value.position)
    || value.position < 0
    || value.position >= 64
    || value.length % 64 !== value.position
    || value.bufferHex.length !== value.position * 2
  ) throw new Error("sha256_state_invalid");
}

class PersistableSha256 extends SHA256 {
  restore(value: PersistedSha256StateV1) {
    assertState(value);
    this.set(...value.words);
    this.length = value.length;
    this.pos = value.position;
    this.buffer.fill(0);
    this.buffer.set(hexToBytes(value.bufferHex));
    this.finished = false;
    this.destroyed = false;
    return this;
  }

  snapshot(): PersistedSha256StateV1 {
    return {
      version: 1,
      words: this.get() as PersistedSha256StateV1["words"],
      bufferHex: bytesToHex(this.buffer.subarray(0, this.pos)),
      length: this.length,
      position: this.pos,
    };
  }
}

export function initialPersistedSha256State(): PersistedSha256StateV1 {
  return new PersistableSha256().snapshot();
}

export function updatePersistedSha256(
  state: PersistedSha256StateV1,
  bytes: Uint8Array,
): PersistedSha256StateV1 {
  return new PersistableSha256().restore(state).update(bytes).snapshot();
}

export function digestPersistedSha256(state: PersistedSha256StateV1) {
  return bytesToHex(new PersistableSha256().restore(state).digest());
}
