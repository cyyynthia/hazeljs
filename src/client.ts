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

import { createSocket } from 'dgram'
import { HazelBuffer, HazelMessage } from './data.js'
import TypedEventEmitter from './emitter.js'
import Connection from './connection.js'
import { HAZEL_VERSION, PacketType } from './constants.js'

type ClientEvents = {
  connected: () => void
  message: (msg: HazelMessage) => void
  close: (forced: boolean, reason?: number, message?: string) => void
  error: (err: Error) => void
}

export default class Client extends TypedEventEmitter<ClientEvents> {
  private connection: Connection
  connected: boolean = false

  get ping () {
    return this.connection.ping
  }

  constructor (address: string, port: number, ipv6?: boolean) {
    super()

    const socket = createSocket(ipv6 ? 'udp6' : 'udp4')
    this.connection = new Connection(
      { address: address, port: port, family: ipv6 ? 'IPv6' : 'IPv4', size: 0 },
      socket
    )

    this.connection.on('error', (err) => this.emit('error', err))
    this.connection.on('close', (forced, reason, message) => this.emit('close', forced, reason, message))
    this.connection.on('message', (msg) => this.emit('message', msg))
  }

  async sendNormal (...messages: HazelMessage[]): Promise<number> {
    return this.connection.sendNormal(...messages)
  }

  async sendReliable (...messages: HazelMessage[]): Promise<number> {
    return this.connection.sendReliable(...messages)
  }

  async connect (msg?: HazelBuffer): Promise<number> {
    if (this.connected) {
      throw new Error('Already connected!')
    }

    const nonce = this.connection.generateNonce()
    const hello = HazelBuffer.alloc(4 + (msg?.length ?? 0))
    hello.writeByte(PacketType.HELLO)
    hello.writeUInt16(nonce, 1)
    hello.writeByte(HAZEL_VERSION, 3)
    if (msg) hello.writeBuffer(msg, 4)

    const promise = this.connection.sendRawReliable(hello, nonce)
    promise.then(() => {
      this.connected = true
      this.emit('connected')
    })
    return promise
  }

  async disconnect (forced: boolean = false, reason?: number, message?: string): Promise<number> {
    if (!this.connected) {
      throw new Error('Already connected!')
    }

    this.connected = false
    return this.connection.disconnect(forced, reason, message)
  }
}
