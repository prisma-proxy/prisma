FROM rust:1-bookworm AS builder
WORKDIR /src

# Stage 1: cache dependencies
COPY Cargo.toml Cargo.lock ./
COPY crates/prisma-core/Cargo.toml crates/prisma-core/
COPY crates/prisma-server/Cargo.toml crates/prisma-server/
COPY crates/prisma-client/Cargo.toml crates/prisma-client/
COPY crates/prisma-cli/Cargo.toml crates/prisma-cli/
COPY crates/prisma-mgmt/Cargo.toml crates/prisma-mgmt/
COPY crates/prisma-ffi/Cargo.toml crates/prisma-ffi/
RUN mkdir -p crates/prisma-core/src crates/prisma-server/src crates/prisma-client/src \
             crates/prisma-mgmt/src crates/prisma-ffi/src \
    && echo "fn main(){}" > crates/prisma-cli/src/main.rs \
    && echo "fn main(){}" > crates/prisma-server/src/main.rs \
    && echo "fn main(){}" > crates/prisma-client/src/main.rs \
    && touch crates/prisma-core/src/lib.rs crates/prisma-server/src/lib.rs \
             crates/prisma-client/src/lib.rs crates/prisma-mgmt/src/lib.rs \
             crates/prisma-ffi/src/lib.rs \
    && cargo build --release -p prisma-cli 2>/dev/null || true

# Stage 2: build actual code (deps are cached)
COPY . .
RUN cargo build --release -p prisma-cli

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /src/target/release/prisma /usr/local/bin/prisma

EXPOSE 8443/tcp 8443/udp 9090/tcp

ENTRYPOINT ["prisma"]
CMD ["server", "-c", "/config/server.toml"]
