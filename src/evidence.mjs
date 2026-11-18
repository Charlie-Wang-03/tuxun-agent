import * as fs from 'node:fs/promises';
import { inspectStreetPng } from './image-check.mjs';

// Evidence failures must never be converted into a fallback selection.
export class EvidenceError extends Error {
  constructor(operation, cause) {
    super(`运行证据不可用（${operation}）：${cause.message}`, {cause});
    this.name = 'EvidenceError';
  }
}

export function inspectScreenshot(png, point = null) {
  try { return inspectStreetPng(png, point); }
  catch (cause) { throw new EvidenceError('PNG 解码', cause); }
}

export function decodeScreenshot(shot) {
  try {
    if (typeof shot?.data !== 'string' || !shot.data.length || shot.data.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(shot.data)) throw Error('截图 base64 无效');
    const png = Buffer.from(shot.data, 'base64');
    return {...shot, png, check: inspectScreenshot(png)};
  } catch (cause) {
    if (cause instanceof EvidenceError) throw cause;
    throw new EvidenceError('截图解码', cause);
  }
}

async function io(operation, file, args) {
  try { return await fs[operation](file, ...args); }
  catch (cause) { throw new EvidenceError(`${operation} ${file}`, cause); }
}
export const readFile = (file, ...args) => io('readFile', file, args);
export const writeFile = (file, ...args) => io('writeFile', file, args);
export const appendFile = (file, ...args) => io('appendFile', file, args);

export async function readScreenshot(file, point = null) {
  const png = await readFile(file);
  return {png, check: inspectScreenshot(png, point)};
}
