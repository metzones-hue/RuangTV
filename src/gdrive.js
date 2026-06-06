const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const FOLDER_NAME = 'RuangTV-Uploads';
let folderId = null;

function getAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      type: 'service_account',
      project_id: process.env.GDRIVE_PROJECT_ID,
      private_key_id: process.env.GDRIVE_PRIVATE_KEY_ID,
      private_key: (process.env.GDRIVE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      client_email: process.env.GDRIVE_CLIENT_EMAIL,
      client_id: process.env.GDRIVE_CLIENT_ID,
    },
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
}

async function getDrive() {
  const auth = getAuth();
  return google.drive({ version: 'v3', auth });
}

async function getOrCreateFolder() {
  if (folderId) return folderId;

  const drive = await getDrive();

  // Cari folder yang sudah ada
  const res = await drive.files.list({
    q: `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id,name)',
  });

  if (res.data.files.length > 0) {
    folderId = res.data.files[0].id;
    return folderId;
  }

  // Buat folder baru
  const folder = await drive.files.create({
    requestBody: {
      name: FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    },
    fields: 'id',
  });

  folderId = folder.data.id;
  console.log(`✓ Google Drive folder dibuat: ${folderId}`);
  return folderId;
}

async function uploadToDrive(filePath, fileName, mimeType) {
  const drive = await getDrive();
  const parentId = await getOrCreateFolder();

  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [parentId],
    },
    media: {
      mimeType,
      body: fs.createReadStream(filePath),
    },
    fields: 'id,webContentLink,webViewLink',
  });

  const fileId = res.data.id;

  // Set file jadi public agar bisa diakses langsung
  await drive.permissions.create({
    fileId,
    requestBody: { role: 'reader', type: 'anyone' },
  });

  // Direct link untuk video/gambar
  const directUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
  const viewUrl = `https://drive.google.com/file/d/${fileId}/view`;

  return { fileId, directUrl, viewUrl };
}

async function deleteFromDrive(fileId) {
  try {
    const drive = await getDrive();
    await drive.files.delete({ fileId });
  } catch (e) {
    console.warn('GDrive delete warning:', e.message);
  }
}

module.exports = { uploadToDrive, deleteFromDrive };
