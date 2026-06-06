const { JWT } = require('google-auth-library');
const fetch = require('node-fetch');
const fs = require('fs');
const FormData = require('form-data');

const FOLDER_NAME = 'RuangTV-Uploads';
let folderId = null;

function getClient() {
  return new JWT({
    email: process.env.GDRIVE_CLIENT_EMAIL,
    key: (process.env.GDRIVE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
}

async function getToken() {
  const client = getClient();
  const { token } = await client.getAccessToken();
  return token;
}

async function getOrCreateFolder() {
  if (folderId) return folderId;

  const token = await getToken();

  // Cari folder yang sudah ada
  const q = encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();

  if (data.files && data.files.length > 0) {
    folderId = data.files[0].id;
    return folderId;
  }

  // Buat folder baru
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  });
  const folder = await createRes.json();
  folderId = folder.id;
  console.log(`✓ Google Drive folder dibuat: ${folderId}`);
  return folderId;
}

async function uploadToDrive(filePath, fileName, mimeType) {
  const token = await getToken();
  const parentId = await getOrCreateFolder();

  // Multipart upload
  const metadata = JSON.stringify({ name: fileName, parents: [parentId] });
  const fileStream = fs.createReadStream(filePath);

  const form = new FormData();
  form.append('metadata', metadata, { contentType: 'application/json' });
  form.append('file', fileStream, { contentType: mimeType, filename: fileName });

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
    { method: 'POST', headers: { Authorization: `Bearer ${token}`, ...form.getHeaders() }, body: form }
  );
  const file = await res.json();
  const fileId = file.id;

  // Set public
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  });

  const directUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
  return { fileId, directUrl };
}

async function deleteFromDrive(fileId) {
  try {
    const token = await getToken();
    await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (e) {
    console.warn('GDrive delete warning:', e.message);
  }
}

module.exports = { uploadToDrive, deleteFromDrive };
