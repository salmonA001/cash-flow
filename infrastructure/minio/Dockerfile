# syntax=docker/dockerfile:1.7
# MinIO no longer publishes community images on Docker Hub, so the server and the `mc`
# admin client are compiled here from their official source at pinned release tags.
# To upgrade: change the two ARGs to newer tags from github.com/minio/minio and github.com/minio/mc.

# The Debian-based Go image already includes git; no package downloads needed.
FROM golang:1.24.8-bookworm AS build
ARG MINIO_RELEASE=RELEASE.2025-10-15T17-29-55Z
ARG MC_RELEASE=RELEASE.2025-08-13T08-35-41Z
ENV CGO_ENABLED=0
WORKDIR /src
RUN git clone --depth 1 --branch "$MINIO_RELEASE" https://github.com/minio/minio.git minio \
 && cd minio \
 && go build -tags kqueue -trimpath -ldflags "$(go run buildscripts/gen-ldflags.go)" -o /out/minio .
RUN git clone --depth 1 --branch "$MC_RELEASE" https://github.com/minio/mc.git mc \
 && cd mc \
 && go build -trimpath -ldflags "$(go run buildscripts/gen-ldflags.go)" -o /out/mc .

# Static binaries; alpine's base image already ships a CA bundle.
FROM alpine:3.22
COPY --from=build /out/minio /out/mc /usr/local/bin/
EXPOSE 9000 9001
ENTRYPOINT ["minio"]
