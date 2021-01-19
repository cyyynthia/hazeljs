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
  close: () => void
}

export default class Server extends TypedEventEmitter<ServerEvents> {
  private readonly socket = createSocket('udp4')
  private readonly connections = new Map<string, Connection>()

  constructor () {
    super()

    this.socket.on('message', this.handleMessage.bind(this))

    // Proxy events
    this.socket.on('listening', () => this.emit('listening', this.socket.address()))
    this.socket.on('close', () => this.emit('close'))
  }

  send (data: Buffer, to: RemoteInfo): Promise<number>
  send (data: Buffer, to: RemoteInfo, callback: (error: Error | null, bytes: number) => void): void
  send (data: Buffer, to: RemoteInfo, callback?: (error: Error | null, bytes: number) => void) {
    if (callback) {
      this.socket.send(data, to.port, to.address, callback)
    } else {
      return new Promise<number>((resolve, reject) => {
        this.socket.send(data, to.port, to.address, (err, bytes) => {
          if (err) {
            reject(err)
          } else {
            resolve(bytes)
          }
        })
      })
    }
  }

  listen (port?: number, bind?: string): Promise<void>
  listen (port: number | undefined, bind: string | undefined, callback: () => void): void
  listen (port?: number, bind?: string, callback?: () => void) {
    if (callback) {
      this.socket.bind(port, bind, callback)
    } else {
      return new Promise<void>((resolve) => this.socket.bind(port, bind, () => resolve()))
    }
  }

  close (): Promise<void>
  close (callback: () => void): void
  close (callback?: () => void) {
    if (callback) {
      this.socket.close(callback)
    } else {
      return new Promise<void>((resolve) => this.socket.close(() => resolve()))
    }
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
