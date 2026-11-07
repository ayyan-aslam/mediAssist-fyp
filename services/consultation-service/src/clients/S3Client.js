import { GetObjectCommand, PutObjectCommand, S3Client as AwsS3Client } from '@aws-sdk/client-s3';

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
}
