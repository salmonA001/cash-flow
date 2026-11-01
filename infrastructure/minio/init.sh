#!/bin/sh
# Idempotent MinIO bootstrap (runs in the minio/mc image):
# private buckets, versioning, temp-upload expiry and a least-privilege application user.
set -eu

mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"

for bucket in design-originals design-exports design-mockups digital-products temporary-uploads report-archives; do
  mc mb --ignore-existing "local/$bucket"
  mc anonymous set none "local/$bucket"
done

for bucket in design-originals design-exports digital-products report-archives; do
  mc version enable "local/$bucket"
done

mc ilm rule add --expire-days 1 local/temporary-uploads 2>/dev/null || true

cat > /tmp/cfe-app-policy.json <<'POLICY'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetBucketLocation", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::design-originals", "arn:aws:s3:::design-exports", "arn:aws:s3:::design-mockups",
        "arn:aws:s3:::digital-products", "arn:aws:s3:::temporary-uploads", "arn:aws:s3:::report-archives"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": [
        "arn:aws:s3:::design-originals/*", "arn:aws:s3:::design-exports/*", "arn:aws:s3:::design-mockups/*",
        "arn:aws:s3:::digital-products/*", "arn:aws:s3:::temporary-uploads/*", "arn:aws:s3:::report-archives/*"
      ]
    }
  ]
}
POLICY

mc admin policy create local cfe-app /tmp/cfe-app-policy.json 2>/dev/null || mc admin policy update local cfe-app /tmp/cfe-app-policy.json 2>/dev/null || true
mc admin user add local "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY"
mc admin policy attach local cfe-app --user "$MINIO_ACCESS_KEY" 2>/dev/null || true
echo "MinIO initialized"
