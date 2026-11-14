// Task attachment files, ported from teamo/main.py's local-disk UPLOAD_DIR onto Supabase
// Storage — serverless has no persistent disk to save to at all. The bucket is private;
// reads go through a short-lived signed URL rather than streaming bytes through a
// function, same tradeoff FastAPI-style serverless setups usually make.
const { createClient } = require("@supabase/supabase-js");

const BUCKET = "task-attachments";
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function uploadFile(key, buffer, contentType) {
  const { error } = await supabase.storage.from(BUCKET).upload(key, buffer, { contentType, upsert: false });
  if (error) throw error;
}

async function removeFiles(keys) {
  if (!keys || !keys.length) return;
  const { error } = await supabase.storage.from(BUCKET).remove(keys);
  if (error) throw error;
}

async function signedUrl(key, expiresIn = 60, downloadName) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(key, expiresIn, downloadName ? { download: downloadName } : undefined);
  if (error) throw error;
  return data.signedUrl;
}

// Project files: big files never pass through the function (Netlify caps a request body at ~6 MB).
// The browser uploads straight to Storage with a one-time signed upload URL instead.
const PROJECT_BUCKET = "project-files";
let bucketReady = false;

async function ensureProjectBucket() {
  if (bucketReady) return;
  const { error } = await supabase.storage.createBucket(PROJECT_BUCKET, { public: false });
  if (error && !/already exists|duplicate/i.test(error.message || "")) throw error;
  bucketReady = true;
}

async function projectUploadUrl(key) {
  await ensureProjectBucket();
  const { data, error } = await supabase.storage.from(PROJECT_BUCKET).createSignedUploadUrl(key);
  if (error) throw error;
  return data.signedUrl;
}

async function projectFileExists(key) {
  const { error } = await supabase.storage.from(PROJECT_BUCKET).createSignedUrl(key, 5);
  return !error;
}

async function projectDownloadUrl(key, downloadName, expiresIn = 3600) {
  const { data, error } = await supabase.storage.from(PROJECT_BUCKET).createSignedUrl(key, expiresIn, { download: downloadName });
  if (error) throw error;
  return data.signedUrl;
}

async function removeProjectFiles(keys) {
  if (!keys || !keys.length) return;
  const { error } = await supabase.storage.from(PROJECT_BUCKET).remove(keys);
  if (error) throw error;
}

module.exports = { uploadFile, removeFiles, signedUrl, projectUploadUrl, projectFileExists, projectDownloadUrl, removeProjectFiles };
