import nodeTest from 'node:test';

// Some Packet 0 gates exercise POSIX-only behaviour: bash packaging scripts,
// symlink-substitution defences, 0600/0700 file modes and pg_dump/pg_restore
// stubs. Those properties are not meaningful on NTFS (and bash resolves to the
// WSL stub on a plain Windows machine), so on Windows the tests are reported as
// skipped instead of failing for reasons unrelated to the application. They run
// unchanged on Linux, macOS and WSL, or on Windows with NEARPILL_POSIX_TESTS=1.
export const posixSkipReason = process.platform === 'win32' && process.env.NEARPILL_POSIX_TESTS !== '1'
  ? 'requires a POSIX shell, symlinks and file modes; run on Linux/macOS/WSL (or set NEARPILL_POSIX_TESTS=1)'
  : false;

export function posixTest(name, optionsOrFn, maybeFn) {
  const options = typeof optionsOrFn === 'function' ? {} : (optionsOrFn ?? {});
  const fn = typeof optionsOrFn === 'function' ? optionsOrFn : maybeFn;
  return nodeTest(name, { ...options, skip: options.skip || posixSkipReason }, fn);
}
