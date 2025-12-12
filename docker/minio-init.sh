#!/bin/sh
# ===========================================
# MinIO Initialization Script
# Creates the 'downloads' bucket on startup
# ===========================================

set -e

echo "Waiting for MinIO to be ready..."

# Wait until MinIO is ready
until mc alias set localminio http://minio:9000 ${S3_ACCESS_KEY_ID:-minioadmin} ${S3_SECRET_ACCESS_KEY:-minioadmin}
do
  echo "MinIO not ready, retrying in 2 seconds..."
  sleep 2
done

echo "MinIO is ready!"

# Create bucket if not exists
mc mb --ignore-existing localminio/${S3_BUCKET_NAME:-downloads}

# Set bucket policy to allow downloads
mc anonymous set download localminio/${S3_BUCKET_NAME:-downloads}

echo "Bucket '${S3_BUCKET_NAME:-downloads}' is ready!"
