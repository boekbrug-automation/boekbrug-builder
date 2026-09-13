// src/lib/document-storage.ts
// [EEN-KLUIS] The one door to where the owner's paper physically lives.
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────
// Fifty-seven call sites in twenty-seven files reached into `supabase.storage.from("documents")`
// directly. Each one repeated the bucket name, and each one decided for itself what a failure
// meant. That is fine right up until the day the bucket is renamed, a second bucket appears, or
// the files move to another provider — at which point the change is twenty-seven diffs on the
// path that holds documents somebody is legally required to keep for seven years.
//
// This module is not an abstraction for its own sake. It is the place where "where the bytes are"
// can change without the rest of the app having an opinion about it.
//
// ── WHAT IT DELIBERATELY DOES *NOT* DO ──────────────────────────────────────────────────────
// It does not choose the client. Every function takes one, because WHICH client reads or writes is
// a security decision, not a plumbing detail: a session client is bound by RLS to one owner, and
// the pipeline (service-role) client is not. Hiding that choice behind a service would make the
// most dangerous line in a route the invisible one. The caller says who is acting; this module
// says where the bytes go.
//
// It also has no exists() and no getMetadata(). Both were proposed; neither has a single caller in
// this codebase. An exported function nobody calls is a promise the next reader assumes is kept —
// this repo has three of those already, and each one cost something to find.
//
// ── THE FIVE OPERATIONS THAT ARE REAL ───────────────────────────────────────────────────────
// Measured, not guessed: remove (26), upload (16), download (9), createSignedUrl (5),
// createSignedUrls (1). One bucket.

/** The single bucket. Named once, here, so a rename is one line rather than fifty-seven. */
export const DOCUMENT_BUCKET = "documents";

/**
 * The slice of a Supabase client this module needs. Structural, so a session client, the pipeline
 * client and a test double all satisfy it without importing a Supabase type into every caller.
 */
/**
 * One row of a bulk signing call. Note `signedUrl` is NULLABLE and each row carries its own
 * `error`: asking for twenty links can fail for three of them and succeed for seventeen, and the
 * caller has to be able to tell which. Flattening that to `string` would have made a missing link
 * look like a present one.
 */
export interface SignedUrlRow {
  path: string | null;
  signedUrl: string | null;
  error: string | null;
}

// Promise, not PromiseLike: callers legitimately write `removeOriginals(...).catch(...)` on a
// fire-and-forget cleanup, and the storage client really does return a Promise. A PromiseLike
// return type would have quietly forbidden that at exactly the call sites that need it.
/** A listed object. Supabase marks a synthetic "folder" with a null id; everything else is real. */
export interface StoredEntry {
  id: string | null;
  name: string;
}

export interface StorageCapableClient {
  storage: {
    from: (bucket: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      upload: (path: string, body: any, opts?: { contentType?: string; upsert?: boolean }) => Promise<{ data: unknown; error: { message: string } | null }>;
      download: (path: string) => Promise<{ data: Blob | null; error: { message: string } | null }>;
      remove: (paths: string[]) => Promise<{ data: unknown; error: { message: string } | null }>;
      createSignedUrl: (path: string, expiresIn: number) => Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>;
      createSignedUrls: (paths: string[], expiresIn: number) => Promise<{ data: SignedUrlRow[] | null; error: { message: string } | null }>;
      list: (prefix: string, opts: { limit: number; offset: number }) => Promise<{ data: StoredEntry[] | null; error: { message: string } | null }>;
    };
  };
}

/** How long a signed link stays usable. One hour, the value every call site already passed. */
export const SIGNED_URL_SECONDS = 3600;

/**
 * Write the original bytes.
 *
 * `upsert` defaults to FALSE, which is the whole point: an upload that would overwrite an existing
 * object fails instead. The originals are evidence, and evidence that a second upload can silently
 * replace is not evidence. A caller that genuinely means to replace says so.
 */
export function storeOriginal(
  client: StorageCapableClient,
  path: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any,
  opts: { contentType?: string; upsert?: boolean } = {},
): Promise<{ data: unknown; error: { message: string } | null }> {
  return client.storage.from(DOCUMENT_BUCKET).upload(path, body, {
    ...(opts.contentType ? { contentType: opts.contentType } : {}),
    upsert: opts.upsert === true,
  });
}

/** Read the original bytes back. */
export function getOriginal(
  client: StorageCapableClient,
  path: string,
): Promise<{ data: Blob | null; error: { message: string } | null }> {
  return client.storage.from(DOCUMENT_BUCKET).download(path);
}

/**
 * Delete originals.
 *
 * Takes a LIST even for one path, because that is the shape the storage API has and hiding it
 * behind a single-path helper would tempt a caller into a loop of round-trips. Nothing here asks
 * whether the document may be deleted — that question belongs to the row, not to the bytes, and
 * public.document_is_referenced() is where it is answered.
 */
export function removeOriginals(
  client: StorageCapableClient,
  paths: string[],
): Promise<{ data: unknown; error: { message: string } | null }> {
  return client.storage.from(DOCUMENT_BUCKET).remove(paths);
}

/**
 * One page of what is actually stored under a prefix.
 *
 * Found late, and worth saying why: the first survey of this codebase grepped for the bucket as a
 * STRING and reported five operations. Four files name it through a `const BUCKET = "documents"`
 * instead, and one of those — the retention purge — uses list() to walk an account's whole tree
 * before deleting it. A door built from the string-literal survey alone would have left the single
 * most destructive caller outside it.
 */
export function listOriginals(
  client: StorageCapableClient,
  prefix: string,
  opts: { limit: number; offset: number },
): Promise<{ data: StoredEntry[] | null; error: { message: string } | null }> {
  return client.storage.from(DOCUMENT_BUCKET).list(prefix, opts);
}

/** A time-limited link to one original. */
export function signedUrl(
  client: StorageCapableClient,
  path: string,
  expiresIn: number = SIGNED_URL_SECONDS,
): Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }> {
  return client.storage.from(DOCUMENT_BUCKET).createSignedUrl(path, expiresIn);
}

/** Time-limited links to many originals, in one round-trip. */
export function signedUrls(
  client: StorageCapableClient,
  paths: string[],
  expiresIn: number = SIGNED_URL_SECONDS,
): Promise<{ data: SignedUrlRow[] | null; error: { message: string } | null }> {
  return client.storage.from(DOCUMENT_BUCKET).createSignedUrls(paths, expiresIn);
}
