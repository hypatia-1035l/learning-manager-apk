/**
 * 生成管线共用的小工具：确定性随机数。
 * 移植自 civ-atlas `src/gen/util.ts`（只取 Rng / mulberry32 / subSeed 三个，去掉噪声依赖）。
 * 口径：同一个种子 = 同一个世界。
 */
export type Rng = () => number;

/** mulberry32：32 位种子 → [0,1) 伪随机序列。 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 从主种子派生出互不相关的子种子，让每个步骤各用一条随机流。 */
export function subSeed(seed: number, salt: string): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < salt.length; i++) {
    h = Math.imul(h ^ salt.charCodeAt(i), 0x85ebca6b);
    h ^= h >>> 13;
  }
  return h >>> 0;
}

/** 32 位整数混合（murmur3 fmix32） */
export function fmix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
