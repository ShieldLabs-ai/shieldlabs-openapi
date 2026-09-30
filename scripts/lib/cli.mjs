// Small helpers shared by the command-line scripts.
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** True when the module with this import.meta.url is the script Node was started with. */
export function isMain(moduleUrl) {
  if (!process.argv[1]) return false;
  try {
    return moduleUrl === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}
