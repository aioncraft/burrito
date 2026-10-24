# Burrito

Tooling for building and maintaining Firefox-based browsers.

Early development. The project currently contains a Bun and TypeScript starter. Patch management and build orchestration are planned.

## Development

Install [Bun](https://bun.com), using the version specified in `package.json`, then clone the repository and install dependencies:

```sh
git clone https://github.com/aioncraft/burrito.git
cd burrito
bun install --frozen-lockfile
```

Run the starter:

```sh
bun run dev
```

Check types:

```sh
bun run typecheck
```
