import { GetObjectCommand, S3Client as AwsS3Client } from '@aws-sdk/client-s3';

// Reads files from the Amazon S3 bucket. Kept small, so tests can replace it.
export class S3Client {
  constructor({ region, accessKeyId, secretAccessKey, bucket }) {
    this.bucket = bucket;
    this.s3 = new AwsS3Client({ region, credentials: { accessKeyId, secretAccessKey } });
  }

  // The whole file, for an email attachment.
  async getBuffer(key) {
    const result = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await result.Body.transformToByteArray());
  }
}
