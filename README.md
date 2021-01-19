# HazelJS
TypeScript implementation of the [Hazel-Networking](https://github.com/willardf/Hazel-Networking) C# net library.

**WARNING**: This implementation is alpha quality, and is probably super buggy. It hasn't been tested (and it really
should because udp is a bitch), and only supports the server-side (and probably poorly).

It's currently lacking some very important stuff:
 - being able to send messages (lol)
 - full support of the disconnect payload
 - utils to read stuff Buffer cannot easily

## Requirements
NodeJS 14+ (HazelJS is esm only)

## Installation
**NOTE**: The package hasn't been published yet.
```
npm i @cyyynthia/hazeljs
yarn add @cyyynthia/hazeljs
pnpm i @cyyynthia/hazeljs
```

## Usage
you don't. (jk, I need to get around writing that part. will do once everything's in a decent shape)
