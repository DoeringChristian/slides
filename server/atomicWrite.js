import fs from 'fs/promises';
import crypto from 'crypto';

/**
 * Replace a file's contents atomically: write a sibling temporary file, then
 * rename it over the target (atomic on one filesystem). A reader never sees
 * a half-written file, and a crash mid-write leaves the previous version
 * intact — a plain writeFile truncates first, so a large deck could be read
 * (or left) half-written.
 */
export async function writeFileAtomic(target, data, options) {
  const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tmp, data, options);
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}
