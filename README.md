# HazelJS
[![ko-fi](https://www.ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/G2G71TSDF)<br>
[![License](https://img.shields.io/github/license/cyyynthia/hazeljs.svg?style=flat-square)](https://github.com/cyyynthia/hazeljs/blob/mistress/LICENSE)
[![npm](https://img.shields.io/npm/v/@cyyynthia/hazeljs?style=flat-square)](https://npm.im/@cyyynthia/hazeljs)

TypeScript implementation of the [Hazel-Networking](https://github.com/willardf/Hazel-Networking) C# net library.

**Note**: This is alpha-quality software which is most likely not suitable for production applications. It hasn't
really been tested and the probability of it exploding catastrophically is 0.9. It's also very likely to receive
breaking changes at any given time.

## Requirements
NodeJS 14+ (HazelJS is esm only)

## Installation
```
npm i @cyyynthia/hazeljs
yarn add @cyyynthia/hazeljs
pnpm i @cyyynthia/hazeljs
```

## Usage
The docs only shows basic usage, and aren't super detailed. I'll eventually add better docs once the lib is more
stable and in a production-ready shape. For now, autocomplete is your best friend:tm:

### Server
Here's a basic example:
```js
import { Server } from '@cyyynthia/hazeljs'

const server = new Server() // To create an IPv6 server: new Server(true)
server.on('connection', (connection) => {
  console.log(`New connection from ${connection.remote.address}:${connection.remote.port}`)

  connection.on('hello', (msg) => {
    console.log('Hello received', msg)
  })

  connection.on('message', (msg) => {
    console.log('Message received', msg)
    // Here we just echo it back, but you'd normally process the message and eventually
    // reply with a more appropriated response.
    connection.sendNormal(msg)
  })

  connection.on('close', () => {
    console.log(`Connection with ${connection.remote.address}:${connection.remote.port} closed.`)
  })
})

server.listen(1337)
```

### Client
The client hasn't been implemented in HazelJS yet. :(
