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

module.exports = { uploadFile, removeFiles, signedUrl };
