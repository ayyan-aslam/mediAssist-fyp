import { DeleteObjectsCommand, GetObjectCommand, PutObjectCommand, S3Client as AwsS3Client } from '@aws-sdk/client-s3';

// Saves and reads files in the Amazon S3 bucket, encrypted with AES-256. Kept small, so tests can replace it.
export class S3Client {
  constructor({ region, accessKeyId, secretAccessKey, bucket }) {
    this.bucket = bucket;
    this.s3 = new AwsS3Client({ region, credentials: { accessKeyId, secretAccessKey } });
  }

  // Returns the file key. Uploading the same key again replaces the file with the same content.
  async upload(key, body, contentType) {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ServerSideEncryption: 'AES256',
      }),
    );
    return key;
  }

  // Returns the file as a Buffer.
  async download(key) {
    const result = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await result.Body.transformToByteArray());
  }

  // Deletes the files (up to 1,000 keys per request; a consultation has at most 180 parts).
  // Throws when S3 reports any key it could not delete.
  async deleteMany(keys) {
    for (let i = 0; i < keys.length; i += 1000) {
      const result = await this.s3.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true },
        }),
      );
      if (result.Errors?.length) {
        throw new Error(`S3 could not delete ${result.Errors.length} file(s): ${result.Errors[0].Code}`);
      }
    }
  }
}
