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

import type { RemoteInfo } from 'dgram'
import type { AddressInfo } from 'net'
import { createSocket } from 'dgram'
import TypedEventEmitter from './emitter.js'
import Connection from './connection.js'
import { PacketType } from './constants.js'

type ServerEvents = {
  listening: (addr: AddressInfo) => void
  connection: (conn: Connection) => void
  error: (err: Error) => void
  close: () => void
}

export default class Server extends TypedEventEmitter<ServerEvents> {
  private readonly socket
  private readonly connections = new Map<string, Connection>()

  constructor (ipv6?: boolean) {
    super()

    this.socket = createSocket(ipv6 ? 'udp6' : 'udp4')
    this.socket.on('message', this.handleMessage.bind(this))

    // Proxy events
    this.socket.on('listening', () => this.emit('listening', this.socket.address()))
    this.socket.on('close', () => this.emit('close'))
    this.socket.on('error', (err) => this.emit('error', err))
  }

  async listen (port?: number, bind?: string): Promise<void> {
    return new Promise<void>((resolve) => this.socket.bind(port, bind, () => resolve()))
  }

  async close (): Promise<void> {
    return new Promise<void>((resolve) => {
      const disconnectPromises = []
      for (const connection of this.connections.values()) {
        disconnectPromises.push(connection.disconnect(true))
      }

      Promise.allSettled(disconnectPromises).then(() => {
        this.socket.close(() => resolve())
      })
    })
  }

  private handleMessage (msg: Buffer, remote: RemoteInfo) {
    if (!msg.length) return

    const ip = `${remote.address}:${remote.port}`
    if (!this.connections.has(ip)) {
      if (msg[0] === PacketType.HELLO) {
        const connection = new Connection(remote, this.socket)
        this.emit('connection', connection)
        this.connections.set(ip, connection)

        connection.on('close', () => this.connections.delete(ip))
      }
    }

    this.connections.get(ip)?.emit('data', msg)
  }
}
