require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const sharp = require('sharp');
const AWS = require('aws-sdk');
const logger = require('pino')();

const PORT = process.env.PORT || 5000;
const FORBIDDEN_CONTENT_TYPE = (process.env.FORBIDDEN_CONTENT_TYPE || '').split(
  ','
);

const app = express();
app.use(
  bodyParser.raw({
    type: '*/*',
    limit: process.env.FILE_SIZE_LIMIT,
  })
);

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY,
  secretAccessKey: process.env.AWS_SECRET_KEY,
});

function isValidContentType(contentType) {
  return FORBIDDEN_CONTENT_TYPE.indexOf(contentType) === -1;
}

function isImage(contentType) {
  return (
    [
      'image/gif',
      'image/jpeg',
      'image/png',
      'image/tiff',
      'image/svg+xml',
    ].indexOf(contentType) !== -1
  );
}

function resizeImage(buffer, width, height) {
  return sharp(buffer).resize(width, height).toBuffer();
}

app.post('/:filename', async (req, res) => {
  const fileName = req.params.filename;
  const fileType = req.get('content-type');
  const fileContent = req.body;

  if (!isValidContentType(fileType)) {
    return res.status(400).send({ error: `${fileType} is not allowed!` });
  }

  try {
    const files = isImage(fileType)
      ? await Promise.all([
          resizeImage(fileContent, 2048, 2048).then((content) => ({
            fileName: `${fileName}_large`,
            fileContent: content,
            fileType,
          })),
          resizeImage(fileContent, 1024, 1024).then((content) => ({
            fileName: `${fileName}_medium`,
            fileContent: content,
            fileType,
          })),
          resizeImage(fileContent, 300, 300).then((content) => ({
            fileName: `${fileName}_thumb`,
            fileContent: content,
            fileType,
          })),
        ])
      : [{ fileName, fileContent, fileType }];

    await Promise.all([
      files.map((file) =>
        s3
          .upload({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: file.fileName,
            Body: file.fileContent,
            ContentType: file.fileType,
          })
          .promise()
      ),
    ]);

    res.status(200).end();
  } catch (err) {
    res.status(500).send(err);
  }
});

app.listen(PORT, () => {
  logger.info(`server listening port ${PORT}`);
});
