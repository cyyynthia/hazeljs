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
  private pendingAck = new Map<number, () => void>()
  private pendingPings = 0
  private lastPings = [ 0, 0, 0, 0, 0 ]
  private seenHello = false
  private nonce = 0

  get ping () {
    return this.lastPings.reduce((a, b) => a + b, 0) / 5
  }

  constructor (private readonly remote: RemoteInfo, private readonly socket: Socket) {
    super()

    this.once('close', () => {
      clearInterval(this.pingTimer)
      this.pendingAck.clear() // Clear memory
    })
    this.on('data', (msg) => this.handleMessage(msg))
  }

  async sendNormal (...messages: HazelMessage[]): Promise<number> {
    const length = messages.reduce((a, b) => a + b.data.length + 3, 1)
    const buf = HazelBuffer.alloc(length)
    buf.writeByte(PacketType.NORMAL)

    let cursor = 1
    messages.forEach((message) => cursor += buf.writeHazelMessage(message, cursor))

    return this.sendRaw(buf)
  }

  async sendReliable (...messages: HazelMessage[]): Promise<number> {
    const nonce = this.getNonce()
    const length = messages.reduce((a, b) => a + b.data.length + 3, 3)
    const buf = HazelBuffer.alloc(length)
    buf.writeByte(PacketType.RELIABLE)
    buf.writeUInt16(nonce, 1)

    let cursor = 3
    messages.forEach((message) => cursor += buf.writeHazelMessage(message, cursor))

    return new Promise<number>((resolve, reject) => {
      let attempts = 0
      let bytes = -1
      const send = async () => (bytes = await this.sendRaw(buf))
      const interval = setInterval(() => {
        if (attempts === 10) {
          clearInterval(interval)
          reject(new Error('Reliable message not acknowledged after 10 attempts.'))
          this.disconnect(true)
        } else {
          send()
          attempts++
        }
      }, 300)

      send()
      this.pendingAck.set(nonce, () => {
        clearInterval(interval)
        resolve(bytes)
      })
    })
  }

  async disconnect (force?: boolean): Promise<number> {
    this.emit('close')

    // todo: reason & message
    const buf = HazelBuffer.alloc(2)
    buf.writeByte(PacketType.DISCONNECT)
    buf.writeBoolean(!force)
    return this.sendRaw(buf)
  }

  private async sendRaw (data: HazelBuffer): Promise<number> {
    const buf = 'toBuffer' in data ? data.toBuffer() : data

    return new Promise((resolve, reject) => {
      this.socket.send(buf, this.remote.port, this.remote.address, (err, bytes) => {
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
  
    const buf = HazelBuffer.alloc(4)
    buf.writeByte(PacketType.ACKNOWLEDGEMENT)
    buf.writeUInt16(nonce, 1)
    buf.writeByte(pending, 3)
    return this.sendRaw(buf)
  }

  private async sendPing (): Promise<number> {
    if (this.pendingPings >= 10) {
      return this.disconnect(true)
    }

    const nonce = this.getNonce()
    const pingTime = Date.now()
    this.pendingAck.set(nonce, () => {
      this.pendingPings--
      this.lastPings.shift()
      this.lastPings.push(Date.now() - pingTime)
    })

    this.pendingPings++
    const buf = HazelBuffer.alloc(3)
    buf.writeByte(PacketType.PING)
    buf.writeUInt16(nonce, 1)
    return this.sendRaw(buf)
  }

  private handleMessage (msg: Buffer) {
    switch (msg[0]) {
      case PacketType.NORMAL:
        this.handleMessagePacket(new HazelBuffer(msg), false)
        break
      case PacketType.HELLO:
      case PacketType.RELIABLE:
        this.handleMessagePacket(new HazelBuffer(msg), true)
        break
      case PacketType.DISCONNECT:
        this.emit('close') // todo: parse reason & stuff?
        break
      case PacketType.ACKNOWLEDGEMENT:
        if (msg.length >= 3) {
          const id = msg.readUInt16BE(1)
          if (this.pendingAck.has(id)) {
            this.pendingAck.get(id)!()
            this.pendingAck.delete(id)
          }
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

  private handleMessagePacket (msg: HazelBuffer, ack: boolean) {
    let cursor = ack ? 3 : 1
    if (msg.length < cursor) {
      this.disconnect(true)
      return
    }

    if (ack) this.sendAck(msg.readUInt16(1))
    const isHello = msg.readByte(0) === PacketType.HELLO
    if (isHello) {
      if (this.seenHello || msg.length < 4) {
        this.disconnect(true)
        return
      }

      this.seenHello = true
      const hazelVer = msg.readByte(3)
      if (hazelVer !== HAZEL_VERSION) {
        this.disconnect(true)
        return
      }

      this.emit('hello', msg.slice(4, msg.length))
      return
    }

    while (cursor < msg.length) {
      const message = msg.readHazelMessage(cursor)
      cursor += 3 + message.data.length
      this.emit('message', message)
    }
  }

  private getNonce () {
    this.nonce = (this.nonce + 1) % 65535
    return this.nonce
  }
}
