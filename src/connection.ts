/*
 * Copyright (c) 2021 Cynthia K. Rey, All rights reserved.
 * 
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 * 
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 * 
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

import type { Socket, RemoteInfo } from 'dgram'
import TypedEventEmitter from './emitter.js'
import { HazelMessage, HazelBuffer } from './data.js'
import { HAZEL_VERSION, PacketType } from './constants.js'

type ConnectionEvents = {
  hello: (msg: HazelBuffer) => void
  message: (msg: HazelMessage) => void

  close: () => void
  data: (msg: Buffer) => void
}

export default class Connection extends TypedEventEmitter<ConnectionEvents> {
  private readonly pingTimer = setInterval(() => this.sendPing(), 1500)
  private pendingPings = new Map<number, number>()
  private pendingAck = new Set()
  private lastPings = [ 0, 0, 0, 0, 0 ]
  private seenHello = false
  private nonce = 0

  get ping () {
    return this.lastPings.reduce((a, b) => a + b, 0) / 5
  }

  constructor (private readonly remote: RemoteInfo, private readonly socket: Socket) {
    super()

    this.once('close', () => clearInterval(this.pingTimer))
    this.on('data', (msg) => this.handleMessage(msg))
  }

  async sendNormal (...messages: HazelMessage[]) {
    const length = messages.reduce((a, b) => a + b.data.length + 3, 1)
    const buf = Buffer.alloc(length)
    this.writeMessages(buf, 1, messages)
    return this.sendRaw(buf)
  }

  async sendReliable (...messages: HazelMessage[]) {
    const nonce = this.getNonce()
    const length = messages.reduce((a, b) => a + b.data.length + 3, 3)
    const buf = Buffer.alloc(length)
    buf.writeUInt8(PacketType.RELIABLE)
    buf.writeUInt16BE(nonce, 1)
    this.writeMessages(buf, 3, messages)

    // todo: retry if not acknowledged & disconnect if not ack'd after a few retries
    return this.sendRaw(buf)
  }

  async disconnect (force?: boolean) { // todo: reason & message
    this.emit('close')
    return this.sendRaw(Buffer.from([ PacketType.DISCONNECT, force ? 0 : 1 ]))
  }

  private writeMessages (buffer: Buffer, offset: number, messages: HazelMessage[]) {
    let cursor = 0
    for (const message of messages) {
      buffer.writeUInt16BE(message.data.length, offset + cursor)
      buffer.writeUInt8(message.tag, offset + cursor + 2)
      message.data.copy(buffer, offset + cursor + 3)
      cursor += message.data.length + 3
    }
  }

  private async sendRaw (data: Buffer): Promise<number> {
    return new Promise((resolve, reject) => {
      this.socket.send(data, this.remote.port, this.remote.address, (err, bytes) => {
        if (err) {
          reject(err)
        } else {
          resolve(bytes)
        }
      })
    })
  }

  private async sendAck (nonce: number): Promise<number> {
    let pending = 0
    for (let i = 1; i <= 8; i++) {
      if (!this.pendingAck.has(nonce - i)) {
        pending |= 1 << (i - 1);
      }
    }
  
    const buf = Buffer.alloc(4)
    buf.writeUInt8(PacketType.ACKNOWLEDGEMENT)
    buf.writeUInt16BE(nonce, 1)
    buf.writeUInt8(pending, 3)
    return this.sendRaw(buf)
  }

  private async sendPing (): Promise<number> {
    if (this.pendingPings.size >= 10) {
      return this.disconnect(true)
    }

    const nonce = this.getNonce()
    this.pendingPings.set(nonce, Date.now())
    this.pendingAck.add(nonce)

    const buf = Buffer.alloc(3)
    buf.writeUInt8(PacketType.PING)
    buf.writeUInt16BE(nonce, 1)
    return this.sendRaw(buf)
  }

  private handleMessage (msg: Buffer) {
    switch (msg[0]) {
      case PacketType.NORMAL:
        this.handleMessagePacket(msg, false)
        break
      case PacketType.HELLO:
      case PacketType.RELIABLE:
        this.handleMessagePacket(msg, true)
        break
      case PacketType.DISCONNECT:
        this.emit('close') // todo: parse reason & stuff?
        break
      case PacketType.ACKNOWLEDGEMENT:
        if (msg.length >= 3) {
          const id = msg.readUInt16BE(1)
          if (this.pendingPings.has(id)) {
            this.lastPings.shift()
            this.lastPings.push(Date.now() - this.pendingPings.get(id)!)
            this.pendingPings.delete(id)
          }
          this.pendingAck.delete(id)
        }
        break
      case PacketType.FRAGMENT:
        // Not implemented in Hazel yet, but it exists apparently.
        break
      case PacketType.PING:
        if (msg.length >= 3) this.sendAck(msg.readUInt16BE(1))
        break
    }
  }

  private handleMessagePacket (msg: Buffer, ack: boolean) {
    let cursor = ack ? 3 : 1
    if (msg.length < cursor) {
      this.disconnect(true)
      return
    }

    if (ack) this.sendAck(msg.readUInt16BE(1))
    const isHello = msg[0] === PacketType.HELLO
    if (isHello) {
      if (this.seenHello || msg.length < 4) {
        this.disconnect(true)
        return
      }

      this.seenHello = true
      const hazelVer = msg[3]
      if (hazelVer !== HAZEL_VERSION) {
        this.disconnect(true)
        return
      }

      this.emit('hello', new HazelBuffer(msg.slice(4, msg.length)))
      return
    }

    while (cursor < msg.length) {
      const length = msg.readUInt16BE(cursor)
      const tag = msg.readUInt8(cursor += 2)
      const data = new HazelBuffer(msg.slice(++cursor, cursor += length))

      this.emit('message', { tag: tag, data: data })
    }
  }

  private getNonce () {
    this.nonce = (this.nonce + 1) % 65535
    return this.nonce
  }
}
